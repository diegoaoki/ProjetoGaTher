import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";        // sessionId do Colyseus
  @type("string") userId: string = "";    // userId persistido (mapeia pro identity do LiveKit)
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: string = "down";
  @type("boolean") isMoving: boolean = false;
  @type("string") color: string = "#4ade80"; // cor da camisa (legado — não usado no LimeZu)
  @type("string") hairColor: string = "#3b2c20"; // cor do cabelo (legado)
  @type("string") characterId: string = "";  // adam|alex|amelia|bob — "" = fallback pra hash do userId
  @type("string") zoneId: string = "open";
}

export class Desk extends Schema {
  @type("string") deskId: string = "";
  @type("string") ownerId: string = "";
  @type("string") ownerName: string = "";
  @type("string") ownerColor: string = "";
}

/**
 * Portas do escritório (Fase C). Estado open/closed sincronizado entre clients.
 * Abertura automática por proximidade (server faz tick), fechamento após 3s
 * sem ninguém perto.
 */
export class Door extends Schema {
  @type("string") doorId: string = "";
  @type("number") x: number = 0;          // centro em pixels
  @type("number") y: number = 0;
  @type("string") orientation: string = "vertical"; // "vertical" | "horizontal"
  @type("string") roomTag: string = "";   // sala interna
  @type("boolean") open: boolean = false;
  @type("boolean") restricted: boolean = false; // flag pra auth futura
  @type("number") gapTiles: number = 2;   // largura do vão em tiles (default 2)
}

export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Desk }) desks = new MapSchema<Desk>();
  @type({ map: Door }) doors = new MapSchema<Door>();
  @type("number") worldWidth: number = 2560;
  @type("number") worldHeight: number = 1760;
}
