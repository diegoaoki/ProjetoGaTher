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

/** Espelhar (scaleX -1) o próprio vídeo. Default: true (mais natural). */
export function getMirrorSelf(): boolean {
  return read(MIRROR_KEY) !== "0";
}
export function setMirrorSelf(on: boolean) {
  write(MIRROR_KEY, on ? "1" : "0");
}
