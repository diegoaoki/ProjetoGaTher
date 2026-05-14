import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import { OfficeScene } from "./OfficeScene";
import { SpatialAudio } from "./SpatialAudio";

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

interface RemoteVideo {
  identity: string;
  element: HTMLVideoElement;
  type: "camera" | "screen";
}

interface ActiveScreenShare {
  identity: string;
  stream: MediaStream;
}

const STORAGE_KEY = "virtual-office-profile-v1";

interface SavedProfile {
  name: string;
  bodyColor: string;
  hairColor: string;
}

function loadProfile(): Partial<SavedProfile> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProfile(p: SavedProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

/** Tenta dar play em um vídeo, ignorando AbortError (que é benigno) */
function safePlay(video: HTMLVideoElement) {
  const p = video.play();
  if (p && typeof p.catch === "function") {
    p.catch((err) => {
      // AbortError acontece quando o vídeo é destruído antes do play resolver — é OK
      if (err?.name !== "AbortError") {
        console.warn("[play] falhou:", err);
      }
    });
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const fullscreenVideoRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const roomRef = useRef<Room | null>(null);
  const spatialRef = useRef<SpatialAudio | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);

  const saved = loadProfile();
  const [conn, setConn] = useState<ConnState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [name, setName] = useState(saved.name || "");
  const [bodyColor, setBodyColor] = useState(saved.bodyColor || SHIRT_COLORS[0]);
  const [hairColor, setHairColor] = useState(saved.hairColor || HAIR_COLORS[0]);
  const [playerCount, setPlayerCount] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([]);
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(null);
  const [fullscreenStream, setFullscreenStream] = useState<MediaStream | null>(null);

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

        scene.onPositionsUpdate = (myPos, peerPositions) => {
          if (!spatialRef.current) return;
          const peers = spatialRef.current.getPeerIdentities();
          const mapped = new Map<string, { x: number; y: number }>();
          const state: any = room.state;
          peerPositions.forEach((pos, sessionId) => {
            const player = state.players.get(sessionId);
            if (!player) return;
            const identity = peers.find((id) => id.startsWith(player.name + "__"));
            if (identity) mapped.set(identity, pos);
          });
          spatialRef.current.updateVolumes(myPos, mapped);
        };
      }, 100);
    };

    const id = requestAnimationFrame(() => requestAnimationFrame(initPhaser));
    return () => cancelAnimationFrame(id);
  }, [conn]);

  async function connect() {
    if (!name.trim()) {
      setErrorMsg("Digite seu nome");
      return;
    }

    saveProfile({ name: name.trim(), bodyColor, hairColor });

    setConn("connecting");
    setErrorMsg("");

    try {
      const client = new Client(SERVER_URL);
      const room = await client.joinOrCreate("office", {
        name: name.trim(),
        color: bodyColor,
        hairColor,
      });
      roomRef.current = room;

      const state: any = room.state;
      setPlayerCount(state.players.size);
      state.players.onAdd(() => setPlayerCount(state.players.size));
      state.players.onRemove(() => setPlayerCount(state.players.size));

      room.onLeave(() => {
        setConn("idle");
        setErrorMsg("Desconectado do servidor");
        cleanupGame();
      });

      setAudioStatus("Obtendo token de áudio...");
      const tokenResp = await fetch(HTTP_URL + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), room: "office" }),
      });

      if (!tokenResp.ok) {
        const errData = await tokenResp.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao obter token");
      }

      const { token, url } = await tokenResp.json();

      setAudioStatus("Conectando áudio espacial...");
      const spatial = new SpatialAudio({
        serverUrl: url,
        token,
        identity: name.trim(),
        enableVideo: true,
        hearingNearRadius: 150,
        hearingFarRadius: 400,
      });

      spatial.onError = (msg) => setAudioStatus("⚠ " + msg);
      spatial.onPeerLeft = (identity) => {
        setRemoteVideos((vs) => vs.filter((v) => v.identity !== identity));
        setActiveScreenShare((cur) => (cur?.identity === identity ? null : cur));
      };

      spatial.onCameraTrack = (identity, element) => {
        element.style.width = "160px";
        element.style.height = "120px";
        element.style.objectFit = "cover";
        setRemoteVideos((vs) => [
          ...vs.filter((v) => !(v.identity === identity && v.type === "camera")),
          { identity, element, type: "camera" },
        ]);
      };

      spatial.onScreenShareStarted = (identity, element) => {
        console.log("[app] screen share começou:", identity);
        const stream = element.srcObject as MediaStream;
        if (!stream) {
          console.warn("[app] screen share sem stream");
          return;
        }
        setActiveScreenShare({ identity, stream });

        if (sceneRef.current) {
          sceneRef.current.showScreenShareOnTV(stream);
        }
      };

      spatial.onScreenShareStopped = (identity) => {
        console.log("[app] screen share parou:", identity);
        setActiveScreenShare((cur) => (cur?.identity === identity ? null : cur));
        if (sceneRef.current) sceneRef.current.hideScreenShareFromTV();
        setFullscreenStream(null);
      };

      spatial.onPeerSpeaking = (identity, speaking) => {
        const stateNow: any = room.state;
        let target: string | null = null;
        stateNow.players.forEach((player: any, sessionId: string) => {
          if (identity.startsWith(player.name + "__")) target = sessionId;
        });
        if (target && sceneRef.current) sceneRef.current.setRemoteSpeaking(target, speaking);
      };

      spatialRef.current = spatial;
      setAudioStatus("");
      setConn("connected");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Falha na conexão");
      setConn("error");
    }
  }

  useEffect(() => {
    if (!videoContainerRef.current) return;
    const c = videoContainerRef.current;
    c.innerHTML = "";
    remoteVideos
      .filter((v) => v.type === "camera")
      .forEach((rv) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;border:2px solid #334155;border-radius:8px;overflow:hidden;background:#000;";
        const lbl = document.createElement("div");
        lbl.textContent = rv.identity.split("__")[0];
        lbl.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:#000a;color:#fff;font-size:11px;padding:2px 6px;";
        wrap.appendChild(rv.element);
        wrap.appendChild(lbl);
        c.appendChild(wrap);
      });
  }, [remoteVideos]);

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

  // Modal fullscreen
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
    setRemoteVideos([]);
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

  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      spatialRef.current?.disconnect();
      gameRef.current?.destroy(true);
    };
  }, []);

  const avatarPreviewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (conn === "connected") return;
    if (!avatarPreviewRef.current) return;
    drawAvatarPreview(avatarPreviewRef.current, bodyColor, hairColor);
  }, [bodyColor, hairColor, conn]);

  if (conn !== "connected") {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Virtual Office</h1>
          <p style={{ margin: "0 0 20px", opacity: 0.7, fontSize: 14 }}>
            Customize seu avatar e entre
          </p>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <canvas
              ref={avatarPreviewRef}
              width={64}
              height={80}
              style={{
                imageRendering: "pixelated",
                width: 96,
                height: 120,
                background: "#0f172a",
                borderRadius: 8,
                border: "1px solid #334155",
                padding: 8,
              }}
            />
          </div>

          <label style={labelStyle}>Seu nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            placeholder="Ex: Maria"
            style={inputStyle}
            disabled={conn === "connecting"}
            maxLength={24}
            autoFocus
          />

          <label style={labelStyle}>Camisa</label>
          <div style={paletteStyle}>
            {SHIRT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setBodyColor(c)}
                style={{
                  ...swatchStyle, background: c,
                  outline: bodyColor === c ? "2px solid #fff" : "none",
                  outlineOffset: 2,
                }}
                title={c}
              />
            ))}
          </div>

          <label style={labelStyle}>Cabelo</label>
          <div style={paletteStyle}>
            {HAIR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setHairColor(c)}
                style={{
                  ...swatchStyle, background: c,
                  outline: hairColor === c ? "2px solid #fff" : "none",
                  outlineOffset: 2,
                }}
                title={c}
              />
            ))}
          </div>

          <button onClick={connect} disabled={conn === "connecting"} style={{ ...buttonStyle, marginTop: 16 }}>
            {conn === "connecting" ? (audioStatus || "Conectando...") : "Entrar no escritório"}
          </button>

          {errorMsg && <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{errorMsg}</p>}
          <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5 }}>⚠ Vai pedir acesso a microfone e câmera.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, width: "100vw", height: "100vh", background: "#0f172a" }} />

      <div style={hudStyle}>
        <div><strong>{name}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{playerCount} no escritório</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={toggleMic} style={iconBtnStyle(micOn)} title="Microfone">{micOn ? "🎤" : "🔇"}</button>
          <button onClick={toggleCam} style={iconBtnStyle(camOn)} title="Câmera">{camOn ? "📹" : "🚫"}</button>
          <button onClick={toggleScreen} style={iconBtnStyle(screenOn)} title="Compartilhar tela">{screenOn ? "🛑" : "🖥️"}</button>
          <button onClick={disconnect} style={{ ...iconBtnStyle(false), background: "#7f1d1d" }}>Sair</button>
        </div>
        {audioStatus && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, color: "#fbbf24" }}>{audioStatus}</div>}
      </div>

      {activeScreenShare && (
        <div style={zoneIndicatorStyle}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            🖥️ {activeScreenShare.identity.split("__")[0]} está compartilhando tela
          </div>
          <button
            onClick={() => setFullscreenStream(activeScreenShare.stream)}
            style={{ ...buttonStyle, marginTop: 6, padding: "6px 10px", fontSize: 12 }}
          >
            Expandir em tela cheia
          </button>
        </div>
      )}

      <div ref={localVideoRef} style={{
        position: "absolute", bottom: 16, right: 16,
        border: "2px solid #4ade80", borderRadius: 8, overflow: "hidden",
        background: "#000", zIndex: 10,
      }} />

      <div ref={videoContainerRef} style={{
        position: "absolute", top: 16, right: 16,
        display: "flex", flexDirection: "column", gap: 8, zIndex: 10,
      }} />

      <div style={hintStyle}>WASD/setas • chegue perto pra conversar • aproxime da TV pra ver apresentações</div>

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
    </div>
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
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px",
  borderRadius: 8, border: "1px solid #334155",
  background: "#0f172a", color: "#e2e8f0",
  fontSize: 14, outline: "none",
};
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
