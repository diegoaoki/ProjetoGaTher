import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  createFurnitureTextures,
  createFloorTextures,
} from "./SpriteFactory";
import {
  getDefaultLayout,
  checkCollision,
  getCurrentRoom,
  applyLayoutOverride,
  hitboxFor,
  WALL_T,
  FLOOR2_Y0,
  FurnitureItem,
  Wall,
} from "./OfficeLayout";
import { findPath } from "./pathfinding";
import {
  preloadLimezuAssets,
  createCharacterAnimations,
  pickCharacterFor,
  registerLimezuFloor,
  CharacterId,
} from "./AssetLoader";
import { registerFurnitureTextures } from "./FurnitureTiles";

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
const NPC_SPEED = 130; // guarda anda um pouco mais devagar que o player
// Guarda fica EM FRENTE de paredes/portas (que usam depth ~y+100 e
// w.y+w.h-1). Soma uma base alta + y (mantém ordenação entre NPCs),
// abaixo de 10000 (balões de vídeo DOM continuam por cima).
const NPC_DEPTH_BASE = 4000;
const SYNC_INTERVAL = 50;
// Tamanho do mundo (80×85 tiles = 2560×2720 px): térreo y 0..55 +
// gap + 2º andar y 60..84. Tem que bater com H_TILES do OfficeLayout
// e worldHeight do schema do server.
const WORLD_W = 2560;
const WORLD_H = 2720;
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
  /** Andar do meu avatar (1|2). Atualizado via setMyFloor (floor:moved). */
  private myFloor = 1;
  private myUserId = "";

  // === Mesas reserváveis ===
  private allDesks: DeskInfo[] = [];
  private deskOverlays = new Map<string, DeskOverlay>(); // deskId → overlay
  private nearestDeskId: string | null = null;
  private myDeskId: string | null = null;
  private keyE!: Phaser.Input.Keyboard.Key;

  // === Portas (Fase C) ===
  // Porta dupla: 2 folhas que deslizam pros lados + fade ao abrir/fechar.
  private doorLeaves = new Map<string, [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle]>();
  private doorOpenState = new Map<string, boolean>();
  /** Walls dinâmicos a partir das portas fechadas — usados em checkCollision. */
  private dynamicWalls: Array<{ x: number; y: number; w: number; h: number }> = [];

  // === Navegação automática (rota com A*) ===
  /** Waypoints restantes em pixels; null = sem rota ativa. */
  private navPath: Array<{ x: number; y: number }> | null = null;
  /** Destino final (pra fallback de teleporte se ficar preso). */
  private navGoal: { x: number; y: number } | null = null;
  /** Linha desenhada da rota. */
  private navGraphics?: Phaser.GameObjects.Graphics;
  /** Acumula tempo "sem progredir" pra abortar com fallback. */
  private navStuckMs = 0;

  // === NPCs de segurança (cadeado) ===
  private securityNpcs = new Map<string, Phaser.GameObjects.Container>();
  /** Rota ativa de cada NPC: anda do posto de segurança até a porta (e
   *  volta ao ser removido). roomId → estado da navegação. */
  private securityNpcNav = new Map<
    string,
    { path: Array<{ x: number; y: number }>; onDone?: () => void }
  >();
  /** Ponto de origem/saída do guarda por sala (perto da porta). */
  private securityApproach = new Map<string, { x: number; y: number }>();

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
  // === Pinça pra zoom (mobile, dois dedos) ===
  private readonly ZOOM_MIN = 0.4;
  private readonly ZOOM_MAX = 1.8;
  private pinchPrevDist = 0;

  /** Aplica zoom com clamp comum (roda do mouse, teclas + - e pinça). */
  private applyZoomClamped(next: number) {
    const z = Math.min(this.ZOOM_MAX, Math.max(this.ZOOM_MIN, next));
    this.cameras.main.setZoom(z);
  }

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  private lastSync = 0;
  private movingSince = 0;     // timestamp (ms) quando começou a se mover continuamente
  private isMoving = false;

  // === Mesa-conversa (tecla G + modo fantasma) ===
  private ghostMode = false;
  private myDeskSeat: string | null = null;
  private lastSitTry = 0;

  private layout = getDefaultLayout();
  /** Override do editor (mobília + paredes) vindo do server. */
  private mapOverride: { furniture?: FurnitureItem[]; walls?: Wall[] } | null = null;
  /** GameObjects de mobília/parede/labels — pra poder limpar no rebuild. */
  private floorSprite?: Phaser.GameObjects.TileSprite;
  private worldBorder?: Phaser.GameObjects.Graphics;
  private furnitureObjs: Phaser.GameObjects.GameObject[] = [];
  private wallObjs: Phaser.GameObjects.GameObject[] = [];
  private roomLabelObjs: Phaser.GameObjects.GameObject[] = [];

  // === Editor de mapa (admin) — etapa 1 (mobília) + etapa 2 (paredes) ===
  private editMode = false;
  private editFurniture: FurnitureItem[] = [];
  private editSprites: Phaser.GameObjects.Image[] = [];
  private editWalls: Wall[] = [];
  private editWallObjs: Phaser.GameObjects.Rectangle[] = [];
  /** Pincel: tipo de móvel, "wall" (desenhar parede) ou null (mover/seleção). */
  private editBrush: string | null = null;
  /** Seleção unificada: o que está selecionado e o índice no array. */
  private editSelKind: "furn" | "wall" | null = null;
  private editSelIdx = -1;
  private editGrid = 16;
  /** Estado do desenho de parede (arrastar retângulo). */
  private wallDrawStart: { x: number; y: number } | null = null;
  private wallPreview?: Phaser.GameObjects.Rectangle;
  public onEditorChange?: (info: { count: number; selected: boolean }) => void;

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
    myInfo: { x: number; y: number; zoneId: string; bubbleId: string; role: string; visitorOk: boolean; deskSeat: string; floor: number },
    peerInfo: Map<string, { x: number; y: number; zoneId: string; bubbleId: string; role: string; visitorOk: boolean; deskSeat: string; floor: number }>
  ) => void;
  public onZoneChange?: (zone: string | null) => void;

  // === Callbacks de mesas (pra App.tsx renderizar HUD/toast) ===
  public onNearbyDeskChange?: (info: { deskId: string; isMine: boolean; ownerName?: string } | null) => void;
  public onMyDeskChange?: (deskId: string | null) => void;
  public onDeskError?: (msg: string) => void;
  /** Clique numa mesa (reserva): App abre o modal de reservar/liberar. */
  public onDeskClick?: (deskId: string) => void;
  /** Right-click num avatar de outro player → App abre menu de contexto. */
  public onPeerContextMenu?: (info: {
    sessionId: string;
    userId: string;
    name: string;
    clientX: number;
    clientY: number;
  }) => void;

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

  init(data: {
    room: Room;
    myId: string;
    bodyColor?: string;
    hairColor?: string;
    mapOverride?: { furniture?: FurnitureItem[]; walls?: Wall[] } | null;
  }) {
    this.room = data.room;
    this.myId = data.myId;
    if (data.bodyColor) this.myBodyColor = data.bodyColor;
    if (data.hairColor) this.myHairColor = data.hairColor;
    this.mapOverride = data.mapOverride ?? null;
    this.layout = applyLayoutOverride(getDefaultLayout(), this.mapOverride);
  }

  preload() {
    // Etapa 1: carrega assets do LimeZu antes de criar a scene.
    // Etapas seguintes (2, 3, 4) vão consumir essas keys.
    preloadLimezuAssets(this);
  }

  create() {
    createFloorTextures(this);
    createFurnitureTextures(this);
    // Etapa 2 (mobília) — pulada por enquanto.
    // registerFurnitureTextures(this);
    // Etapa 3 — animações dos personagens LimeZu (4 personagens × 4 direções × {idle, walk})
    createCharacterAnimations(this);
    // Substitui o piso procedural por uma textura tileable do LimeZu (parquet)
    registerLimezuFloor(this);
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

    // Tecla G: modo fantasma (transparente + atravessa móveis/pessoas)
    // pra entrar/sair da conversa de mesa. Sentado → G sai da mesa.
    this.input.keyboard!.addKey("G").on("down", () => {
      if (isTypingInInput()) return;
      this.toggleGhost();
    });

    // Resposta do server pra mesa-conversa
    this.room.onMessage("desk:sat", (m: { deskId: string; slot: number }) => {
      const pos = this.deskSlotPos(m.deskId, m.slot);
      this.myDeskSeat = m.deskId;
      this.setGhost(false); // sentou → fica sólido
      if (this.myContainer && pos) {
        this.myContainer.x = pos.x;
        this.myContainer.y = pos.y;
        this.myContainer.setDepth(pos.y);
        this.room.send("move", {
          x: pos.x, y: pos.y, direction: this.myDirection, isMoving: false,
        });
      }
    });
    this.room.onMessage("desk:full", () => {
      this.onDeskError?.("Mesa cheia (máx. 3 na conversa)");
      this.setGhost(false);
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

    // NOTA: NÃO interceptar key events em capture phase no document. Um
    // keyInterceptor com stopPropagation() em CAPTURE chega ANTES do input
    // e impede que o onKeyDown do próprio input rode (ex: Enter pra enviar
    // no chat nunca disparava). O Phaser já é protegido quando um input está
    // focado por: (1) this.input.keyboard.enabled=false no focusin e (2) o
    // stopPropagation em bubble do próprio input (ChatPanel/LoginScreen).

    this.events.once("shutdown", () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    });

    // Pan com botão direito do mouse — não interfere com cliques de UI nem com tecla E
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        // No editor: sem menu de contexto de avatar (edição limpa) —
        // right-click só dá pan pra navegar o mapa.
        if (!this.editMode) {
          const over = this.input.hitTestPointer(pointer);
          const hit = over.find((o: any) => o.getData && o.getData("rpSession"));
          if (hit && this.onPeerContextMenu) {
            const ev = pointer.event as MouseEvent;
            this.onPeerContextMenu({
              sessionId: (hit as any).getData("rpSession"),
              userId: (hit as any).getData("rpUser") || "",
              name: (hit as any).getData("rpName") || "",
              clientX: ev?.clientX ?? pointer.x,
              clientY: ev?.clientY ?? pointer.y,
            });
            return;
          }
        }
        this.startPan(pointer.x, pointer.y);
      }
    });
    // Habilita um 2º ponteiro de toque pra detectar pinça (mobile).
    this.input.addPointer(1);
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      // Pinça: dois dedos na tela → ajusta zoom pela variação da distância.
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchPrevDist > 0) {
          const ratio = dist / this.pinchPrevDist;
          this.applyZoomClamped(this.cameras.main.zoom * ratio);
        }
        this.pinchPrevDist = dist;
        this.isPanning = false; // pinça não é pan
        return;
      }
      this.pinchPrevDist = 0;
      if (this.isPanning && pointer.rightButtonDown()) {
        this.updatePan(pointer.x, pointer.y);
      } else if (this.isPanning && !pointer.rightButtonDown()) {
        // Soltou o botão fora da área (ex: drag pra fora do canvas)
        this.isPanning = false;
      }
    });
    this.input.on("pointerup", () => {
      this.isPanning = false;
      this.pinchPrevDist = 0;
    });

    // Erros vindos do server (mesa já reservada, mesa inválida, etc)
    this.room.onMessage("desk:error", (msg: { error: string }) => {
      this.onDeskError?.(msg?.error || "Falha na ação de mesa");
    });

    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    // Zoom in/out via roda do mouse, teclas + / - e pinça (mobile)
    const applyZoom = (next: number) => this.applyZoomClamped(next);
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      applyZoom(this.cameras.main.zoom - dy * 0.0015);
    });
    this.input.keyboard!.addKey("MINUS").on("down", () => applyZoom(this.cameras.main.zoom - 0.15));
    this.input.keyboard!.addKey("PLUS").on("down", () => applyZoom(this.cameras.main.zoom + 0.15));
    this.input.keyboard!.addKey("EQUALS").on("down", () => applyZoom(this.cameras.main.zoom + 0.15));
    this.input.keyboard!.addKey("ZERO").on("down", () => applyZoom(1.3));
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

  /** Versão pública do toggle de fantasma/conversa-de-mesa pro botão G mobile. */
  public triggerGhostAction() {
    this.toggleGhost();
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
    // Usa textura LimeZu se carregada; senão fallback pro canvas procedural
    const floorKey = this.textures.exists("floorWoodLime") ? "floorWoodLime" : "floorWood";
    const floor = this.add.tileSprite(0, 0, WORLD_W, WORLD_H, floorKey).setOrigin(0, 0);
    floor.setDepth(-100);
    this.floorSprite = floor;

    this.layout.floorRegions.forEach((region) => {
      if (region.type === "rug") {
        const rug = this.add.tileSprite(region.x, region.y, region.w, region.h, "floorCarpet").setOrigin(0, 0);
        rug.setDepth(-50);
        rug.setAlpha(0.9);
      } else if (region.type === "dept") {
        // Tinted overlay do piso base pra distinguir departamentos no open space
        const dept = this.add.tileSprite(region.x, region.y, region.w, region.h, floorKey).setOrigin(0, 0);
        dept.setDepth(-90);
        if (region.tint !== undefined) dept.setTint(region.tint);
        dept.setAlpha(0.6);
      }
    });

    const border = this.add.graphics();
    border.setDepth(-10);
    this.worldBorder = border;
    this.redrawWorldBorder(0, 0, WORLD_W, WORLD_H);
  }

  private redrawWorldBorder(x: number, y: number, w: number, h: number) {
    if (!this.worldBorder) return;
    this.worldBorder.clear();
    this.worldBorder.lineStyle(4, 0x1a1a2e, 1);
    this.worldBorder.strokeRect(x, y, w, h);
  }

  private drawFurniture() {
    this.layout.furniture.forEach((item) => {
      const sprite = this.add.image(item.x, item.y, item.type);
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(item.y);
      this.furnitureObjs.push(sprite);

      if (item.tag === "tv") {
        this.tvSprite = sprite;
        this.tvX = item.x;
        this.tvY = item.y;
      }

      // Clicar numa mesa (deskId) → App abre modal de reservar/liberar.
      // Desabilitado no editor de mapa (lá o clique edita o móvel).
      if (item.type === "desk" && item.deskId) {
        const deskId = item.deskId;
        sprite.setInteractive({ useHandCursor: true });
        sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (this.editMode) return;
          if (pointer.rightButtonDown()) return; // right-click = pan, não mesa
          this.onDeskClick?.(deskId);
        });
      }

      // Mesa-conversa: marca discreta no piso dos 3 lugares (sentado +
      // esquerda + direita). Bem sutil — só pra orientar.
      if (item.type === "desk" && item.deskId) {
        const sy = item.y + 34;
        for (const sx of [item.x, item.x - 46, item.x + 46]) {
          const mark = this.add.circle(sx, sy, 9, 0xffffff, 0.06);
          mark.setStrokeStyle(1, 0xffffff, 0.16);
          mark.setDepth(-3); // acima do piso, abaixo de tudo
          this.furnitureObjs.push(mark);
        }
      }
    });
  }

  private drawWalls() {
    // Paredes desenhadas como retângulos cinza-escuro com sombra interna.
    // Depth dinâmico = y do bottom da parede, pra avatar passar atrás quando
    // está acima da parede (efeito "sumir atrás" típico de top-down).
    this.layout.walls.forEach((w) => {
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      // base escura
      const wall = this.add.rectangle(cx, cy, w.w, w.h, 0x3d4a5e);
      wall.setStrokeStyle(2, 0x1e2533);
      wall.setDepth(w.y + w.h - 1);
      this.wallObjs.push(wall);
      // brilho no topo (efeito 3d simples)
      const isHorizontal = w.h === WALL_T;
      if (isHorizontal) {
        const hl = this.add.rectangle(cx, w.y + 2, w.w - 4, 2, 0x6b7d96, 0.6);
        hl.setDepth(w.y + w.h - 1);
        this.wallObjs.push(hl);
      } else {
        const hl = this.add.rectangle(w.x + 2, cy, 2, w.h - 4, 0x6b7d96, 0.6);
        hl.setDepth(w.y + w.h - 1);
        this.wallObjs.push(hl);
      }
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
      this.roomLabelObjs.push(labelText);
    });
  }

  /**
   * Reconstrói mobília + paredes a partir de um novo override (editor de
   * mapa). Zonas/salas/portas continuam do código. Recalcula colisão.
   */
  public rebuildLayout(override: { furniture?: FurnitureItem[]; walls?: Wall[] } | null) {
    this.mapOverride = override;
    this.layout = applyLayoutOverride(getDefaultLayout(), override);

    this.furnitureObjs.forEach((o) => o.destroy());
    this.wallObjs.forEach((o) => o.destroy());
    this.roomLabelObjs.forEach((o) => o.destroy());
    this.furnitureObjs = [];
    this.wallObjs = [];
    this.roomLabelObjs = [];

    this.drawWalls();
    this.drawFurniture();

    // Mesas reserváveis derivam da mobília (mesmo filtro do create())
    this.allDesks = this.layout.furniture
      .filter((f) => f.type === "desk" && f.deskId)
      .map((f) => ({ id: f.deskId!, x: f.x, y: f.y }));

    this.refreshDynamicWalls();
    this.applyFloorView(); // objetos recriados → reaplica a dimensão do andar
  }

  // ============================================================
  //  Editor de mapa — etapa 1: mobília (mover / adicionar / deletar)
  //  Paredes vêm na etapa 2. Só admin (gate na UI/App).
  // ============================================================
  public isEditMode() {
    return this.editMode;
  }

  public enterMapEditor() {
    if (this.editMode) return;
    this.editMode = true;
    this.clearSel();
    this.editBrush = null;
    // Clona mobília + paredes atuais pra edição
    this.editFurniture = this.layout.furniture.map((f) => ({ ...f }));
    this.editWalls = this.layout.walls.map((w) => ({ ...w }));
    // Esconde os estáticos e desenha os editáveis
    this.furnitureObjs.forEach((o) => (o as any).setVisible?.(false));
    this.wallObjs.forEach((o) => (o as any).setVisible?.(false));
    // Edição limpa: some com avatares, balões e o NPC (sem distração)
    this.setActorsVisible(false);
    this.applyFloorView(); // editor: libera os 2 andares (câmera full)
    this.renderEditFurniture();
    this.renderEditWalls();

    this.input.on("drag", this.onEditDrag, this);
    this.input.on("pointerdown", this.onEditPointerDown, this);
    this.input.on("pointermove", this.onEditPointerMove, this);
    this.input.on("pointerup", this.onEditPointerUp, this);
    window.addEventListener("keydown", this.onEditKey, true);
    this.notifyEditor();
  }

  /** Mostra/esconde avatares, balões e NPC (edição limpa do editor). */
  private setActorsVisible(v: boolean) {
    this.myContainer?.setVisible(v);
    this.remotePlayers.forEach((rp) => rp.container.setVisible(v));
    this.securityNpcs.forEach((c) => c.setVisible(v));
    this.videoBalloons.forEach((b) => (b.dom as any)?.setVisible?.(v));
  }

  /** Delete/Backspace apaga o item selecionado (móvel OU parede). */
  private onEditKey = (e: KeyboardEvent) => {
    if (!this.editMode) return;
    if (isTypingInInput()) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.editSelKind) {
        e.preventDefault();
        this.deleteEditorSelection();
      }
    }
  };

  public exitMapEditor(restore: boolean) {
    if (!this.editMode) return;
    this.editMode = false;
    this.input.off("drag", this.onEditDrag, this);
    this.input.off("pointerdown", this.onEditPointerDown, this);
    this.input.off("pointermove", this.onEditPointerMove, this);
    this.input.off("pointerup", this.onEditPointerUp, this);
    window.removeEventListener("keydown", this.onEditKey, true);
    this.editSprites.forEach((s) => s.destroy());
    this.editWallObjs.forEach((r) => r.destroy());
    this.wallPreview?.destroy();
    this.wallPreview = undefined;
    this.wallDrawStart = null;
    this.editSprites = [];
    this.editWallObjs = [];
    this.clearSel();
    this.editBrush = null;
    this.setActorsVisible(true); // volta avatares/balões/NPC
    this.applyFloorView(); // sai do editor → volta pra dimensão do andar
    if (restore) {
      this.rebuildLayout(this.mapOverride);
    }
    // Se salvou, o broadcast map:updated chama rebuildLayout pra todos.
  }

  /** Pincel: tipo de móvel, "wall" (desenhar parede) ou null (seleção). */
  public setEditorBrush(type: string | null) {
    this.editBrush = type;
    if (type !== null) this.clearSel();
    this.notifyEditor();
  }

  public deleteEditorSelection() {
    if (this.editSelKind === "furn" && this.editSelIdx >= 0) {
      this.editFurniture.splice(this.editSelIdx, 1);
      this.clearSel();
      this.renderEditFurniture();
    } else if (this.editSelKind === "wall" && this.editSelIdx >= 0) {
      this.editWalls.splice(this.editSelIdx, 1);
      this.clearSel();
      this.renderEditWalls();
    }
    this.notifyEditor();
  }

  /** Miniatura (dataURL) da textura de um tipo de móvel, pro painel. */
  public getFurnitureThumbnail(type: string, max = 44): string | null {
    if (!this.textures.exists(type)) return null;
    const src = this.textures.get(type).getSourceImage() as any;
    const sw = src?.width, sh = src?.height;
    if (!sw || !sh) return null;
    const scale = Math.min(max / sw, max / sh, 4);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false; // pixel-art nítido
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
    try {
      return c.toDataURL();
    } catch {
      return null;
    }
  }

  /** Adiciona um móvel na posição de TELA (drop do painel no canvas). */
  public addFurnitureAtScreen(type: string, clientX: number, clientY: number) {
    if (!this.editMode || !type) return;
    const rect = this.game.canvas.getBoundingClientRect();
    const wp = this.cameras.main.getWorldPoint(clientX - rect.left, clientY - rect.top);
    const x = Phaser.Math.Clamp(this.snap(wp.x), 0, WORLD_W);
    const y = Phaser.Math.Clamp(this.snap(wp.y), 0, WORLD_H);
    this.editFurniture.push({ type, x, y, depth: 1, hitbox: hitboxFor(type) });
    this.renderEditFurniture();
    this.selectFurn(this.editFurniture.length - 1);
  }

  /** Layout editado pra salvar (mobília + paredes editadas). */
  public getEditedLayout(): { furniture: FurnitureItem[]; walls: Wall[] } {
    return { furniture: this.editFurniture, walls: this.editWalls };
  }

  private notifyEditor() {
    this.onEditorChange?.({
      count: this.editFurniture.length + this.editWalls.length,
      selected: this.editSelKind !== null,
    });
  }

  private snap(v: number) {
    return Math.round(v / this.editGrid) * this.editGrid;
  }

  private clearSel() {
    this.editSelKind = null;
    this.editSelIdx = -1;
    this.applySelHighlight();
    this.notifyEditor();
  }

  private selectFurn(i: number) {
    this.editSelKind = "furn";
    this.editSelIdx = i;
    this.applySelHighlight();
    this.notifyEditor();
  }

  private selectWall(i: number) {
    this.editSelKind = "wall";
    this.editSelIdx = i;
    this.applySelHighlight();
    this.notifyEditor();
  }

  private applySelHighlight() {
    this.editSprites.forEach((s, idx) => {
      if (this.editSelKind === "furn" && idx === this.editSelIdx) s.setTint(0x4ade80);
      else s.clearTint();
    });
    this.editWallObjs.forEach((r, idx) => {
      const sel = this.editSelKind === "wall" && idx === this.editSelIdx;
      r.setStrokeStyle(2, sel ? 0x4ade80 : 0x93c5fd, 1);
      r.setFillStyle(0x3b82f6, sel ? 0.55 : 0.35);
    });
  }

  private renderEditFurniture() {
    this.editSprites.forEach((s) => s.destroy());
    this.editSprites = [];
    this.editFurniture.forEach((item, i) => {
      const spr = this.add.image(item.x, item.y, item.type);
      spr.setOrigin(0.5, 0.5);
      spr.setDepth(item.y);
      if (item.fixed) {
        // Estrutura fixa (escada rolante): visível mas NÃO editável
        // (sem interação/drag; applyLayoutOverride a re-anexa do código).
        spr.setAlpha(0.85);
        this.editSprites.push(spr);
        return;
      }
      spr.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(spr);
      spr.setData("kind", "furn");
      spr.setData("idx", i);
      spr.on("pointerdown", () => {
        if (this.editMode) this.selectFurn(spr.getData("idx") as number);
      });
      this.editSprites.push(spr);
    });
    this.applySelHighlight();
  }

  private renderEditWalls() {
    this.editWallObjs.forEach((r) => r.destroy());
    this.editWallObjs = [];
    this.editWalls.forEach((w, i) => {
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      const rect = this.add.rectangle(cx, cy, w.w, w.h, 0x3b82f6, 0.35);
      rect.setStrokeStyle(2, 0x93c5fd, 1);
      rect.setDepth(90000); // editor: paredes por cima pra editar fácil
      rect.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(rect);
      rect.setData("kind", "wall");
      rect.setData("idx", i);
      rect.on("pointerdown", () => {
        if (this.editMode) this.selectWall(rect.getData("idx") as number);
      });
      this.editWallObjs.push(rect);
    });
    this.applySelHighlight();
  }

  private onEditDrag = (
    _p: Phaser.Input.Pointer,
    obj: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number
  ) => {
    if (!this.editMode) return;
    const go = obj as any;
    const kind = go.getData?.("kind");
    const i = go.getData?.("idx") as number;
    if (kind === "furn" && this.editFurniture[i]) {
      const nx = Phaser.Math.Clamp(this.snap(dragX), 0, WORLD_W);
      const ny = Phaser.Math.Clamp(this.snap(dragY), 0, WORLD_H);
      go.x = nx;
      go.y = ny;
      go.setDepth(ny);
      this.editFurniture[i].x = nx;
      this.editFurniture[i].y = ny;
      if (!(this.editSelKind === "furn" && this.editSelIdx === i)) this.selectFurn(i);
    } else if (kind === "wall" && this.editWalls[i]) {
      const wll = this.editWalls[i];
      // dragX/dragY = centro; converte pro canto sup-esq, snap
      const nx = Phaser.Math.Clamp(this.snap(dragX - wll.w / 2), 0, WORLD_W - wll.w);
      const ny = Phaser.Math.Clamp(this.snap(dragY - wll.h / 2), 0, WORLD_H - wll.h);
      wll.x = nx;
      wll.y = ny;
      go.x = nx + wll.w / 2;
      go.y = ny + wll.h / 2;
      if (!(this.editSelKind === "wall" && this.editSelIdx === i)) this.selectWall(i);
    }
  };

  private onEditPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!this.editMode) return;
    const over = this.input.hitTestPointer(pointer);
    const onFurn = over.some((o) => this.editSprites.includes(o as any));
    const onWall = over.some((o) => this.editWallObjs.includes(o as any));
    const onObj = onFurn || onWall;

    // Modo "desenhar parede": arrasta um retângulo no vazio
    if (this.editBrush === "wall") {
      if (onObj) return;
      this.wallDrawStart = {
        x: Phaser.Math.Clamp(this.snap(pointer.worldX), 0, WORLD_W),
        y: Phaser.Math.Clamp(this.snap(pointer.worldY), 0, WORLD_H),
      };
      this.wallPreview?.destroy();
      this.wallPreview = this.add
        .rectangle(this.wallDrawStart.x, this.wallDrawStart.y, 1, 1, 0x22c55e, 0.4)
        .setOrigin(0, 0)
        .setDepth(90001);
      return;
    }

    // Pincel de móvel → adiciona em QUALQUER lugar (inclusive dentro de
    // salas / sobre paredes). Só não adiciona se clicou num móvel já
    // existente — aí seleciona ele (o próprio obj trata).
    if (this.editBrush) {
      if (onFurn) return;
      const x = Phaser.Math.Clamp(this.snap(pointer.worldX), 0, WORLD_W);
      const y = Phaser.Math.Clamp(this.snap(pointer.worldY), 0, WORLD_H);
      this.editFurniture.push({
        type: this.editBrush,
        x,
        y,
        depth: 1,
        hitbox: hitboxFor(this.editBrush),
      });
      this.renderEditFurniture();
      this.selectFurn(this.editFurniture.length - 1);
    } else {
      if (onObj) return; // clicou num item/parede → seleção é do próprio obj
      this.clearSel();
    }
  };

  private onEditPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.editMode || !this.wallDrawStart || !this.wallPreview) return;
    const ex = Phaser.Math.Clamp(this.snap(pointer.worldX), 0, WORLD_W);
    const ey = Phaser.Math.Clamp(this.snap(pointer.worldY), 0, WORLD_H);
    const x = Math.min(this.wallDrawStart.x, ex);
    const y = Math.min(this.wallDrawStart.y, ey);
    const w = Math.max(1, Math.abs(ex - this.wallDrawStart.x));
    const h = Math.max(1, Math.abs(ey - this.wallDrawStart.y));
    this.wallPreview.setPosition(x, y);
    this.wallPreview.setSize(w, h);
  };

  private onEditPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (!this.editMode || !this.wallDrawStart) return;
    const ex = Phaser.Math.Clamp(this.snap(pointer.worldX), 0, WORLD_W);
    const ey = Phaser.Math.Clamp(this.snap(pointer.worldY), 0, WORLD_H);
    const x = Math.min(this.wallDrawStart.x, ex);
    const y = Math.min(this.wallDrawStart.y, ey);
    const w = Math.abs(ex - this.wallDrawStart.x);
    const h = Math.abs(ey - this.wallDrawStart.y);
    this.wallDrawStart = null;
    this.wallPreview?.destroy();
    this.wallPreview = undefined;
    // Ignora paredes minúsculas (clique sem arrastar)
    if (w < this.editGrid || h < this.editGrid) return;
    this.editWalls.push({ x, y, w, h });
    this.renderEditWalls();
    this.selectWall(this.editWalls.length - 1);
  };

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
          // Só "snapa" pra posição do server quando há teleporte legítimo
          // (botão "ir até player", "minha mesa", convite aceito) — todos têm
          // delta de centenas de px. Threshold baixo causava rubber-banding em
          // movimento normal quando o state delta do server (20fps) ficava
          // atrás da posição local do cliente (60fps).
          if (!this.myContainer) return;
          const dx = player.x - this.myContainer.x;
          const dy = player.y - this.myContainer.y;
          if (Math.abs(dx) > 250 || Math.abs(dy) > 250) {
            this.myContainer.x = player.x;
            this.myContainer.y = player.y;
            this.myContainer.setDepth(player.y);
          }
          if (player.color !== this.myBodyColor || player.hairColor !== this.myHairColor) {
            this.refreshMyAvatarTexture(player.color, player.hairColor);
          }
          // Mudança de personagem (novo sistema LimeZu)
          if (player.characterId && player.characterId !== this.myTextureKey) {
            this.refreshMyCharacter(player.characterId);
          }
          return;
        }
        const rp = this.remotePlayers.get(sessionId);
        if (rp) {
          rp.targetX = player.x;
          rp.targetY = player.y;
          rp.direction = player.direction || "down";
          // Visitante: invisível até o host autorizar; ao autorizar,
          // aparece com a animação de nascimento.
          if (player.role === "visitor") {
            const c = rp.container;
            if (player.visitorOk && !c.visible) {
              // Aparece JÁ na posição final (lado do host), não desliza
              c.x = player.x;
              c.y = player.y;
              c.setDepth(player.y);
              c.setVisible(true);
              this.spawnBirthFx(c, player.x, player.y);
            } else if (!player.visitorOk && c.visible) {
              c.setVisible(false);
            }
          }
          if (rp.bodyColor !== player.color || rp.hairColor !== player.hairColor) {
            this.refreshRemoteAvatarTexture(rp, player.color, player.hairColor);
          }
          if (player.characterId && player.characterId !== rp.textureKey) {
            this.refreshRemoteCharacter(rp, player.userId || "", player.characterId);
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

    // Listener de portas (Fase C)
    if (state.doors && typeof state.doors.onAdd === "function") {
      state.doors.onAdd((door: any, doorId: string) => {
        this.renderDoor(doorId, door);
        door.onChange(() => this.renderDoor(doorId, door));
      });
      state.doors.onRemove((_door: any, doorId: string) => {
        const lv = this.doorLeaves.get(doorId);
        if (lv) { lv[0].destroy(); lv[1].destroy(); this.doorLeaves.delete(doorId); }
        this.doorOpenState.delete(doorId);
      });
    }

    // Listener de NPCs de segurança (cadeado) — protegido contra server antigo
    if (state.securityNPCs && typeof state.securityNPCs.onAdd === "function") {
      state.securityNPCs.onAdd((npc: any, roomId: string) => {
        this.spawnSecurityNpc(roomId, npc);
      });
      state.securityNPCs.onRemove((_npc: any, roomId: string) => {
        this.removeSecurityNpc(roomId);
      });
    }

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

  /**
   * Renderiza a porta como DUAS folhas. Fechada: as duas se encontram no
   * meio (marrom, opacas, bloqueiam). Aberta: cada folha desliza pro seu
   * lado (recolhe na parede) com fade-out. Animação suave via tween;
   * primeira render (join) aplica o estado direto, sem animar.
   */
  private renderDoor(doorId: string, door: { x: number; y: number; orientation: string; open: boolean; gapTiles?: number }) {
    const span = (door.gapTiles ?? 2) * 32;
    const thickness = WALL_T;
    const isVertical = door.orientation === "vertical";
    const leafLen = span / 2; // cada folha cobre metade do vão

    let leaves = this.doorLeaves.get(doorId);
    if (!leaves) {
      const mk = () => {
        const r = this.add.rectangle(
          door.x, door.y,
          isVertical ? thickness : leafLen,
          isVertical ? leafLen : thickness,
          0x8b4513
        );
        r.setStrokeStyle(2, 0x3d2817);
        r.setDepth(door.y + 100);
        return r;
      };
      leaves = [mk(), mk()];
      this.doorLeaves.set(doorId, leaves);
    }
    const [a, b] = leaves;

    // Posições: fechada = encostadas no centro; aberta = recolhidas no vão.
    const aClosed = isVertical ? { x: door.x, y: door.y - leafLen / 2 } : { x: door.x - leafLen / 2, y: door.y };
    const bClosed = isVertical ? { x: door.x, y: door.y + leafLen / 2 } : { x: door.x + leafLen / 2, y: door.y };
    const aOpen = isVertical ? { x: door.x, y: door.y - leafLen } : { x: door.x - leafLen, y: door.y };
    const bOpen = isVertical ? { x: door.x, y: door.y + leafLen } : { x: door.x + leafLen, y: door.y };

    const ta = door.open ? aOpen : aClosed;
    const tb = door.open ? bOpen : bClosed;
    const alpha = door.open ? 0 : 1;

    // Depth: FECHADA fica por cima (door.y+100) pra esconder quem está
    // atrás. ABERTA vai pra trás (-5) IMEDIATAMENTE — assim um avatar
    // rápido que já entrou aparece NA FRENTE da folha que ainda some,
    // em vez de "passar por baixo da porta". Resolve a sensação ruim.
    // Depth pelo estado-alvo, aplicado JÁ: aberta vai pra trás (-5) →
    // um avatar rápido que entrou aparece NA FRENTE da folha que ainda
    // some (acaba a sensação de "passar por baixo da porta"). Fechada
    // volta pro topo (door.y+100) pra ocluir quem está atrás.
    const d = door.open ? -5 : door.y + 100;
    a.setDepth(d);
    b.setDepth(d);

    const prev = this.doorOpenState.get(doorId);
    this.doorOpenState.set(doorId, door.open);
    const shouldAnimate = prev !== undefined && prev !== door.open;

    if (shouldAnimate) {
      // Abrir é rápido (sai logo do caminho); fechar lê melhor um
      // pouco mais lento. Alpha resolve antes do slide terminar.
      const dur = door.open ? 170 : 240;
      this.tweens.add({ targets: a, x: ta.x, y: ta.y, duration: dur, ease: "Cubic.Out" });
      this.tweens.add({ targets: b, x: tb.x, y: tb.y, duration: dur, ease: "Cubic.Out" });
      this.tweens.add({ targets: [a, b], alpha, duration: Math.round(dur * 0.6), ease: "Linear" });
    } else {
      // Primeira render (ou sem mudança real): aplica direto, sem animar.
      this.tweens.killTweensOf(a);
      this.tweens.killTweensOf(b);
      a.setPosition(ta.x, ta.y); a.setAlpha(alpha);
      b.setPosition(tb.x, tb.y); b.setAlpha(alpha);
    }

    // Colisão segue o estado lógico (instantâneo, independe da animação).
    this.refreshDynamicWalls();
  }

  /**
   * Cria sprite do NPC de segurança com fade-in (200ms). Placeholder visual:
   * corpo azul-marinho + cabeça bege + emoji 🛡️ flutuando. Substituir por
   * asset moderninteriors-win quando integrar pack pago (ver backlog).
   */

  /**
   * Origem da caminhada: um ponto a ~140px do posto, do lado de FORA
   * (mesma direção que o posto encara). Curto, sempre no corredor/open
   * space → rota confiável e visível (não depende de cruzar o mapa).
   * direction "right" = posto no lado oeste (salas de reunião) → vem de
   * mais a oeste; "left" = lado leste (diretorias) → vem de mais a leste.
   */
  private securityApproachOrigin(npc: { x: number; y: number; direction: string }) {
    const DIST = 140;
    const ox = npc.direction === "left" ? npc.x + DIST : npc.x - DIST;
    return { x: ox, y: npc.y };
  }

  private spawnSecurityNpc(roomId: string, npc: { x: number; y: number; direction: string }) {
    const origin = this.securityApproachOrigin(npc);
    this.securityApproach.set(roomId, origin);

    // Idempotente — se já existe (race condition), só atualiza o destino
    const existing = this.securityNpcs.get(roomId);
    if (existing) {
      const p = findPath({ x: existing.x, y: existing.y }, { x: npc.x, y: npc.y }, this.layout);
      if (p && p.length) this.securityNpcNav.set(roomId, { path: p });
      else { existing.x = npc.x; existing.y = npc.y; existing.setDepth(npc.y + NPC_DEPTH_BASE); }
      return;
    }

    const container = this.add.container(origin.x, origin.y);
    container.setDepth(origin.y + NPC_DEPTH_BASE);
    container.setAlpha(0);

    // Avatar de verdade (mesmo sistema de sprite/animação dos players).
    // Personagem fixo por sala (determinístico).
    const charId: CharacterId = pickCharacterFor(`security:${roomId}`, "");
    const sprite = this.add.sprite(0, 0, `${charId}_idle`, 0);
    sprite.setScale(2);
    sprite.play(`${charId}_down_idle`);

    // Balão "🛡️ Segurança" acima da cabeça
    const tag = this.add.text(0, -34, "🛡️ Segurança", {
      fontFamily: "system-ui, -apple-system",
      fontSize: "11px",
      color: "#fbbf24",
      backgroundColor: "#0f172abb",
      padding: { x: 6, y: 2 },
      resolution: 2,
    }).setOrigin(0.5);

    container.add([sprite, tag]);
    container.setData("sprite", sprite);
    container.setData("tex", charId);
    container.setData("dir", "down");
    this.securityNpcs.set(roomId, container);

    // Fade-in rápido (some o "pop") e calcula a rota até o posto.
    this.tweens.add({ targets: container, alpha: 1, duration: 200, ease: "Linear" });

    const path = findPath(origin, { x: npc.x, y: npc.y }, this.layout);
    if (path && path.length) {
      this.securityNpcNav.set(roomId, { path });
    } else {
      // Sem rota → vai direto pro posto (fallback, não trava o cadeado)
      container.x = npc.x;
      container.y = npc.y;
      container.setDepth(npc.y + NPC_DEPTH_BASE);
    }
  }

  /**
   * Remove o NPC: ele CAMINHA de volta pro ponto de origem (perto da
   * porta) e só então é destruído. Sem rota → fade-out (fallback).
   */
  private removeSecurityNpc(roomId: string) {
    const container = this.securityNpcs.get(roomId);
    if (!container) return;
    this.securityNpcs.delete(roomId);

    const origin = this.securityApproach.get(roomId);
    this.securityApproach.delete(roomId);
    const back = origin
      ? findPath({ x: container.x, y: container.y }, origin, this.layout)
      : null;
    if (back && back.length) {
      this.securityNpcNav.set(`__leaving__${roomId}`, {
        path: back,
        onDone: () => container.destroy(),
      });
      // guarda o container nesse "slot de saída" pra o advance achar
      this.securityNpcs.set(`__leaving__${roomId}`, container);
      return;
    }
    this.tweens.add({
      targets: container,
      alpha: 0,
      duration: 200,
      ease: "Linear",
      onComplete: () => container.destroy(),
    });
  }

  /** Avança cada NPC de segurança ao longo da rota (chamado no update). */
  private advanceSecurityNpcs(dtSec: number) {
    if (this.securityNpcNav.size === 0) return;
    const step = NPC_SPEED * dtSec;
    this.securityNpcNav.forEach((nav, key) => {
      const c = this.securityNpcs.get(key);
      if (!c) {
        this.securityNpcNav.delete(key);
        return;
      }
      const sprite = c.getData("sprite") as Phaser.GameObjects.Sprite | undefined;
      const tex = c.getData("tex") as string | undefined;
      const playAnim = (dir: string, moving: boolean) => {
        if (!sprite || !tex) return;
        const k = `${tex}_${dir}_${moving ? "walk" : "idle"}`;
        if (this.anims.exists(k) && sprite.anims.currentAnim?.key !== k) {
          sprite.play(k, true);
        }
      };

      const wp = nav.path[0];
      if (!wp) {
        this.securityNpcNav.delete(key);
        playAnim((c.getData("dir") as string) || "down", false); // chegou → idle
        if (nav.onDone) {
          this.securityNpcs.delete(key);
          nav.onDone();
        }
        return;
      }
      const dx = wp.x - c.x;
      const dy = wp.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d <= step || d < 2) {
        c.x = wp.x;
        c.y = wp.y;
        nav.path.shift();
      } else {
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
      }
      c.setDepth(c.y + NPC_DEPTH_BASE);

      const dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "right" : "left")
        : (dy > 0 ? "down" : "up");
      c.setData("dir", dir);
      playAnim(dir, true);
    });
  }

  /** Reconstrói o array de walls dinâmicos com as portas fechadas. */
  private refreshDynamicWalls() {
    const state: any = this.room?.state;
    if (!state?.doors) {
      this.dynamicWalls = [];
      return;
    }
    const walls: Array<{ x: number; y: number; w: number; h: number }> = [];
    state.doors.forEach((door: any) => {
      if (door.open) return;
      const isVertical = door.orientation === "vertical";
      const span = (door.gapTiles ?? 2) * 32;
      const thickness = WALL_T;
      const w = isVertical ? thickness : span;
      const h = isVertical ? span : thickness;
      walls.push({ x: door.x - w / 2, y: door.y - h / 2, w, h });
    });

    // Sala de Segurança = no-entry pra TODOS: bloqueia o interior inteiro
    // (independente da porta abrir/fechar). O guarda NPC não usa tryMove
    // nem o A* usa dynamicWalls, então não é afetado.
    const sec = this.layout.rooms.find((r) => r.id === "security_room");
    if (sec) walls.push({ x: sec.x, y: sec.y, w: sec.w, h: sec.h });

    this.dynamicWalls = walls;
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

  /** Posição do slot da mesa: 0=sentado(frente), 1=esquerda, 2=direita. */
  private deskSlotPos(deskId: string, slot: number): { x: number; y: number } | null {
    const d = this.allDesks.find((dd) => dd.id === deskId);
    if (!d) return null;
    const y = d.y + 34; // na frente da mesa (assento)
    if (slot === 1) return { x: d.x - 46, y };
    if (slot === 2) return { x: d.x + 46, y };
    return { x: d.x, y };
  }

  private setGhost(on: boolean) {
    this.ghostMode = on;
    if (this.mySprite) this.mySprite.setAlpha(on ? 0.4 : 1);
  }

  private toggleGhost() {
    // Se está sentado numa mesa, G sai da conversa.
    if (this.myDeskSeat) {
      this.room.send("desk:leave");
      this.myDeskSeat = null;
      this.setGhost(false);
      return;
    }
    this.setGhost(!this.ghostMode);
  }

  /** Só o "burst" (2 anéis + flash) numa posição — sem mexer em avatar. */
  public playBirthBurst(x: number, y: number) {
    const makeRing = (delay: number) => {
      const ring = this.add.circle(x, y, 12, 0x38bdf8, 0);
      ring.setStrokeStyle(4, 0x38bdf8, 0.95);
      ring.setDepth(y + 1);
      ring.setScale(0.2);
      this.tweens.add({
        targets: ring,
        scale: 8,
        alpha: 0,
        delay,
        duration: 850,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy(),
      });
    };
    makeRing(0);
    makeRing(260);
    const flash = this.add.circle(x, y, 32, 0xffffff, 0.7);
    flash.setDepth(y + 1);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2.2,
      duration: 520,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  /** Nascimento do avatar (visitante): pop do container + burst. */
  private spawnBirthFx(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number
  ) {
    container.setScale(0);
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 900,
      ease: "Back.easeOut",
    });
    this.playBirthBurst(x, y);
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
    // Avatar: prefere player.characterId (escolhido pelo user via modal 🎨),
    // fallback pra hash do userId se não escolheu.
    const charId: CharacterId = pickCharacterFor(this.myUserId, player.characterId);
    this.myTextureKey = charId;

    this.myRing = this.add.circle(0, 6, 16, 0x4ade80, 0);
    this.myRing.setStrokeStyle(3, 0x4ade80);
    this.myRing.setVisible(false);

    // Sprite usa o spritesheet `${charId}_idle` (frame 0 inicial)
    this.mySprite = this.add.sprite(0, 0, `${charId}_idle`, 0);
    this.mySprite.setScale(2); // 16x32 → renderiza 32x64 (visualmente equivalente ao canvas antigo)

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
    if (player.role === "visitor") this.spawnBirthFx(this.myContainer, spawnX, spawnY);

    this.cameras.main.startFollow(this.myContainer, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.3);
    this.myFloor = player.floor ?? 1;
    this.applyFloorView(); // dimensão do andar atual (esconde o outro)

    // Tocar idle inicial — animation key: `${charId}_${dir}_idle`
    this.mySprite.play(`${this.myTextureKey}_down_idle`);

    // Mantém appearance no server (cores não afetam visual no novo sistema, mas atualizam snapshot)
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
        if (!checkCollision(nx, ny, PLAYER_HALF, this.layout, this.dynamicWalls)) {
          return { x: nx, y: ny };
        }
      }
    }
    // Fallback absoluto: centro do mapa
    return { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  /** Cores legadas — não afetam visual no sistema LimeZu, mantidas pra compat. */
  private refreshMyAvatarTexture(bodyColor: string, hairColor: string) {
    this.myBodyColor = bodyColor;
    this.myHairColor = hairColor;
  }

  private refreshRemoteAvatarTexture(rp: RemotePlayer, bodyColor: string, hairColor: string) {
    rp.bodyColor = bodyColor;
    rp.hairColor = hairColor;
  }

  /** Quando o user escolhe outro personagem (modal 🎨), troca o spritesheet. */
  private refreshMyCharacter(newCharId: string) {
    const charId = pickCharacterFor(this.myUserId, newCharId);
    if (charId === this.myTextureKey) return;
    this.myTextureKey = charId;
    if (this.mySprite) {
      this.mySprite.setTexture(`${charId}_idle`, 0);
      const anim = this.isMoving ? "walk" : "idle";
      const animKey = `${charId}_${this.myDirection}_${anim}`;
      if (this.anims.exists(animKey)) this.mySprite.play(animKey, true);
    }
  }

  private refreshRemoteCharacter(rp: RemotePlayer, userId: string, newCharId: string) {
    const charId = pickCharacterFor(userId, newCharId);
    if (charId === rp.textureKey) return;
    rp.textureKey = charId;
    rp.sprite.setTexture(`${charId}_idle`, 0);
    const animKey = `${charId}_${rp.direction}_idle`;
    if (this.anims.exists(animKey)) rp.sprite.play(animKey, true);
  }

  private createRemoteAvatar(sessionId: string, player: any) {
    const userId: string = player.userId || "";
    const charId: CharacterId = pickCharacterFor(userId, player.characterId);
    const textureKey = charId;

    const ring = this.add.circle(0, 6, 16, 0x4ade80, 0);
    ring.setStrokeStyle(3, 0x4ade80);
    ring.setVisible(false);

    const sprite = this.add.sprite(0, 0, `${charId}_idle`, 0);
    sprite.setScale(2);

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
    sprite.play(`${charId}_down_idle`);
    // Pra right-click → menu de contexto (achar via hitTestPointer)
    sprite.setInteractive();
    sprite.setData("rpSession", sessionId);
    sprite.setData("rpUser", player.userId || "");
    sprite.setData("rpName", player.name || "");
    if (player.role === "visitor") {
      if (player.visitorOk) {
        // Visitante já autorizado (ex: entrei e ele já estava aqui)
        this.spawnBirthFx(container, player.x, player.y);
      } else {
        // Não autorizado → invisível pros outros até o host aceitar
        container.setVisible(false);
      }
    }

    this.remotePlayers.set(sessionId, {
      container, sprite, ring, nameText,
      bodyColor: player.color || "",
      hairColor: player.hairColor || "",
      textureKey, // charId (usado pra montar key da anim no update)
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
    // Modo fantasma NÃO atravessa móveis/paredes (só "passa por avatares",
    // que já não têm colisão). O encaixe no slot é feito por snap direto
    // no desk:sat, então não precisa furar móvel pra entrar na mesa.

    const stuck = checkCollision(curX, curY, PLAYER_HALF, this.layout, this.dynamicWalls);

    if (stuck) {
      // Estou preso. Aceito qualquer movimento que reduza o overlap com móveis,
      // OU que me leve pra fora completamente.
      const nextX = curX + dx;
      const nextY = curY + dy;

      // Se a nova posição já está livre, ótimo
      if (!checkCollision(nextX, nextY, PLAYER_HALF, this.layout, this.dynamicWalls)) {
        return { x: nextX, y: nextY };
      }

      // Senão, escolho o movimento que mais afasta de móveis sólidos
      // (heurística simples: aceito o movimento mesmo se ainda em colisão,
      //  desde que não esteja AUMENTANDO a colisão)
      // Pra simplicidade, sempre permito quando preso — o usuário consegue sair
      return { x: nextX, y: nextY };
    }

    // Não preso: comportamento normal de colisão.
    // Cadeado NÃO bloqueia movimento — entra livre, áudio que fica mudo
    // (zona "__pending" no server). Ver fluxo de cadeado no OfficeRoom.
    const nextX = curX + dx;
    const nextY = curY + dy;

    if (!checkCollision(nextX, nextY, PLAYER_HALF, this.layout, this.dynamicWalls)) {
      return { x: nextX, y: nextY };
    }
    if (dx !== 0 && !checkCollision(nextX, curY, PLAYER_HALF, this.layout, this.dynamicWalls)) {
      return { x: nextX, y: curY };
    }
    if (dy !== 0 && !checkCollision(curX, nextY, PLAYER_HALF, this.layout, this.dynamicWalls)) {
      return { x: curX, y: nextY };
    }
    return { x: curX, y: curY };
  }

  // ============================================================
  //  Navegação automática: calcula rota A* desviando de móveis/paredes,
  //  desenha a linha e o avatar segue sozinho (update() dirige o vx/vy).
  //  Qualquer input manual (WASD/joystick) cancela. Sem rota → fallback
  //  teleporte (a ação nunca falha em silêncio).
  // ============================================================
  public navigateTo(tx: number, ty: number) {
    if (!this.myContainer) return;
    const gx = Phaser.Math.Clamp(tx, PLAYER_HALF, WORLD_W - PLAYER_HALF);
    const gy = Phaser.Math.Clamp(ty, PLAYER_HALF, WORLD_H - PLAYER_HALF);
    this.navGoal = { x: gx, y: gy };
    this.navStuckMs = 0;

    const path = findPath(
      { x: this.myContainer.x, y: this.myContainer.y },
      { x: gx, y: gy },
      this.layout
    );

    if (!path || path.length === 0) {
      // Sem rota → teleporta direto (fallback) pra ação não falhar.
      this.teleportTo(gx, gy);
      this.cancelNavigation();
      return;
    }
    this.navPath = path;
    if (!this.navGraphics) {
      this.navGraphics = this.add.graphics();
      this.navGraphics.setDepth(50); // acima do piso, abaixo de avatares/UI
    }
  }

  public cancelNavigation() {
    this.navPath = null;
    this.navGoal = null;
    this.navStuckMs = 0;
    this.navGraphics?.clear();
  }

  /** Teleporte público (ex: visitante autorizado vai pro lado do host). */
  public forceTeleport(x: number, y: number) {
    this.cancelNavigation();
    this.teleportTo(x, y);
  }

  /** Define o andar do meu avatar (chamado no `floor:moved`). */
  public setMyFloor(floor: number) {
    this.myFloor = floor;
    this.applyFloorView();
  }

  /**
   * "Outra dimensão": prende a câmera ao andar atual e esconde toda a
   * mobília/paredes/labels do outro andar. Quem está no térreo não vê
   * o 2º andar e vice-versa. No editor mostra tudo (admin edita os 2).
   */
  private applyFloorView() {
    const cam = this.cameras.main;
    // Define os limites/região visível. O piso (tileSprite) e a borda
    // são REDIMENSIONADOS pra essa região — senão, com zoom-out, o
    // piso continua aparecendo no gap/2º andar como "espaço vazio".
    const setRegion = (x: number, y: number, w: number, h: number) => {
      cam.setBounds(x, y, w, h);
      this.floorSprite?.setPosition(x, y).setSize(w, h);
      this.redrawWorldBorder(x, y, w, h);
    };
    if (this.editMode) {
      // No editor o admin precisa navegar/editar os 2 andares; a
      // visibilidade de estáticos x editáveis é do enter/exitMapEditor.
      setRegion(0, 0, WORLD_W, WORLD_H);
      return;
    }
    const FLOOR1_MAX = 55 * 32; // térreo: y 0..1760 (sem o gap)
    if (this.myFloor === 2) {
      // Região = retângulo da SALA do 2º andar (não o mundo todo,
      // senão sobra margem vazia em volta). +1 tile de respiro.
      const f2 = this.layout.rooms.find((r) => r.id === "floor2");
      if (f2) setRegion(f2.x - 32, f2.y - 32, f2.w + 64, f2.h + 64);
      else setRegion(0, FLOOR2_Y0, WORLD_W, WORLD_H - FLOOR2_Y0);
    } else {
      setRegion(0, 0, WORLD_W, FLOOR1_MAX);
    }
    const floorOf = (o: any) => ((o?.y ?? 0) >= FLOOR2_Y0 ? 2 : 1);
    this.furnitureObjs.forEach((o: any) => o.setVisible?.(floorOf(o) === this.myFloor));
    this.wallObjs.forEach((o: any) => o.setVisible?.(floorOf(o) === this.myFloor));
    this.roomLabelObjs.forEach((o: any) => o.setVisible?.(floorOf(o) === this.myFloor));
  }

  /** Teleporte server-autoritativo-light: move e sincroniza imediatamente. */
  private teleportTo(x: number, y: number) {
    if (!this.myContainer) return;
    this.myContainer.x = Phaser.Math.Clamp(x, PLAYER_HALF, WORLD_W - PLAYER_HALF);
    this.myContainer.y = Phaser.Math.Clamp(y, PLAYER_HALF, WORLD_H - PLAYER_HALF);
    this.myContainer.setDepth(this.myContainer.y);
    this.room.send("move", {
      x: this.myContainer.x,
      y: this.myContainer.y,
      direction: this.myDirection,
      isMoving: false,
    });
  }

  /** Redesenha a linha da rota: da minha posição pelos waypoints restantes. */
  private drawNavLine() {
    if (!this.navGraphics || !this.navPath || !this.myContainer) return;
    const g = this.navGraphics;
    g.clear();
    g.lineStyle(3, 0x38bdf8, 0.85);
    g.beginPath();
    g.moveTo(this.myContainer.x, this.myContainer.y);
    for (const p of this.navPath) g.lineTo(p.x, p.y);
    g.strokePath();
    // Marcador no destino
    const last = this.navPath[this.navPath.length - 1];
    g.fillStyle(0x38bdf8, 0.9);
    g.fillCircle(last.x, last.y, 5);
  }

  update(time: number, delta: number) {
    if (!this.myContainer) return;

    const dt = delta / 1000;
    let vx = 0, vy = 0;
    let newDir = this.myDirection;
    const navBeforeX = this.myContainer.x;
    const navBeforeY = this.myContainer.y;

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

    // Autopilot: se há rota ativa e o usuário NÃO está dando input manual,
    // o avatar segue a rota. Qualquer input manual cancela a navegação.
    const manualInput = vx !== 0 || vy !== 0;
    let navDriving = false;
    if (this.navPath) {
      if (manualInput) {
        this.cancelNavigation();
      } else {
        const px = this.myContainer.x;
        const py = this.myContainer.y;
        // Consome waypoints já alcançados
        while (this.navPath.length > 0) {
          const wp = this.navPath[0];
          if (Math.hypot(wp.x - px, wp.y - py) <= 10) this.navPath.shift();
          else break;
        }
        if (this.navPath.length === 0) {
          this.cancelNavigation();
        } else {
          const wp = this.navPath[0];
          const ddx = wp.x - px;
          const ddy = wp.y - py;
          const d = Math.hypot(ddx, ddy) || 1;
          vx = ddx / d;
          vy = ddy / d;
          if (Math.abs(ddx) > Math.abs(ddy)) newDir = ddx > 0 ? "right" : "left";
          else newDir = ddy > 0 ? "down" : "up";
          navDriving = true;
        }
      }
    }

    if (!navDriving && vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }

    const wasMoving = this.isMoving;
    this.isMoving = vx !== 0 || vy !== 0;

    // Se o user mexer no avatar enquanto a câmera tá deslocada (panning), volta a seguir.
    if (this.isMoving && !this.cameraFollowing) {
      this.recenterCamera();
    }

    // Boost: a cada 3s de movimento contínuo, aumenta multiplicador em 0.5x (cap 3x)
    if (this.isMoving) {
      if (this.movingSince === 0) this.movingSince = time;
    } else {
      this.movingSince = 0;
    }
    const heldMs = this.movingSince > 0 ? time - this.movingSince : 0;
    const speedMul = Math.min(3, 1 + Math.floor(heldMs / 3000) * 0.5);

    if (this.isMoving) {
      const dx = vx * SPEED * speedMul * dt;
      const dy = vy * SPEED * speedMul * dt;
      const moved = this.tryMove(this.myContainer.x, this.myContainer.y, dx, dy);
      this.myContainer.x = Phaser.Math.Clamp(moved.x, PLAYER_HALF, WORLD_W - PLAYER_HALF);
      this.myContainer.y = Phaser.Math.Clamp(moved.y, PLAYER_HALF, WORLD_H - PLAYER_HALF);
      this.myContainer.setDepth(this.myContainer.y);
    }

    // Acompanhamento da rota: detecta "preso" (porta que não abriu, peer
    // bloqueando) e cai pro fallback de teleporte; senão redesenha a linha.
    if (this.navPath) {
      const progressed = Math.hypot(
        this.myContainer.x - navBeforeX,
        this.myContainer.y - navBeforeY
      );
      if (progressed < 0.5) this.navStuckMs += delta;
      else this.navStuckMs = 0;

      if (this.navStuckMs > 1800 && this.navGoal) {
        this.teleportTo(this.navGoal.x, this.navGoal.y);
        this.cancelNavigation();
      } else {
        this.drawNavLine();
      }
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
    this.remotePlayers.forEach((rp, sid) => {
      // Esconde quem está em outro andar (isolamento de andar).
      // No editor a visibilidade é controlada por setActorsVisible.
      if (!this.editMode) {
        const pf = (this.room.state as any)?.players?.get?.(sid)?.floor ?? 1;
        rp.container.setVisible(pf === this.myFloor);
      }
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

    this.advanceSecurityNpcs(dt);

    // Mesa-conversa: fantasma perto de uma mesa → tenta sentar (server
    // valida máx 3). Sentado e se afastou do slot → sai da conversa.
    if (this.myContainer) {
      const px = this.myContainer.x;
      const py = this.myContainer.y;
      if (this.ghostMode && !this.myDeskSeat && time - this.lastSitTry > 800) {
        let near: { id: string; d2: number } | null = null;
        for (const d of this.allDesks) {
          const dd = (d.x - px) ** 2 + (d.y + 34 - py) ** 2;
          if (dd < 70 * 70 && (!near || dd < near.d2)) near = { id: d.id, d2: dd };
        }
        if (near) {
          this.lastSitTry = time;
          this.room.send("desk:sit", { deskId: near.id });
        }
      } else if (this.myDeskSeat && this.isMoving) {
        const d = this.allDesks.find((dd) => dd.id === this.myDeskSeat);
        if (d) {
          const dist2 = (d.x - px) ** 2 + (d.y + 34 - py) ** 2;
          if (dist2 > 110 * 110) {
            this.room.send("desk:leave");
            this.myDeskSeat = null;
          }
        }
      }
    }

    if (this.onPositionsUpdate) {
      const peerInfo = new Map<string, { x: number; y: number; zoneId: string; bubbleId: string; role: string; visitorOk: boolean; deskSeat: string; floor: number }>();
      const state: any = this.room.state;
      this.remotePlayers.forEach((rp, sessionId) => {
        const peerPlayer = state?.players?.get?.(sessionId);
        peerInfo.set(sessionId, {
          x: rp.container.x,
          y: rp.container.y,
          zoneId: peerPlayer?.zoneId || "open",
          bubbleId: peerPlayer?.bubbleId || "",
          role: peerPlayer?.role || "user",
          visitorOk: peerPlayer?.visitorOk ?? true,
          deskSeat: peerPlayer?.deskSeat || "",
          floor: peerPlayer?.floor ?? 1,
        });
      });
      const mySessionId = (this.room as any).sessionId;
      const myPlayer = state?.players?.get?.(mySessionId);
      this.onPositionsUpdate(
        {
          x: this.myContainer.x,
          y: this.myContainer.y,
          zoneId: this.currentZone || "open",
          bubbleId: myPlayer?.bubbleId || "",
          role: myPlayer?.role || "user",
          visitorOk: myPlayer?.visitorOk ?? true,
          deskSeat: myPlayer?.deskSeat || "",
          floor: myPlayer?.floor ?? this.myFloor,
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
