import { useEffect, useRef, useState } from "react";
import { playNotificationBeep } from "./chat";
import { SpatialAudio } from "./SpatialAudio";
import {
  getMicDeviceId,
  setMicDeviceId,
  getSpeakerDeviceId,
  setSpeakerDeviceId,
  getPeerGain,
  getMicGain,
  setMicGain,
  setPeerGain,
  getMirrorSelf,
  setMirrorSelf,
} from "./audioPrefs";

interface Props {
  /** Fecha o modal de teste. */
  onClose: () => void;
  /** Sessão de áudio ativa (quando aberto em jogo) — pra trocar device ao vivo. */
  spatial?: SpatialAudio | null;
  /** Avisa o App quando o usuário liga/desliga o espelhamento do vídeo. */
  onMirrorChange?: (mirror: boolean) => void;
}

const sinkIdSupported =
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype;

/**
 * Tela pré-conexão pra usuário testar mic, speaker e câmera antes de entrar.
 * Não obrigatório — só botões. Pra dispensar, clica em "Entrar no escritório".
 */
export default function AudioTestScreen({ onClose, spatial, onMirrorChange }: Props) {
  const [mirror, setMirror] = useState(getMirrorSelf());
  const [micLevel, setMicLevel] = useState(0);   // 0..1
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Seleção de dispositivos de áudio
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [spkDevices, setSpkDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState(getMicDeviceId());
  const [spkId, setSpkId] = useState(getSpeakerDeviceId());
  const [peerGain, setPeerGainState] = useState(getPeerGain());
  const [micGain, setMicGainState] = useState(getMicGain());

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(all.filter((d) => d.kind === "audioinput"));
      setSpkDevices(all.filter((d) => d.kind === "audiooutput"));
    } catch {
      /* enumerateDevices indisponível */
    }
  }

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, []);

  function changeMic(id: string) {
    setMicId(id);
    setMicDeviceId(id);
    spatial?.setMicDevice(id);
    if (micActive) {
      stopMicTest();
      // pequeno atraso pra a track anterior soltar antes de reabrir
      setTimeout(() => startMicTest(id, true), 120);
    }
  }
  function changeSpeaker(id: string) {
    setSpkId(id);
    setSpeakerDeviceId(id);
    spatial?.setSpeakerDevice(id);
  }
  function changePeerGain(v: number) {
    setPeerGainState(v);
    if (spatial) spatial.setPeerGain(v);
    else setPeerGain(v); // pré-jogo: só persiste, aplica ao conectar
  }
  function changeMicGain(v: number) {
    setMicGainState(v);
    if (spatial) spatial.setMicGain(v);
    else setMicGain(v); // pré-jogo: só persiste, aplica ao conectar
  }

  // Refs pra cleanup
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  async function startMicTest(overrideId?: string, force = false) {
    if (micActive && !force) return;
    setMicError("");
    try {
      const useId = overrideId !== undefined ? overrideId : micId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: useId ? { deviceId: { exact: useId } } : true,
      });
      audioStreamRef.current = stream;
      // Agora que houve permissão, os labels dos devices aparecem
      refreshDevices();
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
          <select
            value={micId}
            onChange={(e) => changeMic(e.target.value)}
            style={selectStyle}
          >
            <option value="">Microfone padrão do sistema</option>
            {micDevices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microfone ${i + 1}`}
              </option>
            ))}
          </select>
          <div style={levelTrackStyle}>
            <div style={{ ...levelFillStyle, width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <p style={hintTextStyle}>
            {micActive ? "Fale algo — a barra deve subir." : "Clique em testar e fale algo."}
          </p>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>Ganho do microfone</span>
              <strong>{Math.round(micGain * 100)}%</strong>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={micGain}
              onChange={(e) => changeMicGain(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
            <p style={hintTextStyle}>
              Acima de 100% amplifica sua voz (pra quando ficam te ouvindo baixo).
            </p>
          </div>
          {micError && <p style={errorTextStyle}>{micError}</p>}
        </div>

        {/* === Som / Speaker === */}
        <div style={sectionStyle}>
          <div style={sectionHeader}>
            <strong style={{ fontSize: 14 }}>🔊 Som</strong>
            <button onClick={() => playNotificationBeep()} style={smallBtnStyle}>Tocar beep</button>
          </div>
          {sinkIdSupported && spkDevices.length > 0 ? (
            <select
              value={spkId}
              onChange={(e) => changeSpeaker(e.target.value)}
              style={selectStyle}
            >
              <option value="">Saída padrão do sistema</option>
              {spkDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Alto-falante ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <p style={hintTextStyle}>
              Seleção de saída não suportada neste navegador — use as configs do sistema.
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>Volume dos outros (peers)</span>
              <strong>{Math.round(peerGain * 100)}%</strong>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={peerGain}
              onChange={(e) => changePeerGain(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
            <p style={hintTextStyle}>
              Acima de 100% amplifica (pra quando os outros estão baixos).
            </p>
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
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ ...cameraVideoStyle, transform: mirror ? "scaleX(-1)" : "none" }}
              />
            ) : (
              <p style={{ ...hintTextStyle, margin: 0 }}>Preview aparece aqui após testar</p>
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={mirror}
              onChange={(e) => {
                const v = e.target.checked;
                setMirror(v);
                setMirrorSelf(v);
                onMirrorChange?.(v);
              }}
            />
            Espelhar meu vídeo (como num espelho)
          </label>
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
  position: "fixed", inset: 0,
  width: "100vw", height: "100vh",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "#0f172af2",
  overflowY: "auto", padding: 16,
  zIndex: 100,
  backdropFilter: "blur(4px)",
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
const selectStyle: React.CSSProperties = {
  width: "100%", margin: "2px 0 8px",
  padding: "6px 8px", borderRadius: 6,
  background: "#1e293b", color: "#e2e8f0",
  border: "1px solid #334155", fontSize: 12,
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
