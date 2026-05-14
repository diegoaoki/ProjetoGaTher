import { Room, Client } from "@colyseus/core";
import { eq } from "drizzle-orm";
import { OfficeState, Player, Desk } from "./schema";
import { verifyAuthToken } from "./auth/jwt";
import { getDb } from "./db/client";
import { profiles, users, deskReservations } from "./db/schema";
import { DESKS, getDeskById, getSeatPosition } from "./desks";

interface MoveMessage {
  x: number;
  y: number;
  direction: string;
  isMoving: boolean;
}

interface AppearanceMessage {
  bodyColor?: string;
  hairColor?: string;
}

interface DeskClaimMessage {
  deskId: string;
}

interface JoinOptions {
  token?: string;
}

interface AuthData {
  userId: string;
  email: string;
  displayName: string;
  bodyColor: string;
  hairColor: string;
}

/**
 * Spawn points conhecidos como SEGUROS (longe de qualquer móvel).
 * Usado apenas como fallback — se o user tem mesa reservada, spawna nela.
 */
const SPAWN_POINTS: Array<[number, number]> = [
  [450, 420],
  [400, 420],
  [500, 420],
  [550, 420],
  [380, 680],
  [480, 680],
  [580, 680],
  [380, 720],
  [480, 720],
  [580, 720],
  [620, 420],
  [340, 680],
];

export class OfficeRoom extends Room<OfficeState> {
  maxClients = 50;
  private readonly MAX_DELTA = 100;

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

      const updates: Partial<{ bodyColor: string; hairColor: string }> = {};
      if (message.bodyColor && /^#[0-9a-fA-F]{6}$/.test(message.bodyColor)) {
        player.color = message.bodyColor;
        updates.bodyColor = message.bodyColor;
      }
      if (message.hairColor && /^#[0-9a-fA-F]{6}$/.test(message.hairColor)) {
        player.hairColor = message.hairColor;
        updates.hairColor = message.hairColor;
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
      if (player) player.zoneId = zoneId;
    });

    this.onMessage<DeskClaimMessage>("desk:claim", (client, msg) =>
      this.handleDeskClaim(client, msg)
    );
    this.onMessage<DeskClaimMessage>("desk:release", (client, msg) =>
      this.handleDeskRelease(client, msg)
    );
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

    return {
      userId: user.id,
      email: user.email,
      displayName: profile.displayName,
      bodyColor: profile.bodyColor,
      hairColor: profile.hairColor,
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
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`[OfficeRoom] ${client.sessionId} saiu (consented=${consented})`);
    this.state.players.delete(client.sessionId);
    // NÃO libera mesas — reservas persistem mesmo offline.
  }

  onDispose() {
    console.log(`[OfficeRoom] descartada: ${this.roomId}`);
  }

  private handleMove(client: Client, msg: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const dx = Math.abs(msg.x - player.x);
    const dy = Math.abs(msg.y - player.y);
    if (dx > this.MAX_DELTA || dy > this.MAX_DELTA) return;

    const newX = Math.max(0, Math.min(this.state.worldWidth, msg.x));
    const newY = Math.max(0, Math.min(this.state.worldHeight, msg.y));

    player.x = newX;
    player.y = newY;
    player.direction = msg.direction;
    player.isMoving = msg.isMoving;
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
}

// Lista de mesas válidas é exportada também pra possíveis consultas externas.
export { DESKS };
