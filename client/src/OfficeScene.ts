import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  createAvatarTexture,
  createAvatarAnimations,
  createFurnitureTextures,
  createFloorTextures,
} from "./SpriteFactory";
import { getDefaultLayout, checkCollision, getCurrentRoom } from "./OfficeLayout";
import { preloadLimezuAssets } from "./AssetLoader";

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

  // === Joystick virtual (mobile) — sobrescreve teclado quando ativo ===
  private virtualVx = 0;
  private virtualVy = 0;

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

  // Balões de vídeo (câmera + screen share) flutuando em cima dos avatares.
  // Chave: `${identity}|${kind}` onde kind = "camera" | "screen". Identity especial
  // "__local__" representa o próprio jogador.
  private videoBalloons = new Map<string, {
    identity: string;     // identity do LiveKit ou "__local__"
    kind: "camera" | "screen";
    dom: Phaser.GameObjects.DOMElement;
    video: HTMLVideoElement;
  }>();

  // Raio de visibilidade dos balões em open space. Em salas isoladas
  // (mesma zona != "open"), sempre vê. Mesma regra do áudio.
  private readonly BALLOON_HEARING_RADIUS = 60;

  public onPositionsUpdate?: (
    myInfo: { x: number; y: number; zoneId: string },
    peerInfo: Map<string, { x: number; y: number; zoneId: string }>
  ) => void;
  public onZoneChange?: (zone: string | null) => void;

  // === Callbacks de mesas (pra App.tsx renderizar HUD/toast) ===
  public onNearbyDeskChange?: (info: { deskId: string; isMine: boolean; ownerName?: string } | null) => void;
  public onMyDeskChange?: (deskId: string | null) => void;
  public onDeskError?: (msg: string) => void;

  // === Callback de câmera (pra App.tsx mostrar hint "C pra centralizar") ===
  public onCameraFollowingChange?: (following: boolean) => void;

  // === Visibilidade dos peers (pra renderizar cards filtrados na barra direita) ===
  // Recebe Set de identities (LiveKit) dos peers visíveis pro player local.
  // Dispara só quando o conjunto MUDA — não a cada frame.
  public onVisiblePeersChange?: (visibleIdentities: Set<string>) => void;
  private visiblePeersCache = new Set<string>();

  constructor() {
    super({ key: "OfficeScene" });
  }

  init(data: { room: Room; myId: string; bodyColor?: string; hairColor?: string }) {
    this.room = data.room;
    this.myId = data.myId;
    if (data.bodyColor) this.myBodyColor = data.bodyColor;
    if (data.hairColor) this.myHairColor = data.hairColor;
  }

  preload() {
    // Etapa 1: carrega assets do LimeZu antes de criar a scene.
    // Etapas seguintes (2, 3, 4) vão consumir essas keys.
    preloadLimezuAssets(this);
  }

  create() {
    createFloorTextures(this);
    createFurnitureTextures(this);
    this.drawFloor();
    this.drawWalls();
    this.drawFurniture();

    // Catálogo de mesas extraído do layout — usado pra detecção de proximidade.
    this.allDesks = this.layout.furniture
      .filter((f) => f.type === "desk" && f.deskId)
      .map((f) => ({ id: f.deskId!, x: f.x, y: f.y }));

    this.setupStateListeners();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as any;
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyE.on("down", () => {
      if (isTypingInInput()) return;
      this.handleClaimKey();
    });

    // Tecla C: recentraliza câmera no avatar (volta a seguir)
    this.input.keyboard!.addKey("C").on("down", () => {
      if (isTypingInInput()) return;
      this.recenterCamera();
    });

    // Desabilita TODO o keyboard manager do Phaser quando o usuário foca em
    // um input HTML. Sem isso, Phaser intercepta letras (E, W, A, S, D, C)
    // antes do input receber, e o user não consegue digitar essas letras
    // no chat / login / modais.
    const onFocusIn = (e: FocusEvent) => {
      const t = (e.target as HTMLElement | null);
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (this.input?.keyboard) this.input.keyboard.enabled = false;
      }
    };
    const onFocusOut = () => {
      // Pequeno delay pra evitar race entre blur de um e focus de outro
      setTimeout(() => {
        if (!isTypingInInput() && this.input?.keyboard) {
          this.input.keyboard.enabled = true;
        }
      }, 0);
    };
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    // Defesa extra: intercepta keydown/keyup em CAPTURE phase (antes do Phaser
    // que escuta em bubble phase no window) e para a propagação se o target é
    // um input HTML. Garante que letras como E, W, A, S, D, C cheguem ao input
    // mesmo se o Phaser ainda estiver escutando.
    const keyInterceptor = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) {
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", keyInterceptor, true);
    document.addEventListener("keyup", keyInterceptor, true);

    this.events.once("shutdown", () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", keyInterceptor, true);
      document.removeEventListener("keyup", keyInterceptor, true);
    });

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

  /** Joystick virtual: x/y normalizados em -1..1. (0,0) = parado. */
  public setVirtualInput(x: number, y: number) {
    this.virtualVx = Math.max(-1, Math.min(1, x));
    this.virtualVy = Math.max(-1, Math.min(1, y));
  }

  /** Versão pública de handleClaimKey pra o botão E mobile chamar. */
  public triggerClaimAction() {
    this.handleClaimKey();
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

  /**
   * Cria/atualiza um balão de vídeo (câmera ou screen share) acima de um avatar.
   * - `identity` = identity do LiveKit (`userId__timestamp`) ou "__local__" pro próprio user.
   * - `kind` = "camera" (pequeno, sem click) ou "screen" (maior, clicável).
   * - `onClick` = só aplica em screen (opcional).
   */
  public showVideoBalloon(
    identity: string,
    kind: "camera" | "screen",
    element: HTMLVideoElement,
    onClick?: () => void
  ) {
    this.hideVideoBalloon(identity, kind);

    // Configurações visuais diferentes por tipo
    const isScreen = kind === "screen";
    element.style.width = isScreen ? "140px" : "100px";
    element.style.height = isScreen ? "90px" : "70px";
    element.style.objectFit = isScreen ? "contain" : "cover";
    element.style.borderRadius = "8px";
    element.style.border = isScreen ? "2px solid #4ade80" : "2px solid #60a5fa";
    element.style.background = "#000";
    element.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
    element.style.display = "block";
    element.muted = true;
    element.playsInline = true;
    if (isScreen && onClick) {
      element.style.cursor = "pointer";
      element.title = "Clique pra expandir";
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
    } else {
      element.style.cursor = "default";
    }
    // Força play (autoplay pode falhar em alguns timings)
    element.play().catch((err) => {
      if (err?.name !== "AbortError") console.warn("[balloon] play falhou:", err);
    });

    // Posição inicial — update() reposiciona a cada frame
    const pos = this.getAvatarPositionFor(identity);
    const offsetY = isScreen ? -100 : -50;
    const dom = this.add.dom(pos.x, pos.y + offsetY, element);
    dom.setDepth(10000);

    const key = `${identity}|${kind}`;
    this.videoBalloons.set(key, { identity, kind, dom, video: element });
  }

  public hideVideoBalloon(identity: string, kind: "camera" | "screen") {
    const key = `${identity}|${kind}`;
    const b = this.videoBalloons.get(key);
    if (!b) return;
    b.video.srcObject = null;
    b.dom.destroy();
    this.videoBalloons.delete(key);
  }

  /** Resolve posição atual do avatar do peer pela identity do LiveKit. */
  private getAvatarPositionFor(identity: string): { x: number; y: number } | null {
    if (identity === "__local__") {
      if (this.myContainer) return { x: this.myContainer.x, y: this.myContainer.y };
      return null;
    }
    const userId = identity.split("__")[0];
    const state: any = this.room.state;
    let target: { x: number; y: number } | null = null;
    state?.players?.forEach?.((p: any, sid: string) => {
      if (p.userId !== userId) return;
      if (sid === this.myId && this.myContainer) {
        target = { x: this.myContainer.x, y: this.myContainer.y };
      } else {
        const rp = this.remotePlayers.get(sid);
        if (rp) target = { x: rp.container.x, y: rp.container.y };
      }
    });
    return target;
  }

  /**
   * Decide se o balão de um peer deve ser visível pro player local.
   * Regra:
   *  - __local__ → sempre visível (eu mesmo)
   *  - Zona diferente → invisível (paredes isolam)
   *  - Mesma zona isolada (sala != "open") → sempre visível (estamos juntos na sala)
   *  - Open space → só se dentro do BALLOON_HEARING_RADIUS
   */
  private isPeerBalloonVisible(identity: string): boolean {
    if (identity === "__local__") return true;
    if (!this.myContainer) return false;

    const userId = identity.split("__")[0];
    const state: any = this.room.state;
    let peerData: { x: number; y: number; zoneId: string } | null = null;

    state?.players?.forEach?.((p: any, sid: string) => {
      if (p.userId !== userId) return;
      const rp = sid === this.myId ? null : this.remotePlayers.get(sid);
      if (rp) {
        peerData = { x: rp.container.x, y: rp.container.y, zoneId: p.zoneId || "open" };
      }
    });
    if (!peerData) return false;

    const myZone = this.currentZone || "open";
    if (peerData.zoneId !== myZone) return false;

    // Sala isolada (qualquer zona != open): sempre vê quem tá dentro
    if (myZone !== "open") return true;

    // Open space: só vê quem está perto
    const dx = peerData.x - this.myContainer.x;
    const dy = peerData.y - this.myContainer.y;
    return dx * dx + dy * dy <= this.BALLOON_HEARING_RADIUS * this.BALLOON_HEARING_RADIUS;
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

  private drawWalls() {
    // Paredes desenhadas como retângulos cinza-escuro, depth alta pra ficarem
    // por cima do chão/tapetes mas abaixo de móveis e avatares na mesma linha.
    this.layout.walls.forEach((w) => {
      const wall = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x4a5568);
      wall.setStrokeStyle(1, 0x2d3748);
      wall.setDepth(-5);
    });

    // Labels flutuantes em cima de cada sala
    this.layout.rooms.forEach((room) => {
      const labelText = this.add.text(room.x + room.w / 2, room.y + 12, room.label, {
        fontFamily: "system-ui, -apple-system",
        fontSize: "11px",
        color: "#94a3b8",
        backgroundColor: "#1a1a2eaa",
        padding: { x: 6, y: 2 },
        resolution: 2,
      }).setOrigin(0.5);
      labelText.setDepth(-4);
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
          // Teleporte server-autoritativo: bate posição visual se delta grande
          if (!this.myContainer) return;
          const dx = player.x - this.myContainer.x;
          const dy = player.y - this.myContainer.y;
          if (Math.abs(dx) > 50 || Math.abs(dy) > 50) {
            this.myContainer.x = player.x;
            this.myContainer.y = player.y;
            this.myContainer.setDepth(player.y);
          }
          // Mudança de aparência (modal 🎨) → recria texture do meu sprite
          if (player.color !== this.myBodyColor || player.hairColor !== this.myHairColor) {
            this.refreshMyAvatarTexture(player.color, player.hairColor);
          }
          return;
        }
        const rp = this.remotePlayers.get(sessionId);
        if (rp) {
          rp.targetX = player.x;
          rp.targetY = player.y;
          rp.direction = player.direction || "down";
          // Mudança de aparência de outro player → recria texture do sprite dele
          if (rp.bodyColor !== player.color || rp.hairColor !== player.hairColor) {
            this.refreshRemoteAvatarTexture(rp, player.color, player.hairColor);
          }
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

  /**
   * Substitui a texture do meu avatar quando troco cores (modal 🎨).
   * Cria texture+animações novas se ainda não existem pra essa combinação.
   */
  private refreshMyAvatarTexture(bodyColor: string, hairColor: string) {
    if (!this.mySprite) return;
    this.myBodyColor = bodyColor;
    this.myHairColor = hairColor;
    const newKey = `avatar_${bodyColor}_${hairColor}`;
    if (!this.textures.exists(newKey)) {
      createAvatarTexture(this, newKey, bodyColor, hairColor);
      createAvatarAnimations(this, newKey);
    }
    this.myTextureKey = newKey;
    const anim = this.isMoving ? "walk" : "idle";
    const animKey = `${newKey}_${this.myDirection}_${anim}`;
    if (this.anims.exists(animKey)) this.mySprite.play(animKey, true);
    else this.mySprite.setTexture(newKey, 0);
  }

  /** Mesma lógica pra peers remotos quando mudam aparência. */
  private refreshRemoteAvatarTexture(rp: RemotePlayer, bodyColor: string, hairColor: string) {
    rp.bodyColor = bodyColor;
    rp.hairColor = hairColor;
    const newKey = `avatar_${bodyColor}_${hairColor}`;
    if (!this.textures.exists(newKey)) {
      createAvatarTexture(this, newKey, bodyColor, hairColor);
      createAvatarAnimations(this, newKey);
    }
    rp.textureKey = newKey;
    const animKey = `${newKey}_${rp.direction}_idle`;
    if (this.anims.exists(animKey)) rp.sprite.play(animKey, true);
    else rp.sprite.setTexture(newKey, 0);
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

    // Se o usuário está digitando em algum input HTML (chat, modal),
    // ignora WASD/setas pra não mover o avatar com as letras digitadas.
    const typing = isTypingInInput();

    if (!typing) {
      // Teclado (desktop)
      if (this.cursors.left?.isDown || this.wasd.A.isDown) { vx = -1; newDir = "left"; }
      else if (this.cursors.right?.isDown || this.wasd.D.isDown) { vx = 1; newDir = "right"; }

      if (this.cursors.up?.isDown || this.wasd.W.isDown) { vy = -1; newDir = "up"; }
      else if (this.cursors.down?.isDown || this.wasd.S.isDown) { vy = 1; newDir = "down"; }

      // Joystick virtual (mobile) — só usa se teclado não está ativo
      if (vx === 0 && vy === 0 && (this.virtualVx !== 0 || this.virtualVy !== 0)) {
        // Threshold mínimo pra evitar drift
        const ax = Math.abs(this.virtualVx);
        const ay = Math.abs(this.virtualVy);
        if (ax > 0.15 || ay > 0.15) {
          vx = this.virtualVx;
          vy = this.virtualVy;
          // Direção animada baseada no eixo dominante
          if (ax > ay) newDir = this.virtualVx > 0 ? "right" : "left";
          else newDir = this.virtualVy > 0 ? "down" : "up";
        }
      }
    }

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

    const room = getCurrentRoom(this.myContainer.x, this.myContainer.y, this.layout);
    if (room.id !== this.currentZone) {
      this.currentZone = room.id;
      this.onZoneChange?.(room.id);
      // Avisa server da nova zona (pros peers calcularem áudio isolado)
      this.room.send("zone", room.id);
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
      const peerInfo = new Map<string, { x: number; y: number; zoneId: string }>();
      const state: any = this.room.state;
      this.remotePlayers.forEach((rp, sessionId) => {
        const peerPlayer = state?.players?.get?.(sessionId);
        peerInfo.set(sessionId, {
          x: rp.container.x,
          y: rp.container.y,
          zoneId: peerPlayer?.zoneId || "open",
        });
      });
      this.onPositionsUpdate(
        {
          x: this.myContainer.x,
          y: this.myContainer.y,
          zoneId: this.currentZone || "open",
        },
        peerInfo
      );
    }

    this.updateNearestDesk();

    // Atualiza posição e visibilidade dos balões de vídeo + acumula visíveis
    const currentlyVisible = new Set<string>();
    this.videoBalloons.forEach((b) => {
      const pos = this.getAvatarPositionFor(b.identity);
      if (!pos) {
        b.dom.setVisible(false);
        return;
      }
      const visible = this.isPeerBalloonVisible(b.identity);
      b.dom.setVisible(visible);
      if (!visible) return;

      if (b.kind === "camera" && b.identity !== "__local__") {
        currentlyVisible.add(b.identity);
      }

      // Empilhamento: screen mais alto que camera
      const offsetY = b.kind === "screen" ? -110 : -55;
      b.dom.x = pos.x;
      b.dom.y = pos.y + offsetY;
      b.dom.setDepth(10000);
    });

    // Notifica App.tsx se o conjunto de peers visíveis mudou
    if (!setEquals(currentlyVisible, this.visiblePeersCache)) {
      this.visiblePeersCache = currentlyVisible;
      this.onVisiblePeersChange?.(new Set(currentlyVisible));
    }
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

/** Compara dois Sets de strings por igualdade (mesmo conteúdo). */
function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Detecta se o usuário está digitando em algum input/textarea HTML.
 * Usado pra desabilitar input do jogo (WASD/E/C) e evitar que digitar
 * "casa" mova o avatar pra esquerda + reservar mesa + recentralizar câmera.
 */
function isTypingInInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  // contentEditable também conta (chat com formatação no futuro)
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
