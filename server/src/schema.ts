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
  @type("string") ownerId: string = "";       // userId (não sessionId — persiste mesmo offline)
  @type("string") ownerName: string = "";
  @type("string") ownerColor: string = "";    // hex da camisa do dono
}

export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Desk }) desks = new MapSchema<Desk>();
  @type("number") worldWidth: number = 1024;
  @type("number") worldHeight: number = 1024;
}
