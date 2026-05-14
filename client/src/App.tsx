import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import { OfficeScene } from "./OfficeScene";

/**
 * Resolve a URL do servidor de forma inteligente:
 *
 * 1. Se VITE_SERVER_URL estiver definida no build, usa ela (e ajusta o protocolo
 *    se preciso pra evitar mixed content).
 * 2. Caso contrário, em dev usa ws://localhost:2567.
 *
 * Regra do navegador: se a página é https, o WebSocket DEVE ser wss.
 */
function resolveServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;

  if (fromEnv) {
    // Se passaram https://... ou http://..., converte pra wss/ws
    let url = fromEnv.trim();
    if (url.startsWith("https://")) url = "wss://" + url.slice(8);
    else if (url.startsWith("http://")) url = "ws://" + url.slice(7);

    // Se a página é HTTPS mas alguém configurou ws://, força wss:// pra evitar mixed content
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("ws://")) {
      url = "wss://" + url.slice(5);
      console.warn("[ws] forçando wss:// pra evitar mixed content");
    }

    return url.replace(/\/+$/, ""); // remove trailing slash
  }

  // Default dev
  return "ws://localhost:2567";
}

const SERVER_URL = resolveServerUrl();

type ConnState = "idle" | "connecting" | "connected" | "error";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const roomRef = useRef<Room | null>(null);

  const [conn, setConn] = useState<ConnState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(0);

  async function connect() {
    if (!name.trim()) {
      setErrorMsg("Digite seu nome");
      return;
    }

    setConn("connecting");
    setErrorMsg("");

    try {
      const client = new Client(SERVER_URL);
      const room = await client.joinOrCreate("office", { name: name.trim() });
      roomRef.current = room;

      const state: any = room.state;
      state.players.onAdd(() => setPlayerCount(state.players.size));
      state.players.onRemove(() => setPlayerCount(state.players.size));

      room.onLeave(() => {
        setConn("idle");
        setErrorMsg("Desconectado do servidor");
        gameRef.current?.destroy(true);
        gameRef.current = null;
      });

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current!,
        backgroundColor: "#0f172a",
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [OfficeScene],
        physics: { default: "arcade" },
        render: { antialias: true, pixelArt: false },
      });

      game.scene.start("OfficeScene", { room, myId: room.sessionId });
      gameRef.current = game;
      setConn("connected");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Falha na conexão — verifique se o servidor está rodando");
      setConn("error");
    }
  }

  function disconnect() {
    roomRef.current?.leave();
    gameRef.current?.destroy(true);
    gameRef.current = null;
    setConn("idle");
  }

  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      gameRef.current?.destroy(true);
    };
  }, []);

  if (conn !== "connected") {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Virtual Office</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.7, fontSize: 14 }}>
            MVP — fase 1: mundo 2D multiplayer
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
            {conn === "connecting" ? "Conectando..." : "Entrar no escritório"}
          </button>

          {errorMsg && (
            <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{errorMsg}</p>
          )}

          <p style={{ marginTop: 24, fontSize: 12, opacity: 0.5, wordBreak: "break-all" }}>
            Servidor: <code>{SERVER_URL}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      <div style={hudStyle}>
        <div><strong>{name}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{playerCount} no escritório</div>
        <button onClick={disconnect} style={{ ...buttonStyle, padding: "6px 12px", fontSize: 12, marginTop: 8 }}>
          Sair
        </button>
      </div>

      <div style={hintStyle}>
        WASD ou setas para mover
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
};

const cardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 32,
  width: 360,
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  marginBottom: 6,
  opacity: 0.8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 14,
  outline: "none",
  marginBottom: 16,
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#4ade80",
  color: "#052e16",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  background: "#1e293bdd",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
};

const hintStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  background: "#1e293bdd",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12,
  opacity: 0.8,
};
