import { Room, Client } from "@colyseus/core";
import { OfficeState, Player } from "./schema";

interface MoveMessage {
  x: number;
  y: number;
  direction: string;
  isMoving: boolean;
}

interface JoinOptions {
  name?: string;
  color?: string;
}

/**
 * OfficeRoom: uma sala/escritório virtual.
 *
 * Modelo authoritative: o servidor mantém a verdade sobre o estado.
 * Por enquanto confiamos no client para enviar posição (mais simples),
 * mas validamos limites do mundo. Numa v2, o servidor pode rodar a física.
 */
export class OfficeRoom extends Room<OfficeState> {
  // Capacidade máxima por sala. Acima disso o áudio espacial complica.
  maxClients = 50;

  // Quanto o avatar pode andar por mensagem (anti-cheat básico)
  private readonly MAX_DELTA = 100; // pixels por update

  onCreate(options: any) {
    console.log(`[OfficeRoom] criada: ${this.roomId}`);
    this.setState(new OfficeState());

    // Patch rate: quantas vezes por segundo o servidor envia deltas
    // 20Hz = 50ms, suficientemente fluido sem inundar a rede
    this.setPatchRate(1000 / 20);

    this.onMessage<MoveMessage>("move", (client, message) => {
      this.handleMove(client, message);
    });

    this.onMessage<string>("zone", (client, zoneId) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.zoneId = zoneId;
      }
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log(`[OfficeRoom] ${client.sessionId} entrou`);

    const player = new Player();
    player.id = client.sessionId;
    player.name = options.name?.slice(0, 24) || `Convidado-${client.sessionId.slice(0, 4)}`;
    player.color = options.color || this.randomColor();

    // Spawna em posição aleatória dentro de uma área central
    player.x = 400 + Math.floor(Math.random() * 200);
    player.y = 400 + Math.floor(Math.random() * 200);

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

    // Validação básica: delta razoável e dentro do mundo
    const dx = Math.abs(msg.x - player.x);
    const dy = Math.abs(msg.y - player.y);
    if (dx > this.MAX_DELTA || dy > this.MAX_DELTA) {
      // Movimento suspeito (teleporte). Ignora e força resync.
      return;
    }

    const newX = Math.max(0, Math.min(this.state.worldWidth, msg.x));
    const newY = Math.max(0, Math.min(this.state.worldHeight, msg.y));

    player.x = newX;
    player.y = newY;
    player.direction = msg.direction;
    player.isMoving = msg.isMoving;
  }

  private randomColor(): string {
    const palette = [
      "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
      "#a78bfa", "#34d399", "#fb7185", "#22d3ee",
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }
}
