/**
 * Preferências de dispositivo de áudio (microfone de entrada e saída),
 * persistidas em localStorage. "" = padrão do sistema.
 */

const MIC_KEY = "vo-mic-device-v1";
const SPK_KEY = "vo-spk-device-v1";
const PEER_GAIN_KEY = "vo-peer-gain-v1";
const MIRROR_KEY = "vo-mirror-self-v1";
const MIC_GAIN_KEY = "vo-mic-gain-v1";

function read(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function write(key: string, val: string) {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch {
    /* localStorage indisponível — ignora */
  }
}

export function getMicDeviceId(): string {
  return read(MIC_KEY);
}
export function setMicDeviceId(id: string) {
  write(MIC_KEY, id);
}
export function getSpeakerDeviceId(): string {
  return read(SPK_KEY);
}
export function setSpeakerDeviceId(id: string) {
  write(SPK_KEY, id);
}

/** Ganho de saída (peers). 1 = normal; pode passar de 1 (Web Audio). */
export function getPeerGain(): number {
  const v = parseFloat(read(PEER_GAIN_KEY));
  return Number.isFinite(v) && v >= 0 ? v : 1;
}
export function setPeerGain(v: number) {
  write(PEER_GAIN_KEY, String(v));
}

/** Ganho do microfone (entrada). 1 = normal; pode passar de 1. */
export function getMicGain(): number {
  const v = parseFloat(read(MIC_GAIN_KEY));
  return Number.isFinite(v) && v >= 0 ? v : 1;
}
export function setMicGain(v: number) {
  write(MIC_GAIN_KEY, String(v));
}

/**
 * Volume individual por pessoa, multiplicador sobre o ganho master.
 * Chaveado por userId (estável entre sessões, ao contrário da identity
 * do LiveKit que carrega timestamp). 1 = normal; 0 = mudo; até 2.
 */
const PEER_VOL_KEY = "vo-peer-vol-v1";

function readPeerVolMap(): Record<string, number> {
  try {
    const raw = read(PEER_VOL_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
export function getPeerVolume(userId: string): number {
  const v = readPeerVolMap()[userId];
  return Number.isFinite(v) && v >= 0 ? v : 1;
}
export function setPeerVolume(userId: string, v: number) {
  if (!userId) return;
  const map = readPeerVolMap();
  if (v === 1) delete map[userId]; // default não ocupa espaço
  else map[userId] = v;
  try {
    const keys = Object.keys(map);
    if (keys.length) localStorage.setItem(PEER_VOL_KEY, JSON.stringify(map));
    else localStorage.removeItem(PEER_VOL_KEY);
  } catch {
    /* localStorage indisponível — ignora */
  }
}

/** Espelhar (scaleX -1) o próprio vídeo. Default: true (mais natural). */
export function getMirrorSelf(): boolean {
  return read(MIRROR_KEY) !== "0";
}
export function setMirrorSelf(on: boolean) {
  write(MIRROR_KEY, on ? "1" : "0");
}
