import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import { OfficeScene } from "./OfficeScene";

function resolveServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;

  if (fromEnv) {
    let url = fromEnv.trim();
    if (url.startsWith("https://")) url = "wss://" + url.slice(8);
    else if (url.startsWith("http://")) url = "ws://" + url.slice(7);

    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("ws://")) {
      url = "wss://" + url.slice(5);
      console.warn("[ws] forçando wss:// pra evitar mixed content");
    }

    return url.replace(/\/+$/, "");
  }

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

  /**
   * Inicializa o Phaser DEPOIS que o React renderizou o container.
   * Roda quando 'conn' vira 'connected' (container já está no DOM com tamanho real).
   * Esperar um requestAnimationFrame garante que o browser fez layout/reflow.
   */
  useEffect(() => {
    if (conn !== "connected" || !roomRef.current || !containerRef.current) return;
    if (gameRef.current) return; // já criado

    const room = roomRef.current;
    const container = containerRef.current;

    // Garante que o container tem dimensões antes do Phaser inicializar
    const initPhaser = () => {
      // Pega tamanho real do container; fallback pro tamanho da viewport
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
        // Importante: desabilita FX que podem trigger o bug de framebuffer
        fps: { target: 60, forceSetTimeOut: false },
      });

      game.scene.start("OfficeScene", { room, myId: room.sessionId });
      gameRef.current = game;
    };

    // Pequeno delay garante que o layout do React já aconteceu
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(initPhaser);
    });

    return () => {
      cancelAnimationFrame(id);
    };
  }, [conn]);

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
      setPlayerCount(state.players.size);
      state.players.onAdd(() => setPlayerCount(state.players.size));
      state.players.onRemove(() => setPlayerCount(state.players.size));

      room.onLeave(() => {
        setConn("idle");
        setErrorMsg("Desconectado do servidor");
        if (gameRef.current) {
          gameRef.current.destroy(true);
          gameRef.current = null;
        }
      });

      setConn("connected");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Falha na conexão — verifique se o servidor está rodando");
      setConn("error");
    }
  }

  function disconnect() {
    roomRef.current?.leave();
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
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
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Container do Phaser - dimensões explícitas evitam o bug de framebuffer */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "#0f172a",
        }}
      />

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
  zIndex: 10,
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
  zIndex: 10,
};
