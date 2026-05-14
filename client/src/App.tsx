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
  const wsUrl = resolveServerUrl();
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice(6);
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice(5);
  return wsUrl;
}

const SERVER_URL = resolveServerUrl();
const HTTP_URL = resolveHttpUrl();

type ConnState = "idle" | "connecting" | "connected" | "error";

interface RemoteVideo {
  identity: string;
  element: HTMLVideoElement;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const roomRef = useRef<Room | null>(null);
  const spatialRef = useRef<SpatialAudio | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);

  const [conn, setConn] = useState<ConnState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioStatus, setAudioStatus] = useState<string>("");

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
      });

      game.scene.start("OfficeScene", { room, myId: room.sessionId });
      gameRef.current = game;

      // Pega referência da scene depois que ela inicia
      setTimeout(() => {
        const scene = game.scene.getScene("OfficeScene") as OfficeScene;
        sceneRef.current = scene;

        // Conecta callback de posições -> áudio espacial
        scene.onPositionsUpdate = (myPos, peerPositions) => {
          if (!spatialRef.current) return;

          // Mapeia sessionId -> identity (que é o que o LiveKit usa)
          // Identity = name + "__" + timestamp, então pegamos pelo prefixo do nome
          // Solução mais simples: cada participante remoto = um peer, mapeamos por ordem
          const peers = spatialRef.current.getPeerIdentities();
          const mapped = new Map<string, { x: number; y: number }>();

          // Mapeamento por nome: pega o player do state e casa com identity
          const state: any = room.state;
          peerPositions.forEach((pos, sessionId) => {
            const player = state.players.get(sessionId);
            if (!player) return;
            // Acha identity que comece com o nome desse player
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

    setConn("connecting");
    setErrorMsg("");

    try {
      // 1) Conecta no Colyseus
      const client = new Client(SERVER_URL);
      const room = await client.joinOrCreate("office", { name: name.trim() });
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

      // 2) Pega token do LiveKit
      setAudioStatus("Obtendo token de áudio...");
      const tokenResp = await fetch(HTTP_URL + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), room: "office" }),
      });

      if (!tokenResp.ok) {
        const errData = await tokenResp.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao obter token de áudio");
      }

      const { token, url } = await tokenResp.json();

      // 3) Conecta no LiveKit pra áudio/vídeo
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

      spatial.onPeerJoined = (identity) => {
        console.log("[app] peer entrou:", identity);
      };

      spatial.onPeerLeft = (identity) => {
        console.log("[app] peer saiu:", identity);
        setRemoteVideos((vs) => vs.filter((v) => v.identity !== identity));
      };

      spatial.onVideoTrack = (identity, element) => {
        element.style.width = "160px";
        element.style.height = "120px";
        element.style.objectFit = "cover";
        setRemoteVideos((vs) => [...vs.filter((v) => v.identity !== identity), { identity, element }]);
      };

      spatial.onPeerSpeaking = (identity, speaking) => {
        // Mapeia identity de volta pro sessionId pra mostrar anel no avatar
        const stateNow: any = room.state;
        let targetSessionId: string | null = null;
        stateNow.players.forEach((player: any, sessionId: string) => {
          if (identity.startsWith(player.name + "__")) targetSessionId = sessionId;
        });
        if (targetSessionId && sceneRef.current) {
          sceneRef.current.setRemoteSpeaking(targetSessionId, speaking);
        }
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

  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([]);

  // Anexa vídeos remotos ao container quando aparecem
  useEffect(() => {
    if (!videoContainerRef.current) return;
    const container = videoContainerRef.current;
    container.innerHTML = "";
    remoteVideos.forEach((rv) => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative;border:2px solid #334155;border-radius:8px;overflow:hidden;background:#000;";
      const label = document.createElement("div");
      label.textContent = rv.identity.split("__")[0];
      label.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:#000a;color:#fff;font-size:11px;padding:2px 6px;";
      wrapper.appendChild(rv.element);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  }, [remoteVideos]);

  // Anexa preview do vídeo local
  useEffect(() => {
    if (conn !== "connected" || !spatialRef.current || !localVideoRef.current) return;
    const tryAttach = () => {
      const el = spatialRef.current?.getLocalVideoElement();
      if (el && localVideoRef.current) {
        localVideoRef.current.innerHTML = "";
        el.style.width = "160px";
        el.style.height = "120px";
        el.style.objectFit = "cover";
        el.style.transform = "scaleX(-1)"; // espelha
        localVideoRef.current.appendChild(el);
      }
    };
    // Aguarda o track local ser publicado
    const t = setTimeout(tryAttach, 800);
    return () => clearTimeout(t);
  }, [conn, camOn]);

  function cleanupGame() {
    spatialRef.current?.disconnect();
    spatialRef.current = null;
    gameRef.current?.destroy(true);
    gameRef.current = null;
    setRemoteVideos([]);
  }

  function disconnect() {
    roomRef.current?.leave();
    cleanupGame();
    setConn("idle");
  }

  async function toggleMic() {
    if (!spatialRef.current) return;
    const newState = !micOn;
    setMicOn(newState);
    await spatialRef.current.setMicEnabled(newState);
  }

  async function toggleCam() {
    if (!spatialRef.current) return;
    const newState = !camOn;
    setCamOn(newState);
    await spatialRef.current.setCameraEnabled(newState);
  }

  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      spatialRef.current?.disconnect();
      gameRef.current?.destroy(true);
    };
  }, []);

  if (conn !== "connected") {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Virtual Office</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.7, fontSize: 14 }}>
            MVP — fase 2: áudio/vídeo espacial
          </p>

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

          <button onClick={connect} disabled={conn === "connecting"} style={buttonStyle}>
            {conn === "connecting" ? (audioStatus || "Conectando...") : "Entrar no escritório"}
          </button>

          {errorMsg && (
            <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{errorMsg}</p>
          )}

          <p style={{ marginTop: 16, fontSize: 11, opacity: 0.5 }}>
            ⚠ O navegador vai pedir acesso a microfone e câmera.
          </p>
          <p style={{ marginTop: 8, fontSize: 11, opacity: 0.4, wordBreak: "break-all" }}>
            <code>{SERVER_URL}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          background: "#0f172a",
        }}
      />

      {/* HUD principal */}
      <div style={hudStyle}>
        <div><strong>{name}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{playerCount} no escritório</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button onClick={toggleMic} style={iconBtnStyle(micOn)}>
            {micOn ? "🎤" : "🔇"}
          </button>
          <button onClick={toggleCam} style={iconBtnStyle(camOn)}>
            {camOn ? "📹" : "🚫"}
          </button>
          <button onClick={disconnect} style={{ ...iconBtnStyle(false), background: "#7f1d1d" }}>
            Sair
          </button>
        </div>
        {audioStatus && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, color: "#fbbf24" }}>{audioStatus}</div>}
      </div>

      {/* Preview do meu vídeo */}
      <div
        ref={localVideoRef}
        style={{
          position: "absolute",
          bottom: 16, right: 16,
          border: "2px solid #4ade80",
          borderRadius: 8,
          overflow: "hidden",
          background: "#000",
          zIndex: 10,
        }}
      />

      {/* Vídeos remotos */}
      <div
        ref={videoContainerRef}
        style={{
          position: "absolute",
          top: 16, right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 10,
        }}
      />

      <div style={hintStyle}>
        WASD ou setas • chegue perto pra conversar
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  width: "100vw", height: "100vh",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
};

const cardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 32, width: 360,
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
};

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, marginBottom: 6, opacity: 0.8 };

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px",
  borderRadius: 8, border: "1px solid #334155",
  background: "#0f172a", color: "#e2e8f0",
  fontSize: 14, outline: "none", marginBottom: 16,
};

const buttonStyle: React.CSSProperties = {
  width: "100%", padding: "10px 16px",
  borderRadius: 8, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 14, cursor: "pointer",
};

const iconBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "none",
  background: active ? "#334155" : "#1e293b",
  color: "#e2e8f0",
  fontSize: 14,
  cursor: "pointer",
  opacity: active ? 1 : 0.5,
});

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 16, left: 16,
  background: "#1e293bdd",
  border: "1px solid #334155",
  borderRadius: 8, padding: "10px 14px",
  fontSize: 13, zIndex: 10,
};

const hintStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 16, left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bdd",
  border: "1px solid #334155",
  borderRadius: 8, padding: "8px 14px",
  fontSize: 12, opacity: 0.8, zIndex: 10,
};
