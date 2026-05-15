import { useEffect, useRef, useState } from "react";
import { playNotificationBeep } from "./chat";

interface Props {
  /** Fecha o modal de teste. */
  onClose: () => void;
}

/**
 * Tela pré-conexão pra usuário testar mic, speaker e câmera antes de entrar.
 * Não obrigatório — só botões. Pra dispensar, clica em "Entrar no escritório".
 */
export default function AudioTestScreen({ onClose }: Props) {
  const [micLevel, setMicLevel] = useState(0);   // 0..1
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Refs pra cleanup
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  async function startMicTest() {
    if (micActive) return;
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        // Calcula RMS (0..1)
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel(Math.min(1, rms * 4)); // amplificado pra ficar visível
        animRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMicActive(true);
    } catch (e: any) {
      setMicError(e?.message || "Não consegui acessar o microfone");
    }
  }

  function stopMicTest() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    setMicLevel(0);
    setMicActive(false);
  }

  async function startCameraTest() {
    if (cameraActive) return;
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (e: any) {
      setCameraError(e?.message || "Não consegui acessar a câmera");
    }
  }

  function stopCameraTest() {
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      stopMicTest();
      stopCameraTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    stopMicTest();
    stopCameraTest();
    onClose();
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>🎧 Teste seu áudio e vídeo</h1>
        <p style={{ margin: "0 0 18px", fontSize: 13, opacity: 0.7 }}>
          Antes de entrar, confirme que tudo está funcionando. Opcional — pode pular.
        </p>

        {/* === Microfone === */}
        <div style={sectionStyle}>
          <div style={sectionHeader}>
            <strong style={{ fontSize: 14 }}>🎤 Microfone</strong>
            {!micActive ? (
              <button onClick={startMicTest} style={smallBtnStyle}>Testar</button>
            ) : (
              <button onClick={stopMicTest} style={{ ...smallBtnStyle, background: "#7f1d1d" }}>Parar</button>
            )}
          </div>
          <div style={levelTrackStyle}>
            <div style={{ ...levelFillStyle, width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <p style={hintTextStyle}>
            {micActive ? "Fale algo — a barra deve subir." : "Clique em testar e fale algo."}
          </p>
          {micError && <p style={errorTextStyle}>{micError}</p>}
        </div>

        {/* === Som / Speaker === */}
        <div style={sectionStyle}>
          <div style={sectionHeader}>
            <strong style={{ fontSize: 14 }}>🔊 Som</strong>
            <button onClick={() => playNotificationBeep()} style={smallBtnStyle}>Tocar beep</button>
          </div>
          <p style={hintTextStyle}>
            Você deve ouvir um som curto. Se não, ajuste o volume do seu dispositivo.
          </p>
        </div>

        {/* === Câmera === */}
        <div style={sectionStyle}>
          <div style={sectionHeader}>
            <strong style={{ fontSize: 14 }}>📹 Câmera</strong>
            {!cameraActive ? (
              <button onClick={startCameraTest} style={smallBtnStyle}>Testar</button>
            ) : (
              <button onClick={stopCameraTest} style={{ ...smallBtnStyle, background: "#7f1d1d" }}>Parar</button>
            )}
          </div>
          <div style={cameraPreviewWrap}>
            {cameraActive ? (
              <video ref={videoRef} muted playsInline style={cameraVideoStyle} />
            ) : (
              <p style={{ ...hintTextStyle, margin: 0 }}>Preview aparece aqui após testar</p>
            )}
          </div>
          {cameraError && <p style={errorTextStyle}>{cameraError}</p>}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={close} style={primaryBtnStyle}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  width: "100vw", height: "100vh",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg, #0f172a, #1e293b)",
  overflowY: "auto", padding: 16,
};
const cardStyle: React.CSSProperties = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 12, padding: 24, width: 420, maxWidth: "100%",
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
};
const sectionStyle: React.CSSProperties = {
  background: "#0f172a", borderRadius: 8,
  padding: 12, marginBottom: 10,
  border: "1px solid #334155",
};
const sectionHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  marginBottom: 6,
};
const smallBtnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 12, cursor: "pointer",
};
const levelTrackStyle: React.CSSProperties = {
  width: "100%", height: 8,
  background: "#1e293b", borderRadius: 4, overflow: "hidden",
  border: "1px solid #334155",
};
const levelFillStyle: React.CSSProperties = {
  height: "100%", background: "linear-gradient(90deg, #4ade80, #fbbf24, #ef4444)",
  transition: "width 50ms linear",
};
const hintTextStyle: React.CSSProperties = {
  margin: "6px 0 0", fontSize: 11, opacity: 0.7,
};
const errorTextStyle: React.CSSProperties = {
  margin: "6px 0 0", fontSize: 11, color: "#f87171",
};
const cameraPreviewWrap: React.CSSProperties = {
  background: "#000", borderRadius: 6, overflow: "hidden",
  minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center",
};
const cameraVideoStyle: React.CSSProperties = {
  width: "100%", height: "auto", maxHeight: 180,
  objectFit: "contain", display: "block", transform: "scaleX(-1)",
};
const primaryBtnStyle: React.CSSProperties = {
  flex: 1, padding: "10px 14px",
  borderRadius: 8, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 14, cursor: "pointer",
};
