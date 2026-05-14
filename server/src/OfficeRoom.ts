import { Room, Client } from "@colyseus/core";
import { eq } from "drizzle-orm";
import { OfficeState, Player } from "./schema";
import { verifyAuthToken } from "./auth/jwt";
import { getDb } from "./db/client";
import { profiles, users } from "./db/schema";

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
 * Verificados manualmente contra o OfficeLayout do cliente.
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

  onCreate(_options: any) {
    console.log(`[OfficeRoom] criada: ${this.roomId}`);
    this.setState(new OfficeState());
    this.setPatchRate(1000 / 20);

    this.onMessage<MoveMessage>("move", (client, message) => this.handleMove(client, message));

    // Aparência também é persistida no DB pra refletir mudanças em sessões futuras.
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

      if (Object.keys(updates).length > 0) {
        try {
          await getDb()
            .update(profiles)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(profiles.userId, authData.userId));
        } catch (err) {
          console.warn("[OfficeRoom] falha ao persistir aparência:", err);
        }
      }
    });

    this.onMessage<string>("zone", (client, zoneId) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.zoneId = zoneId;
    });
  }

  /**
   * Valida o JWT vindo do cliente ANTES de aceitar a conexão.
   * Retorna os dados que vão pra client.userData (acessível em onJoin/onMessage).
   */
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

  onJoin(client: Client, _options: JoinOptions, auth: AuthData) {
    console.log(`[OfficeRoom] ${client.sessionId} entrou (user=${auth.email})`);

    // Anexa dados de auth na conexão pra reuso em onMessage/onLeave
    client.userData = auth;

    const player = new Player();
    player.id = client.sessionId;
    player.userId = auth.userId;
    player.name = auth.displayName;
    player.color = auth.bodyColor;
    player.hairColor = auth.hairColor;

    const spawnIdx = this.state.players.size % SPAWN_POINTS.length;
    const [sx, sy] = SPAWN_POINTS[spawnIdx];
    player.x = sx + Math.floor(Math.random() * 20) - 10;
    player.y = sy + Math.floor(Math.random() * 20) - 10;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`[OfficeRoom] ${client.sessionId} saiu (consented=${consented})`);
    this.state.players.delete(client.sessionId);
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
}
