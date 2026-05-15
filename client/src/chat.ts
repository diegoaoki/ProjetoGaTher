/**
 * Helpers de chat: fetch de histórico e tipos compartilhados.
 * Envio de mensagens é via Colyseus (room.send("chat:send", ...)).
 */

export interface ReactionAggregate {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  channelType: "global" | "dm" | "room";
  senderId: string;
  senderName: string | null;
  recipientId?: string | null;
  content: string;
  createdAt: string; // ISO timestamp
  reactions?: ReactionAggregate[];
}

export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

export interface DmConversation {
  // Identificadores
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
  other_user: string;
  other_name: string | null;
}

async function parseError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    return data?.error || `Erro ${resp.status}`;
  } catch {
    return `Erro ${resp.status}`;
  }
}

export async function fetchGlobalMessages(
  httpUrl: string,
  token: string,
  before?: string
): Promise<ChatMessage[]> {
  const url = new URL(httpUrl + "/messages/global");
  if (before) url.searchParams.set("before", before);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return (data.messages || []).map(normalizeMessage);
}

export async function fetchDmMessages(
  httpUrl: string,
  token: string,
  otherUserId: string,
  before?: string
): Promise<ChatMessage[]> {
  const url = new URL(httpUrl + `/messages/dm/${otherUserId}`);
  if (before) url.searchParams.set("before", before);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return (data.messages || []).map(normalizeMessage);
}

export async function fetchDmConversations(
  httpUrl: string,
  token: string
): Promise<DmConversation[]> {
  const resp = await fetch(httpUrl + "/messages/dm", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return data.conversations || [];
}

/** Normaliza a resposta da API pra ChatMessage (campos snake_case vs camel). */
function normalizeMessage(raw: any): ChatMessage {
  return {
    id: raw.id,
    channelType: raw.channelType || raw.channel_type || "global",
    senderId: raw.senderId || raw.sender_id,
    senderName: raw.senderName ?? raw.sender_name ?? null,
    recipientId: raw.recipientId ?? raw.recipient_id ?? null,
    content: raw.content,
    createdAt: typeof raw.createdAt === "string"
      ? raw.createdAt
      : typeof raw.created_at === "string"
        ? raw.created_at
        : new Date(raw.created_at).toISOString(),
    reactions: Array.isArray(raw.reactions) ? raw.reactions : [],
  };
}

/** Toca um beep curto via Web Audio (sem precisar de arquivo MP3). */
export function playNotificationBeep() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880; // tom A5
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 400);
  } catch (err) {
    // Áudio bloqueado pelo browser (autoplay policy) — silenciosamente ignora
  }
}
