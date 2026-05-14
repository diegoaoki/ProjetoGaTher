import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  createAvatarTexture,
  createAvatarAnimations,
  createFurnitureTextures,
  createFloorTextures,
} from "./SpriteFactory";
import { getDefaultLayout } from "./OfficeLayout";

interface RemotePlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  color: string;
  textureKey: string;
  targetX: number;
  targetY: number;
  lastX: number;
  lastY: number;
  direction: string;
}

const TILE = 32;
const SPEED = 180;
const SYNC_INTERVAL = 50;
const WORLD_W = 1024;
const WORLD_H = 1024;

export class OfficeScene extends Phaser.Scene {
  private room!: Room;
  private myId!: string;

  private mySprite!: Phaser.GameObjects.Sprite;
  private myRing!: Phaser.GameObjects.Arc;
  private myContainer!: Phaser.GameObjects.Container;
  private myNameText!: Phaser.GameObjects.Text;
  private myTextureKey!: string;
  private myDirection = "down";

  private remotePlayers = new Map<string, RemotePlayer>();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  private lastSync = 0;
  private isMoving = false;

  public onPositionsUpdate?: (
    myPos: { x: number; y: number },
    peerPositions: Map<string, { x: number; y: number }>
  ) => void;

  constructor() {
    super({ key: "OfficeScene" });
  }

  init(data: { room: Room; myId: string }) {
    this.room = data.room;
    this.myId = data.myId;
  }

  create() {
    // Cria todas as texturas em runtime
    createFloorTextures(this);
    createFurnitureTextures(this);

    // Piso e layout
    this.drawFloor();
    this.drawFurniture();

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as any;

    // Listeners do estado
    this.setupStateListeners();

    // Configurações da câmera
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
  }

  public setRemoteSpeaking(sessionId: string, speaking: boolean) {
    const rp = this.remotePlayers.get(sessionId);
    if (rp) rp.ring.setVisible(speaking);
  }

  public setMySpeaking(speaking: boolean) {
    if (this.myRing) this.myRing.setVisible(speaking);
  }

  private drawFloor() {
    const layout = getDefaultLayout();
    const floor = this.add.tileSprite(0, 0, WORLD_W, WORLD_H, "floorWood").setOrigin(0, 0);
    floor.setDepth(-100);

    // Tapetes e áreas especiais
    layout.floorRegions.forEach((region) => {
      if (region.type === "rug") {
        const rug = this.add.tileSprite(
          region.x,
          region.y,
          region.w,
          region.h,
          "floorCarpet"
        ).setOrigin(0, 0);
        rug.setDepth(-50);
        rug.setAlpha(0.9);
      }
    });

    // Bordas do mundo (parede simulada)
    const border = this.add.graphics();
    border.lineStyle(4, 0x1a1a2e, 1);
    border.strokeRect(0, 0, WORLD_W, WORLD_H);
    border.setDepth(-10);

    // Vinheta sutil nas bordas
    const vignette = this.add.graphics();
    vignette.fillStyle(0x000000, 0.15);
    for (let i = 0; i < 4; i++) {
      vignette.fillRect(0, i * 2, WORLD_W, 2);
      vignette.fillRect(0, WORLD_H - (i + 1) * 2, WORLD_W, 2);
      vignette.fillRect(i * 2, 0, 2, WORLD_H);
      vignette.fillRect(WORLD_W - (i + 1) * 2, 0, 2, WORLD_H);
    }
    vignette.setDepth(-9);
  }

  private drawFurniture() {
    const layout = getDefaultLayout();
    layout.furniture.forEach((item) => {
      const sprite = this.add.image(item.x, item.y, item.type);
      sprite.setOrigin(0.5, 0.5);
      // Usa Y do sprite como depth pra ordenação natural (sprites mais embaixo aparecem na frente)
      sprite.setDepth(item.y);
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
        if (sessionId === this.myId) return;
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
  }

  private createMyAvatar(player: any) {
    const color = player.color || "#4ade80";
    this.myTextureKey = `avatar_${color}`;
    createAvatarTexture(this, this.myTextureKey, color);
    createAvatarAnimations(this, this.myTextureKey);

    // Anel verde (falando)
    this.myRing = this.add.circle(0, 4, 22, 0x4ade80, 0);
    this.myRing.setStrokeStyle(3, 0x4ade80);
    this.myRing.setVisible(false);

    // Sprite do avatar
    this.mySprite = this.add.sprite(0, 0, this.myTextureKey, 0);
    this.mySprite.setScale(1);

    // Nome
    this.myNameText = this.add.text(0, -28, player.name + " (você)", {
      fontFamily: "system-ui, -apple-system",
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000bb",
      padding: { x: 6, y: 2 },
      resolution: 2,
    }).setOrigin(0.5);

    this.myContainer = this.add.container(player.x, player.y, [
      this.myRing,
      this.mySprite,
      this.myNameText,
    ]);
    this.myContainer.setDepth(player.y);

    this.cameras.main.startFollow(this.myContainer, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.3);

    this.mySprite.play(`${this.myTextureKey}_down_idle`);
  }

  private createRemoteAvatar(sessionId: string, player: any) {
    const color = player.color || "#60a5fa";
    const textureKey = `avatar_${color}`;
    createAvatarTexture(this, textureKey, color);
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
      container,
      sprite,
      ring,
      nameText,
      color,
      textureKey,
      targetX: player.x,
      targetY: player.y,
      lastX: player.x,
      lastY: player.y,
      direction: player.direction || "down",
    });
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

    if (this.isMoving) {
      const newX = this.myContainer.x + vx * SPEED * dt;
      const newY = this.myContainer.y + vy * SPEED * dt;
      this.myContainer.x = Phaser.Math.Clamp(newX, 16, WORLD_W - 16);
      this.myContainer.y = Phaser.Math.Clamp(newY, 16, WORLD_H - 16);
      this.myContainer.setDepth(this.myContainer.y);
    }

    // Atualiza animação se direção ou estado mudou
    if (newDir !== this.myDirection || this.isMoving !== wasMoving) {
      this.myDirection = newDir;
      const anim = this.isMoving ? "walk" : "idle";
      const key = `${this.myTextureKey}_${this.myDirection}_${anim}`;
      if (this.anims.exists(key)) this.mySprite.play(key, true);
    }

    // Sync periódico
    if (time - this.lastSync > SYNC_INTERVAL) {
      this.lastSync = time;
      this.room.send("move", {
        x: this.myContainer.x,
        y: this.myContainer.y,
        direction: this.myDirection,
        isMoving: this.isMoving,
      });
    }

    // Interpolação dos remotos + animação por movimento
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

      rp.lastX = rp.container.x;
      rp.lastY = rp.container.y;
    });

    // Callback de posições pro áudio espacial
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
  }
}
