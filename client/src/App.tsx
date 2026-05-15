import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import { OfficeScene } from "./OfficeScene";
import { SpatialAudio } from "./SpatialAudio";
import LoginScreen from "./LoginScreen";
import AdminPanel from "./AdminPanel";
import ChatPanel from "./ChatPanel";
import MobileControls from "./MobileControls";
import { ChatMessage, playNotificationBeep } from "./chat";
import { useIsMobile } from "./useIsMobile";
import {
  AuthSession,
  clearToken,
  fetchMe,
  getStoredToken,
  storeToken,
  updateProfile,
} from "./auth";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenVideoRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const roomRef = useRef<Room | null>(null);
  const spatialRef = useRef<SpatialAudio | null>(null);
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
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(null);

  // Cards de câmera no canto superior direito (clones dos elements do balão)
  const [peerCards, setPeerCards] = useState<PeerCard[]>([]);
  const [visiblePeerIds, setVisiblePeerIds] = useState<Set<string>>(new Set());
  const [fullscreenStream, setFullscreenStream] = useState<MediaStream | null>(null);

  // === Modal de edição de avatar durante sessão ===
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // === Indicador de auto-save da tela de customização ===
  const [profileSaveStatus, setProfileSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // === Painel de admin ===
  const [adminOpen, setAdminOpen] = useState(false);

  // === Sessão duplicada (mesma conta em outra aba) ===
  // Quando server retorna erro DUPLICATE_SESSION, abre modal pra forçar entrada.
  const [duplicateSession, setDuplicateSession] = useState(false);
  // Quando este cliente é kickado por outra aba, mostra tela específica e
  // bloqueia auto-reconnect (senão entra em loop).
  const [wasKicked, setWasKicked] = useState(false);

  // === Chat ===
  const [chatOpen, setChatOpen] = useState(false);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
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

  // === Câmera (pan com botão direito) ===
  const [cameraFollowing, setCameraFollowing] = useState(true);

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
  interface OnlinePlayer {
    sessionId: string;
    userId: string;
    name: string;
    color: string;
    hairColor: string;
    isMe: boolean;
  }
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);

  // === Convites ===
  const [incomingInvite, setIncomingInvite] = useState<{ fromSessionId: string; fromName: string } | null>(null);
  const [socialToast, setSocialToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
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

  function logout() {
    if (conn === "connected") {
      roomRef.current?.leave();
      cleanupGame();
    }
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

    const initPhaser = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

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
        render: { antialias: true, pixelArt: false, powerPreference: "high-performance" },
        fps: { target: 60, forceSetTimeOut: false },
        dom: { createContainer: true },
      });

      game.scene.start("OfficeScene", {
        room,
        myId: room.sessionId,
        bodyColor,
        hairColor,
      });
      gameRef.current = game;

      setTimeout(() => {
        const scene = game.scene.getScene("OfficeScene") as OfficeScene;
        sceneRef.current = scene;

        scene.onPositionsUpdate = (myInfo, peerInfo) => {
          if (!spatialRef.current) return;
          const peers = spatialRef.current.getPeerIdentities();
          const mapped = new Map<string, { x: number; y: number; zoneId: string }>();
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
        scene.onMyDeskChange = (deskId) => {
          setMyDeskId((prev) => {
            // Toast só na transição: virou minha OU deixou de ser minha
            if (deskId && deskId !== prev) {
              setDeskToast({ text: `Mesa ${labelOf(deskId)} reservada pra você`, tone: "info" });
            } else if (!deskId && prev) {
              setDeskToast({ text: `Mesa ${labelOf(prev)} liberada`, tone: "info" });
            }
            return deskId;
          });
        };
        scene.onDeskError = (msg) => setDeskToast({ text: msg, tone: "error" });
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

    setConn("connecting");
    setErrorMsg("");
    setDuplicateSession(false);
    setWasKicked(false);

    try {
      const client = new Client(SERVER_URL);
      const room = await client.joinOrCreate("office", {
        token: session.token,
        forceTakeover,
      });
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
        // Se foi kickado por outra aba, NÃO tenta reconnect (loop infinito)
        // — wasKicked é setado pelo listener session:kicked logo abaixo
        if (!wasKicked) {
          setConn("idle");
          setErrorMsg("Desconectado do servidor — reconectando...");
          autoConnectedRef.current = false;
        } else {
          setConn("idle");
        }
      });

      // Server avisa que esta sessão foi kickada porque o user entrou em outra aba
      room.onMessage("session:kicked", () => {
        setWasKicked(true);
        autoConnectedRef.current = true; // bloqueia auto-reconnect
      });

      // Listeners de convites/teleporte do server
      room.onMessage("invite:received", (msg: { fromSessionId: string; fromName: string }) => {
        // Segundo convite enquanto há um pendente: substitui (avisa via toast)
        setIncomingInvite((prev) => {
          if (prev) setSocialToast({ text: `Novo convite de ${msg.fromName} (substituiu anterior)`, tone: "info" });
          return msg;
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
      room.onMessage("teleport:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no teleporte", tone: "error" });
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
          // Som só pra DM (geral seria spammy)
          if (msg.channelType === "dm") playNotificationBeep();
        }
      });

      room.onMessage("chat:error", (msg: { error: string }) => {
        setSocialToast({ text: msg?.error || "Falha no chat", tone: "error" });
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
      };

      spatialRef.current = spatial;
      setAudioStatus("");
      setConn("connected");
    } catch (e: any) {
      console.error(e);
      const msg = String(e?.message || "");
      if (msg.includes("DUPLICATE_SESSION")) {
        // Sessão duplicada: abre modal pra forçar entrada
        setDuplicateSession(true);
        setConn("idle");
        autoConnectedRef.current = false;
        return;
      }
      setErrorMsg(msg || "Falha na conexão");
      setConn("error");
    }
  }


  // Renderiza cards laterais filtrando peerCards pelos visíveis (mesma zona/perto)
  useEffect(() => {
    if (conn !== "connected") return;
    if (!cardsContainerRef.current) return;
    const c = cardsContainerRef.current;
    c.innerHTML = "";

    peerCards
      .filter((card) => visiblePeerIds.has(card.identity))
      .forEach((card) => {
        const userId = card.identity.split("__")[0];
        const player = onlinePlayers.find((p) => p.userId === userId);
        const displayName = player?.name || userId.slice(0, 8);

        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;border:1px solid #334155;border-radius:6px;overflow:hidden;background:#000;";
        card.element.style.width = "120px";
        card.element.style.height = "80px";
        card.element.style.objectFit = "cover";
        card.element.style.display = "block";

        const lbl = document.createElement("div");
        lbl.textContent = displayName;
        lbl.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:#000a;color:#fff;font-size:11px;padding:2px 6px;";
        wrap.appendChild(card.element);
        wrap.appendChild(lbl);
        c.appendChild(wrap);
        safePlay(card.element);
      });
  }, [peerCards, visiblePeerIds, onlinePlayers, conn]);

  useEffect(() => {
    if (conn !== "connected" || !spatialRef.current || !localVideoRef.current) return;
    const tryAttach = () => {
      const el = spatialRef.current?.getLocalVideoElement();
      if (el && localVideoRef.current) {
        localVideoRef.current.innerHTML = "";
        el.style.width = "160px";
        el.style.height = "120px";
        el.style.objectFit = "cover";
        el.style.transform = "scaleX(-1)";
        localVideoRef.current.appendChild(el);
      }
    };
    const t = setTimeout(tryAttach, 800);
    return () => clearTimeout(t);
  }, [conn, camOn]);

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
            <button
              onClick={() => {
                setWasKicked(false);
                autoConnectedRef.current = false;
                setConn("idle");
              }}
              style={buttonStyle}
            >
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
            <button
              onClick={() => {
                setErrorMsg("");
                autoConnectedRef.current = false;
                setConn("idle");
              }}
              style={buttonStyle}
            >
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
            {audioStatus || "Conectando..."}
          </p>
          <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5 }}>⚠ Pode pedir acesso a microfone e câmera.</p>
        </div>
      </div>
    );
  }

  // === Render: conectado (jogo + HUD) ===
  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, width: "100vw", height: "100vh", background: "#0f172a" }} />

      <div style={hudStyle}>
        <div><strong>{session.profile.displayName}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{playerCount} no escritório</div>
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
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={toggleMic} style={iconBtnStyle(micOn)} title="Microfone">{micOn ? "🎤" : "🔇"}</button>
          <button onClick={toggleCam} style={iconBtnStyle(camOn)} title="Câmera">{camOn ? "📹" : "🚫"}</button>
          <button onClick={toggleScreen} style={iconBtnStyle(screenOn)} title="Compartilhar tela">{screenOn ? "🛑" : "🖥️"}</button>
          <button onClick={() => setSidebarOpen((v) => !v)} style={iconBtnStyle(sidebarOpen)} title="Quem está online">👥</button>
          <button
            onClick={() => setChatOpen((v) => !v)}
            style={{ ...iconBtnStyle(chatOpen), position: "relative" }}
            title="Chat"
          >
            💬
            {totalUnread > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#ef4444", color: "#fff",
                fontSize: 9, fontWeight: 700,
                borderRadius: 8, padding: "1px 5px",
                minWidth: 14, textAlign: "center",
              }}>
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </button>
          {myDeskId && (
            <button
              onClick={() => roomRef.current?.send("teleport:to-desk", { deskId: myDeskId })}
              style={iconBtnStyle(false)}
              title={`Ir pra mesa ${labelOf(myDeskId)}`}
            >
              📍
            </button>
          )}
          <button onClick={() => setEditingAvatar(true)} style={iconBtnStyle(false)} title="Editar avatar">🎨</button>
          {session.user.isAdmin && (
            <button onClick={() => setAdminOpen(true)} style={iconBtnStyle(false)} title="Painel de administração">🛡️</button>
          )}
          <button onClick={logout} style={{ ...iconBtnStyle(false), background: "#7f1d1d" }} title="Sair da conta">Sair</button>
        </div>
        {audioStatus && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, color: "#fbbf24" }}>{audioStatus}</div>}
      </div>

      {sidebarOpen && (
        <div style={{
          ...sidebarStyle,
          ...(isMobile ? { top: 0, left: 0, right: 0, bottom: 0, width: "100vw", maxHeight: "100vh" } : {}),
        }}>
          <div style={sidebarHeaderStyle}>
            <span><strong>{onlinePlayers.length}</strong> online</span>
            <button onClick={() => setSidebarOpen(false)} style={sidebarCloseBtn} title="Fechar">✕</button>
          </div>
          <div style={sidebarListStyle}>
            {onlinePlayers
              .slice()
              .sort((a, b) => {
                if (a.isMe) return -1;
                if (b.isMe) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((p) => (
                <div key={p.sessionId} style={sidebarRowStyle}>
                  <MiniAvatar bodyColor={p.color} hairColor={p.hairColor} />
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                    {p.isMe && <span style={youBadgeStyle}>você</span>}
                  </div>
                  {!p.isMe && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => roomRef.current?.send("teleport:to-player", { targetSessionId: p.sessionId })}
                        style={sidebarActionBtn}
                        title={`Ir até ${p.name}`}
                      >
                        📍
                      </button>
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
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <div ref={localVideoRef} style={{
        position: "absolute",
        // Em mobile, sobe pra não colidir com o joystick
        bottom: isMobile ? 120 : 16,
        right: 16,
        border: "2px solid #4ade80", borderRadius: 8, overflow: "hidden",
        background: "#000", zIndex: 10,
      }} />

      {isMobile && (
        <MobileControls
          onMove={(x, y) => sceneRef.current?.setVirtualInput(x, y)}
          onAction={() => sceneRef.current?.triggerClaimAction()}
        />
      )}

      <div ref={cardsContainerRef} style={{
        position: "absolute", top: 16, right: 16,
        display: visiblePeerIds.size > 0 ? "flex" : "none",
        flexDirection: "column", gap: 4, zIndex: 10,
      }} />


      {!isMobile && (
        <div style={hintStyle}>
          WASD/setas pra mover • <kbd style={kbdStyle}>botão direito</kbd> arrasta a câmera • <kbd style={kbdStyle}>C</kbd> centraliza
        </div>
      )}

      {!cameraFollowing && !isMobile && (
        <div style={cameraHintStyle}>
          Câmera deslocada — aperte <kbd style={kbdStyle}>C</kbd> ou mova com <kbd style={kbdStyle}>WASD</kbd> pra voltar
        </div>
      )}

      {nearbyDesk && (
        <div style={deskHintStyle}>
          {nearbyDesk.isMine ? (
            <>Aperte <kbd style={kbdStyle}>E</kbd> pra liberar sua mesa</>
          ) : nearbyDesk.ownerName ? (
            <>Mesa de <strong>{nearbyDesk.ownerName}</strong></>
          ) : (
            <>Aperte <kbd style={kbdStyle}>E</kbd> pra reservar essa mesa</>
          )}
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

      {adminOpen && session.user.isAdmin && (
        <AdminPanel
          httpUrl={HTTP_URL}
          token={session.token}
          currentUserId={session.user.id}
          onClose={() => setAdminOpen(false)}
        />
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
          onSend={(channel, content) => {
            roomRef.current?.send("chat:send", {
              channelType: channel.type,
              recipientId: channel.recipientId,
              content,
            });
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
        />
      )}

      {editingAvatar && (
        <div style={modalStyle} onClick={() => !savingEdit && setEditingAvatar(false)}>
          <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Editar avatar</h2>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <canvas
                ref={avatarPreviewRef}
                width={64}
                height={80}
                style={{
                  imageRendering: "pixelated",
                  width: 96, height: 120,
                  background: "#0f172a", borderRadius: 8,
                  border: "1px solid #334155", padding: 8,
                }}
              />
            </div>

            <label style={labelStyle}>Camisa</label>
            <div style={paletteStyle}>
              {SHIRT_COLORS.map((c) => (
                <button key={c} onClick={() => setBodyColor(c)} disabled={savingEdit}
                  style={{ ...swatchStyle, background: c, outline: bodyColor === c ? "2px solid #fff" : "none", outlineOffset: 2 }} />
              ))}
            </div>

            <label style={labelStyle}>Cabelo</label>
            <div style={paletteStyle}>
              {HAIR_COLORS.map((c) => (
                <button key={c} onClick={() => setHairColor(c)} disabled={savingEdit}
                  style={{ ...swatchStyle, background: c, outline: hairColor === c ? "2px solid #fff" : "none", outlineOffset: 2 }} />
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditingAvatar(false)} disabled={savingEdit}
                style={{ ...buttonStyle, background: "#334155", color: "#e2e8f0" }}>
                Cancelar
              </button>
              <button onClick={() => saveAvatarEdit(bodyColor, hairColor)} disabled={savingEdit} style={buttonStyle}>
                {savingEdit ? "Salvando..." : "Salvar"}
              </button>
            </div>

            {editError && <p style={{ color: "#f87171", marginTop: 12, fontSize: 13 }}>{editError}</p>}
          </div>
        </div>
      )}
    </div>
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
};
const saveStatusStyle = (status: "saving" | "saved" | "error"): React.CSSProperties => ({
  marginLeft: 8,
  fontSize: 11,
  fontWeight: 400,
  color: status === "saved" ? "#4ade80" : status === "error" ? "#f87171" : "#fbbf24",
  opacity: 0.9,
});
const deskHintStyle: React.CSSProperties = {
  position: "absolute", bottom: 56, left: "50%",
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
const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  margin: "0 4px",
  background: "#334155",
  border: "1px solid #475569",
  borderRadius: 4,
  fontFamily: "monospace",
  fontSize: 11,
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
const socialToastStyle: React.CSSProperties = {
  position: "absolute", top: "12%", left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bee", border: "1px solid #60a5fa",
  borderRadius: 8, padding: "10px 16px",
  fontSize: 13, zIndex: 20, textAlign: "center",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};
