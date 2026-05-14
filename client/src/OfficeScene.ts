import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  createAvatarTexture,
  createAvatarAnimations,
  createFurnitureTextures,
  createFloorTextures,
} from "./SpriteFactory";
import { getDefaultLayout, checkCollision, getCurrentZone } from "./OfficeLayout";

interface RemotePlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  bodyColor: string;
  hairColor: string;
  textureKey: string;
  targetX: number;
  targetY: number;
  direction: string;
}

interface DeskInfo {
  id: string;
  x: number;
  y: number;
}

interface DeskOverlay {
  outline: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const SPEED = 180;
const SYNC_INTERVAL = 50;
const WORLD_W = 1024;
const WORLD_H = 1024;
const PLAYER_HALF = 12;
const DESK_CLAIM_RADIUS = 70;

export class OfficeScene extends Phaser.Scene {
  private room!: Room;
  private myId!: string;

  private myBodyColor = "#4ade80";
  private myHairColor = "#3b2c20";

  private mySprite!: Phaser.GameObjects.Sprite;
  private myRing!: Phaser.GameObjects.Arc;
  private myContainer!: Phaser.GameObjects.Container;
  private myNameText!: Phaser.GameObjects.Text;
  private myTextureKey!: string;
  private myDirection = "down";

  private remotePlayers = new Map<string, RemotePlayer>();
  private myUserId = "";

  // === Mesas reserváveis ===
  private allDesks: DeskInfo[] = [];
  private deskOverlays = new Map<string, DeskOverlay>(); // deskId → overlay
  private nearestDeskId: string | null = null;
  private myDeskId: string | null = null;
  private keyE!: Phaser.Input.Keyboard.Key;

  // === Pan da câmera com mouse ===
  private cameraFollowing = true;
  private isPanning = false;
  private panStartScreenX = 0;
  private panStartScreenY = 0;
  private panStartScrollX = 0;
  private panStartScrollY = 0;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  private lastSync = 0;
  private isMoving = false;

  private layout = getDefaultLayout();

  private tvSprite?: Phaser.GameObjects.Image;
  private tvScreen?: Phaser.GameObjects.Rectangle;
  private tvVideoDom?: Phaser.GameObjects.DOMElement;
  private tvVideoElement?: HTMLVideoElement;
  private tvX = 0;
  private tvY = 0;
  private currentZone: string | null = null;

  public onPositionsUpdate?: (
    myPos: { x: number; y: number },
    peerPositions: Map<string, { x: number; y: number }>
  ) => void;
  public onZoneChange?: (zone: string | null) => void;

  // === Callbacks de mesas (pra App.tsx renderizar HUD/toast) ===
  public onNearbyDeskChange?: (info: { deskId: string; isMine: boolean; ownerName?: string } | null) => void;
  public onMyDeskChange?: (deskId: string | null) => void;
  public onDeskError?: (msg: string) => void;

  // === Callback de câmera (pra App.tsx mostrar hint "C pra centralizar") ===
  public onCameraFollowingChange?: (following: boolean) => void;

  constructor() {
    super({ key: "OfficeScene" });
  }

  init(data: { room: Room; myId: string; bodyColor?: string; hairColor?: string }) {
    this.room = data.room;
    this.myId = data.myId;
    if (data.bodyColor) this.myBodyColor = data.bodyColor;
    if (data.hairColor) this.myHairColor = data.hairColor;
  }

  create() {
    createFloorTextures(this);
    createFurnitureTextures(this);
    this.drawFloor();
    this.drawFurniture();

    // Catálogo de mesas extraído do layout — usado pra detecção de proximidade.
    this.allDesks = this.layout.furniture
      .filter((f) => f.type === "desk" && f.deskId)
      .map((f) => ({ id: f.deskId!, x: f.x, y: f.y }));

    this.setupStateListeners();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as any;
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyE.on("down", () => this.handleClaimKey());

    // Tecla C: recentraliza câmera no avatar (volta a seguir)
    this.input.keyboard!.addKey("C").on("down", () => this.recenterCamera());

    // Pan com botão direito do mouse — não interfere com cliques de UI nem com tecla E
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.startPan(pointer.x, pointer.y);
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning && pointer.rightButtonDown()) {
        this.updatePan(pointer.x, pointer.y);
      } else if (this.isPanning && !pointer.rightButtonDown()) {
        // Soltou o botão fora da área (ex: drag pra fora do canvas)
        this.isPanning = false;
      }
    });
    this.input.on("pointerup", () => {
      this.isPanning = false;
    });

    // Erros vindos do server (mesa já reservada, mesa inválida, etc)
    this.room.onMessage("desk:error", (msg: { error: string }) => {
      this.onDeskError?.(msg?.error || "Falha na ação de mesa");
    });

    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
  }

  private startPan(screenX: number, screenY: number) {
    this.isPanning = true;
    this.panStartScreenX = screenX;
    this.panStartScreenY = screenY;
    this.panStartScrollX = this.cameras.main.scrollX;
    this.panStartScrollY = this.cameras.main.scrollY;
    if (this.cameraFollowing) {
      this.cameraFollowing = false;
      this.cameras.main.stopFollow();
      this.onCameraFollowingChange?.(false);
    }
  }

  private updatePan(screenX: number, screenY: number) {
    const zoom = this.cameras.main.zoom || 1;
    const dx = (screenX - this.panStartScreenX) / zoom;
    const dy = (screenY - this.panStartScreenY) / zoom;
    this.cameras.main.scrollX = this.panStartScrollX - dx;
    this.cameras.main.scrollY = this.panStartScrollY - dy;
  }

  private recenterCamera() {
    if (!this.myContainer) return;
    if (this.cameraFollowing) return;
    this.cameraFollowing = true;
    this.cameras.main.startFollow(this.myContainer, true, 0.1, 0.1);
    this.onCameraFollowingChange?.(true);
  }

  public setRemoteSpeaking(sessionId: string, speaking: boolean) {
    const rp = this.remotePlayers.get(sessionId);
    if (rp) rp.ring.setVisible(speaking);
  }

  public setMySpeaking(speaking: boolean) {
    if (this.myRing) this.myRing.setVisible(speaking);
  }

  public showScreenShareOnTV(stream: MediaStream) {
    if (!this.tvSprite) return;
    this.hideScreenShareFromTV();

    const videoEl = document.createElement("video");
    videoEl.srcObject = stream;
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.width = "136px";
    videoEl.style.height = "52px";
    videoEl.style.objectFit = "contain";
    videoEl.style.background = "#000";
    videoEl.style.pointerEvents = "none";
    videoEl.style.display = "block";
    videoEl.play().catch((err) => console.warn("[scene] play TV falhou:", err));

    this.tvVideoElement = videoEl;
    const dom = this.add.dom(this.tvX, this.tvY - 14, videoEl);
    dom.setDepth(this.tvY + 1);
    this.tvVideoDom = dom;

    if (this.tvScreen) {
      this.tweens.killTweensOf(this.tvScreen);
      this.tvScreen.destroy();
    }
    this.tvScreen = this.add.rectangle(this.tvX + 30, this.tvY + 4, 4, 4, 0x16a34a);
    this.tvScreen.setDepth(this.tvY + 2);
    this.tweens.add({ targets: this.tvScreen, alpha: { from: 0.4, to: 1 }, duration: 800, yoyo: true, repeat: -1 });
  }

  public hideScreenShareFromTV() {
    if (this.tvVideoElement) {
      this.tvVideoElement.srcObject = null;
      this.tvVideoElement = undefined;
    }
    if (this.tvVideoDom) { this.tvVideoDom.destroy(); this.tvVideoDom = undefined; }
    if (this.tvScreen) {
      this.tweens.killTweensOf(this.tvScreen);
      this.tvScreen.destroy();
      this.tvScreen = undefined;
    }
  }

  private drawFloor() {
    const floor = this.add.tileSprite(0, 0, WORLD_W, WORLD_H, "floorWood").setOrigin(0, 0);
    floor.setDepth(-100);

    this.layout.floorRegions.forEach((region) => {
      if (region.type === "rug") {
        const rug = this.add.tileSprite(region.x, region.y, region.w, region.h, "floorCarpet").setOrigin(0, 0);
        rug.setDepth(-50);
        rug.setAlpha(0.9);
      }
    });

    const border = this.add.graphics();
    border.lineStyle(4, 0x1a1a2e, 1);
    border.strokeRect(0, 0, WORLD_W, WORLD_H);
    border.setDepth(-10);
  }

  private drawFurniture() {
    this.layout.furniture.forEach((item) => {
      const sprite = this.add.image(item.x, item.y, item.type);
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(item.y);

      if (item.tag === "tv") {
        this.tvSprite = sprite;
        this.tvX = item.x;
        this.tvY = item.y;
      }
    });
  }

  private setupStateListeners() {
    const state: any = this.room.state;

    state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === this.myId) {
        this.createMyAvatar(player);
      } else {
        this.createRemoteAvatar(sessionId, player);
      }

      player.onChange(() => {
        if (sessionId === this.myId) {
          // Se o server mexeu na minha posição (teleport autoritativo), bate
          // a posição visual. Só aplica quando o delta é GRANDE — pequenos
          // jitters do server vs local seriam noise.
          if (!this.myContainer) return;
          const dx = player.x - this.myContainer.x;
          const dy = player.y - this.myContainer.y;
          if (Math.abs(dx) > 50 || Math.abs(dy) > 50) {
            this.myContainer.x = player.x;
            this.myContainer.y = player.y;
            this.myContainer.setDepth(player.y);
          }
          return;
        }
        const rp = this.remotePlayers.get(sessionId);
        if (rp) {
          rp.targetX = player.x;
          rp.targetY = player.y;
          rp.direction = player.direction || "down";
        }
      });
    });

    state.players.onRemove((_player: any, sessionId: string) => {
      const rp = this.remotePlayers.get(sessionId);
      if (rp) {
        rp.container.destroy();
        this.remotePlayers.delete(sessionId);
      }
    });

    // Listener de mesas reservadas — protegido contra server desatualizado
    // que ainda não tem `desks` no schema (durante deploys parciais).
    if (state.desks && typeof state.desks.onAdd === "function") {
      state.desks.onAdd((desk: any, deskId: string) => {
        this.renderDeskOverlay(deskId, desk);
        desk.onChange(() => this.renderDeskOverlay(deskId, desk));
        if (desk.ownerId === this.myUserId) {
          this.myDeskId = deskId;
          this.onMyDeskChange?.(deskId);
        }
      });

      state.desks.onRemove((_desk: any, deskId: string) => {
        this.removeDeskOverlay(deskId);
        if (this.myDeskId === deskId) {
          this.myDeskId = null;
          this.onMyDeskChange?.(null);
        }
      });
    } else {
      console.warn("[scene] state.desks ausente — server desatualizado, mesas desabilitadas");
    }
  }

  private renderDeskOverlay(deskId: string, desk: { ownerName: string; ownerColor: string }) {
    const info = this.allDesks.find((d) => d.id === deskId);
    if (!info) return;

    const color = Phaser.Display.Color.HexStringToColor(desk.ownerColor || "#4ade80").color;
    const existing = this.deskOverlays.get(deskId);

    if (existing) {
      existing.outline.setStrokeStyle(3, color, 1);
      existing.label.setText(desk.ownerName);
      existing.label.setColor("#ffffff");
      existing.label.setBackgroundColor("#000000bb");
      return;
    }

    const outline = this.add.rectangle(info.x, info.y, 100, 36);
    outline.setStrokeStyle(3, color, 1);
    outline.setFillStyle(0, 0);
    outline.setDepth(info.y - 1);

    const label = this.add.text(info.x, info.y - 30, desk.ownerName, {
      fontFamily: "system-ui, -apple-system",
      fontSize: "11px",
      color: "#ffffff",
      backgroundColor: "#000000bb",
      padding: { x: 5, y: 1 },
      resolution: 2,
    }).setOrigin(0.5);
    label.setDepth(info.y - 1);

    this.deskOverlays.set(deskId, { outline, label });
  }

  private removeDeskOverlay(deskId: string) {
    const o = this.deskOverlays.get(deskId);
    if (o) {
      o.outline.destroy();
      o.label.destroy();
      this.deskOverlays.delete(deskId);
    }
  }

  private handleClaimKey() {
    if (!this.myContainer) return;
    const state: any = this.room.state;
    if (!state?.desks) {
      console.warn("[desk] E pressionado mas state.desks ausente — server desatualizado. Rode `railway up`.");
      this.onDeskError?.("Servidor desatualizado — mesas indisponíveis");
      return;
    }
    console.log(
      "[desk] E pressionado:",
      "nearestDeskId=", this.nearestDeskId,
      "myDeskId=", this.myDeskId,
      "myUserId=", this.myUserId
    );
    // Se está perto de uma mesa, age sobre ela. Senão, se tem mesa reservada, libera.
    if (this.nearestDeskId) {
      const desk = state.desks.get(this.nearestDeskId);
      if (desk && desk.ownerId === this.myUserId) {
        this.room.send("desk:release", { deskId: this.nearestDeskId });
      } else if (!desk) {
        this.room.send("desk:claim", { deskId: this.nearestDeskId });
      } else {
        // Mesa de outra pessoa — avisa pro user
        this.onDeskError?.(`Essa mesa é de ${desk.ownerName}`);
      }
    } else if (this.myDeskId) {
      // Não tá perto de nenhuma; libera a mesa atual se tiver
      this.room.send("desk:release", { deskId: this.myDeskId });
    } else {
      this.onDeskError?.("Chegue perto de uma mesa pra reservar");
    }
  }

  private createMyAvatar(player: any) {
    this.myUserId = player.userId || "";
    this.myTextureKey = `avatar_${this.myBodyColor}_${this.myHairColor}`;
    createAvatarTexture(this, this.myTextureKey, this.myBodyColor, this.myHairColor);
    createAvatarAnimations(this, this.myTextureKey);

    this.myRing = this.add.circle(0, 4, 22, 0x4ade80, 0);
    this.myRing.setStrokeStyle(3, 0x4ade80);
    this.myRing.setVisible(false);

    this.mySprite = this.add.sprite(0, 0, this.myTextureKey, 0);

    this.myNameText = this.add.text(0, -28, player.name + " (você)", {
      fontFamily: "system-ui, -apple-system",
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000bb",
      padding: { x: 6, y: 2 },
      resolution: 2,
    }).setOrigin(0.5);

    let spawnX = player.x;
    let spawnY = player.y;

    // Se mesmo assim spawnou dentro de móvel (ex: server antigo, layout antigo, race),
    // procura ponto livre próximo
    if (checkCollision(spawnX, spawnY, PLAYER_HALF, this.layout)) {
      const safe = this.findNearestFreePosition(spawnX, spawnY);
      spawnX = safe.x;
      spawnY = safe.y;
      console.warn("[scene] spawn em colisão; reposicionado para", safe);
    }

    this.myContainer = this.add.container(spawnX, spawnY, [this.myRing, this.mySprite, this.myNameText]);
    this.myContainer.setDepth(spawnY);

    this.cameras.main.startFollow(this.myContainer, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.3);

    this.mySprite.play(`${this.myTextureKey}_down_idle`);

    this.room.send("appearance", {
      bodyColor: this.myBodyColor,
      hairColor: this.myHairColor,
    });
  }

  /**
   * Busca em espiral por uma posição sem colisão a partir de (sx, sy).
   * Útil quando o avatar spawna dentro de móvel ou o layout muda.
   */
  private findNearestFreePosition(sx: number, sy: number): { x: number; y: number } {
    const STEP = 16;
    const MAX_RADIUS = 400;

    for (let r = STEP; r <= MAX_RADIUS; r += STEP) {
      // Testa 8 direções em cada raio
      const directions = [
        [0, -r], [r, 0], [0, r], [-r, 0],
        [r, -r], [r, r], [-r, r], [-r, -r],
      ];
      for (const [dx, dy] of directions) {
        const nx = Phaser.Math.Clamp(sx + dx, PLAYER_HALF, WORLD_W - PLAYER_HALF);
        const ny = Phaser.Math.Clamp(sy + dy, PLAYER_HALF, WORLD_H - PLAYER_HALF);
        if (!checkCollision(nx, ny, PLAYER_HALF, this.layout)) {
          return { x: nx, y: ny };
        }
      }
    }
    // Fallback absoluto: centro do mapa
    return { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  private createRemoteAvatar(sessionId: string, player: any) {
    const bodyColor = player.color || "#60a5fa";
    const hairColor = player.hairColor || "#3b2c20";
    const textureKey = `avatar_${bodyColor}_${hairColor}`;
    createAvatarTexture(this, textureKey, bodyColor, hairColor);
    createAvatarAnimations(this, textureKey);

    const ring = this.add.circle(0, 4, 22, 0x4ade80, 0);
    ring.setStrokeStyle(3, 0x4ade80);
    ring.setVisible(false);

    const sprite = this.add.sprite(0, 0, textureKey, 0);

    const nameText = this.add.text(0, -28, player.name, {
      fontFamily: "system-ui, -apple-system",
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000bb",
      padding: { x: 6, y: 2 },
      resolution: 2,
    }).setOrigin(0.5);

    const container = this.add.container(player.x, player.y, [ring, sprite, nameText]);
    container.setDepth(player.y);
    sprite.play(`${textureKey}_down_idle`);

    this.remotePlayers.set(sessionId, {
      container, sprite, ring, nameText,
      bodyColor, hairColor, textureKey,
      targetX: player.x, targetY: player.y,
      direction: player.direction || "down",
    });
  }

  /**
   * Tenta mover de (curX, curY) por (dx, dy) com lógica de unstuck.
   *
   * Regra:
   *   - Se a posição ATUAL já está em colisão, qualquer movimento que diminua
   *     a "profundidade" da colisão é permitido. Isso resolve o caso "preso dentro de móvel".
   *   - Caso contrário, comportamento normal: testa destino, slide nos eixos.
   */
  private tryMove(curX: number, curY: number, dx: number, dy: number): { x: number; y: number } {
    const stuck = checkCollision(curX, curY, PLAYER_HALF, this.layout);

    if (stuck) {
      // Estou preso. Aceito qualquer movimento que reduza o overlap com móveis,
      // OU que me leve pra fora completamente.
      const nextX = curX + dx;
      const nextY = curY + dy;

      // Se a nova posição já está livre, ótimo
      if (!checkCollision(nextX, nextY, PLAYER_HALF, this.layout)) {
        return { x: nextX, y: nextY };
      }

      // Senão, escolho o movimento que mais afasta de móveis sólidos
      // (heurística simples: aceito o movimento mesmo se ainda em colisão,
      //  desde que não esteja AUMENTANDO a colisão)
      // Pra simplicidade, sempre permito quando preso — o usuário consegue sair
      return { x: nextX, y: nextY };
    }

    // Não preso: comportamento normal de colisão
    const nextX = curX + dx;
    const nextY = curY + dy;

    if (!checkCollision(nextX, nextY, PLAYER_HALF, this.layout)) {
      return { x: nextX, y: nextY };
    }
    if (dx !== 0 && !checkCollision(nextX, curY, PLAYER_HALF, this.layout)) {
      return { x: nextX, y: curY };
    }
    if (dy !== 0 && !checkCollision(curX, nextY, PLAYER_HALF, this.layout)) {
      return { x: curX, y: nextY };
    }
    return { x: curX, y: curY };
  }

  update(time: number, delta: number) {
    if (!this.myContainer) return;

    const dt = delta / 1000;
    let vx = 0, vy = 0;
    let newDir = this.myDirection;

    if (this.cursors.left?.isDown || this.wasd.A.isDown) { vx = -1; newDir = "left"; }
    else if (this.cursors.right?.isDown || this.wasd.D.isDown) { vx = 1; newDir = "right"; }

    if (this.cursors.up?.isDown || this.wasd.W.isDown) { vy = -1; newDir = "up"; }
    else if (this.cursors.down?.isDown || this.wasd.S.isDown) { vy = 1; newDir = "down"; }

    if (vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }

    const wasMoving = this.isMoving;
    this.isMoving = vx !== 0 || vy !== 0;

    // Se o user mexer no avatar enquanto a câmera tá deslocada (panning), volta a seguir.
    if (this.isMoving && !this.cameraFollowing) {
      this.recenterCamera();
    }

    if (this.isMoving) {
      const dx = vx * SPEED * dt;
      const dy = vy * SPEED * dt;
      const moved = this.tryMove(this.myContainer.x, this.myContainer.y, dx, dy);
      this.myContainer.x = Phaser.Math.Clamp(moved.x, PLAYER_HALF, WORLD_W - PLAYER_HALF);
      this.myContainer.y = Phaser.Math.Clamp(moved.y, PLAYER_HALF, WORLD_H - PLAYER_HALF);
      this.myContainer.setDepth(this.myContainer.y);
    }

    if (newDir !== this.myDirection || this.isMoving !== wasMoving) {
      this.myDirection = newDir;
      const anim = this.isMoving ? "walk" : "idle";
      const key = `${this.myTextureKey}_${this.myDirection}_${anim}`;
      if (this.anims.exists(key)) this.mySprite.play(key, true);
    }

    if (time - this.lastSync > SYNC_INTERVAL) {
      this.lastSync = time;
      this.room.send("move", {
        x: this.myContainer.x,
        y: this.myContainer.y,
        direction: this.myDirection,
        isMoving: this.isMoving,
      });
    }

    const zone = getCurrentZone(this.myContainer.x, this.myContainer.y, this.layout);
    const zoneId = zone?.id || null;
    if (zoneId !== this.currentZone) {
      this.currentZone = zoneId;
      this.onZoneChange?.(zoneId);
    }

    const lerp = 0.2;
    this.remotePlayers.forEach((rp) => {
      const prevX = rp.container.x;
      const prevY = rp.container.y;
      rp.container.x = Phaser.Math.Linear(rp.container.x, rp.targetX, lerp);
      rp.container.y = Phaser.Math.Linear(rp.container.y, rp.targetY, lerp);
      rp.container.setDepth(rp.container.y);

      const moved = Math.abs(rp.container.x - prevX) > 0.5 || Math.abs(rp.container.y - prevY) > 0.5;
      const anim = moved ? "walk" : "idle";
      const key = `${rp.textureKey}_${rp.direction}_${anim}`;
      if (this.anims.exists(key) && rp.sprite.anims.currentAnim?.key !== key) {
        rp.sprite.play(key, true);
      }
    });

    if (this.onPositionsUpdate) {
      const peerPositions = new Map<string, { x: number; y: number }>();
      this.remotePlayers.forEach((rp, sessionId) => {
        peerPositions.set(sessionId, { x: rp.container.x, y: rp.container.y });
      });
      this.onPositionsUpdate(
        { x: this.myContainer.x, y: this.myContainer.y },
        peerPositions
      );
    }

    this.updateNearestDesk();
  }

  /** Calcula a mesa mais próxima dentro do raio. Notifica App quando muda. */
  private updateNearestDesk() {
    if (!this.myContainer) return;
    const px = this.myContainer.x;
    const py = this.myContainer.y;

    let closest: { id: string; dist2: number } | null = null;
    for (const d of this.allDesks) {
      const dx = d.x - px;
      const dy = d.y - py;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < DESK_CLAIM_RADIUS * DESK_CLAIM_RADIUS) {
        if (!closest || dist2 < closest.dist2) closest = { id: d.id, dist2 };
      }
    }

    const newId = closest?.id || null;
    if (newId !== this.nearestDeskId) {
      this.nearestDeskId = newId;
      if (!newId) {
        this.onNearbyDeskChange?.(null);
      } else {
        const state: any = this.room.state;
        const desk = state?.desks?.get?.(newId);
        this.onNearbyDeskChange?.({
          deskId: newId,
          isMine: desk?.ownerId === this.myUserId,
          ownerName: desk?.ownerName,
        });
      }
    }
  }
}
