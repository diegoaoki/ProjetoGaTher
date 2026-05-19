import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

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
  // Avatar modular (LimeZu Character Generator): JSON
  // {body,hair,outfit,hat} com keys das peças. "" = sem custom (usa
  // characterId/hash legado). Sincronizado p/ todos verem o avatar do peer.
  @type("string") appearance: string = "";
  @type("string") zoneId: string = "open";
  // Bolha de conversa privada: "" = sem bolha. Mesmo bubbleId = mesma bolha
  // (N pessoas). Áudio entre membros = cheio; pra fora da bolha = baixo.
  @type("string") bubbleId: string = "";
  // Modo visitante: "user" | "visitor". Visitante não reserva mesa e fica
  // mudo até um host autorizar (visitorOk vira true).
  @type("string") role: string = "user";
  @type("boolean") visitorOk: boolean = false;
  // Mesa-conversa: deskSeat = deskId ocupado ("" = nenhum); deskSlot
  // = 0 (sentado) | 1 (esquerda) | 2 (direita). Quem está na mesma
  // mesa forma zona de áudio isolada (só eles se ouvem).
  @type("string") deskSeat: string = "";
  @type("number") deskSlot: number = -1;
  // Andar do prédio: 1 = térreo (mapa original), 2 = segundo andar.
  // Áudio e visibilidade são isolados entre andares diferentes.
  @type("number") floor: number = 1;
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

/**
 * Sala de reunião trancada via cadeado. Quem tranca vira "dono" da sessão
 * (lockedBy). Outros precisam pedir entrada (AccessRequest) e o dono libera.
 * key do MapSchema = roomId (ex: "meeting_xg").
 */
export class LockedRoom extends Schema {
  @type("string") roomId: string = "";
  @type("string") lockedBy: string = "";       // userId
  @type("string") lockedByName: string = "";
  @type("number") lockedAt: number = 0;        // ms epoch
}

/**
 * Pedido pendente de acesso a sala trancada. Aparece como toast pro dono.
 * key do MapSchema = `${roomId}:${requesterId}` (idempotente — se mesmo user
 * pedir 2x, atualiza em vez de duplicar).
 */
export class AccessRequest extends Schema {
  @type("string") roomId: string = "";
  @type("string") requesterId: string = "";    // userId
  @type("string") requesterSessionId: string = "";
  @type("string") requesterName: string = "";
  @type("number") createdAt: number = 0;
}

/**
 * NPC virtual de segurança que aparece na porta da sala trancada.
 * Não é Player — não tem userId, não conecta ao LiveKit, não move.
 * Apenas posição + flag pro client renderizar com fade-in/out.
 * key do MapSchema = roomId (1 NPC por sala trancada).
 */
export class SecurityNPC extends Schema {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;               // centro em pixels
  @type("number") y: number = 0;
  @type("string") direction: string = "down";  // pra qual lado o sprite olha
}

export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Desk }) desks = new MapSchema<Desk>();
  @type({ map: Door }) doors = new MapSchema<Door>();
  @type({ map: LockedRoom }) lockedRooms = new MapSchema<LockedRoom>();
  @type({ map: AccessRequest }) accessRequests = new MapSchema<AccessRequest>();
  @type({ map: SecurityNPC }) securityNPCs = new MapSchema<SecurityNPC>();
  @type("number") worldWidth: number = 2560;
  @type("number") worldHeight: number = 2720; // 80×85 tiles (2º andar incluso)
}
