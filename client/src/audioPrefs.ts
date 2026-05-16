/**
 * Preferências de dispositivo de áudio (microfone de entrada e saída),
 * persistidas em localStorage. "" = padrão do sistema.
 */

const MIC_KEY = "vo-mic-device-v1";
const SPK_KEY = "vo-spk-device-v1";
const PEER_GAIN_KEY = "vo-peer-gain-v1";

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
