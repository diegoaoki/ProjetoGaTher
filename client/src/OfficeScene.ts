import Phaser from "phaser";
import { Room } from "colyseus.js";

interface RemotePlayer {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc; // anel verde quando falando
  nameText: Phaser.GameObjects.Text;
  identity?: string; // mapeamento pro LiveKit
  targetX: number;
  targetY: number;
}

const TILE = 32;
const SPEED = 180;
const SYNC_INTERVAL = 50;

export class OfficeScene extends Phaser.Scene {
  private room!: Room;
  private myId!: string;

  private myBody!: Phaser.GameObjects.Arc;
  private myRing!: Phaser.GameObjects.Arc;
  private myContainer!: Phaser.GameObjects.Container;
  private myNameText!: Phaser.GameObjects.Text;

  private remotePlayers = new Map<string, RemotePlayer>();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  private lastSync = 0;
  private direction = "down";
  private isMoving = false;

  // Callback chamado a cada frame com as posições atualizadas
  // Usado pelo App pra atualizar o áudio espacial
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
    this.drawFloor();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as any;

    this.setupStateListeners();

    this.cameras.main.setBackgroundColor("#1e293b");
  }

  /** Marca um avatar remoto como "falando" (anel verde piscando) */
  public setRemoteSpeaking(sessionId: string, speaking: boolean) {
    const rp = this.remotePlayers.get(sessionId);
    if (!rp) return;
    rp.ring.setVisible(speaking);
  }

  public setMySpeaking(speaking: boolean) {
    if (this.myRing) this.myRing.setVisible(speaking);
  }

  private drawFloor() {
    const g = this.add.graphics();
    const cols = 32;
    const rows = 32;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const isDark = (x + y) % 2 === 0;
        g.fillStyle(isDark ? 0x1e293b : 0x273449, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    g.lineStyle(1, 0x334155, 0.3);
    for (let x = 0; x <= cols; x++) {
      g.lineBetween(x * TILE, 0, x * TILE, rows * TILE);
    }
    for (let y = 0; y <= rows; y++) {
      g.lineBetween(0, y * TILE, cols * TILE, y * TILE);
    }
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
        }
      });
    });

    state.players.onRemove((_player: any, sessionId: string) => {
      const rp = this.remotePlayers.get(sessionId);
      if (rp) {
        rp.sprite.destroy();
        this.remotePlayers.delete(sessionId);
      }
    });
  }

  private createMyAvatar(player: any) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;

    // Anel verde de "falando" (começa invisível)
    this.myRing = this.add.circle(0, 0, 20, 0x4ade80, 0);
    this.myRing.setStrokeStyle(3, 0x4ade80);
    this.myRing.setVisible(false);

    this.myBody = this.add.circle(0, 0, 14, color);
    this.myBody.setStrokeStyle(2, 0xffffff);

    this.myNameText = this.add.text(0, -28, player.name + " (você)", {
      fontFamily: "system-ui",
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000aa",
      padding: { x: 6, y: 2 },
    }).setOrigin(0.5);

    this.myContainer = this.add.container(player.x, player.y, [this.myRing, this.myBody, this.myNameText]);

    this.cameras.main.startFollow(this.myContainer, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.4);
  }

  private createRemoteAvatar(sessionId: string, player: any) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;

    const ring = this.add.circle(0, 0, 20, 0x4ade80, 0);
    ring.setStrokeStyle(3, 0x4ade80);
    ring.setVisible(false);

    const body = this.add.circle(0, 0, 14, color);
    body.setStrokeStyle(2, 0xffffff);

    const nameText = this.add.text(0, -28, player.name, {
      fontFamily: "system-ui",
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000aa",
      padding: { x: 6, y: 2 },
    }).setOrigin(0.5);

    const sprite = this.add.container(player.x, player.y, [ring, body, nameText]);

    this.remotePlayers.set(sessionId, {
      sprite,
      body,
      ring,
      nameText,
      targetX: player.x,
      targetY: player.y,
    });
  }

  update(time: number, delta: number) {
    if (!this.myContainer) return;

    const dt = delta / 1000;
    let vx = 0, vy = 0;

    if (this.cursors.left?.isDown || this.wasd.A.isDown) { vx = -1; this.direction = "left"; }
    else if (this.cursors.right?.isDown || this.wasd.D.isDown) { vx = 1; this.direction = "right"; }

    if (this.cursors.up?.isDown || this.wasd.W.isDown) { vy = -1; this.direction = "up"; }
    else if (this.cursors.down?.isDown || this.wasd.S.isDown) { vy = 1; this.direction = "down"; }

    if (vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }

    this.isMoving = vx !== 0 || vy !== 0;

    if (this.isMoving) {
      const newX = this.myContainer.x + vx * SPEED * dt;
      const newY = this.myContainer.y + vy * SPEED * dt;
      this.myContainer.x = Phaser.Math.Clamp(newX, 14, 32 * TILE - 14);
      this.myContainer.y = Phaser.Math.Clamp(newY, 14, 32 * TILE - 14);
    }

    if (time - this.lastSync > SYNC_INTERVAL) {
      this.lastSync = time;
      this.room.send("move", {
        x: this.myContainer.x,
        y: this.myContainer.y,
        direction: this.direction,
        isMoving: this.isMoving,
      });
    }

    const lerp = 0.2;
    this.remotePlayers.forEach((rp) => {
      rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.targetX, lerp);
      rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.targetY, lerp);
    });

    // Notifica App das posições pra atualizar áudio espacial
    if (this.onPositionsUpdate) {
      const peerPositions = new Map<string, { x: number; y: number }>();
      this.remotePlayers.forEach((rp, sessionId) => {
        peerPositions.set(sessionId, { x: rp.sprite.x, y: rp.sprite.y });
      });
      this.onPositionsUpdate(
        { x: this.myContainer.x, y: this.myContainer.y },
        peerPositions
      );
    }
  }
}
