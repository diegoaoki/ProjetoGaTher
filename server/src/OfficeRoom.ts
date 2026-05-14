import { Room, Client } from "@colyseus/core";
import { OfficeState, Player } from "./schema";

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
  name?: string;
  color?: string;
  hairColor?: string;
}

/**
 * Spawn points conhecidos como SEGUROS (longe de qualquer móvel).
 * Verificados manualmente contra o OfficeLayout do cliente.
 * Adicione mais se quiser distribuir melhor a entrada.
 */
const SPAWN_POINTS: Array<[number, number]> = [
  [450, 420],  // centro-superior (entre fileiras de mesas)
  [400, 420],
  [500, 420],
  [550, 420],
  [380, 680],  // abaixo das mesas inferiores
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

    this.onMessage<AppearanceMessage>("appearance", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (message.bodyColor && /^#[0-9a-fA-F]{6}$/.test(message.bodyColor)) {
        player.color = message.bodyColor;
      }
      if (message.hairColor && /^#[0-9a-fA-F]{6}$/.test(message.hairColor)) {
        player.hairColor = message.hairColor;
      }
    });

    this.onMessage<string>("zone", (client, zoneId) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.zoneId = zoneId;
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log(`[OfficeRoom] ${client.sessionId} entrou`);
    const player = new Player();
    player.id = client.sessionId;
    player.name = options.name?.slice(0, 24) || `Convidado-${client.sessionId.slice(0, 4)}`;
    player.color = (options.color && /^#[0-9a-fA-F]{6}$/.test(options.color)) ? options.color : this.randomColor();
    player.hairColor = (options.hairColor && /^#[0-9a-fA-F]{6}$/.test(options.hairColor)) ? options.hairColor : "#3b2c20";

    // Spawn em ponto seguro pré-definido (rotacionando entre os pontos disponíveis)
    const spawnIdx = this.state.players.size % SPAWN_POINTS.length;
    const [sx, sy] = SPAWN_POINTS[spawnIdx];
    // Pequeno jitter pra evitar empilhar avatares
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

  private randomColor(): string {
    const palette = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#34d399", "#fb7185", "#22d3ee"];
    return palette[Math.floor(Math.random() * palette.length)];
  }
}
