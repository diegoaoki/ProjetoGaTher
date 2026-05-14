import { Schema, MapSchema, type } from "@colyseus/schema";

/**
 * Player: representa um avatar no espaço.
 * Os campos com @type são sincronizados automaticamente entre clientes
 * pelo Colyseus (delta encoding via binary protocol).
 */
export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";

  // Posição em pixels no mundo
  @type("number") x: number = 0;
  @type("number") y: number = 0;

  // Direção que o avatar está olhando: "down" | "up" | "left" | "right"
  @type("string") direction: string = "down";

  // Está se movendo? (para tocar animação no client)
  @type("boolean") isMoving: boolean = false;

  // Cor do avatar (placeholder até termos sprites de verdade)
  @type("string") color: string = "#4ade80";

  // ID da sala/zona em que está (para áudio espacial futuro)
  @type("string") zoneId: string = "open";
}

/**
 * OfficeState: estado global da sala/escritório.
 * O Map de players é sincronizado: adicionar/remover/mudar
 * gera um delta para todos os clientes conectados.
 */
export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();

  // Dimensões do mundo em pixels (default: 32x32 tiles de 32px = 1024x1024)
  @type("number") worldWidth: number = 1024;
  @type("number") worldHeight: number = 1024;
}
