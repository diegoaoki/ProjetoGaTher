import { Room, Client } from "@colyseus/core";
import { eq } from "drizzle-orm";
import { OfficeState, Player, Desk, Door, LockedRoom, AccessRequest, SecurityNPC } from "./schema";
import { DOORS, DOOR_OPEN_RADIUS_PX, DOOR_CLOSE_TIMEOUT_MS } from "./doors";
import { verifyAuthToken } from "./auth/jwt";
import { getDb } from "./db/client";
import { profiles, users, deskReservations, messages, messageReactions } from "./db/schema";
import { and, eq as eqOp } from "drizzle-orm";
import { DESKS, getDeskById, getSeatPosition } from "./desks";
import { isAdminEmail } from "./auth/admin";
import { markOnline, markOffline } from "./presence";

interface MoveMessage {
  x: number;
  y: number;
  direction: string;
  isMoving: boolean;
}

interface AppearanceMessage {
  bodyColor?: string;
  hairColor?: string;
  characterId?: string;
}

interface DeskClaimMessage {
  deskId: string;
}

interface TeleportToPlayerMessage {
  targetSessionId: string;
}

interface TeleportToDeskMessage {
  deskId: string;
}

interface InviteMessage {
  targetSessionId: string;
}

interface InviteResponseMessage {
  fromSessionId: string;
  accepted: boolean;
}

interface ChatSendMessage {
  channelType: "global" | "dm" | "room";
  recipientId?: string;  // userId, obrigatório pra DM
  content: string;       // texto (max 2000 chars)
}

interface ChatReactionToggleMessage {
  messageId: string;
  emoji: string;
}

interface RoomLockMessage {
  roomId: string;
}

interface AccessRequestMessage {
  roomId: string;
}

interface AccessRespondMessage {
  roomId: string;
  requesterId: string;
  accepted: boolean;
}

interface BubbleInviteMessage {
  targetSessionId: string;
}

interface BubbleRespondMessage {
  fromSessionId: string;
  accepted: boolean;
}

/**
 * Bolha de conversa privada (N pessoas). Distância máxima entre um membro e
 * o membro MAIS PRÓXIMO da bolha — quem fica longe de TODOS é dropado. A
 * bolha dissolve quando sobra ≤1 pessoa. Atenuação de áudio pra fora da
 * bolha fica no client (SpatialAudio.BUBBLE_OUTSIDE_VOL).
 */
const BUBBLE_MAX_DIST = 250;

const ALLOWED_REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🎉"]);

/**
 * Salas que podem ser trancadas via cadeado. Bounds em pixels (precisa ficar
 * em sync com OfficeLayout.ts no client — se mudar layout das salas, atualiza
 * aqui também). Usado por `getRoomAt` no handleMove pra detectar entrada não
 * autorizada em sala trancada.
 */
const LOCKABLE_ROOMS: Record<string, { x: number; y: number; w: number; h: number }> = {
  meeting_xg: { x: 60 * 32, y: 0,         w: 20 * 32, h: 17 * 32 },
  meeting_m1: { x: 60 * 32, y: 17 * 32,   w: 20 * 32, h: 12 * 32 },
  meeting_g1: { x: 60 * 32, y: 29 * 32,   w: 20 * 32, h: 13 * 32 },
  meeting_g2: { x: 60 * 32, y: 42 * 32,   w: 20 * 32, h: 13 * 32 },
  // Diretorias também podem trancar. Recepção/Copa/Lounge NÃO (área comum).
  office_1:   { x: 0,       y: 0,         w: 20 * 32, h: 9 * 32 },
  office_2:   { x: 0,       y: 9 * 32,    w: 20 * 32, h: 9 * 32 },
};

/**
 * Throttle pra "room:blocked" — server só notifica cliente 1x a cada 2s
 * pra não floodar quando o player segura tecla contra a porta trancada.
 */
const BLOCKED_NOTIFY_THROTTLE_MS = 2000;

interface JoinOptions {
  token?: string;
  /** Se true, kicka qualquer sessão existente do mesmo userId em vez de rejeitar. */
  forceTakeover?: boolean;
}

interface AuthData {
  userId: string;
  email: string;
  displayName: string;
  bodyColor: string;
  hairColor: string;
  characterId: string;
}

/**
 * Spawn points na Recepção do novo mapa (Fase A do prompt-escritorio.txt).
 * Recepção fica em (0, 576) – (448, 832). Spawnamos no centro com jitter.
 */
const SPAWN_POINTS: Array<[number, number]> = [
  [200, 700], [240, 700], [180, 720], [260, 720],
  [200, 750], [240, 750], [220, 680], [220, 770],
];

export class OfficeRoom extends Room<OfficeState> {
  maxClients = 50;
  private readonly MAX_DELTA = 100;

  /**
   * Map de userId → client atualmente ativo. Usado pra detectar quando o
   * mesmo user tenta entrar de outra aba (duplicate session). O cliente
   * pode optar por "forçar entrada", caso em que o anterior é kickado.
   */
  private activeUsers = new Map<string, Client>();

  /** Timestamp (ms) da última vez que cada porta teve player próximo. */
  private doorLastActivity = new Map<string, number>();

  /**
   * Cadeado: userIds aprovados a entrar em cada sala trancada (além do dono).
   * Reset quando a sala é destrancada. Não persiste em DB — efêmero.
   */
  private allowedInRoom = new Map<string, Set<string>>();

  /** Throttle do "room:blocked": último envio por sessionId (ms epoch). */
  private lastBlockedNotify = new Map<string, number>();

  /** Última sala trancada pela qual já mandamos o modal obrigatório (sessionId → roomId). */
  private pendingModalSent = new Map<string, string>();

  async onCreate(_options: any) {
    console.log(`[OfficeRoom] criada: ${this.roomId}`);
    this.setState(new OfficeState());
    this.setPatchRate(1000 / 20);

    // Hidrata reservas de mesa do DB pro state. Mesas sem dono não vão pro
    // MapSchema — quando alguém reserva, é adicionada; quando libera, removida.
    try {
      const rows = await getDb().select().from(deskReservations);
      for (const r of rows) {
        // Sanity: ignora reservas pra mesas que não existem mais no layout
        if (!getDeskById(r.deskId)) {
          console.warn(`[OfficeRoom] reserva ignorada — desk ${r.deskId} não existe no layout`);
          continue;
        }
        const desk = new Desk();
        desk.deskId = r.deskId;
        desk.ownerId = r.userId;
        desk.ownerName = r.displayName;
        desk.ownerColor = r.bodyColor;
        this.state.desks.set(r.deskId, desk);
      }
      console.log(`[OfficeRoom] hidratou ${this.state.desks.size} reservas`);
    } catch (err) {
      console.error("[OfficeRoom] falha ao hidratar desks:", err);
    }

    this.onMessage<MoveMessage>("move", (client, message) => this.handleMove(client, message));

    this.onMessage<AppearanceMessage>("appearance", async (client, message) => {
      const player = this.state.players.get(client.sessionId);
      const authData = client.userData as AuthData | undefined;
      if (!player || !authData) return;

      const updates: Partial<{ bodyColor: string; hairColor: string; characterId: string }> = {};
      if (message.bodyColor && /^#[0-9a-fA-F]{6}$/.test(message.bodyColor)) {
        player.color = message.bodyColor;
        updates.bodyColor = message.bodyColor;
      }
      if (message.hairColor && /^#[0-9a-fA-F]{6}$/.test(message.hairColor)) {
        player.hairColor = message.hairColor;
        updates.hairColor = message.hairColor;
      }
      if (message.characterId && ["adam", "alex", "amelia", "bob"].includes(message.characterId)) {
        player.characterId = message.characterId;
        updates.characterId = message.characterId;
      }

      if (Object.keys(updates).length === 0) return;

      try {
        const db = getDb();
        await db
          .update(profiles)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(profiles.userId, authData.userId));

        // Se mudou body color e tem mesa reservada, atualiza snapshot
        // (pra outros verem a cor nova no outline da mesa)
        if (updates.bodyColor) {
          const myDesks = await db
            .select()
            .from(deskReservations)
            .where(eq(deskReservations.userId, authData.userId));
          for (const r of myDesks) {
            await db
              .update(deskReservations)
              .set({ bodyColor: updates.bodyColor })
              .where(eq(deskReservations.deskId, r.deskId));
            const stateDesk = this.state.desks.get(r.deskId);
            if (stateDesk) stateDesk.ownerColor = updates.bodyColor;
          }
        }
      } catch (err) {
        console.warn("[OfficeRoom] falha ao persistir aparência:", err);
      }
    });

    this.onMessage<string>("zone", (client, zoneId) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const auth = client.userData as AuthData | undefined;
      const userId = auth?.userId || "";

      // Se o player entrou numa sala trancada SEM permissão, a zona vira
      // "<roomId>__pending": áudio fica isolado (updateVolumes muta zonas
      // diferentes) mas o movimento é livre. Modal obrigatório é enviado 1x.
      const lock = this.state.lockedRooms.get(zoneId);
      const authorized =
        !lock ||
        lock.lockedBy === userId ||
        this.allowedInRoom.get(zoneId)?.has(userId);

      if (lock && !authorized) {
        player.zoneId = zoneId + "__pending";
        if (this.pendingModalSent.get(client.sessionId) !== zoneId) {
          this.pendingModalSent.set(client.sessionId, zoneId);
          client.send("room:entered-locked", {
            roomId: zoneId,
            lockedByName: lock.lockedByName,
          });
        }
      } else {
        player.zoneId = zoneId;
        this.pendingModalSent.delete(client.sessionId);
      }

      // Se quem trancou uma sala saiu fisicamente dela, destranca (a sala
      // não fica presa quando o dono vai "pegar um café"). Posição atual do
      // player é autoritativa aqui.
      this.autoReleaseRoomsOwnedBy(userId, player);
    });

    // Inicializa portas (sempre fechadas no boot)
    for (const cfg of DOORS) {
      const d = new Door();
      d.doorId = cfg.doorId;
      d.x = cfg.x;
      d.y = cfg.y;
      d.orientation = cfg.orientation;
      d.roomTag = cfg.roomTag;
      d.restricted = cfg.restricted;
      d.gapTiles = cfg.gapTiles;
      d.open = false;
      this.state.doors.set(cfg.doorId, d);
    }

    // Tick periódico: abre/fecha portas baseado em proximidade dos players
    this.setSimulationInterval((deltaTime) => this.tickDoors(), 250);

    this.onMessage<DeskClaimMessage>("desk:claim", (client, msg) =>
      this.handleDeskClaim(client, msg)
    );
    this.onMessage<DeskClaimMessage>("desk:release", (client, msg) =>
      this.handleDeskRelease(client, msg)
    );

    this.onMessage<TeleportToPlayerMessage>("teleport:to-player", (client, msg) =>
      this.handleTeleportToPlayer(client, msg)
    );
    this.onMessage<TeleportToDeskMessage>("teleport:to-desk", (client, msg) =>
      this.handleTeleportToDesk(client, msg)
    );
    this.onMessage<InviteMessage>("invite", (client, msg) =>
      this.handleInvite(client, msg)
    );
    this.onMessage<InviteResponseMessage>("invite:respond", (client, msg) =>
      this.handleInviteRespond(client, msg)
    );

    // Bolha de conversa privada
    this.onMessage<BubbleInviteMessage>("bubble:invite", (client, msg) =>
      this.handleBubbleInvite(client, msg)
    );
    this.onMessage<BubbleRespondMessage>("bubble:respond", (client, msg) =>
      this.handleBubbleRespond(client, msg)
    );
    this.onMessage("bubble:leave", (client) =>
      this.handleBubbleLeave(client)
    );

    this.onMessage<ChatSendMessage>("chat:send", (client, msg) =>
      this.handleChatSend(client, msg)
    );

    this.onMessage<ChatReactionToggleMessage>("chat:reaction:toggle", (client, msg) =>
      this.handleChatReactionToggle(client, msg)
    );

    // Cadeado de sala de reunião
    this.onMessage<RoomLockMessage>("room:lock", (client, msg) =>
      this.handleRoomLock(client, msg)
    );
    this.onMessage<RoomLockMessage>("room:unlock", (client, msg) =>
      this.handleRoomUnlock(client, msg)
    );
    this.onMessage<AccessRequestMessage>("room:request-access", (client, msg) =>
      this.handleAccessRequest(client, msg)
    );
    this.onMessage<AccessRespondMessage>("room:respond-access", (client, msg) =>
      this.handleAccessRespond(client, msg)
    );
    // Usuário escolheu "sair" no modal obrigatório de sala trancada
    this.onMessage<RoomLockMessage>("room:leave-locked", (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const roomId = String(msg?.roomId || "");
      this.ejectFromRoom(player, roomId);
      this.pendingModalSent.delete(client.sessionId);
      // Remove pedido pendente se houver
      const auth = client.userData as AuthData | undefined;
      if (auth?.userId) this.state.accessRequests.delete(`${roomId}:${auth.userId}`);
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    const token = options?.token;
    if (!token) throw new Error("Token de autenticação ausente");

    let payload: { sub: string; email: string };
    try {
      payload = verifyAuthToken(token);
    } catch {
      throw new Error("Token inválido ou expirado");
    }

    const db = getDb();
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user) throw new Error("Usuário não encontrado");

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
    if (!profile) throw new Error("Perfil não encontrado");

    // Checa sessão duplicada (mesmo user em outra aba)
    const existing = this.activeUsers.get(user.id);
    if (existing) {
      if (!options?.forceTakeover) {
        // Rejeita com código específico que o cliente reconhece
        throw new Error("DUPLICATE_SESSION");
      }
      // Force takeover: avisa o anterior e desconecta
      try {
        existing.send("session:kicked", { reason: "Você entrou em outra aba" });
      } catch {}
      // leave() é async; o onLeave do anterior limpa o estado eventualmente
      try {
        existing.leave();
      } catch {}
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: profile.displayName,
      bodyColor: profile.bodyColor,
      hairColor: profile.hairColor,
      characterId: profile.characterId || "",
    };
  }

  onJoin(client: Client, _options: JoinOptions, auth?: AuthData) {
    if (!auth) {
      console.error(`[OfficeRoom] ${client.sessionId} entrou sem auth — bug?`);
      client.leave();
      return;
    }
    console.log(`[OfficeRoom] ${client.sessionId} entrou (user=${auth.email})`);

    client.userData = auth;

    const player = new Player();
    player.id = client.sessionId;
    player.userId = auth.userId;
    player.name = auth.displayName;
    player.color = auth.bodyColor;
    player.hairColor = auth.hairColor;
    player.characterId = auth.characterId;

    // Se o user tem uma mesa reservada, spawna ao lado dela. Senão usa fallback.
    const reservedDesk = this.findReservedDeskFor(auth.userId);
    if (reservedDesk) {
      const seat = getSeatPosition(reservedDesk);
      player.x = seat.x;
      player.y = seat.y;
    } else {
      const spawnIdx = this.state.players.size % SPAWN_POINTS.length;
      const [sx, sy] = SPAWN_POINTS[spawnIdx];
      player.x = sx + Math.floor(Math.random() * 20) - 10;
      player.y = sy + Math.floor(Math.random() * 20) - 10;
    }

    this.state.players.set(client.sessionId, player);
    // Registra como sessão ativa pro userId (sobrescreve qualquer anterior já kickada)
    this.activeUsers.set(auth.userId, client);
    markOnline(auth.userId);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`[OfficeRoom] ${client.sessionId} saiu (consented=${consented})`);
    // Captura a bolha ANTES de remover o player do state, pra poder
    // dissolver se sobrar ≤1 pessoa.
    const leavingBubbleId = this.state.players.get(client.sessionId)?.bubbleId || "";
    this.state.players.delete(client.sessionId);
    if (leavingBubbleId) this.pruneBubble(leavingBubbleId);
    this.lastBlockedNotify.delete(client.sessionId);
    this.pendingModalSent.delete(client.sessionId);
    // Limpa activeUsers SÓ se este client é o atualmente registrado.
    // Quando há force takeover, o novo client já tomou o slot e não devemos limpá-lo.
    const auth = client.userData as AuthData | undefined;
    if (auth?.userId && this.activeUsers.get(auth.userId) === client) {
      this.activeUsers.delete(auth.userId);
      markOffline(auth.userId);
    }
    // Remove pedidos de acesso pendentes desse user (o dono não consegue
    // mais responder porque o requester sumiu)
    if (auth?.userId) {
      const keysToDelete: string[] = [];
      this.state.accessRequests.forEach((req, key) => {
        if (req.requesterId === auth.userId) keysToDelete.push(key);
      });
      for (const k of keysToDelete) this.state.accessRequests.delete(k);
    }
    // Destranca salas que esse user trancou — se ele desconectou, ninguém
    // conseguiria destrancar pela UI e a sala ficaria presa pra sempre.
    if (auth?.userId) this.autoReleaseRoomsOwnedBy(auth.userId);
    // NÃO libera mesas — reservas persistem mesmo offline.
  }

  onDispose() {
    console.log(`[OfficeRoom] descartada: ${this.roomId}`);
  }

  /**
   * Tick periódico das portas:
   * - Player "à frente" da porta (caixa retangular alinhada ao eixo de passagem) → abre + reseta timer
   * - Sem ninguém perto há > DOOR_CLOSE_TIMEOUT_MS → fecha
   *
   * "Frente" pra porta vertical = aproximar-se pelo eixo X (perpendicular à parede)
   * com Y próximo ao vão. Evita que portas abram quando o jogador só passa
   * paralelo à parede.
   */
  private tickDoors() {
    const now = Date.now();
    const FRONT = DOOR_OPEN_RADIUS_PX;       // alcance perpendicular à porta
    const SIDE = 40;                          // tolerância lateral (paralela à parede)
    this.state.doors.forEach((door, doorId) => {
      let nearby = false;
      this.state.players.forEach((p) => {
        const dx = Math.abs(p.x - door.x);
        const dy = Math.abs(p.y - door.y);
        if (door.orientation === "vertical") {
          // parede vertical → "frente" é leste/oeste (dx pequeno = perto), lateral é Y
          if (dx < FRONT && dy < SIDE) nearby = true;
        } else {
          // parede horizontal → "frente" é norte/sul (dy pequeno)
          if (dy < FRONT && dx < SIDE) nearby = true;
        }
      });

      if (nearby) {
        this.doorLastActivity.set(doorId, now);
        if (!door.open) door.open = true;
      } else {
        const lastActivity = this.doorLastActivity.get(doorId) || 0;
        if (door.open && now - lastActivity > DOOR_CLOSE_TIMEOUT_MS) {
          door.open = false;
        }
      }
    });
  }

  private handleMove(client: Client, msg: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const dx = Math.abs(msg.x - player.x);
    const dy = Math.abs(msg.y - player.y);
    if (dx > this.MAX_DELTA || dy > this.MAX_DELTA) return;

    const newX = Math.max(0, Math.min(this.state.worldWidth, msg.x));
    const newY = Math.max(0, Math.min(this.state.worldHeight, msg.y));

    // Cadeado NÃO bloqueia movimento — a pessoa entra fisicamente pra poder
    // pedir entrada. O isolamento é feito via zoneId "__pending" (áudio mudo)
    // no handler "zone". Ver handleZone / handleAccessRespond.
    player.x = newX;
    player.y = newY;
    player.direction = msg.direction;
    player.isMoving = msg.isMoving;

    // Se está numa bolha e se afastou de todos os membros, é dropado.
    if (player.bubbleId) this.enforceBubbleCohesion(client.sessionId, player);
  }

  /** Retorna o roomId da sala lockable que contém o ponto, ou null. */
  private getLockableRoomAt(x: number, y: number): string | null {
    for (const [id, b] of Object.entries(LOCKABLE_ROOMS)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return id;
    }
    return null;
  }

  /** Coords da porta de uma sala (centro em pixels) — null se sala não tem porta. */
  private getRoomDoorPos(roomId: string): { x: number; y: number } | null {
    const door = DOORS.find((d) => d.roomTag === roomId);
    return door ? { x: door.x, y: door.y } : null;
  }

  /**
   * Move o avatar pra FORA da sala, do outro lado da porta. Reunião tem porta
   * na parede esquerda (sai pro oeste); diretoria na direita (sai pro leste).
   * Também normaliza a zona (remove __pending) pra não ficar mudo do lado de fora.
   */
  private ejectFromRoom(player: Player, roomId: string) {
    const bounds = LOCKABLE_ROOMS[roomId];
    const doorPos = this.getRoomDoorPos(roomId);
    if (!bounds || !doorPos) return;
    const doorOnLeftWall = doorPos.x <= bounds.x + 20;
    player.x = doorOnLeftWall ? bounds.x - 40 : bounds.x + bounds.w + 40;
    player.y = doorPos.y;
    player.isMoving = false;
    if (player.zoneId === roomId + "__pending") player.zoneId = "open";
  }

  /** Procura no state quem é dono da mesa reservada pelo userId. */
  private findReservedDeskFor(userId: string) {
    for (const desk of this.state.desks.values()) {
      if (desk.ownerId === userId) {
        return getDeskById(desk.deskId);
      }
    }
    return undefined;
  }

  private async handleDeskClaim(client: Client, msg: DeskClaimMessage) {
    const auth = client.userData as AuthData | undefined;
    const player = this.state.players.get(client.sessionId);
    if (!auth || !player) return;

    const deskId = String(msg?.deskId || "");
    const deskInfo = getDeskById(deskId);
    if (!deskInfo) {
      client.send("desk:error", { error: "Mesa inválida" });
      return;
    }

    // Diretorias e similares são adminOnly — só ADMIN_EMAILS reservam.
    if (deskInfo.adminOnly && !isAdminEmail(auth.email)) {
      client.send("desk:error", { error: "Só administradores podem reservar essa sala" });
      return;
    }

    const existing = this.state.desks.get(deskId);
    if (existing && existing.ownerId !== auth.userId) {
      client.send("desk:error", { error: `Mesa já reservada por ${existing.ownerName}` });
      return;
    }
    if (existing && existing.ownerId === auth.userId) {
      // Já é dele — no-op idempotente
      return;
    }

    // Cada user só pode ter UMA mesa. Se já tem outra, libera primeiro.
    const previous = this.findOwnDesk(auth.userId);
    if (previous) {
      await this.releaseDeskInternal(previous.id, auth.userId);
    }

    try {
      await getDb().insert(deskReservations).values({
        deskId,
        userId: auth.userId,
        displayName: auth.displayName,
        bodyColor: player.color,
      });
      const desk = new Desk();
      desk.deskId = deskId;
      desk.ownerId = auth.userId;
      desk.ownerName = auth.displayName;
      desk.ownerColor = player.color;
      this.state.desks.set(deskId, desk);
      console.log(`[OfficeRoom] ${auth.email} reservou ${deskId}`);
    } catch (err) {
      console.error("[OfficeRoom] falha ao reservar mesa:", err);
      client.send("desk:error", { error: "Falha ao reservar (tente de novo)" });
    }
  }

  private async handleDeskRelease(client: Client, msg: DeskClaimMessage) {
    const auth = client.userData as AuthData | undefined;
    if (!auth) return;
    const deskId = String(msg?.deskId || "");
    const existing = this.state.desks.get(deskId);
    if (!existing) return;
    if (existing.ownerId !== auth.userId) {
      client.send("desk:error", { error: "Essa mesa não é sua" });
      return;
    }
    await this.releaseDeskInternal(deskId, auth.userId);
    console.log(`[OfficeRoom] ${auth.email} liberou ${deskId}`);
  }

  /** Acha a mesa atualmente reservada pelo userId (no state). */
  private findOwnDesk(userId: string) {
    for (const desk of this.state.desks.values()) {
      if (desk.ownerId === userId) {
        return { id: desk.deskId };
      }
    }
    return undefined;
  }

  private async releaseDeskInternal(deskId: string, userId: string) {
    try {
      await getDb()
        .delete(deskReservations)
        .where(eq(deskReservations.deskId, deskId));
      this.state.desks.delete(deskId);
    } catch (err) {
      console.error("[OfficeRoom] falha ao liberar mesa:", err);
    }
    // userId é só pra log / sanity — a query já filtra pela PK desk_id
    void userId;
  }

  // ============================================================
  //  Teletransporte (server-autoritativo)
  //  Cliente nunca manda coordenadas grandes; só pede.
  //  Server decide a posição e escreve direto no state.
  // ============================================================

  private TELEPORT_OFFSET = 40; // px ao lado do alvo, pra não ficar em cima

  private handleTeleportToPlayer(client: Client, msg: TeleportToPlayerMessage) {
    try {
      console.log(`[teleport:to-player] de=${client.sessionId} msg=`, JSON.stringify(msg));
      const me = this.state.players.get(client.sessionId);
      if (!me) {
        console.warn(`[teleport:to-player] me não está no state (sessionId=${client.sessionId})`);
        return;
      }

      const targetSessionId = String(msg?.targetSessionId || "");
      if (!targetSessionId || targetSessionId === client.sessionId) {
        console.warn(`[teleport:to-player] targetSessionId inválido: ${targetSessionId}`);
        return;
      }

      const target = this.state.players.get(targetSessionId);
      if (!target) {
        console.warn(`[teleport:to-player] target ${targetSessionId} não existe`);
        client.send("teleport:error", { error: "Usuário não encontrado" });
        return;
      }

      const pos = this.pickSpotNear(target.x, target.y);
      me.x = pos.x;
      me.y = pos.y;
      console.log(`[teleport:to-player] ${me.name} -> perto de ${target.name} (${pos.x},${pos.y})`);
    } catch (err) {
      console.error("[teleport:to-player] EXCEPTION:", err);
    }
  }

  private handleTeleportToDesk(client: Client, msg: TeleportToDeskMessage) {
    try {
      console.log(`[teleport:to-desk] de=${client.sessionId} msg=`, JSON.stringify(msg));
      const auth = client.userData as AuthData | undefined;
      const me = this.state.players.get(client.sessionId);
      if (!auth || !me) return;

      const deskId = String(msg?.deskId || "");
      const deskInfo = getDeskById(deskId);
      if (!deskInfo) {
        client.send("teleport:error", { error: "Mesa inválida" });
        return;
      }

      // Permite só se a mesa é sua (ou ninguém é dono — caso raro)
      const stateDesk = this.state.desks.get(deskId);
      if (stateDesk && stateDesk.ownerId !== auth.userId) {
        client.send("teleport:error", { error: `Mesa é de ${stateDesk.ownerName}` });
        return;
      }

      const seat = getSeatPosition(deskInfo);
      me.x = seat.x;
      me.y = seat.y;
      console.log(`[teleport:to-desk] ${me.name} -> ${deskId} (${seat.x},${seat.y})`);
    } catch (err) {
      console.error("[teleport:to-desk] EXCEPTION:", err);
    }
  }

  /** Escolhe um ponto ao lado do alvo (4 direções, picka primeira sem colisão simples). */
  private pickSpotNear(tx: number, ty: number): { x: number; y: number } {
    // 4 offsets simples; assume que o teleport_offset é maior que o avatar
    const candidates = [
      { x: tx + this.TELEPORT_OFFSET, y: ty },
      { x: tx - this.TELEPORT_OFFSET, y: ty },
      { x: tx, y: ty + this.TELEPORT_OFFSET },
      { x: tx, y: ty - this.TELEPORT_OFFSET },
    ];
    // Servidor não tem layout de colisão; cliente faz unstuck se necessário.
    // Por enquanto pega o primeiro dentro do mundo.
    for (const c of candidates) {
      if (c.x > 20 && c.x < this.state.worldWidth - 20 && c.y > 20 && c.y < this.state.worldHeight - 20) {
        return c;
      }
    }
    return { x: tx, y: ty };
  }

  // ============================================================
  //  Convites (fluxo: A convida B → B aceita/recusa → A recebe resposta)
  // ============================================================

  private handleInvite(client: Client, msg: InviteMessage) {
    try {
      console.log(`[invite] de=${client.sessionId} msg=`, JSON.stringify(msg));
      const me = this.state.players.get(client.sessionId);
      if (!me) {
        console.warn(`[invite] me não está no state`);
        return;
      }
      const targetSessionId = String(msg?.targetSessionId || "");
      if (!targetSessionId || targetSessionId === client.sessionId) {
        console.warn(`[invite] targetSessionId inválido: ${targetSessionId}`);
        return;
      }

      const target = this.state.players.get(targetSessionId);
      if (!target) {
        console.warn(`[invite] target ${targetSessionId} não existe no state`);
        client.send("invite:error", { error: "Usuário não está mais online" });
        return;
      }

      // Acha o cliente do target pra mandar a mensagem direta
      const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
      if (!targetClient) {
        console.warn(`[invite] targetClient não encontrado em this.clients`);
        client.send("invite:error", { error: "Usuário não está mais online" });
        return;
      }

      targetClient.send("invite:received", {
        fromSessionId: client.sessionId,
        fromName: me.name,
      });
      console.log(`[invite] ${me.name} -> ${target.name} OK`);
    } catch (err) {
      console.error("[invite] EXCEPTION:", err);
    }
  }

  private handleInviteRespond(client: Client, msg: InviteResponseMessage) {
    try {
      console.log(`[invite:respond] de=${client.sessionId} msg=`, JSON.stringify(msg));
      const responder = this.state.players.get(client.sessionId);
      if (!responder) return;

      const fromSessionId = String(msg?.fromSessionId || "");
      const accepted = !!msg?.accepted;
      if (!fromSessionId) return;

      const inviter = this.state.players.get(fromSessionId);
      const inviterClient = this.clients.find((c) => c.sessionId === fromSessionId);

      // Notifica o convidador (se ainda online)
      if (inviterClient) {
        inviterClient.send("invite:response", {
          fromSessionId: client.sessionId,
          fromName: responder.name,
          accepted,
        });
      }

      // Se aceito, teletransporta o convidado pra perto do convidador (server-autoritativo)
      if (accepted && inviter) {
        const pos = this.pickSpotNear(inviter.x, inviter.y);
        responder.x = pos.x;
        responder.y = pos.y;
      }
      console.log(`[invite:respond] ${responder.name} accepted=${accepted}`);
    } catch (err) {
      console.error("[invite:respond] EXCEPTION:", err);
    }
  }

  // ============================================================
  //  Bolha de conversa privada (N pessoas)
  //  - Qualquer membro convida; ao aceitar, o alvo recebe o MESMO bubbleId
  //    do convidador (cria um novo se o convidador não tiver bolha).
  //  - Áudio entre membros = cheio; pra fora da bolha (mesma sala) = baixo
  //    (a atenuação fica no client, SpatialAudio.BUBBLE_OUTSIDE_VOL).
  //  - Sai manualmente (botão) OU é dropado por proximidade (ficou a
  //    >BUBBLE_MAX_DIST de TODOS os outros membros). Dissolve com ≤1 membro.
  // ============================================================

  /** Membros atuais de uma bolha (sessionId + player). */
  private bubbleMembers(bubbleId: string): { sessionId: string; player: Player }[] {
    const out: { sessionId: string; player: Player }[] = [];
    if (!bubbleId) return out;
    this.state.players.forEach((p, sid) => {
      if (p.bubbleId === bubbleId) out.push({ sessionId: sid, player: p });
    });
    return out;
  }

  /** Dissolve a bolha se sobrou ≤1 membro (uma bolha de 1 não faz sentido). */
  private pruneBubble(bubbleId: string) {
    if (!bubbleId) return;
    const members = this.bubbleMembers(bubbleId);
    if (members.length <= 1) {
      members.forEach(({ sessionId, player }) => {
        player.bubbleId = "";
        const c = this.clients.find((cc) => cc.sessionId === sessionId);
        if (c) c.send("bubble:ended", { reason: "Bolha encerrada" });
      });
    }
  }

  private handleBubbleInvite(client: Client, msg: BubbleInviteMessage) {
    try {
      const me = this.state.players.get(client.sessionId);
      if (!me) return;
      const targetSessionId = String(msg?.targetSessionId || "");
      if (!targetSessionId || targetSessionId === client.sessionId) return;

      const target = this.state.players.get(targetSessionId);
      const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
      if (!target || !targetClient) {
        client.send("bubble:error", { error: "Usuário não está mais online" });
        return;
      }
      if (target.bubbleId) {
        client.send("bubble:error", { error: "Essa pessoa já está numa bolha" });
        return;
      }
      targetClient.send("bubble:invite-received", {
        fromSessionId: client.sessionId,
        fromName: me.name,
      });
      console.log(`[bubble:invite] ${me.name} -> ${target.name}`);
    } catch (err) {
      console.error("[bubble:invite] EXCEPTION:", err);
    }
  }

  private handleBubbleRespond(client: Client, msg: BubbleRespondMessage) {
    try {
      const responder = this.state.players.get(client.sessionId);
      if (!responder) return;
      const fromSessionId = String(msg?.fromSessionId || "");
      const accepted = !!msg?.accepted;
      if (!fromSessionId) return;

      const inviter = this.state.players.get(fromSessionId);
      const inviterClient = this.clients.find((c) => c.sessionId === fromSessionId);

      if (!accepted) {
        if (inviterClient)
          inviterClient.send("bubble:response", { fromName: responder.name, accepted: false });
        return;
      }
      if (!inviter) {
        client.send("bubble:error", { error: "Quem convidou saiu" });
        return;
      }
      // Se o responder entrou em outra bolha enquanto decidia, recusa
      if (responder.bubbleId) {
        client.send("bubble:error", { error: "Você já está numa bolha" });
        return;
      }

      // Usa a bolha do convidador se já existir; senão cria uma nova pros dois
      let bubbleId = inviter.bubbleId;
      if (!bubbleId) {
        bubbleId = `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        inviter.bubbleId = bubbleId;
      }
      responder.bubbleId = bubbleId;

      this.bubbleMembers(bubbleId).forEach(({ sessionId }) => {
        const c = this.clients.find((cc) => cc.sessionId === sessionId);
        if (c) c.send("bubble:started", { joinedName: responder.name });
      });
      if (inviterClient)
        inviterClient.send("bubble:response", { fromName: responder.name, accepted: true });
      console.log(`[bubble:respond] ${responder.name} entrou na bolha ${bubbleId}`);
    } catch (err) {
      console.error("[bubble:respond] EXCEPTION:", err);
    }
  }

  private handleBubbleLeave(client: Client) {
    try {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.bubbleId) return;
      const bubbleId = player.bubbleId;
      player.bubbleId = "";
      client.send("bubble:ended", { reason: "Você saiu da bolha" });
      this.pruneBubble(bubbleId);
    } catch (err) {
      console.error("[bubble:leave] EXCEPTION:", err);
    }
  }

  /**
   * Chamado a cada move de quem está numa bolha: se o player ficou a mais de
   * BUBBLE_MAX_DIST do membro MAIS PRÓXIMO, ele é dropado (e a bolha pode
   * dissolver se sobrar ≤1).
   */
  private enforceBubbleCohesion(sessionId: string, player: Player) {
    const bubbleId = player.bubbleId;
    if (!bubbleId) return;
    const others = this.bubbleMembers(bubbleId).filter((m) => m.sessionId !== sessionId);
    if (others.length === 0) return; // pruneBubble cuida do caso ≤1
    const nearest = Math.min(
      ...others.map((o) => Math.hypot(o.player.x - player.x, o.player.y - player.y))
    );
    if (nearest > BUBBLE_MAX_DIST) {
      player.bubbleId = "";
      const c = this.clients.find((cc) => cc.sessionId === sessionId);
      if (c) c.send("bubble:ended", { reason: "Você se afastou do grupo" });
      this.pruneBubble(bubbleId);
    }
  }

  // ============================================================
  //  Cadeado de sala de reunião
  //  - Qualquer ocupante da sala pode trancar (vira "dono" da sessão).
  //  - Dono destranca a qualquer momento. Se o dono SAI da sala (anda pra
  //    fora) ou desconecta, a sala destranca automaticamente — não fica
  //    presa sem ninguém que consiga destrancar. Ver autoReleaseRoomsOwnedBy.
  //  - Movimento é LIVRE: quem entra numa sala trancada sem permissão entra
  //    fisicamente, mas a zona vira "<roomId>__pending" → áudio mudo (não
  //    ouve nem é ouvido). Modal obrigatório força "pedir entrada" ou "sair".
  //  - Dono recebe `access:request-incoming` → aceita/recusa.
  //  - Aceito: entra em allowedInRoom, zona normaliza, áudio liberado (NÃO
  //    teleporta — já está dentro). Recusado: avatar movido pra fora da sala.
  // ============================================================

  private handleRoomLock(client: Client, msg: RoomLockMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      const player = this.state.players.get(client.sessionId);
      if (!auth || !player) return;

      const roomId = String(msg?.roomId || "");
      if (!LOCKABLE_ROOMS[roomId]) {
        client.send("room:error", { error: "Essa sala não pode ser trancada" });
        return;
      }

      // Tem que estar dentro da sala
      const myRoom = this.getLockableRoomAt(player.x, player.y);
      if (myRoom !== roomId) {
        client.send("room:error", { error: "Você precisa estar dentro da sala pra trancar" });
        return;
      }

      if (this.state.lockedRooms.has(roomId)) {
        client.send("room:error", { error: "Sala já está trancada" });
        return;
      }

      const lock = new LockedRoom();
      lock.roomId = roomId;
      lock.lockedBy = auth.userId;
      lock.lockedByName = auth.displayName;
      lock.lockedAt = Date.now();
      this.state.lockedRooms.set(roomId, lock);
      this.allowedInRoom.set(roomId, new Set());

      // Spawna NPC na frente da porta (do lado de fora da sala, levemente afastado)
      const doorPos = this.getRoomDoorPos(roomId);
      if (doorPos) {
        const npc = new SecurityNPC();
        npc.roomId = roomId;
        // Salas de reunião têm porta na lateral esquerda (vão vertical) → NPC
        // do lado de FORA é x-24 (oeste da porta). direction "right" pra encarar
        // quem se aproxima do open space.
        npc.x = doorPos.x - 24;
        npc.y = doorPos.y;
        npc.direction = "right";
        this.state.securityNPCs.set(roomId, npc);
      }

      console.log(`[room:lock] ${auth.email} trancou ${roomId}`);
    } catch (err) {
      console.error("[room:lock] EXCEPTION:", err);
    }
  }

  private handleRoomUnlock(client: Client, msg: RoomLockMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      if (!auth) return;

      const roomId = String(msg?.roomId || "");
      const lock = this.state.lockedRooms.get(roomId);
      if (!lock) {
        client.send("room:error", { error: "Sala não está trancada" });
        return;
      }
      // Dono ou admin
      if (lock.lockedBy !== auth.userId && !isAdminEmail(auth.email)) {
        client.send("room:error", { error: "Só quem trancou pode destrancar" });
        return;
      }

      this.releaseRoom(roomId);
      console.log(`[room:unlock] ${auth.email} destrancou ${roomId}`);
    } catch (err) {
      console.error("[room:unlock] EXCEPTION:", err);
    }
  }

  /**
   * Limpeza completa de uma sala trancada (idempotente). Usado pelo unlock
   * manual (handleRoomUnlock) e pelo auto-release quando o dono sai/desconecta.
   * Remove lock + NPC + whitelist, normaliza zonas "__pending" (libera áudio),
   * e limpa flags de modal e pedidos de acesso pendentes daquela sala.
   */
  private releaseRoom(roomId: string) {
    if (!this.state.lockedRooms.has(roomId)) return;
    this.state.lockedRooms.delete(roomId);
    this.state.securityNPCs.delete(roomId);
    this.allowedInRoom.delete(roomId);

    // Normaliza zona de quem estava pendente nessa sala (libera áudio)
    this.state.players.forEach((p) => {
      if (p.zoneId === roomId + "__pending") p.zoneId = roomId;
    });
    // Limpa flags de modal pendente dessa sala
    this.pendingModalSent.forEach((rid, sid) => {
      if (rid === roomId) this.pendingModalSent.delete(sid);
    });

    // Remove pedidos pendentes pra essa sala
    const keysToDelete: string[] = [];
    this.state.accessRequests.forEach((req, key) => {
      if (req.roomId === roomId) keysToDelete.push(key);
    });
    for (const k of keysToDelete) this.state.accessRequests.delete(k);
  }

  /**
   * Auto-release: destranca toda sala cujo dono (lockedBy === userId) não está
   * mais fisicamente dentro dela. Chamado quando o dono troca de zona (anda pra
   * fora) ou desconecta. `player` opcional — se ausente (desconexão), o dono
   * com certeza não está mais na sala, então destranca direto.
   */
  private autoReleaseRoomsOwnedBy(userId: string, player?: Player) {
    if (!userId) return;
    // Coleta antes de deletar — mutar o MapSchema durante o forEach pode
    // bagunçar o iterador dos proxies do Colyseus.
    const toRelease: string[] = [];
    this.state.lockedRooms.forEach((lock, roomId) => {
      if (lock.lockedBy !== userId) return;
      const stillInside =
        !!player && this.getLockableRoomAt(player.x, player.y) === roomId;
      if (!stillInside) toRelease.push(roomId);
    });
    for (const roomId of toRelease) {
      this.releaseRoom(roomId);
      console.log(`[room:auto-unlock] dono saiu → ${roomId} destrancada`);
    }
  }

  private handleAccessRequest(client: Client, msg: AccessRequestMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      const player = this.state.players.get(client.sessionId);
      if (!auth || !player) return;

      const roomId = String(msg?.roomId || "");
      const lock = this.state.lockedRooms.get(roomId);
      if (!lock) {
        client.send("room:error", { error: "Sala não está mais trancada" });
        return;
      }
      if (lock.lockedBy === auth.userId) return; // dono não pede a si mesmo

      // Idempotente: se já tem pedido pendente desse user, atualiza timestamp
      const key = `${roomId}:${auth.userId}`;
      let req = this.state.accessRequests.get(key);
      if (!req) {
        req = new AccessRequest();
        req.roomId = roomId;
        req.requesterId = auth.userId;
        req.requesterSessionId = client.sessionId;
        req.requesterName = auth.displayName;
        this.state.accessRequests.set(key, req);
      }
      req.requesterSessionId = client.sessionId; // sempre atualiza (user pode ter reconectado)
      req.createdAt = Date.now();

      // Notifica o dono (se online)
      const ownerClient = this.clients.find((c) => {
        const p = this.state.players.get(c.sessionId);
        return p?.userId === lock.lockedBy;
      });
      if (ownerClient) {
        ownerClient.send("access:request-incoming", {
          roomId,
          requesterId: auth.userId,
          requesterName: auth.displayName,
        });
      }

      console.log(`[room:request-access] ${auth.email} -> ${roomId}`);
    } catch (err) {
      console.error("[room:request-access] EXCEPTION:", err);
    }
  }

  private handleAccessRespond(client: Client, msg: AccessRespondMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      if (!auth) return;

      const roomId = String(msg?.roomId || "");
      const requesterId = String(msg?.requesterId || "");
      const accepted = !!msg?.accepted;

      const lock = this.state.lockedRooms.get(roomId);
      if (!lock) return;
      if (lock.lockedBy !== auth.userId) return; // só dono responde

      const key = `${roomId}:${requesterId}`;
      const req = this.state.accessRequests.get(key);
      if (!req) return;

      // Acha o requester (pode ter trocado de sessionId)
      const requesterClient = this.clients.find((c) => {
        const p = this.state.players.get(c.sessionId);
        return p?.userId === requesterId;
      });

      if (accepted) {
        // Whitelist + libera áudio (normaliza a zona, removendo __pending).
        // NÃO teleporta — a pessoa já está fisicamente dentro.
        let allowed = this.allowedInRoom.get(roomId);
        if (!allowed) {
          allowed = new Set();
          this.allowedInRoom.set(roomId, allowed);
        }
        allowed.add(requesterId);

        if (requesterClient) {
          const requesterPlayer = this.state.players.get(requesterClient.sessionId);
          if (requesterPlayer && requesterPlayer.zoneId === roomId + "__pending") {
            requesterPlayer.zoneId = roomId; // áudio liberado
          }
          this.pendingModalSent.delete(requesterClient.sessionId);
          requesterClient.send("access:response", { roomId, accepted: true });
        }
      } else if (requesterClient) {
        // Recusado: move o avatar pra FORA da sala (lado de fora da porta).
        const requesterPlayer = this.state.players.get(requesterClient.sessionId);
        if (requesterPlayer) {
          this.ejectFromRoom(requesterPlayer, roomId);
        }
        this.pendingModalSent.delete(requesterClient.sessionId);
        requesterClient.send("access:response", { roomId, accepted: false });
      }

      this.state.accessRequests.delete(key);
      console.log(`[room:respond-access] ${auth.email} ${accepted ? "aceitou" : "recusou"} ${requesterId} em ${roomId}`);
    } catch (err) {
      console.error("[room:respond-access] EXCEPTION:", err);
    }
  }

  // ============================================================
  //  Chat
  //  - global: persiste em messages, broadcast pra todos
  //  - dm: persiste, manda só pro target (e ecoa pro sender)
  //  - room: efêmero (sem DB), manda só pros peers da mesma zona
  // ============================================================

  private async handleChatSend(client: Client, msg: ChatSendMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      const sender = this.state.players.get(client.sessionId);
      if (!auth || !sender) return;

      const content = (msg?.content || "").trim();
      if (!content) return;
      if (content.length > 2000) {
        client.send("chat:error", { error: "Mensagem muito longa (max 2000 caracteres)" });
        return;
      }

      const channelType = msg?.channelType;
      if (channelType !== "global" && channelType !== "dm" && channelType !== "room") {
        client.send("chat:error", { error: "Tipo de canal inválido" });
        return;
      }

      // === Sala / proximidade: efêmero, só broadcast filtrado ===
      if (channelType === "room") {
        const senderZone = sender.zoneId || "open";
        const payload = {
          id: `eph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channelType: "room" as const,
          senderId: auth.userId,
          senderName: auth.displayName,
          content,
          createdAt: new Date().toISOString(),
        };
        // Envia pra todos os clients cujos players estão na mesma zona
        // (inclui o próprio sender pra ele ver o eco)
        this.clients.forEach((c) => {
          const p = this.state.players.get(c.sessionId);
          if (p && (p.zoneId || "open") === senderZone) {
            c.send("chat:message", payload);
          }
        });
        return;
      }

      // === Global ou DM: persiste no DB ===
      let recipientId: string | null = null;
      if (channelType === "dm") {
        recipientId = String(msg.recipientId || "");
        if (!recipientId || recipientId === auth.userId) {
          client.send("chat:error", { error: "Destinatário inválido" });
          return;
        }
      }

      const db = getDb();
      const [row] = await db
        .insert(messages)
        .values({
          senderId: auth.userId,
          channelType,
          recipientId,
          content,
        })
        .returning();

      const payload = {
        id: row.id,
        channelType,
        senderId: auth.userId,
        senderName: auth.displayName,
        recipientId,
        content,
        createdAt: row.createdAt.toISOString(),
      };

      if (channelType === "global") {
        // Broadcast pra todos os clients conectados
        this.broadcast("chat:message", payload);
      } else {
        // DM: manda pro sender (eco) e pro target se estiver online
        client.send("chat:message", payload);
        const targetClient = this.clients.find((c) => {
          const p = this.state.players.get(c.sessionId);
          return p && p.userId === recipientId;
        });
        if (targetClient && targetClient.sessionId !== client.sessionId) {
          targetClient.send("chat:message", payload);
        }
      }
    } catch (err) {
      console.error("[chat:send] EXCEPTION:", err);
    }
  }

  /**
   * Toggle de reação em uma mensagem persistida (global/DM).
   * Reações em mensagens efêmeras (room) não são suportadas.
   */
  private async handleChatReactionToggle(client: Client, msg: ChatReactionToggleMessage) {
    try {
      const auth = client.userData as AuthData | undefined;
      if (!auth) return;

      const messageId = String(msg?.messageId || "");
      const emoji = String(msg?.emoji || "");
      if (!messageId || !emoji) return;
      if (!ALLOWED_REACTION_EMOJIS.has(emoji)) {
        client.send("chat:error", { error: "Emoji não permitido" });
        return;
      }

      const db = getDb();

      // Busca a mensagem original pra saber pra quem propagar
      const [original] = await db
        .select({ id: messages.id, channelType: messages.channelType, senderId: messages.senderId, recipientId: messages.recipientId })
        .from(messages)
        .where(eqOp(messages.id, messageId))
        .limit(1);
      if (!original) {
        client.send("chat:error", { error: "Mensagem não encontrada" });
        return;
      }

      // Verifica permissão: em DM, só sender ou recipient podem reagir
      if (original.channelType === "dm") {
        if (original.senderId !== auth.userId && original.recipientId !== auth.userId) {
          client.send("chat:error", { error: "Sem permissão" });
          return;
        }
      }

      // Toggle: tenta DELETE; se removeu nada, INSERT
      const deleted = await db
        .delete(messageReactions)
        .where(
          and(
            eqOp(messageReactions.messageId, messageId),
            eqOp(messageReactions.userId, auth.userId),
            eqOp(messageReactions.emoji, emoji)
          )
        )
        .returning({ emoji: messageReactions.emoji });

      const removed = deleted.length > 0;
      if (!removed) {
        await db.insert(messageReactions).values({
          messageId,
          userId: auth.userId,
          emoji,
        });
      }

      // Busca reações agregadas atuais pra propagar (todos os emojis da msg)
      const rows = await db
        .select({ emoji: messageReactions.emoji, userId: messageReactions.userId })
        .from(messageReactions)
        .where(eqOp(messageReactions.messageId, messageId));

      const agg: Record<string, string[]> = {};
      for (const r of rows) {
        if (!agg[r.emoji]) agg[r.emoji] = [];
        agg[r.emoji].push(r.userId);
      }
      const reactions = Object.entries(agg).map(([emoji, userIds]) => ({ emoji, userIds }));

      const payload = {
        messageId,
        reactions,
      };

      // Propaga pra mesma audiência da msg original
      if (original.channelType === "global") {
        this.broadcast("chat:reaction:updated", payload);
      } else if (original.channelType === "dm") {
        // Manda pros 2 envolvidos se online
        this.clients.forEach((c) => {
          const p = this.state.players.get(c.sessionId);
          if (p && (p.userId === original.senderId || p.userId === original.recipientId)) {
            c.send("chat:reaction:updated", payload);
          }
        });
      }
    } catch (err) {
      console.error("[chat:reaction:toggle] EXCEPTION:", err);
    }
  }
}

// Lista de mesas válidas é exportada também pra possíveis consultas externas.
export { DESKS };
