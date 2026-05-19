import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import { OfficeScene } from "./OfficeScene";
import { SpatialAudio } from "./SpatialAudio";
import LoginScreen from "./LoginScreen";
import AdminPanel from "./AdminPanel";
import ChatPanel from "./ChatPanel";
import MobileControls from "./MobileControls";
import AudioTestScreen from "./AudioTestScreen";
import SecurityLockModal from "./SecurityLockModal";
import MiniMap from "./MiniMap";
import { getMirrorSelf } from "./audioPrefs";
import { ChatMessage, playNotificationBeep } from "./chat";
import { useIsMobile } from "./useIsMobile";
import { requestNotificationPermissionOnce, showNotificationIfHidden } from "./notifications";
import {
  AuthSession,
  clearToken,
  fetchMe,
  getStoredToken,
  storeToken,
  updateProfile,
  listAllUsers,
  DirectoryUser,
  fetchMapLayout,
  saveMapLayout,
  resetMapLayout,
  createVisitorCode,
} from "./auth";
import { EDITOR_FURNITURE_TYPES } from "./OfficeLayout";

function resolveServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) {
    let url = fromEnv.trim();
    if (url.startsWith("https://")) url = "wss://" + url.slice(8);
    else if (url.startsWith("http://")) url = "ws://" + url.slice(7);
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("ws://")) {
      url = "wss://" + url.slice(5);
    }
    return url.replace(/\/+$/, "");
  }
  return "ws://localhost:2567";
}

function resolveHttpUrl(): string {
  const ws = resolveServerUrl();
  if (ws.startsWith("wss://")) return "https://" + ws.slice(6);
  if (ws.startsWith("ws://")) return "http://" + ws.slice(5);
  return ws;
}

const SERVER_URL = resolveServerUrl();
const HTTP_URL = resolveHttpUrl();

// Reconexão: teto de tentativas + timeout do joinOrCreate. Sem isso o
// cliente entrava em loop infinito (~3 erros/s) em desconexão/sessão
// duplicada e a tela "Conectando..." travava pra sempre (BUG-001/002).
const MAX_RECONNECT = 5;
const CONN_TIMEOUT_MS = 15000;

// Categorias + rótulos PT pra paleta do editor de mapa (busca/filtro).
const FURN_CAT: Record<string, string> = {
  plant: "Geral", sofa: "Geral", bookshelf: "Geral", whiteboard: "Geral",
  tv: "Geral", chair: "Geral", coffeeTable: "Geral",
  meetingTable: "Mesas", kitchen_table: "Mesas", desk: "Mesas",
  reception_desk: "Mesas", monitor: "Mesas", desk_work: "Mesas", desk_long: "Mesas", desk_office: "Mesas", desk_plain: "Mesas",
  desk_wide: "Mesas", desk_pc1: "Mesas", desk_pc2: "Mesas",
  desk_screen1: "Mesas", desk_screen2: "Mesas", printer: "Mesas",
  deskpc_dev: "Mesas", deskpc_dados: "Mesas", deskpc_infra: "Mesas",
  deskpc_fin: "Mesas",
  fridge: "Cozinha", stove: "Cozinha", counter: "Cozinha",
  counter_sink: "Cozinha", coffee_machine: "Cozinha",
  microwave: "Cozinha", range_hood: "Cozinha",
  cctv_screen: "Segurança", cctv_screen2: "Segurança",
  cctv_screen3: "Segurança", security_console: "Segurança",
  server_rack: "Segurança", security_camera: "Segurança",
  crate: "2º andar",
};
const FURN_LABEL: Record<string, string> = {
  plant: "Planta", sofa: "Sofá", bookshelf: "Estante",
  whiteboard: "Quadro", tv: "TV", chair: "Cadeira",
  coffeeTable: "Mesa de centro", meetingTable: "Mesa de reunião",
  kitchen_table: "Mesa (copa)", desk: "Mesa (padrão)", monitor: "Monitor",
  reception_desk: "Balcão de recepção", desk_work: "Mesa de trabalho", desk_long: "Bancada larga", desk_office: "Mesa escritório", desk_plain: "Mesa lisa",
  desk_wide: "Mesa larga", desk_pc1: "Mesa+PC (madeira)",
  desk_pc2: "Mesa+PC (cinza)", desk_screen1: "Mesa+tela (madeira)",
  desk_screen2: "Mesa+tela (cinza)", printer: "Impressora",
  deskpc_dev: "Mesa Dev", deskpc_dados: "Mesa Dados",
  deskpc_infra: "Mesa Infra", deskpc_fin: "Mesa Financeiro",
  fridge: "Geladeira", stove: "Fogão", counter: "Balcão",
  counter_sink: "Pia", coffee_machine: "Cafeteira",
  microwave: "Microondas", range_hood: "Coifa",
  cctv_screen: "Monitor CCTV", cctv_screen2: "Monitor CCTV 2",
  cctv_screen3: "Monitor CCTV 3", security_console: "Console",
  server_rack: "Rack", security_camera: "Câmera",
  crate: "Caixa",
};
const FURN_CATEGORIES = ["Todos", "Mesas", "Cozinha", "Segurança", "Geral", "2º andar"];

const SHIRT_COLORS = [
  "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
  "#a78bfa", "#34d399", "#fb7185", "#22d3ee",
  "#ef4444", "#facc15", "#10b981", "#8b5cf6",
];

const HAIR_COLORS = [
  "#3b2c20", "#5d4037", "#8b4513", "#2c1810",
  "#d4a574", "#fbbf24", "#737373", "#171717",
  "#dc2626", "#a855f7",
];

type ConnState = "idle" | "connecting" | "connected" | "error";
type AuthState = "checking" | "anonymous" | "authed";

interface ActiveScreenShare {
  identity: string;
  stream: MediaStream;
}

/** Segundo element de vídeo (track.attach() é chamável várias vezes) usado nos cards laterais. */
interface PeerCard {
  identity: string;
  element: HTMLVideoElement;
}

/** Tenta dar play em um vídeo, ignorando AbortError (que é benigno) */
function safePlay(video: HTMLVideoElement) {
  const p = video.play();
  if (p && typeof p.catch === "function") {
    p.catch((err) => {
      if (err?.name !== "AbortError") {
        console.warn("[play] falhou:", err);
      }
    });
  }
}

export default function App() {
  const isMobile = useIsMobile();
  // Suprime o toast "mesa reservada pra você" no sync inicial (join):
  // só mostra reservas feitas ATIVAMENTE depois desse instante.
  const deskToastSinceRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const roomCardsRef = useRef<HTMLDivElement>(null);
  const fullscreenVideoRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const roomRef = useRef<Room | null>(null);
  const spatialRef = useRef<SpatialAudio | null>(null);
  const mapOverrideRef = useRef<{ furniture?: any[]; walls?: any[] } | null>(null);
  const [mapEditorOpen, setMapEditorOpen] = useState(false);
  const [editorBrush, setEditorBrush] = useState<string | null>(null);
  const [editorCat, setEditorCat] = useState("Todos");
  const [editorSearch, setEditorSearch] = useState("");
  const [editorInfo, setEditorInfo] = useState<{
    count: number;
    selected: boolean;
    selKind?: "furn" | "wall" | null;
    wallColor?: number | null;
  }>({ count: 0, selected: false });
  const [editorSaving, setEditorSaving] = useState(false);
  // Miniaturas (dataURL) por tipo de móvel, geradas da textura Phaser
  const [editorThumbs, setEditorThumbs] = useState<Record<string, string>>({});
  const sceneRef = useRef<OfficeScene | null>(null);

  // === Auth state ===
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [session, setSession] = useState<AuthSession | null>(null);

  // === Customização (pré-conexão, alimentado pelo profile do server) ===
  const [bodyColor, setBodyColor] = useState(SHIRT_COLORS[0]);
  const [hairColor, setHairColor] = useState(HAIR_COLORS[0]);

  // === Conexão e mídia ===
  const [conn, setConn] = useState<ConnState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [playerCount, setPlayerCount] = useState(0);
  // Mic e câmera começam DESLIGADOS — user liga manualmente quando quiser
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(null);

  // Cards de câmera no canto superior direito (clones dos elements do balão)
  const [peerCards, setPeerCards] = useState<PeerCard[]>([]);
  const [visiblePeerIds, setVisiblePeerIds] = useState<Set<string>>(new Set());
  const [fullscreenStream, setFullscreenStream] = useState<MediaStream | null>(null);
  const [mirrorSelf, setMirrorSelf] = useState(getMirrorSelf());

  // === Modal de edição de avatar durante sessão ===
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // === Indicador de auto-save da tela de customização ===
  const [profileSaveStatus, setProfileSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // === Painel de admin ===
  const [adminOpen, setAdminOpen] = useState(false);

  // === Confirmação ao clicar em "Sair" ===
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // === Menu de configurações (engrenagem) ===
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioTestOpen, setAudioTestOpen] = useState(false);

  // === Câmera (pan com botão direito) ===
  // Declarado AQUI (antes dos useEffects abaixo) pra evitar TDZ
  const [cameraFollowing, setCameraFollowing] = useState(true);

  // === Toast unificado pra mensagens efêmeras do HUD ===
  const [hudToast, setHudToast] = useState<string | null>(null);
  useEffect(() => {
    if (!hudToast) return;
    const t = setTimeout(() => setHudToast(null), 2500);
    return () => clearTimeout(t);
  }, [hudToast]);

  // Injeção de keyframes CSS globais (não tem CSS module no projeto)
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes speakerPulse { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
      .vo-bar button[title] { position: relative; }
      .vo-bar button[title]:hover::after {
        content: attr(title);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: #0f172af2;
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 50;
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // ENTER (fora de inputs) → toggla o chat
  useEffect(() => {
    if (conn !== "connected") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        setChatOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conn]);

  // Dica rápida de controles ao entrar (some em 5s)
  useEffect(() => {
    if (conn !== "connected") return;
    setHudToast(isMobile
      ? "Joystick pra andar • E reserva mesa • G entra na conversa"
      : "WASD pra mover • Enter abre o chat • E reserva mesa • G entra/sai da conversa de mesa (fantasma)");
  }, [conn, isMobile]);

  // Mostra toast pequeno em vez do bloco azul quando câmera está deslocada
  const cameraToastShownRef = useRef(false);
  useEffect(() => {
    if (cameraFollowing) {
      cameraToastShownRef.current = false;
      return;
    }
    // Só mostra UMA vez por desfocar — depois fica em silêncio
    if (!cameraToastShownRef.current) {
      cameraToastShownRef.current = true;
      setHudToast("Câmera deslocada — aperte C ou ande pra voltar");
    }
  }, [cameraFollowing]);

  // Pede permissão de notificações na primeira vez que conecta no escritório.
  // Cacheado em localStorage — não pede de novo nas próximas sessões.
  useEffect(() => {
    if (conn !== "connected") return;
    // Pequeno atraso pra não interromper o "Entrando no escritório" loading
    const t = setTimeout(() => { requestNotificationPermissionOnce(); }, 1500);
    return () => clearTimeout(t);
  }, [conn]);

  // Aviso do browser ao fechar aba/janela quando dentro do escritório.
  // O browser mostra dialog padrão ("Sair do site?") — não dá pra customizar
  // a mensagem desde 2017, mas a confirmação aparece.
  useEffect(() => {
    if (conn !== "connected") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge ainda exigem returnValue setado (mesmo deprecated)
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [conn]);

  // === Sessão duplicada (mesma conta em outra aba) ===
  // Quando server retorna erro DUPLICATE_SESSION, abre modal pra forçar entrada.
  const [duplicateSession, setDuplicateSession] = useState(false);
  // Quando este cliente é kickado por outra aba, mostra tela específica e
  // bloqueia auto-reconnect (senão entra em loop).
  const [wasKicked, setWasKicked] = useState(false);

  // === Chat ===
  const [chatOpen, setChatOpen] = useState(false);
  // Pedido de abrir DM com alguém (botão "iniciar conversa" da lista). Nonce
  // pra re-disparar mesmo clicando na mesma pessoa de novo.
  const [dmRequest, setDmRequest] = useState<{ userId: string; n: number } | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  // Override de reações por message id (atualiza msgs do histórico que
  // não estão em liveMessages)
  const [reactionsOverride, setReactionsOverride] = useState<Map<string, Array<{ emoji: string; userIds: string[] }>>>(new Map());
  // Contagem de mensagens não lidas por canal
  // Key: "global" | "room" | "dm:<userId>"
  const [unreadByChannel, setUnreadByChannel] = useState<Map<string, number>>(new Map());
  const totalUnread = Array.from(unreadByChannel.values()).reduce((s, n) => s + n, 0);

  // === Mesas reserváveis ===
  // nearbyDesk = mesa que o player está perto agora (pra renderizar hint "Aperte E pra reservar/liberar")
  const [nearbyDesk, setNearbyDesk] = useState<{ deskId: string; isMine: boolean; ownerName?: string } | null>(null);
  // myDeskId = mesa que pertence ao usuário (pra mostrar status persistente no HUD)
  const [myDeskId, setMyDeskId] = useState<string | null>(null);
  // Toast efêmero — usado pra confirmação de claim/release e mensagens de erro do server
  const [deskToast, setDeskToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [deskAction, setDeskAction] = useState<
    { deskId: string; free: boolean; mine: boolean; ownerName?: string } | null
  >(null);
  const [peerMenu, setPeerMenu] = useState<
    { sessionId: string; userId: string; name: string; x: number; y: number } | null
  >(null);

  // === Zona atual (sala ou open space) — pra mostrar no HUD ===
  const [currentZoneId, setCurrentZoneId] = useState<string>("open");
  const ZONE_LABELS: Record<string, { label: string; isIsolated: boolean }> = {
    "open": { label: "Open space", isIsolated: false },
    "meeting-large": { label: "Sala grande", isIsolated: true },
    "meeting-a": { label: "Sala pequena A", isIsolated: true },
    "meeting-b": { label: "Sala pequena B", isIsolated: true },
  };

  // === Sidebar de usuários online ===
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [locateUserId, setLocateUserId] = useState<string | null>(null);
  interface OnlinePlayer {
    sessionId: string;
    userId: string;
    name: string;
    color: string;
    hairColor: string;
    isMe: boolean;
    floor: number;
  }
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  // Andar do meu avatar (1|2) — pra HUD e isolar a contagem por andar.
  const [myFloor, setMyFloor] = useState(1);
  // Diretório completo (todos cadastrados) — buscado ao abrir a sidebar.
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [directoryErr, setDirectoryErr] = useState<string | null>(null);
  useEffect(() => {
    if (!sidebarOpen || !session) return;
    let cancelled = false;
    setDirectoryErr(null);
    listAllUsers(HTTP_URL, session.token)
      .then((list) => {
        if (!cancelled) setDirectory(list);
      })
      .catch((err) => {
        if (!cancelled) setDirectoryErr(err?.message || "Falha ao carregar usuários");
      });
    return () => {
      cancelled = true;
    };
  }, [sidebarOpen, session]);

  // === Convites ===
  const [incomingInvite, setIncomingInvite] = useState<{ fromSessionId: string; fromName: string } | null>(null);
  const [securityLockOpen, setSecurityLockOpen] = useState(false);
  const [socialToast, setSocialToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  // === Bolha de conversa privada ===

  // === Modo visitante ===
  const isVisitor = session?.user?.role === "visitor";
  const [visitorAuthorized, setVisitorAuthorized] = useState(false);
  const [visitorCodeModal, setVisitorCodeModal] = useState<string | null>(null);
  const [incomingVisitor, setIncomingVisitor] = useState<{ visitorSessionId: string; visitorName: string } | null>(null);
  const [visitorWaiting, setVisitorWaiting] = useState<{ hostName: string; online: boolean } | null>(null);
  // Estou numa bolha? Dirige a visibilidade do botão "sair da bolha" no HUD.
  // Verdade de áudio é o state.players[me].bubbleId; isso aqui é só pra UI.
  const [inBubble, setInBubble] = useState(false);

  // === Cadeado de salas de reunião ===
  // lockedRooms: snapshot do state.lockedRooms do Colyseus pra renderizar HUD/UI
  const [lockedRooms, setLockedRooms] = useState<Map<string, { lockedBy: string; lockedByName: string }>>(new Map());
  // Modal de pedido de entrada (eu esbarrei em sala trancada)
  const [accessRequestModal, setAccessRequestModal] = useState<{ roomId: string; lockedByName: string } | null>(null);
  // Toast pro dono quando alguém pede pra entrar
  const [incomingAccessRequest, setIncomingAccessRequest] = useState<{ roomId: string; requesterId: string; requesterName: string } | null>(null);
  // sessionIds dos players falando agora (vem do ActiveSpeakersChanged do LiveKit)
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!socialToast) return;
    const t = setTimeout(() => setSocialToast(null), 3000);
    return () => clearTimeout(t);
  }, [socialToast]);

  useEffect(() => {
    if (!deskToast) return;
    const t = setTimeout(() => setDeskToast(null), 2500);
    return () => clearTimeout(t);
  }, [deskToast]);

  // Auto-login: ao montar, tenta validar JWT salvo
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthState("anonymous");
      return;
    }
    (async () => {
      try {
        const { user, profile } = await fetchMe(HTTP_URL, token);
        const s: AuthSession = { token, user, profile };
        setSession(s);
        setBodyColor(profile.bodyColor);
        setHairColor(profile.hairColor);
        setAuthState("authed");
      } catch (e) {
        clearToken();
        setAuthState("anonymous");
      }
    })();
  }, []);

  function handleAuthed(s: AuthSession) {
    setSession(s);
    setBodyColor(s.profile.bodyColor);
    setHairColor(s.profile.hairColor);
    setAuthState("authed");
  }

  // Estado de reconexão (BUG-002): contador de tentativas, timer agendado e
  // info pra mostrar "Reconectando... (n/5)" na tela. wasKickedRef é um REF
  // (não state) porque o onLeave captura o closure no connect() — o state
  // wasKicked fica stale (sempre false) lá dentro, então a sessão kickada
  // reconectava e batia DUPLICATE de novo (BUG-001).
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const wasKickedRef = useRef(false);
  const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; max: number } | null>(null);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  // Reconexão com backoff exponencial e teto. Chamado pelo onLeave em
  // desconexão inesperada. Sem isso o reconnect era imediato e infinito.
  function scheduleReconnect() {
    clearReconnectTimer();
    const n = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = n;
    if (n > MAX_RECONNECT) {
      setReconnectInfo(null);
      setErrorMsg("Não foi possível reconectar ao servidor após várias tentativas.");
      setConn("error");
      autoConnectedRef.current = true; // não auto-reconecta; os botões resolvem
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** (n - 1)); // 1s,2s,4s,8s,15s
    autoConnectedRef.current = true; // bloqueia o efeito; o timer reconecta
    setReconnectInfo({ attempt: n, max: MAX_RECONNECT });
    setConn("connecting");
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }

  // Retry manual (botões das telas Conectando/Erro): zera o backoff.
  function manualRetry() {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    setReconnectInfo(null);
    setErrorMsg("");
    wasKickedRef.current = false;
    setWasKicked(false);
    autoConnectedRef.current = false;
    setConn("idle");
  }

  function logout() {
    if (conn === "connected") {
      roomRef.current?.leave();
      cleanupGame();
    }
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    setReconnectInfo(null);
    wasKickedRef.current = false;
    setConn("idle");
    clearToken();
    setSession(null);
    setAuthState("anonymous");
    autoConnectedRef.current = false;
  }

  // Auto-connect: assim que autentica, vai direto pro escritório (sem passar
  // por tela intermediária de customização). Pra editar avatar, usa o modal 🎨.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (authState === "authed" && conn === "idle" && !autoConnectedRef.current) {
      autoConnectedRef.current = true;
      connect();
    }
    if (authState !== "authed") {
      autoConnectedRef.current = false;
    }
  }, [authState, conn]);

  useEffect(() => {
    if (conn !== "connected" || !roomRef.current || !containerRef.current) return;
    if (gameRef.current) return;

    const room = roomRef.current;
    const container = containerRef.current;

    const initPhaser = async () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      // IMPORTANTE: buscar o override ANTES de criar o Phaser.Game. Se o
      // await ficar entre `new Phaser.Game` e `scene.start(data)`, o Phaser
      // auto-inicia a cena (scene:[OfficeScene]) SEM o room → init() sem
      // dados → create()/setupStateListeners estoura ("reading 'state'").
      try {
        mapOverrideRef.current = await fetchMapLayout(HTTP_URL, session.token);
      } catch {
        mapOverrideRef.current = null;
      }

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width,
        height,
        backgroundColor: "#0f172a",
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: "100%",
          height: "100%",
        },
        scene: [OfficeScene],
        physics: { default: "arcade" },
        render: { antialias: false, pixelArt: true, powerPreference: "high-performance" },
        fps: { target: 60, forceSetTimeOut: false },
        dom: { createContainer: true },
      });

      game.scene.start("OfficeScene", {
        room,
        myId: room.sessionId,
        bodyColor,
        hairColor,
        mapOverride: mapOverrideRef.current,
      });
      gameRef.current = game;

      setTimeout(() => {
        const scene = game.scene.getScene("OfficeScene") as OfficeScene;
        sceneRef.current = scene;

        scene.onPositionsUpdate = (myInfo, peerInfo) => {
          // Reconectou já autorizado (autorização persiste até meia-noite):
          // o server seta visitorOk no schema → some o painel de escolher host.
          if (myInfo.role === "visitor" && myInfo.visitorOk) setVisitorAuthorized(true);
          if (!spatialRef.current) return;
          const peers = spatialRef.current.getPeerIdentities();
          const mapped = new Map<string, { x: number; y: number; zoneId: string; bubbleId: string; role: string; visitorOk: boolean; deskSeat: string }>();
          const state: any = room.state;
          peerInfo.forEach((info, sessionId) => {
            const player = state.players.get(sessionId);
            if (!player) return;
            // identity do LiveKit é `userId__timestamp`; mapeia pelo userId persistido
            const identity = peers.find((id) => id.startsWith(player.userId + "__"));
            if (identity) mapped.set(identity, info);
          });
          spatialRef.current.updateVolumes(myInfo, mapped);
        };

        // Câmera (pan com botão direito)
        scene.onCameraFollowingChange = (following) => setCameraFollowing(following);

        // Peers visíveis (mesma zona + raio espacial) — pra filtrar cards laterais
        scene.onVisiblePeersChange = (ids) => setVisiblePeerIds(ids);

        // Zona atual (sala isolada vs open space)
        scene.onZoneChange = (zoneId) => setCurrentZoneId(zoneId || "open");

        // Mesas: hint de proximidade + toasts de claim/release/erro
        scene.onNearbyDeskChange = (info) => setNearbyDesk(info);
        deskToastSinceRef.current = Date.now() + 5000; // janela do join
        scene.onMyDeskChange = (deskId) => {
          setMyDeskId((prev) => {
            // Toast só na transição: virou minha OU deixou de ser minha
            if (deskId && deskId !== prev) {
              // No join a reserva já existe; não precisa avisar. Só
              // toasta quando o usuário reserva ATIVAMENTE (depois do join).
              if (Date.now() >= deskToastSinceRef.current) {
                setDeskToast({ text: `Mesa ${labelOf(deskId)} reservada pra você`, tone: "info" });
              }
            } else if (!deskId && prev) {
              setDeskToast({ text: `Mesa ${labelOf(prev)} liberada`, tone: "info" });
            }
            return deskId;
          });
        };
        scene.onDeskError = (msg) => setDeskToast({ text: msg, tone: "error" });
        scene.onDeskClick = (deskId) => {
          const st: any = roomRef.current?.state;
          const desk = st?.desks?.get?.(deskId);
          const mine = !!desk && desk.ownerId === session.user.id;
          setDeskAction({
            deskId,
            free: !desk,
            mine,
            ownerName: desk && !mine ? desk.ownerName : undefined,
          });
        };
        scene.onPeerContextMenu = (info) => {
          setPeerMenu({
            sessionId: info.sessionId,
            userId: info.userId,
            name: info.name,
            x: info.clientX,
            y: info.clientY,
          });
        };
      }, 100);
    };

    const id = requestAnimationFrame(() => requestAnimationFrame(initPhaser));
    return () => cancelAnimationFrame(id);
  }, [conn]);

  async function connect(forceTakeover: boolean = false) {
    if (!session) {
      setErrorMsg("Sessão expirada. Faça login novamente.");
      setAuthState("anonymous");
      return;
    }

    clearReconnectTimer();
    setConn("connecting");
    setErrorMsg("");
    setDuplicateSession(false);
    setWasKicked(false);
    wasKickedRef.current = false;

    try {
      const client = new Client(SERVER_URL);
      // Timeout no joinOrCreate (BUG-002): sem isso, se a conexão pendura
      // (rede ruim, server fora), a tela "Conectando..." trava pra sempre
      // sem nenhuma saída pro usuário.
      const room: Room = await Promise.race([
        client.joinOrCreate("office", {
          token: session.token,
          forceTakeover,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CONN_TIMEOUT")), CONN_TIMEOUT_MS)
        ),
      ]);
      roomRef.current = room;

      const state: any = room.state;
      setPlayerCount(state.players.size);

      // Helper que converte um Player do schema pra nosso shape do React
      const toEntry = (sessionId: string, p: any): OnlinePlayer => ({
        sessionId,
        userId: p.userId || "",
        name: p.name || "(sem nome)",
        color: p.color || "#4ade80",
        hairColor: p.hairColor || "#3b2c20",
        isMe: sessionId === room.sessionId,
        floor: p.floor ?? 1,
      });

      // Snapshot inicial dos players já no state quando entramos
      const initial: OnlinePlayer[] = [];
      state.players.forEach((p: any, sid: string) => initial.push(toEntry(sid, p)));
      setOnlinePlayers(initial);

      state.players.onAdd((p: any, sid: string) => {
        setPlayerCount(state.players.size);
        setOnlinePlayers((prev) => {
          const without = prev.filter((x) => x.sessionId !== sid);
          return [...without, toEntry(sid, p)];
        });
        // Listener pra mudanças de nome/cor (modal 🎨)
        p.onChange?.(() => {
          setOnlinePlayers((prev) =>
            prev.map((x) => (x.sessionId === sid ? toEntry(sid, p) : x))
          );
        });
      });
      state.players.onRemove((_p: any, sid: string) => {
        setPlayerCount(state.players.size);
        setOnlinePlayers((prev) => prev.filter((x) => x.sessionId !== sid));
      });

      room.onLeave(() => {
        cleanupGame();
        // Kickado por outra aba: NÃO reconecta (senão DUPLICATE em loop —
        // BUG-001). Lê o REF, não o state wasKicked (que é stale neste
        // closure, capturado lá no connect()).
        if (wasKickedRef.current) {
          setConn("idle");
          return;
        }
        // Desconexão inesperada → reconecta com backoff e teto (BUG-002),
        // em vez do reconnect imediato e infinito de antes.
        scheduleReconnect();
      });

      // Server avisa que esta sessão foi kickada porque o user entrou em outra aba
      room.onMessage("session:kicked", () => {
        wasKickedRef.current = true;
        setWasKicked(true);
        clearReconnectTimer();
        autoConnectedRef.current = true; // bloqueia auto-reconnect
      });

      // Listeners de convites/teleporte do server
      room.onMessage("invite:received", (msg: { fromSessionId: string; fromName: string }) => {
        // Segundo convite enquanto há um pendente: substitui (avisa via toast)
        setIncomingInvite((prev) => {
          if (prev) setSocialToast({ text: `Novo convite de ${msg.fromName} (substituiu anterior)`, tone: "info" });
          return msg;
        });
        // Notificação push (só se aba não está visível)
        showNotificationIfHidden({
          title: "👋 Convite recebido",
          body: `${msg.fromName} está te chamando`,
          tag: "invite",
        });
      });
      room.onMessage("invite:response", (msg: { fromName: string; accepted: boolean }) => {
        setSocialToast({
          text: msg.accepted ? `${msg.fromName} aceitou seu convite` : `${msg.fromName} recusou`,
          tone: msg.accepted ? "info" : "error",
        });
      });
      room.onMessage("invite:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no convite", tone: "error" });
      });
      // Escada rolante → server trocou meu andar. forceTeleport (evita
      // o race do authoritative-light) + atualiza meu andar.
      room.onMessage("floor:moved", (msg: { x: number; y: number; floor: number }) => {
        // setMyFloor primeiro (ajusta câmera/dimensão do andar) e só
        // depois forceTeleport (move pra dentro dos novos limites).
        sceneRef.current?.setMyFloor(msg.floor);
        sceneRef.current?.forceTeleport(msg.x, msg.y);
        setMyFloor(msg.floor);
        setSocialToast({
          text: msg.floor === 2 ? "🛗 Você subiu pro 2º andar" : "🛗 Você desceu pro térreo",
          tone: "info",
        });
      });
      // Convite aceito por mim → ando até o convidador (rota A*, sem teleporte)
      room.onMessage("invite:walk-to", (msg: { x: number; y: number }) => {
        sceneRef.current?.navigateTo(msg.x, msg.y);
      });
      room.onMessage("teleport:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no teleporte", tone: "error" });
      });

      // === Bolha de conversa privada (sem convite — criada direto) ===
      room.onMessage("bubble:started", (msg: { joinedName: string }) => {
        setInBubble(true);
        setSocialToast({ text: `Bolha de conversa ativa (${msg.joinedName} entrou)`, tone: "info" });
      });
      room.onMessage("bubble:ended", (msg: { reason: string }) => {
        setInBubble(false);
        setSocialToast({ text: msg?.reason || "Bolha encerrada", tone: "info" });
      });
      room.onMessage("bubble:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha na bolha", tone: "error" });
      });

      // "Vir para cá": alguém te chamou → toast + caminha até lá
      room.onMessage("summon:incoming", (msg: { fromName: string; x: number; y: number }) => {
        setSocialToast({ text: `${msg.fromName} chamou você`, tone: "info" });
        sceneRef.current?.navigateTo(msg.x, msg.y);
      });

      // === Modo visitante ===
      // Visitante via código: aguardando o host (gerador) autorizar
      room.onMessage("visitor:waiting", (msg: { hostName: string; online: boolean }) => {
        setVisitorWaiting(msg);
      });
      // Visitante materializou ao lado do host → burst pra todos verem
      room.onMessage("visitor:arrived", (msg: { x: number; y: number }) => {
        sceneRef.current?.playBirthBurst(msg.x, msg.y);
      });
      // Host recebe pedido de um visitante
      room.onMessage("visitor:incoming", (msg: { visitorSessionId: string; visitorName: string }) => {
        setIncomingVisitor(msg);
        showNotificationIfHidden({
          title: "👤 Visitante",
          body: `${msg.visitorName} quer falar com você`,
          tag: "visitor",
        });
      });
      // Visitante recebe a resposta
      room.onMessage(
        "visitor:result",
        (msg: { accepted: boolean; hostName?: string; reason?: string; x?: number; y?: number }) => {
          if (msg.accepted) {
            setVisitorAuthorized(true);
            // Teleporta pro lado do host (client-autoritativo — sem corrida).
            if (typeof msg.x === "number" && typeof msg.y === "number") {
              sceneRef.current?.forceTeleport(msg.x, msg.y);
            }
            setSocialToast({ text: `${msg.hostName || "Anfitrião"} autorizou — áudio liberado`, tone: "info" });
          } else {
            setSocialToast({
              text: msg.reason || `${msg.hostName || "A pessoa"} recusou — tente outra pessoa`,
              tone: "error",
            });
          }
        }
      );

      // Editor de mapa: um admin salvou → recarrega o layout pra todos.
      room.onMessage("map:updated", async () => {
        try {
          const ov = await fetchMapLayout(HTTP_URL, session.token);
          mapOverrideRef.current = ov;
          sceneRef.current?.rebuildLayout(ov);
          setSocialToast({ text: "Mapa atualizado", tone: "info" });
        } catch {
          /* ignora — próximo boot pega */
        }
      });

      // === Cadeado de salas ===
      // Entrou fisicamente numa sala trancada → modal OBRIGATÓRIO (pedir ou sair).
      // Áudio já está mudo (zona "__pending" no server).
      room.onMessage("room:entered-locked", (msg: { roomId: string; lockedByName: string }) => {
        setAccessRequestModal({ roomId: msg.roomId, lockedByName: msg.lockedByName });
      });
      // Dono recebe pedido — guarda pra mostrar toast com Aceitar/Recusar
      room.onMessage("access:request-incoming", (msg: { roomId: string; requesterId: string; requesterName: string }) => {
        setIncomingAccessRequest(msg);
        showNotificationIfHidden({
          title: "🔒 Pedido de entrada",
          body: `${msg.requesterName} quer entrar na sala`,
          tag: `access:${msg.roomId}`,
        });
      });
      // Requester recebe resposta
      room.onMessage(
        "access:response",
        (msg: { roomId: string; accepted: boolean; x?: number; y?: number }) => {
          setSocialToast({
            text: msg.accepted ? "Entrada autorizada — áudio liberado" : "Pedido recusado — você saiu da sala",
            tone: msg.accepted ? "info" : "error",
          });
          // Recusado: server expulsou pra fora da porta. forceTeleport
          // pq authoritative-light sobrescreveria a posição do server.
          if (!msg.accepted && typeof msg.x === "number" && typeof msg.y === "number") {
            sceneRef.current?.forceTeleport(msg.x, msg.y);
          }
          // Fecha o modal obrigatório se ainda estiver aberto pra essa sala
          setAccessRequestModal((cur) => (cur && cur.roomId === msg.roomId ? null : cur));
        }
      );
      // Erros do fluxo de cadeado
      room.onMessage("room:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no cadeado", tone: "error" });
      });
      // Tentou entrar na Sala de Segurança → painel de fechadura
      room.onMessage("security:locked", () => {
        setSecurityLockOpen((cur) => cur || true);
      });

      // Sincroniza lockedRooms do state pro HUD (botão 🔒/🔓 condicional)
      state.lockedRooms.onAdd((lock: any, roomId: string) => {
        setLockedRooms((prev) => {
          const next = new Map(prev);
          next.set(roomId, { lockedBy: lock.lockedBy, lockedByName: lock.lockedByName });
          return next;
        });
      });
      state.lockedRooms.onRemove((_lock: any, roomId: string) => {
        setLockedRooms((prev) => {
          const next = new Map(prev);
          next.delete(roomId);
          return next;
        });
      });

      // Chat: novas mensagens entram em real-time
      room.onMessage("chat:message", (msg: ChatMessage) => {
        setLiveMessages((prev) => {
          // Dedupe por id (caso server emita 2x)
          if (prev.some((m) => m.id === msg.id)) return prev;
          // Limita o buffer pra 200 msgs in-memory
          const next = [...prev, msg];
          return next.length > 200 ? next.slice(-200) : next;
        });
        // Não conta msg PRÓPRIA como não lida
        const isMine = !!session && msg.senderId === session.user.id;
        if (!isMine) {
          let channelKey = "global";
          if (msg.channelType === "room") channelKey = "room";
          else if (msg.channelType === "dm") channelKey = `dm:${msg.senderId}`;
          setUnreadByChannel((prev) => {
            const next = new Map(prev);
            next.set(channelKey, (next.get(channelKey) || 0) + 1);
            return next;
          });
          // Som + notificação só pra DM (geral seria spammy)
          if (msg.channelType === "dm") {
            playNotificationBeep();
            showNotificationIfHidden({
              title: `💬 ${msg.senderName || "Nova mensagem"}`,
              body: msg.content.slice(0, 120),
              tag: `dm:${msg.senderId}`, // novas DMs do mesmo user substituem
              onClick: () => {
                setChatOpen(true);
                // Idealmente abriria a conversa direto — pra MVP, abre o painel
              },
            });
          }
        }
      });

      room.onMessage("chat:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no chat", tone: "error" });
      });

      // Reações atualizadas em uma mensagem persistida
      room.onMessage("chat:reaction:updated", (msg: { messageId: string; reactions: Array<{ emoji: string; userIds: string[] }> }) => {
        // Atualiza override (cobre tanto msgs em live quanto do histórico)
        setReactionsOverride((prev) => {
          const next = new Map(prev);
          next.set(msg.messageId, msg.reactions);
          return next;
        });
        // Também atualiza liveMessages se a msg já tá lá (consistência)
        setLiveMessages((prev) =>
          prev.map((m) => (m.id === msg.messageId ? { ...m, reactions: msg.reactions } : m))
        );
      });

      setAudioStatus("Obtendo token de áudio...");
      const tokenResp = await fetch(HTTP_URL + "/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.token,
        },
        body: JSON.stringify({ room: "office" }),
      });

      if (!tokenResp.ok) {
        if (tokenResp.status === 401) {
          // JWT expirou ou foi invalidado
          clearToken();
          setSession(null);
          setAuthState("anonymous");
          throw new Error("Sessão expirada. Faça login novamente.");
        }
        const errData = await tokenResp.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao obter token");
      }

      const { token, url } = await tokenResp.json();

      setAudioStatus("Conectando áudio espacial...");
      const spatial = new SpatialAudio({
        serverUrl: url,
        token,
        identity: session.profile.displayName,
        enableVideo: true,
        hearingNearRadius: 25,   // 100% só super encostado (~1 avatar)
        hearingFarRadius: 60,    // fade rápido — depois muta
      });

      spatial.onError = (msg) => setAudioStatus("⚠ " + msg);
      spatial.onPeerLeft = (identity) => {
        // Limpa qualquer balão do peer que saiu
        if (sceneRef.current) {
          sceneRef.current.hideVideoBalloon(identity, "camera");
          sceneRef.current.hideVideoBalloon(identity, "screen");
        }
        setActiveScreenShare((cur) => (cur?.identity === identity ? null : cur));
        setPeerCards((prev) => prev.filter((c) => c.identity !== identity));
      };

      spatial.onCameraTrack = (identity, element) => {
        if (sceneRef.current) {
          sceneRef.current.showVideoBalloon(identity, "camera", element);
        }
        // Cria SEGUNDO element pro card lateral (mesmo MediaStream, dois <video>)
        const stream = element.srcObject as MediaStream | null;
        if (stream) {
          const cardEl = document.createElement("video");
          cardEl.srcObject = stream;
          cardEl.autoplay = true;
          cardEl.muted = true;
          cardEl.playsInline = true;
          setPeerCards((prev) => [
            ...prev.filter((c) => c.identity !== identity),
            { identity, element: cardEl },
          ]);
        }
      };

      spatial.onCameraTrackEnded = (identity) => {
        if (sceneRef.current) sceneRef.current.hideVideoBalloon(identity, "camera");
        setPeerCards((prev) => prev.filter((c) => c.identity !== identity));
      };

      spatial.onScreenShareStarted = (identity, element) => {
        const stream = element.srcObject as MediaStream;
        if (!stream) return;
        setActiveScreenShare({ identity, stream });
        if (sceneRef.current) {
          sceneRef.current.showVideoBalloon(identity, "screen", element, () => {
            setFullscreenStream(stream);
          });
        }
      };

      spatial.onScreenShareStopped = (identity) => {
        setActiveScreenShare((cur) => (cur?.identity === identity ? null : cur));
        if (sceneRef.current) sceneRef.current.hideVideoBalloon(identity, "screen");
        setFullscreenStream((cur) => (cur ? null : cur));
      };

      // Screen share LOCAL (eu mesmo) — balão em cima do meu avatar
      spatial.onLocalScreenShareStarted = (element) => {
        const stream = element.srcObject as MediaStream;
        if (!stream) return;
        if (sceneRef.current) {
          sceneRef.current.showVideoBalloon("__local__", "screen", element, () => {
            setFullscreenStream(stream);
          });
        }
      };

      spatial.onLocalScreenShareStopped = () => {
        if (sceneRef.current) sceneRef.current.hideVideoBalloon("__local__", "screen");
      };

      spatial.onPeerSpeaking = (identity, speaking) => {
        const stateNow: any = room.state;
        let target: string | null = null;
        stateNow.players.forEach((player: any, sessionId: string) => {
          if (identity.startsWith(player.userId + "__")) target = sessionId;
        });
        if (target && sceneRef.current) sceneRef.current.setRemoteSpeaking(target, speaking);
        // Atualiza sidebar (badge "está falando")
        if (target) {
          const t = target;
          setActiveSpeakerIds((prev) => {
            const next = new Set(prev);
            if (speaking) next.add(t); else next.delete(t);
            return next;
          });
        }
      };

      // Eu mesmo falando: anel verde no meu avatar + 🎙️ no "você" da sidebar.
      spatial.onLocalSpeaking = (speaking) => {
        sceneRef.current?.setMySpeaking(speaking);
        const mySid = room.sessionId;
        setActiveSpeakerIds((prev) => {
          const next = new Set(prev);
          if (speaking) next.add(mySid); else next.delete(mySid);
          return next;
        });
      };

      spatialRef.current = spatial;
      setAudioStatus("");
      // Conectou: zera o backoff de reconexão.
      reconnectAttemptsRef.current = 0;
      setReconnectInfo(null);
      setConn("connected");
    } catch (e: any) {
      console.error(e);
      clearReconnectTimer();
      const msg = String(e?.message || "");
      if (msg.includes("DUPLICATE_SESSION")) {
        // Sessão duplicada: abre o modal "Já está conectado" e PÁRA.
        // autoConnectedRef fica TRUE de propósito — se resetasse pra false,
        // o efeito de auto-connect dispararia connect() de novo na hora,
        // batendo DUPLICATE outra vez → loop infinito de ~3 erros/s
        // (BUG-001). A saída é o usuário escolher no modal.
        setReconnectInfo(null);
        setDuplicateSession(true);
        setConn("idle");
        autoConnectedRef.current = true;
        return;
      }
      setReconnectInfo(null);
      setErrorMsg(
        msg === "CONN_TIMEOUT"
          ? "Tempo esgotado ao conectar. Verifique sua conexão e tente novamente."
          : msg || "Falha na conexão"
      );
      setConn("error");
    }
  }


  // Renderiza os vídeos dos peers visíveis. Em sala (não open space),
  // vai pra um grid maior centralizado ("primeiro plano"); no open
  // space, fica na coluninha lateral discreta.
  useEffect(() => {
    if (conn !== "connected") return;
    const side = cardsContainerRef.current;
    const room = roomCardsRef.current;
    if (side) side.innerHTML = "";
    if (room) room.innerHTML = "";

    const inRoom = !!currentZoneId && currentZoneId !== "open";
    const target = inRoom ? room : side;
    if (!target) return;
    // Mobile: cards menores pra não engolir a tela / cobrir controles
    const W = isMobile ? (inRoom ? 132 : 84) : inRoom ? 220 : 120;
    const H = isMobile ? (inRoom ? 99 : 56) : inRoom ? 165 : 80;

    peerCards
      .filter((card) => visiblePeerIds.has(card.identity))
      .forEach((card) => {
        const userId = card.identity.split("__")[0];
        const player = onlinePlayers.find((p) => p.userId === userId);
        const displayName = player?.name || userId.slice(0, 8);

        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;border:1px solid #334155;border-radius:8px;overflow:hidden;background:#000;";
        card.element.style.width = `${W}px`;
        card.element.style.height = `${H}px`;
        card.element.style.objectFit = "cover";
        card.element.style.display = "block";

        const lbl = document.createElement("div");
        lbl.textContent = displayName;
        lbl.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:#000a;color:#fff;font-size:11px;padding:2px 6px;display:flex;align-items:center;gap:6px;";

        // Slider de volume individual desta pessoa (multiplicador, persiste).
        const cur = spatialRef.current?.getPeerVolumeFor(card.identity) ?? 1;
        const vol = document.createElement("input");
        vol.type = "range";
        vol.min = "0";
        vol.max = "2";
        vol.step = "0.05";
        vol.value = String(cur);
        vol.title = `Volume de ${displayName}: ${Math.round(cur * 100)}%`;
        vol.style.cssText = "flex:1;min-width:44px;height:12px;cursor:pointer;accent-color:#38bdf8;";
        vol.onpointerdown = (e) => e.stopPropagation(); // não arrasta a câmera
        vol.oninput = () => {
          const v = parseFloat(vol.value);
          spatialRef.current?.setPeerVolumeFor(card.identity, v);
          vol.title = `Volume de ${displayName}: ${Math.round(v * 100)}%`;
        };
        const nameSpan = document.createElement("span");
        nameSpan.textContent = displayName;
        nameSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%;";
        lbl.textContent = "";
        lbl.append("🔊", vol, nameSpan);

        wrap.appendChild(card.element);
        wrap.appendChild(lbl);
        target.appendChild(wrap);
        safePlay(card.element);
      });
  }, [peerCards, visiblePeerIds, onlinePlayers, conn, currentZoneId, isMobile]);

  // Gera as miniaturas dos móveis quando o editor abre (texturas Phaser
  // já carregadas nessa altura). Pequeno retry caso ainda não estejam.
  useEffect(() => {
    if (!mapEditorOpen) return;
    let tries = 0;
    let timer: number | undefined;
    const build = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      const map: Record<string, string> = {};
      let missing = 0;
      for (const t of EDITOR_FURNITURE_TYPES) {
        const url = scene.getFurnitureThumbnail?.(t);
        if (url) map[t] = url;
        else missing++;
      }
      setEditorThumbs(map);
      if (missing > 0 && tries < 5) {
        tries++;
        timer = window.setTimeout(build, 250);
      }
    };
    build();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [mapEditorOpen]);

  // Edição limpa: silencia o áudio dos peers enquanto o editor está aberto
  useEffect(() => {
    spatialRef.current?.setEditorMute(mapEditorOpen);
  }, [mapEditorOpen]);

  useEffect(() => {
    if (conn !== "connected" || !spatialRef.current || !localVideoRef.current) return;
    const tryAttach = () => {
      const el = spatialRef.current?.getLocalVideoElement();
      if (el && localVideoRef.current) {
        localVideoRef.current.innerHTML = "";
        el.style.width = "160px";
        el.style.height = "120px";
        el.style.objectFit = "cover";
        el.style.transform = mirrorSelf ? "scaleX(-1)" : "none";
        localVideoRef.current.appendChild(el);
      }
    };
    const t = setTimeout(tryAttach, 800);
    return () => clearTimeout(t);
  }, [conn, camOn, mirrorSelf]);

  // Aplica o espelhamento na hora (sem esperar o re-attach de 800ms)
  useEffect(() => {
    const el = localVideoRef.current?.querySelector("video") as HTMLVideoElement | null;
    if (el) el.style.transform = mirrorSelf ? "scaleX(-1)" : "none";
  }, [mirrorSelf]);

  useEffect(() => {
    if (!fullscreenVideoRef.current || !fullscreenStream) return;
    const wrap = fullscreenVideoRef.current;
    wrap.innerHTML = "";

    const video = document.createElement("video");
    video.srcObject = fullscreenStream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    video.style.background = "#000";

    wrap.appendChild(video);
    safePlay(video);

    return () => {
      video.srcObject = null;
      wrap.innerHTML = "";
    };
  }, [fullscreenStream]);

  function cleanupGame() {
    spatialRef.current?.disconnect();
    spatialRef.current = null;
    gameRef.current?.destroy(true);
    gameRef.current = null;
    setActiveScreenShare(null);
    setFullscreenStream(null);
  }

  function disconnect() {
    roomRef.current?.leave();
    cleanupGame();
    setConn("idle");
  }

  async function toggleMic() {
    if (!spatialRef.current) return;
    const v = !micOn;
    setMicOn(v);
    await spatialRef.current.setMicEnabled(v);
  }

  async function toggleCam() {
    if (!spatialRef.current) return;
    const v = !camOn;
    setCamOn(v);
    await spatialRef.current.setCameraEnabled(v);
  }

  async function toggleScreen() {
    if (!spatialRef.current) return;
    const v = !screenOn;
    const ok = await spatialRef.current.setScreenShareEnabled(v);
    if (ok) setScreenOn(v);
    else setScreenOn(false);
  }

  // Auto-save na tela de customização (antes de entrar no escritório).
  // Salva imediatamente no server pra não perder se o user recarregar.
  async function selectAndSaveColor(field: "bodyColor" | "hairColor", value: string) {
    if (field === "bodyColor") setBodyColor(value);
    else setHairColor(value);

    if (!session) return;
    if (session.profile[field] === value) return; // sem mudança

    setProfileSaveStatus("saving");
    try {
      const profile = await updateProfile(HTTP_URL, session.token, { [field]: value });
      setSession((s) => (s ? { ...s, profile } : s));
      setProfileSaveStatus("saved");
      // volta pra idle depois de 1.5s pra não ficar verde permanente
      setTimeout(() => setProfileSaveStatus((cur) => (cur === "saved" ? "idle" : cur)), 1500);
    } catch (e: any) {
      console.warn("[profile] auto-save falhou:", e);
      setProfileSaveStatus("error");
      if (e?.message?.toLowerCase()?.includes("401") || /sess/i.test(e?.message || "")) {
        clearToken();
        setSession(null);
        setAuthState("anonymous");
      }
    }
  }

  // Persiste aparência (e atualiza o player na sala se estiver conectado)
  async function saveAvatarEdit(newBody: string, newHair: string) {
    if (!session) return;
    setEditError("");
    setSavingEdit(true);
    try {
      const profile = await updateProfile(HTTP_URL, session.token, {
        bodyColor: newBody,
        hairColor: newHair,
      });
      setSession({ ...session, profile });
      setBodyColor(newBody);
      setHairColor(newHair);

      // Avisa o server pra atualizar o Player no schema do Colyseus
      if (roomRef.current && conn === "connected") {
        roomRef.current.send("appearance", { bodyColor: newBody, hairColor: newHair });
      }
      setEditingAvatar(false);
    } catch (e: any) {
      if (e?.message?.includes("401") || /sess/i.test(e?.message || "")) {
        clearToken();
        setSession(null);
        setAuthState("anonymous");
      }
      setEditError(e?.message || "Falha ao salvar");
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      spatialRef.current?.disconnect();
      gameRef.current?.destroy(true);
    };
  }, []);

  const avatarPreviewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (conn === "connected" && !editingAvatar) return;
    if (!avatarPreviewRef.current) return;
    drawAvatarPreview(avatarPreviewRef.current, bodyColor, hairColor);
  }, [bodyColor, hairColor, conn, editingAvatar]);

  // === Render: auth checking ===
  if (authState === "checking") {
    return (
      <div style={overlayStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <p style={{ opacity: 0.7 }}>Verificando sessão...</p>
        </div>
      </div>
    );
  }

  // === Render: login ===
  if (authState === "anonymous" || !session) {
    return <LoginScreen httpUrl={HTTP_URL} onAuthed={handleAuthed} />;
  }

  // === Render: foi kickado por outra aba ===
  if (wasKicked) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>👋 Sessão encerrada</h1>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.8 }}>
            Você foi desconectado porque entrou em outra aba ou dispositivo.
            Essa aba ficou inativa.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={manualRetry} style={buttonStyle}>
              Voltar pra esta aba
            </button>
            <button onClick={logout} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
              Sair da conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Render: sessão duplicada — pergunta se quer forçar entrada ===
  if (duplicateSession) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>⚠️ Já está conectado</h1>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.8 }}>
            Sua conta já está conectada em outra aba ou dispositivo.
            Se entrar aqui, a outra sessão será desconectada.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setDuplicateSession(false);
                connect(true); // força takeover
              }}
              style={buttonStyle}
            >
              Forçar entrada aqui
            </button>
            <button onClick={logout} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Render: erro de conexão (auth OK mas algo falhou no caminho) ===
  if (conn === "error") {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Não consegui conectar</h1>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#f87171" }}>{errorMsg}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={manualRetry} style={buttonStyle}>
              Tentar de novo
            </button>
            <button onClick={logout} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
              Sair da conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Render: conectando (auth OK, esperando Colyseus + LiveKit) ===
  if (conn !== "connected") {
    return (
      <div style={overlayStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Entrando no escritório</h1>
          <p style={{ margin: "0 0 8px", opacity: 0.7, fontSize: 13 }}>
            Olá, <strong>{session.profile.displayName}</strong>
          </p>
          <p style={{ margin: "12px 0", opacity: 0.7, fontSize: 13, color: "#fbbf24" }}>
            {reconnectInfo
              ? `Reconectando... (tentativa ${reconnectInfo.attempt}/${reconnectInfo.max})`
              : audioStatus || "Conectando..."}
          </p>
          <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5 }}>⚠ Pode pedir acesso a microfone e câmera.</p>
          {/* Saída sempre disponível (BUG-002): antes a tela "Conectando..."
              travava sem nenhum botão e a única forma de sair era limpar o
              localStorage no DevTools. */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button onClick={manualRetry} style={buttonStyle}>
              Tentar de novo
            </button>
            <button onClick={logout} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
              Sair da conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Render: conectado (jogo + HUD) ===
  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{ position: "absolute", top: 0, left: 0, width: "100vw", height: "100vh", background: "#0f172a" }}
        onDragOver={(e) => {
          // Necessário pra o onDrop disparar (só quando arrastando móvel)
          if (mapEditorOpen && e.dataTransfer.types.includes("text/vo-furn")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (!mapEditorOpen) return;
          const t = e.dataTransfer.getData("text/vo-furn");
          if (!t) return;
          e.preventDefault();
          sceneRef.current?.addFurnitureAtScreen(t, e.clientX, e.clientY);
        }}
      />

      {/* HUD esquerdo: info do user. Some quando a lista de usuários ou
          o mini-mapa estão abertos (top-left compartilhado). */}
      {!sidebarOpen && !miniMapOpen && (
      <div style={isMobile ? { ...hudStyle, padding: "6px 10px", fontSize: 12 } : hudStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>{session.profile.displayName}</strong>
          <button
            onClick={() => setSidebarOpen(true)}
            title="Ver quem está online / offline"
            style={{
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
              borderRadius: 6,
              padding: "2px 6px",
              fontSize: 13,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            👥
          </button>
        </div>
        {!isMobile && (
          <>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{playerCount} no escritório</div>
            {(() => {
              const other = myFloor === 1 ? 2 : 1;
              const n = onlinePlayers.filter((p) => (p.floor ?? 1) === other).length;
              const lbl = other === 2 ? "no 2º andar" : "no térreo";
              return (
                <div style={{ fontSize: 12, opacity: 0.7 }} title="Áudio e avatares isolados entre andares">
                  🛗 {n} {n === 1 ? "pessoa" : "pessoas"} {lbl}
                </div>
              );
            })()}
            {(() => {
              const z = ZONE_LABELS[currentZoneId] || { label: currentZoneId, isIsolated: false };
              return (
                <div style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: z.isIsolated ? "#60a5fa" : "#94a3b8",
                }}>
                  {z.isIsolated ? "🔒 " : "📍 "}{z.label}
                  {z.isIsolated && <span style={{ opacity: 0.6 }}> · áudio isolado</span>}
                </div>
              );
            })()}
          </>
        )}
        {audioStatus && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, color: "#fbbf24" }}>{audioStatus}</div>}
      </div>
      )}

      {/* Barra de controles principais: rodapé central no desktop, topo central no mobile (pra não colidir com joystick/botão E) */}
      <div className="vo-bar" style={isMobile ? { ...bottomBarStyle, top: 16, bottom: "auto" } : bottomBarStyle}>
        <button onClick={toggleMic} style={mediaBtnStyle(micOn, micOn ? "#22c55e" : "#7f1d1d")} title="Microfone">
          {micOn ? "🎤" : "🔇"}
        </button>
        <button onClick={toggleCam} style={mediaBtnStyle(camOn, camOn ? "#22c55e" : "#7f1d1d")} title="Câmera">
          {camOn ? "📹" : "🚫"}
        </button>
        <button onClick={toggleScreen} style={mediaBtnStyle(screenOn, screenOn ? "#2563eb" : "#1e293b")} title="Compartilhar tela">
          🖥️
        </button>
        {/* Sair da bolha: só aparece quando estou numa bolha de conversa */}
        {inBubble && (
          <button
            onClick={() => roomRef.current?.send("bubble:leave")}
            style={mediaBtnStyle(true, "#0e7490")}
            title="Sair da bolha de conversa"
          >
            🫧
          </button>
        )}
        {/* Cadeado: aparece automaticamente quando entra em sala de reunião lockable */}
        {["meeting_xg", "meeting_m1", "meeting_g1", "meeting_g2", "office_1", "office_2"].includes(currentZoneId) && (() => {
          const lock = lockedRooms.get(currentZoneId);
          const isOwner = lock && lock.lockedBy === session.user.id;
          // Não-dono dentro de sala trancada não vê botão (não pode destrancar)
          if (lock && !isOwner) return null;
          return (
            <button
              onClick={() => {
                if (lock) {
                  roomRef.current?.send("room:unlock", { roomId: currentZoneId });
                } else {
                  roomRef.current?.send("room:lock", { roomId: currentZoneId });
                }
              }}
              style={mediaBtnStyle(!!lock, lock ? "#dc2626" : "#1e293b")}
              title={lock ? "Destrancar sala" : "Trancar sala"}
            >
              {lock ? "🔓" : "🔒"}
            </button>
          );
        })()}
        <button
          onClick={() => setSidebarOpen(true)}
          style={mediaBtnStyle(sidebarOpen, sidebarOpen ? "#2563eb" : "#1e293b")}
          title="Usuários (online / offline)"
        >
          👥
        </button>
        <button
          onClick={() => setMiniMapOpen((v) => !v)}
          style={mediaBtnStyle(miniMapOpen, miniMapOpen ? "#2563eb" : "#1e293b")}
          title="Mini-mapa (localizar alguém)"
        >
          🧭
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          style={{ ...mediaBtnStyle(chatOpen, chatOpen ? "#2563eb" : "#1e293b"), position: "relative" }}
          title="Chat (Enter)"
        >
          💬
          {totalUnread > 0 && (
            <span style={badgeOnMediaBtn}>{totalUnread > 99 ? "99+" : totalUnread}</span>
          )}
        </button>
        {/* Engrenagem ⚙️ — submenu abre pra cima já que estamos na barra inferior */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            style={mediaBtnStyle(settingsOpen, settingsOpen ? "#2563eb" : "#1e293b")}
            title="Configurações"
          >
            ⚙️
          </button>
          {settingsOpen && (
            <div
              style={{
                ...settingsMenuStyle,
                ...(isMobile
                  ? { top: 60, right: 0 } // mobile: bottombar tá no topo → submenu desce
                  : { bottom: 60, top: "auto", right: 0 }),
              }}
              onClick={() => setSettingsOpen(false)}
            >
              <button onClick={() => setEditingAvatar(true)} style={menuItemStyle}>🎨 Editar avatar</button>
              <button onClick={() => setAudioTestOpen(true)} style={menuItemStyle}>🎧 Testar áudio/vídeo</button>
              <button onClick={() => setSidebarOpen(true)} style={menuItemStyle}>👥 Quem está online</button>
              {!isVisitor && (
                <button
                  onClick={async () => {
                    setSettingsOpen(false);
                    try {
                      const r = await createVisitorCode(HTTP_URL, session.token);
                      setVisitorCodeModal(r.code);
                    } catch (e: any) {
                      setSocialToast({ text: e?.message || "Falha ao gerar código", tone: "error" });
                    }
                  }}
                  style={menuItemStyle}
                >
                  🎟️ Código de convidado
                </button>
              )}
              {session.user.isAdmin && (
                <button onClick={() => setAdminOpen(true)} style={menuItemStyle}>🛡️ Admin</button>
              )}
              {session.user.isAdmin && (
                <button
                  onClick={() => {
                    setSettingsOpen(false);
                    const scene = sceneRef.current;
                    if (!scene) return;
                    scene.onEditorChange = (info) => setEditorInfo(info);
                    scene.enterMapEditor();
                    setEditorBrush(null);
                    setMapEditorOpen(true);
                  }}
                  style={menuItemStyle}
                >
                  🗺️ Editor de mapa
                </button>
              )}
              {myDeskId && (
                <button
                  onClick={() => {
                    // Usa o layout vivo (inclui mesas criadas no editor)
                    if (!sceneRef.current?.goToDesk(myDeskId)) {
                      setSocialToast({ text: "Não achei sua mesa no mapa", tone: "error" });
                    }
                  }}
                  style={menuItemStyle}
                >
                  📍 Ir pra minha mesa
                </button>
              )}
              <div style={{ height: 1, background: "#334155", margin: "4px 0" }} />
              <button
                onClick={() => setConfirmingLogout(true)}
                style={{ ...menuItemStyle, color: "#f87171" }}
              >
                🚪 Sair do escritório
              </button>
            </div>
          )}
        </div>
      </div>

      {sidebarOpen && (() => {
        // Mescla o diretório (todos cadastrados) com o state.players (online
        // em tempo real — fonte da verdade pro status e pros sessionIds das
        // ações). Online players ausentes do diretório (recém-cadastrado /
        // diretório stale) ainda aparecem.
        interface DirRow {
          key: string;
          name: string;
          bodyColor: string;
          hairColor: string;
          online: boolean;
          isMe: boolean;
          sessionId?: string;
          floor?: number;
        }
        const onlineByUser = new Map(
          onlinePlayers.filter((o) => o.userId).map((o) => [o.userId, o] as const)
        );
        // userId → deskId de quem tem mesa reservada. Vem do state.desks
        // (hidratado do Postgres no boot do server), então funciona mesmo
        // com o dono offline.
        const deskOfUser = new Map<string, string>();
        const dstate: any = (roomRef.current as any)?.state;
        dstate?.desks?.forEach?.((d: any) => {
          if (d?.ownerId && d?.deskId) deskOfUser.set(d.ownerId, d.deskId);
        });
        const goToUserDesk = (userId: string, name: string) => {
          const deskId = deskOfUser.get(userId);
          if (deskId && sceneRef.current?.goToDesk(deskId)) {
            setSidebarOpen(false);
          } else {
            setSocialToast({ text: `${name} não tem mesa reservada`, tone: "error" });
          }
        };
        const rows: DirRow[] = [];
        const seen = new Set<string>();
        for (const d of directory) {
          const op = onlineByUser.get(d.id);
          rows.push({
            key: d.id,
            name: op?.name || d.displayName,
            bodyColor: op?.color || d.bodyColor,
            hairColor: op?.hairColor || d.hairColor,
            online: !!op,
            isMe: !!op?.isMe,
            sessionId: op?.sessionId,
            floor: op?.floor,
          });
          seen.add(d.id);
        }
        for (const o of onlinePlayers) {
          if (!o.userId || seen.has(o.userId)) continue;
          rows.push({
            key: o.userId,
            name: o.name,
            bodyColor: o.color,
            hairColor: o.hairColor,
            online: true,
            isMe: o.isMe,
            sessionId: o.sessionId,
            floor: o.floor,
          });
        }
        rows.sort((a, b) => {
          if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
          if (a.online !== b.online) return a.online ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        const onlineCount = rows.filter((r) => r.online).length;
        return (
        <div style={{
          ...sidebarStyle,
          ...(isMobile ? { top: 0, left: 0, right: 0, bottom: 0, width: "100vw", maxHeight: "100vh" } : {}),
        }}>
          <div style={sidebarHeaderStyle}>
            <span><strong>{onlineCount}</strong> online · {rows.length} no total</span>
            <button onClick={() => setSidebarOpen(false)} style={sidebarCloseBtn} title="Fechar">✕</button>
          </div>
          <div style={sidebarListStyle}>
            {directoryErr && (
              <div style={{ padding: 8, fontSize: 12, color: "#f87171" }}>
                {directoryErr} — mostrando só quem está online.
              </div>
            )}
            {rows.map((p) => (
                <div key={p.key} style={{ ...sidebarRowStyle, opacity: p.online ? 1 : 0.5 }}>
                  <MiniAvatar bodyColor={p.bodyColor} hairColor={p.hairColor} />
                  <div style={{ flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span
                      title={p.online ? "Online" : "Offline"}
                      style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        marginRight: 6, verticalAlign: "middle",
                        background: p.online ? "#22c55e" : "#64748b",
                      }}
                    />
                    {p.name}
                    {p.isMe && <span style={youBadgeStyle}>você</span>}
                    {p.online && (p.floor ?? 1) === 2 && (
                      <span
                        title="Está no 2º andar"
                        style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 6, background: "#1e3a8a", color: "#bfdbfe" }}
                      >
                        🛗 2º andar
                      </span>
                    )}
                    {p.sessionId && activeSpeakerIds.has(p.sessionId) && (
                      <span title="Falando agora" style={{
                        marginLeft: 6, display: "inline-block",
                        animation: "speakerPulse 1s ease-in-out infinite",
                      }}>🎙️</span>
                    )}
                  </div>
                  {!p.isMe && p.online && p.sessionId && (
                    <div style={sidebarActionsRow}>
                      <button
                        onClick={() => {
                          // p.key == userId (vide construção das rows)
                          setLocateUserId(p.key);
                          setMiniMapOpen(true);
                          setSidebarOpen(false);
                        }}
                        style={sidebarActionBtn}
                        title={`Localizar ${p.name} no mini-mapa`}
                      >
                        🧭
                      </button>
                      <button
                        onClick={() => {
                          // p.key == userId (vide construção das rows)
                          setDmRequest({ userId: p.key, n: Date.now() });
                          setChatOpen(true);
                          setSidebarOpen(false);
                        }}
                        style={sidebarActionBtn}
                        title={`Iniciar conversa com ${p.name}`}
                      >
                        💬
                      </button>
                      <button
                        onClick={() => {
                          const peer = (roomRef.current as any)?.state?.players?.get?.(p.sessionId);
                          if (peer && sceneRef.current) {
                            sceneRef.current.navigateTo(peer.x, peer.y);
                            setSidebarOpen(false);
                          }
                        }}
                        style={sidebarActionBtn}
                        title={`Ir até ${p.name}`}
                      >
                        📍
                      </button>
                      {deskOfUser.has(p.key) && (
                        <button
                          onClick={() => goToUserDesk(p.key, p.name)}
                          style={sidebarActionBtn}
                          title={`Ir até a mesa de ${p.name}`}
                        >
                          🪑
                        </button>
                      )}
                      <button
                        onClick={() => {
                          roomRef.current?.send("invite", { targetSessionId: p.sessionId });
                          setSocialToast({ text: `Convite enviado pra ${p.name}`, tone: "info" });
                        }}
                        style={sidebarActionBtn}
                        title={`Convidar ${p.name}`}
                      >
                        👋
                      </button>
                      <button
                        onClick={() => {
                          roomRef.current?.send("bubble:invite", { targetSessionId: p.sessionId });
                          setSocialToast({ text: `Bolha aberta com ${p.name}`, tone: "info" });
                        }}
                        style={sidebarActionBtn}
                        title={`Abrir bolha de conversa com ${p.name}`}
                      >
                        🫧
                      </button>
                    </div>
                  )}
                  {!p.isMe && !p.online && (
                    <div style={sidebarActionsRow}>
                      <button
                        onClick={() => goToUserDesk(p.key, p.name)}
                        disabled={!deskOfUser.has(p.key)}
                        style={{
                          ...sidebarActionBtn,
                          ...(deskOfUser.has(p.key) ? {} : { opacity: 0.35, cursor: "not-allowed" }),
                        }}
                        title={
                          deskOfUser.has(p.key)
                            ? `Ir até a mesa de ${p.name}`
                            : `${p.name} não tem mesa reservada`
                        }
                      >
                        🪑
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
        );
      })()}

      {miniMapOpen && conn === "connected" && roomRef.current && (
        <MiniMap
          room={roomRef.current}
          meSessionId={roomRef.current.sessionId}
          onLocate={(x, y) => sceneRef.current?.navigateTo(x, y)}
          onClose={() => { setMiniMapOpen(false); setLocateUserId(null); }}
          highlightUserId={locateUserId}
          myFloor={myFloor}
        />
      )}

      <div ref={localVideoRef} style={{
        position: "absolute",
        // Mobile: canto superior direito (abaixo da barra), longe do
        // joystick e dos botões E/G que ficam no rodapé.
        ...(isMobile
          ? { top: 58, right: 8 }
          : { bottom: 16, right: 16 }),
        border: "2px solid #4ade80", borderRadius: 8, overflow: "hidden",
        background: "#000", zIndex: 10,
      }} />

      {isMobile && !mapEditorOpen && !chatOpen && !sidebarOpen && !adminOpen && !editingAvatar && !confirmingLogout && !incomingInvite && !fullscreenStream && (
        <MobileControls
          onMove={(x, y) => sceneRef.current?.setVirtualInput(x, y)}
          onAction={() => sceneRef.current?.triggerClaimAction()}
          onGhost={() => sceneRef.current?.triggerGhostAction()}
        />
      )}

      <div ref={cardsContainerRef} style={{
        position: "absolute",
        // Mobile: coluna à esquerda abaixo da barra (não colide com o
        // self-view à direita nem com os controles no rodapé) e rolável.
        ...(isMobile
          ? { top: 58, left: 8, maxHeight: "calc(100dvh - 220px)", overflowY: "auto" as const }
          : { top: 16, right: 16 }),
        display: visiblePeerIds.size > 0 && currentZoneId === "open" ? "flex" : "none",
        flexDirection: "column", gap: 4, zIndex: 10,
      }} />

      {/* Primeiro plano: grid maior centralizado quando você está numa sala */}
      <div ref={roomCardsRef} style={{
        position: "absolute", top: 70, left: "50%",
        transform: "translateX(-50%)",
        display: visiblePeerIds.size > 0 && !!currentZoneId && currentZoneId !== "open" ? "flex" : "none",
        flexWrap: "wrap", justifyContent: "center", gap: 8,
        maxWidth: isMobile ? "94vw" : "80vw",
        // Mobile: limita a altura e rola, pra nunca cobrir os controles
        ...(isMobile ? { maxHeight: "55dvh", overflowY: "auto" as const } : {}),
        zIndex: 9,
      }} />




      {/* Só mostra de quem é a mesa (sem prompt de ação — o clique na
          mesa já abre o modal de reservar/liberar). */}
      {nearbyDesk && !nearbyDesk.isMine && nearbyDesk.ownerName && (
        <div style={deskHintStyle}>
          Mesa de <strong>{nearbyDesk.ownerName}</strong>
        </div>
      )}

      {deskToast && (
        <div style={{ ...deskToastStyle, borderColor: deskToast.tone === "error" ? "#f87171" : "#4ade80" }}>
          {deskToast.text}
        </div>
      )}

      {socialToast && (
        <div style={{ ...socialToastStyle, borderColor: socialToast.tone === "error" ? "#f87171" : "#60a5fa" }}>
          {socialToast.text}
        </div>
      )}

      {hudToast && (
        <div style={hudToastStyle}>{hudToast}</div>
      )}

      {securityLockOpen && (
        <SecurityLockModal onClose={() => setSecurityLockOpen(false)} />
      )}

      {incomingInvite && (
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ ...cardStyle, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>👋 Convite recebido</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14 }}>
              <strong>{incomingInvite.fromName}</strong> está te chamando.
              Se aceitar, você teletransporta pra perto dele(a).
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  roomRef.current?.send("invite:respond", {
                    fromSessionId: incomingInvite.fromSessionId,
                    accepted: false,
                  });
                  setIncomingInvite(null);
                }}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
              >
                Recusar
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send("invite:respond", {
                    fromSessionId: incomingInvite.fromSessionId,
                    accepted: true,
                  });
                  setIncomingInvite(null);
                }}
                style={buttonStyle}
              >
                Aceitar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Painel do visitante (até ser autorizado). O chat também ancora à
          direita (340px, full-height) — sem ajuste, este painel ficava
          exatamente em cima das abas do chat (BUG-009). Quando o chat está
          aberto: no desktop desloca pra esquerda do painel de chat; no
          mobile o chat é fullscreen, então some (reaparece ao fechar). */}
      {isVisitor && !visitorAuthorized && conn === "connected" && !(chatOpen && isMobile) && (
        <div style={{ ...editorPanelStyle, top: 16, right: chatOpen ? 356 : 16, width: 300 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>👤 Você é visitante</div>
          {visitorWaiting ? (
            // Entrou por código → host é quem gerou; aguarda autorização
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Seu áudio está mudo até quem te convidou autorizar.
              {visitorWaiting.online ? (
                <>
                  {" "}Aguardando <strong>{visitorWaiting.hostName || "anfitrião"}</strong> aceitar…
                </>
              ) : (
                <> Quem te convidou ainda não está online — assim que entrar, você é avisado.</>
              )}
            </div>
          ) : (
            // Entrou por senha (sem host) → fluxo manual de escolher
            <>
              <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 10 }}>
                Seu áudio está mudo até alguém do escritório te autorizar.
                Escolha com quem quer falar:
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {onlinePlayers.filter((p) => !p.isMe).length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.6 }}>Ninguém online ainda…</div>
                )}
                {onlinePlayers
                  .filter((p) => !p.isMe && p.userId)
                  .map((p) => (
                    <button
                      key={p.sessionId}
                      onClick={() => {
                        roomRef.current?.send("visitor:request", { targetUserId: p.userId });
                        setSocialToast({ text: `Pedido enviado pra ${p.name}`, tone: "info" });
                      }}
                      style={{ ...editorBtn, background: "#2563eb", textAlign: "left" }}
                    >
                      💬 Falar com {p.name}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Host: visitante pediu pra falar */}
      {incomingVisitor && (
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ ...cardStyle, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>👤 Visitante</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14 }}>
              <strong>{incomingVisitor.visitorName}</strong> (visitante) quer falar
              com você. Se aceitar, o áudio dele(a) é liberado no escritório.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  roomRef.current?.send("visitor:respond", {
                    visitorSessionId: incomingVisitor.visitorSessionId,
                    accepted: false,
                  });
                  setIncomingVisitor(null);
                }}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
              >
                Recusar
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send("visitor:respond", {
                    visitorSessionId: incomingVisitor.visitorSessionId,
                    accepted: true,
                  });
                  setIncomingVisitor(null);
                }}
                style={buttonStyle}
              >
                Autorizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Código de convidado gerado */}
      {visitorCodeModal && (
        <div style={modalStyle} onClick={() => setVisitorCodeModal(null)}>
          <div style={{ ...cardStyle, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>🎟️ Código de convidado</h2>
            <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.8 }}>
              Compartilhe com o convidado. Uso único, expira em ~30 min.
            </p>
            <div
              style={{
                fontSize: 32, fontWeight: 800, letterSpacing: 4, textAlign: "center",
                background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
                padding: "14px 0", marginBottom: 14, userSelect: "all",
              }}
            >
              {visitorCodeModal}
            </div>
            <button
              onClick={() => {
                try { navigator.clipboard?.writeText(visitorCodeModal); } catch {}
                setSocialToast({ text: "Código copiado", tone: "info" });
                setVisitorCodeModal(null);
              }}
              style={{ ...buttonStyle, marginBottom: 8 }}
            >
              Copiar
            </button>
            <button
              onClick={() => setVisitorCodeModal(null)}
              style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {peerMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 60 }}
          onClick={() => setPeerMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setPeerMenu(null); }}
        >
          <div
            style={{
              position: "absolute",
              left: Math.min(peerMenu.x, window.innerWidth - 200),
              top: Math.min(peerMenu.y, window.innerHeight - 110),
              minWidth: 180,
              background: "#0f172af2",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: 4,
              color: "#e2e8f0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 12, fontWeight: 700, padding: "6px 8px", opacity: 0.8 }}>
              {peerMenu.name}
            </div>
            <button
              onClick={() => {
                roomRef.current?.send("summon", { targetSessionId: peerMenu.sessionId });
                setSocialToast({ text: `Você chamou ${peerMenu.name}`, tone: "info" });
                setPeerMenu(null);
              }}
              style={menuItemStyle}
            >
              📢 Pedir pra vir aqui
            </button>
            <button
              onClick={() => {
                const p: any = (roomRef.current as any)?.state?.players?.get?.(peerMenu.sessionId);
                if (p && sceneRef.current) sceneRef.current.navigateTo(p.x, p.y);
                setPeerMenu(null);
              }}
              style={menuItemStyle}
            >
              📍 Ir até {peerMenu.name}
            </button>
          </div>
        </div>
      )}

      {deskAction && (
        <div style={modalStyle} onClick={() => setDeskAction(null)}>
          <div style={{ ...cardStyle, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>🪑 Mesa</h2>
            {deskAction.mine ? (
              <>
                <p style={{ margin: "0 0 18px", fontSize: 14 }}>
                  Esta é a <strong>sua mesa</strong>. Quer liberá-la?
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setDeskAction(null)} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>Cancelar</button>
                  <button
                    onClick={() => {
                      roomRef.current?.send("desk:release", { deskId: deskAction.deskId });
                      setDeskAction(null);
                    }}
                    style={{ ...buttonStyle, background: "#b91c1c" }}
                  >
                    Liberar mesa
                  </button>
                </div>
              </>
            ) : !deskAction.free ? (
              <>
                <p style={{ margin: "0 0 18px", fontSize: 14 }}>
                  Mesa de <strong>{deskAction.ownerName || "outra pessoa"}</strong>.
                </p>
                <button onClick={() => setDeskAction(null)} style={buttonStyle}>OK</button>
              </>
            ) : myDeskId ? (
              <>
                <p style={{ margin: "0 0 18px", fontSize: 14 }}>
                  Você já tem uma mesa reservada. Liberar a atual e reservar esta?
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setDeskAction(null)} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>Cancelar</button>
                  <button
                    onClick={() => {
                      // Server libera a anterior automaticamente no novo claim
                      roomRef.current?.send("desk:claim", { deskId: deskAction.deskId });
                      setDeskAction(null);
                    }}
                    style={buttonStyle}
                  >
                    Trocar de mesa
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 18px", fontSize: 14 }}>
                  Reservar esta mesa pra você?
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setDeskAction(null)} style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>Cancelar</button>
                  <button
                    onClick={() => {
                      roomRef.current?.send("desk:claim", { deskId: deskAction.deskId });
                      setDeskAction(null);
                    }}
                    style={buttonStyle}
                  >
                    Reservar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal "Sala trancada — pedir entrada?" (eu esbarrei na porta) */}
      {accessRequestModal && (
        <div style={modalStyle}>
          <div style={{ ...cardStyle, width: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>🔒 Sala trancada</h2>
            <p style={{ margin: "0 0 12px", fontSize: 14 }}>
              Essa sala foi trancada por <strong>{accessRequestModal.lockedByName}</strong>.
              Você entrou mas <strong>não consegue ouvir nem ser ouvido</strong> até ser autorizado.
            </p>
            <p style={{ margin: "0 0 18px", fontSize: 13, opacity: 0.75 }}>
              Você precisa decidir: pedir entrada (aguarda autorização) ou sair da sala.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  roomRef.current?.send("room:leave-locked", { roomId: accessRequestModal.roomId });
                  setAccessRequestModal(null);
                }}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
              >
                Sair da sala
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send("room:request-access", { roomId: accessRequestModal.roomId });
                  setSocialToast({ text: "Pedido enviado — aguardando autorização", tone: "info" });
                  setAccessRequestModal(null);
                }}
                style={buttonStyle}
              >
                Pedir entrada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast/modal pro dono: "X quer entrar — Aceitar/Recusar" */}
      {incomingAccessRequest && (
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ ...cardStyle, width: 380 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>🔒 Pedido de entrada</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14 }}>
              <strong>{incomingAccessRequest.requesterName}</strong> quer entrar na sala que você trancou.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  roomRef.current?.send("room:respond-access", {
                    roomId: incomingAccessRequest.roomId,
                    requesterId: incomingAccessRequest.requesterId,
                    accepted: false,
                  });
                  setIncomingAccessRequest(null);
                }}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
              >
                Recusar
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send("room:respond-access", {
                    roomId: incomingAccessRequest.roomId,
                    requesterId: incomingAccessRequest.requesterId,
                    accepted: true,
                  });
                  setIncomingAccessRequest(null);
                }}
                style={buttonStyle}
              >
                Aceitar
              </button>
            </div>
          </div>
        </div>
      )}

      {fullscreenStream && (
        <div style={modalStyle} onClick={() => setFullscreenStream(null)}>
          <div ref={fullscreenVideoRef} style={{
            width: "90vw", height: "85vh",
            background: "#000", borderRadius: 8, overflow: "hidden",
          }} onClick={(e) => e.stopPropagation()} />
          <button
            onClick={() => setFullscreenStream(null)}
            style={{ position: "absolute", top: 20, right: 20, ...iconBtnStyle(false), fontSize: 16, padding: "8px 14px" }}
          >
            ✕ Fechar
          </button>
        </div>
      )}

      {mapEditorOpen && session.user.isAdmin && (
        <div style={editorPanelStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>🗺️ Editor de mapa</div>
          <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}>
            <b>Arraste</b> uma miniatura pro mapa pra adicionar (ou clique nela
            e depois no mapa). Arraste itens no mapa pra mover; clique pra
            selecionar. Mesas (reserváveis) ficam travadas.
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button
              onClick={() => { setEditorBrush(null); sceneRef.current?.setEditorBrush(null); }}
              style={{ ...editorChip(editorBrush === null), flex: 1 }}
            >
              ✋ Mover/selecionar
            </button>
            <button
              onClick={() => { setEditorBrush("wall"); sceneRef.current?.setEditorBrush("wall"); }}
              style={{ ...editorChip(editorBrush === "wall"), flex: 1 }}
            >
              🧱 Parede
            </button>
          </div>
          {/* Busca + categorias da paleta */}
          <input
            value={editorSearch}
            onChange={(e) => setEditorSearch(e.target.value)}
            placeholder="🔎 buscar móvel…"
            style={{
              width: "100%", padding: "5px 8px", marginBottom: 6,
              borderRadius: 6, border: "1px solid #334155",
              background: "#0f172a", color: "#e2e8f0", fontSize: 12,
              outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {FURN_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setEditorCat(c)}
                style={{
                  ...editorChip(editorCat === c),
                  fontSize: 11, padding: "3px 8px",
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
              marginBottom: 8,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {EDITOR_FURNITURE_TYPES.filter((t) => {
              if (editorCat !== "Todos" && (FURN_CAT[t] || "Geral") !== editorCat) return false;
              const q = editorSearch.trim().toLowerCase();
              if (!q) return true;
              return (
                t.toLowerCase().includes(q) ||
                (FURN_LABEL[t] || "").toLowerCase().includes(q)
              );
            }).map((t) => {
              const sel = editorBrush === t;
              return (
                <div
                  key={t}
                  title={FURN_LABEL[t] || t}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/vo-furn", t);
                    e.dataTransfer.effectAllowed = "copy";
                    setEditorBrush(t);
                    sceneRef.current?.setEditorBrush(t);
                  }}
                  onClick={() => { setEditorBrush(t); sceneRef.current?.setEditorBrush(t); }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    padding: 4,
                    height: 64,
                    borderRadius: 6,
                    cursor: "grab",
                    background: sel ? "#2563eb" : "#0f172a",
                    border: `1px solid ${sel ? "#60a5fa" : "#334155"}`,
                    userSelect: "none",
                  }}
                >
                  {editorThumbs[t] ? (
                    <img
                      src={editorThumbs[t]}
                      alt={t}
                      draggable={false}
                      style={{ maxWidth: 40, maxHeight: 40, imageRendering: "pixelated", pointerEvents: "none" }}
                    />
                  ) : (
                    <div style={{ fontSize: 16 }}>📦</div>
                  )}
                  <span style={{ fontSize: 9, opacity: 0.8, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {FURN_LABEL[t] || t}
                  </span>
                </div>
              );
            })}
          </div>
          {editorBrush === "wall" && (
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}>
              Arraste no mapa pra desenhar uma parede. "✋ Mover/selecionar"
              pra mover/deletar/recolorir paredes existentes (clique nelas).
            </div>
          )}
          {(editorBrush === "wall" || editorInfo.selKind === "wall") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
              <span>🎨 Cor da parede{editorInfo.selKind === "wall" ? " (selecionada)" : " (nova)"}:</span>
              <input
                type="color"
                value={
                  "#" +
                  (editorInfo.selKind === "wall" && editorInfo.wallColor != null
                    ? editorInfo.wallColor
                    : 0x3d4a5e
                  )
                    .toString(16)
                    .padStart(6, "0")
                }
                onChange={(e) =>
                  sceneRef.current?.setWallColor(parseInt(e.target.value.slice(1), 16))
                }
                style={{ width: 40, height: 26, padding: 0, border: "1px solid #334155", borderRadius: 4, background: "#0f172a", cursor: "pointer" }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => sceneRef.current?.deleteEditorSelection()}
              disabled={!editorInfo.selected}
              style={{ ...editorBtn, background: editorInfo.selected ? "#b91c1c" : "#374151", flex: 1 }}
            >
              🗑️ Deletar selecionado
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
            {editorInfo.count} itens no mapa (móveis + paredes)
          </div>
          <button
            disabled={editorSaving}
            onClick={async () => {
              if (!window.confirm(
                "Restaurar o layout PADRÃO do código (inclui a Copa nova) e " +
                "apagar o mapa salvo? Suas edições do editor serão perdidas."
              )) return;
              const scene = sceneRef.current;
              if (!scene) return;
              setEditorSaving(true);
              try {
                await resetMapLayout(HTTP_URL, session.token);
              } catch (e: any) {
                setSocialToast({ text: e?.message || "Falha ao restaurar", tone: "error" });
                setEditorSaving(false);
                return;
              }
              try {
                mapOverrideRef.current = null;
                scene.exitMapEditor(false);
                scene.rebuildLayout(null); // null → layout padrão (Copa nova)
                roomRef.current?.send("map:reload");
              } catch (err) {
                console.warn("[editor] pós-reset:", err);
              }
              setMapEditorOpen(false);
              setSocialToast({ text: "Layout padrão restaurado", tone: "info" });
              setEditorSaving(false);
            }}
            style={{ ...editorBtn, background: "#7c3aed", width: "100%", marginBottom: 6 }}
          >
            ↺ Restaurar layout padrão (Copa nova)
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                sceneRef.current?.exitMapEditor(true);
                setMapEditorOpen(false);
              }}
              style={{ ...editorBtn, background: "#334155", flex: 1 }}
            >
              Descartar
            </button>
            <button
              disabled={editorSaving}
              onClick={async () => {
                const scene = sceneRef.current;
                if (!scene) return;
                setEditorSaving(true);
                const edited = scene.getEditedLayout();
                try {
                  // O que define "salvou" é o PUT no banco dar certo.
                  await saveMapLayout(HTTP_URL, session.token, edited);
                } catch (e: any) {
                  setSocialToast({ text: e?.message || "Falha ao salvar o mapa", tone: "error" });
                  setEditorSaving(false);
                  return;
                }
                // Salvou. As etapas seguintes (sair do editor, redesenhar,
                // avisar os outros) são best-effort — um glitch aqui NÃO é
                // "falha ao salvar".
                try {
                  mapOverrideRef.current = edited;
                  scene.exitMapEditor(false);
                  scene.rebuildLayout(edited);
                  roomRef.current?.send("map:reload");
                } catch (err) {
                  console.warn("[editor] pós-save:", err);
                }
                setMapEditorOpen(false);
                setSocialToast({ text: "Mapa salvo", tone: "info" });
                setEditorSaving(false);
              }}
              style={{ ...editorBtn, background: "#16a34a", flex: 1 }}
            >
              {editorSaving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {adminOpen && session.user.isAdmin && (
        <AdminPanel
          httpUrl={HTTP_URL}
          token={session.token}
          currentUserId={session.user.id}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {audioTestOpen && (
        <AudioTestScreen
          onClose={() => setAudioTestOpen(false)}
          spatial={spatialRef.current}
          onMirrorChange={(v) => setMirrorSelf(v)}
        />
      )}

      {confirmingLogout && (
        <div style={modalStyle} onClick={() => setConfirmingLogout(false)}>
          <div style={{ ...cardStyle, width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Sair do escritório?</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14, opacity: 0.8 }}>
              Você vai voltar pra tela de login. Sua mesa reservada continua sua.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmingLogout(false)}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setConfirmingLogout(false);
                  logout();
                }}
                style={{ ...buttonStyle, background: "#b91c1c", color: "#fff" }}
              >
                Sim, sair
              </button>
            </div>
          </div>
        </div>
      )}

      {chatOpen && (
        <ChatPanel
          httpUrl={HTTP_URL}
          token={session.token}
          myUserId={session.user.id}
          onlinePlayers={onlinePlayers
            .filter((p) => p.userId)
            .map((p) => ({ userId: p.userId, name: p.name, isMe: p.isMe }))}
          liveMessages={liveMessages}
          reactionsOverride={reactionsOverride}
          isVisitor={isVisitor}
          onSend={(channel, content) => {
            roomRef.current?.send("chat:send", {
              channelType: channel.type,
              recipientId: channel.recipientId,
              content,
            });
          }}
          onToggleReaction={(messageId, emoji) => {
            roomRef.current?.send("chat:reaction:toggle", { messageId, emoji });
          }}
          onClose={() => setChatOpen(false)}
          onChannelViewed={(channelKey) => {
            setUnreadByChannel((prev) => {
              if (!prev.has(channelKey)) return prev;
              const next = new Map(prev);
              next.delete(channelKey);
              return next;
            });
          }}
          mobile={isMobile}
          dmRequest={dmRequest}
        />
      )}

      {editingAvatar && (
        <div style={modalStyle} onClick={() => !savingEdit && setEditingAvatar(false)}>
          <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Escolha seu personagem</h2>
            <p style={{ margin: "0 0 16px", fontSize: 12, opacity: 0.7 }}>
              Click pra escolher. Salva ao clicar — outros vão ver na hora.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
              {(["adam", "alex", "amelia", "bob"] as const).map((c) => {
                const selected = (session.profile.characterId || "") === c;
                const label = c.charAt(0).toUpperCase() + c.slice(1);
                return (
                  <button
                    key={c}
                    onClick={async () => {
                      if (savingEdit) return;
                      setEditError("");
                      setSavingEdit(true);
                      try {
                        const profile = await updateProfile(HTTP_URL, session.token, { characterId: c });
                        setSession({ ...session, profile });
                        roomRef.current?.send("appearance", { characterId: c });
                      } catch (e: any) {
                        setEditError(e?.message || "Falha ao salvar");
                      } finally {
                        setSavingEdit(false);
                      }
                    }}
                    disabled={savingEdit}
                    style={{
                      background: selected ? "#2563eb" : "#1e293b",
                      border: selected ? "2px solid #60a5fa" : "1px solid #334155",
                      borderRadius: 10, padding: 10,
                      cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    }}
                  >
                    <CharacterPreview character={label} />
                    <span style={{ fontSize: 12, color: "#e2e8f0" }}>{label}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setEditingAvatar(false)} disabled={savingEdit}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
                Fechar
              </button>
            </div>

            {editError && <p style={{ color: "#f87171", marginTop: 12, fontSize: 13 }}>{editError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Preview do personagem LimeZu pro modal de seleção. Desenha o primeiro
 *  frame do spritesheet idle_anim em escala 3x. */
function CharacterPreview({ character }: { character: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Frame 0 do spritesheet: source 16x32 → dest 48x96 (3x)
      ctx.drawImage(img, 0, 0, 16, 32, 0, 0, 48, 96);
    };
    img.src = `/assets/characters/${character}_idle_anim_16x16.png`;
  }, [character]);
  return (
    <canvas
      ref={ref}
      width={48}
      height={96}
      style={{ imageRendering: "pixelated", display: "block" }}
    />
  );
}

/** Avatar mini (24x30 px) renderizado em canvas — usado na sidebar */
function MiniAvatar({ bodyColor, hairColor }: { bodyColor: string; hairColor: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    drawAvatarPreview(ref.current, bodyColor, hairColor);
  }, [bodyColor, hairColor]);
  return (
    <canvas
      ref={ref}
      width={64}
      height={80}
      style={{
        imageRendering: "pixelated",
        width: 24, height: 30,
        background: "#0f172a",
        borderRadius: 4,
        border: "1px solid #334155",
        flexShrink: 0,
      }}
    />
  );
}

function drawAvatarPreview(canvas: HTMLCanvasElement, bodyColor: string, hairColor: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const skin = "#f5cfa0";
  const pants = "#2c3e50";
  const shoes = "#1a1a1a";
  const outline = "#1a1a2a";
  const SCALE = 4;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  };

  for (let x = 5; x < 11; x++) { px(x, 2, hairColor); px(x, 3, hairColor); }
  px(4, 3, hairColor); px(11, 3, hairColor);
  for (let x = 5; x < 11; x++) for (let y = 4; y < 7; y++) px(x, y, skin);
  px(6, 5, outline); px(9, 5, outline);
  for (let y = 7; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, bodyColor);
  for (let y = 8; y < 12; y++) { px(3, y, bodyColor); px(12, y, bodyColor); }
  px(3, 12, skin); px(12, 12, skin);
  for (let y = 13; y < 17; y++) {
    px(5, y, pants); px(6, y, pants); px(9, y, pants); px(10, y, pants);
  }
  for (let x = 5; x < 7; x++) px(x, 17, shoes);
  for (let x = 9; x < 11; x++) px(x, 17, shoes);
}

const overlayStyle: React.CSSProperties = {
  width: "100vw", height: "100vh",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
  overflowY: "auto",
};
const cardStyle: React.CSSProperties = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 12, padding: 28, width: 380,
  // Nunca estoura a viewport (mesmo quando algum modal sobrescreve width
  // com px fixo via {...cardStyle, width: N}); rola se for muito alto.
  maxWidth: "calc(100vw - 24px)",
  maxHeight: "calc(100dvh - 24px)",
  overflowY: "auto",
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, marginBottom: 6, marginTop: 12, opacity: 0.8 };
const buttonStyle: React.CSSProperties = {
  width: "100%", padding: "10px 16px",
  borderRadius: 8, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 14, cursor: "pointer",
};
const paletteStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
  gap: 6, marginBottom: 4,
};
const swatchStyle: React.CSSProperties = {
  width: "100%", aspectRatio: "1",
  borderRadius: 6, border: "1px solid #334155",
  cursor: "pointer", padding: 0,
};
const iconBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 10px", borderRadius: 6, border: "none",
  background: active ? "#334155" : "#1e293b",
  color: "#e2e8f0", fontSize: 14, cursor: "pointer",
  opacity: active ? 1 : 0.6,
});
const hudStyle: React.CSSProperties = {
  position: "absolute", top: 16, left: 16,
  background: "#1e293bdd", border: "1px solid #334155",
  borderRadius: 8, padding: "10px 14px",
  fontSize: 13, zIndex: 10,
};
const hintStyle: React.CSSProperties = {
  position: "absolute", bottom: 16, left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bdd", border: "1px solid #334155",
  borderRadius: 8, padding: "8px 14px",
  fontSize: 12, opacity: 0.8, zIndex: 10,
};
const zoneIndicatorStyle: React.CSSProperties = {
  position: "absolute", top: 16, left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee", border: "1px solid #4ade80",
  borderRadius: 8, padding: "10px 16px",
  fontSize: 13, zIndex: 15, textAlign: "center",
};
const modalStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "#000c", zIndex: 100,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
  // Mobile/telas baixas: permite rolar e dá respiro nas bordas
  padding: 12,
  overflowY: "auto",
};
const saveStatusStyle = (status: "saving" | "saved" | "error"): React.CSSProperties => ({
  marginLeft: 8,
  fontSize: 11,
  fontWeight: 400,
  color: status === "saved" ? "#4ade80" : status === "error" ? "#f87171" : "#fbbf24",
  opacity: 0.9,
});
const deskHintStyle: React.CSSProperties = {
  // Acima da barra central (bottom:24 + ~56px de altura) pra não sobrepor
  position: "absolute", bottom: 96, left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee", border: "1px solid #fbbf24",
  borderRadius: 8, padding: "6px 12px",
  fontSize: 13, zIndex: 12,
};
const cameraHintStyle: React.CSSProperties = {
  position: "absolute", top: 80, left: 16,
  background: "#1e293bee", border: "1px solid #60a5fa",
  borderRadius: 8, padding: "6px 12px",
  fontSize: 12, zIndex: 12, maxWidth: 280,
};
const deskToastStyle: React.CSSProperties = {
  position: "absolute", top: "20%", left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee", border: "1px solid #4ade80",
  borderRadius: 8, padding: "10px 16px",
  fontSize: 13, zIndex: 20, textAlign: "center",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

/** "desk-3" → "3" (label curto pra toast) */
function labelOf(deskId: string): string {
  const m = /^desk-(\d+)$/.exec(deskId);
  return m ? m[1] : deskId;
}

const sidebarStyle: React.CSSProperties = {
  position: "absolute", top: 16, left: 220,
  background: "#1e293bee", border: "1px solid #334155",
  borderRadius: 8, padding: 10,
  width: 240, maxHeight: "70vh",
  zIndex: 11, display: "flex", flexDirection: "column",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};
const sidebarHeaderStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  fontSize: 13, marginBottom: 10, paddingBottom: 8,
  borderBottom: "1px solid #334155",
};
const sidebarCloseBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#94a3b8",
  fontSize: 14, cursor: "pointer", padding: 0,
};
const sidebarListStyle: React.CSSProperties = {
  overflowY: "auto", display: "flex", flexDirection: "column", gap: 6,
};
const sidebarRowStyle: React.CSSProperties = {
  display: "flex", gap: 8, alignItems: "center",
  padding: "4px 6px", borderRadius: 4, fontSize: 13,
  // Sidebar tem só 240px. Sem wrap, os 5-6 botões de ação de um usuário
  // online espremiam o nome (flex:1 + overflow:hidden) até 0px — só a
  // linha "você" (sem botões) e os offline (1 botão) mostravam nome
  // (BUG-008). Com wrap + flexBasis:100% nos botões, eles caem pra linha
  // de baixo e o nome sempre aparece.
  flexWrap: "wrap",
};
// Container dos botões de ação: ocupa a linha inteira abaixo do nome e
// quebra entre si em telas estreitas (mobile).
const sidebarActionsRow: React.CSSProperties = {
  display: "flex", gap: 4, flexBasis: "100%", flexWrap: "wrap",
};
const youBadgeStyle: React.CSSProperties = {
  marginLeft: 6, background: "#0e7490", color: "#fff",
  fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 600,
};
const sidebarActionBtn: React.CSSProperties = {
  background: "#334155", border: "none",
  color: "#e2e8f0", fontSize: 12, cursor: "pointer",
  padding: "2px 6px", borderRadius: 4,
};
/* === Estilos do HUD novo === */
const bottomBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 24, left: "50%",
  transform: "translateX(-50%)",
  display: "flex", gap: 10,
  background: "#0f172abf",
  border: "1px solid #334155",
  borderRadius: 999,
  padding: "8px 12px",
  zIndex: 11,
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};
const mediaBtnStyle = (active: boolean, color: string): React.CSSProperties => ({
  width: 48, height: 48,
  borderRadius: "50%",
  border: active ? `2px solid ${color}` : "2px solid #334155",
  background: active ? `${color}33` : "#1e293b",
  color: "#e2e8f0",
  fontSize: 20,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  transition: "all 0.15s ease",
});
const badgeOnMediaBtn: React.CSSProperties = {
  position: "absolute", top: -2, right: -2,
  background: "#ef4444", color: "#fff",
  fontSize: 10, fontWeight: 700,
  borderRadius: 10, padding: "2px 6px",
  minWidth: 16, textAlign: "center",
  border: "2px solid #0f172a",
};
const pillBtnStyle = (active: boolean): React.CSSProperties => ({
  width: 42, height: 42,
  borderRadius: "50%",
  border: "1px solid #334155",
  background: active ? "#334155" : "#1e293bbf",
  color: "#e2e8f0",
  fontSize: 18,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  backdropFilter: "blur(8px)",
});
const settingsMenuStyle: React.CSSProperties = {
  position: "absolute", top: 50, right: 0,
  background: "#1e293bf2",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: 6, minWidth: 200,
  display: "flex", flexDirection: "column",
  gap: 2,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  backdropFilter: "blur(8px)",
};
const menuItemStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 13,
  color: "#e2e8f0",
  cursor: "pointer",
  borderRadius: 4,
};

const editorPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 280,
  zIndex: 30,
  background: "#0f172af2",
  border: "1px solid #334155",
  borderRadius: 10,
  padding: 12,
  color: "#e2e8f0",
};
const editorBtn: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  cursor: "pointer",
};
function editorChip(active: boolean): React.CSSProperties {
  return {
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
    background: active ? "#2563eb" : "#1e293b",
    color: "#e2e8f0",
  };
}
const hudToastStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 92, left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee",
  border: "1px solid #60a5fa",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  color: "#e2e8f0",
  zIndex: 13,
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};

const socialToastStyle: React.CSSProperties = {
  position: "absolute", top: "12%", left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee", border: "1px solid #60a5fa",
  borderRadius: 8, padding: "10px 16px",
  fontSize: 13, zIndex: 20, textAlign: "center",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};
