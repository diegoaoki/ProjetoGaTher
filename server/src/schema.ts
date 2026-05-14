import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: string = "down";
  @type("boolean") isMoving: boolean = false;
  @type("string") color: string = "#4ade80"; // cor da camisa
  @type("string") hairColor: string = "#3b2c20"; // cor do cabelo
  @type("string") zoneId: string = "open";
}

export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("number") worldWidth: number = 1024;
  @type("number") worldHeight: number = 1024;
}
