import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALLOWED_REACTIONS,
  ChatMessage,
  DmConversation,
  fetchDmConversations,
  fetchDmMessages,
  fetchGlobalMessages,
} from "./chat";

interface OnlinePeer {
  userId: string;
  name: string;
  isMe: boolean;
}

interface Props {
  httpUrl: string;
  token: string;
  myUserId: string;
  /** Lista de online peers — usada pra começar DM com alguém visível. */
  onlinePlayers: OnlinePeer[];
  /** Mensagens que o App.tsx recebe via Colyseus (real-time). Append em ordem. */
  liveMessages: ChatMessage[];
  /** Override de reações por messageId (atualizações em tempo real do server) */
  reactionsOverride: Map<string, Array<{ emoji: string; userIds: string[] }>>;
  /** Manda mensagem (delega pro App, que envia via room.send). */
  onSend: (channel: { type: "global" | "dm" | "room"; recipientId?: string }, content: string) => void;
  /** Toggle de reação numa mensagem persistida (global/DM). */
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Fecha o painel. */
  onClose: () => void;
  /** Chama quando o usuário visualiza msgs de um canal — pra App zerar o unread. */
  onChannelViewed: (channelKey: string) => void;
  /** Em mobile, ocupa a tela inteira. */
  mobile?: boolean;
}

type Tab = "global" | "room" | "dm";

export default function ChatPanel({
  httpUrl, token, myUserId, onlinePlayers, liveMessages, reactionsOverride, onSend, onToggleReaction, onClose, onChannelViewed, mobile,
}: Props) {
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);
  /**
   * Resolve userId → displayName com 3 níveis de fallback:
   *  1. Nome fornecido (do server, vem em senderName/otherName)
   *  2. Lista de online players (caso o user esteja conectado agora)
   *  3. UUID truncado (último recurso)
   *
   * Também aprende com liveMessages: se alguém te mandou DM antes e ainda
   * não está online, o nome dele foi enviado pelo server na payload — guarda
   * isso pra reuso.
   */
  const learnedNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of liveMessages) {
      if (m.senderId && m.senderName) map.set(m.senderId, m.senderName);
    }
    return map;
  }, [liveMessages]);

  function resolveName(userId: string, providedName?: string | null): string {
    if (providedName && providedName.trim()) return providedName;
    const online = onlinePlayers.find((p) => p.userId === userId);
    if (online?.name) return online.name;
    const learned = learnedNames.get(userId);
    if (learned) return learned;
    return userId.slice(0, 8);
  }

  const [tab, setTab] = useState<Tab>("global");
  const [globalHistory, setGlobalHistory] = useState<ChatMessage[]>([]);
  const [dmHistory, setDmHistory] = useState<Map<string, ChatMessage[]>>(new Map());
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [activeDmUserId, setActiveDmUserId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofoco no campo de mensagem ao abrir o chat e ao trocar de canal —
  // assim o usuário digita e o Enter já envia (sem o Enter global, que
  // abre/fecha o chat, interferir por falta de foco no input).
  useEffect(() => {
    if (tab === "dm" && !activeDmUserId) return; // input desabilitado
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [tab, activeDmUserId]);

  // === Histórico inicial ===
  useEffect(() => {
    fetchGlobalMessages(httpUrl, token).then(setGlobalHistory).catch(() => {});
    fetchDmConversations(httpUrl, token).then(setDmConversations).catch(() => {});
  }, [httpUrl, token]);

  // Quando abre uma conversa DM, carrega histórico
  useEffect(() => {
    if (tab !== "dm" || !activeDmUserId) return;
    if (dmHistory.has(activeDmUserId)) return; // já carregado
    setLoadingHistory(true);
    fetchDmMessages(httpUrl, token, activeDmUserId)
      .then((msgs) => {
        setDmHistory((prev) => {
          const next = new Map(prev);
          next.set(activeDmUserId, msgs);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [tab, activeDmUserId, httpUrl, token, dmHistory]);

  // === Mensagens visíveis na aba atual ===
  const visibleMessages = useMemo<ChatMessage[]>(() => {
    if (tab === "global") {
      const live = liveMessages.filter((m) => m.channelType === "global");
      // Merge sem duplicar (por id)
      const seen = new Set(globalHistory.map((m) => m.id));
      const fresh = live.filter((m) => !seen.has(m.id));
      return [...globalHistory, ...fresh];
    }
    if (tab === "room") {
      // Sala é efêmera — só liveMessages do tipo "room"
      return liveMessages.filter((m) => m.channelType === "room");
    }
    if (tab === "dm" && activeDmUserId) {
      const hist = dmHistory.get(activeDmUserId) || [];
      const live = liveMessages.filter(
        (m) =>
          m.channelType === "dm" &&
          ((m.senderId === activeDmUserId && m.recipientId === myUserId) ||
            (m.senderId === myUserId && m.recipientId === activeDmUserId))
      );
      const seen = new Set(hist.map((m) => m.id));
      const fresh = live.filter((m) => !seen.has(m.id));
      return [...hist, ...fresh];
    }
    return [];
  }, [tab, activeDmUserId, globalHistory, dmHistory, liveMessages, myUserId]);

  // Scroll automático pro final quando chega msg nova
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length]);

  // Marca channel como lido quando user visualiza
  useEffect(() => {
    if (tab === "global") onChannelViewed("global");
    else if (tab === "room") onChannelViewed("room");
    else if (tab === "dm" && activeDmUserId) onChannelViewed(`dm:${activeDmUserId}`);
  }, [tab, activeDmUserId, visibleMessages.length, onChannelViewed]);

  function submit() {
    const text = input.trim();
    if (!text) return;
    if (tab === "global") onSend({ type: "global" }, text);
    else if (tab === "room") onSend({ type: "room" }, text);
    else if (tab === "dm" && activeDmUserId) onSend({ type: "dm", recipientId: activeDmUserId }, text);
    else return;
    setInput("");
  }

  // Lista de peers pra começar uma DM nova (exclui o próprio user)
  const dmTargets = onlinePlayers.filter((p) => !p.isMe);

  // Conversas DM já existentes — combina backend + live (em caso de receber DM de alguém novo)
  const knownDms = useMemo(() => {
    const map = new Map<string, { userId: string; name: string; lastContent: string; lastAt: string }>();
    dmConversations.forEach((c) => {
      map.set(c.other_user, {
        userId: c.other_user,
        name: c.other_name || c.other_user.slice(0, 8),
        lastContent: c.content,
        lastAt: c.created_at,
      });
    });
    liveMessages
      .filter((m) => m.channelType === "dm")
      .forEach((m) => {
        const other = m.senderId === myUserId ? m.recipientId : m.senderId;
        if (!other) return;
        const existing = map.get(other);
        if (!existing || new Date(m.createdAt) > new Date(existing.lastAt)) {
          map.set(other, {
            userId: other,
            name: other === m.senderId ? m.senderName || other.slice(0, 8) : (existing?.name || other.slice(0, 8)),
            lastContent: m.content,
            lastAt: m.createdAt,
          });
        }
      });
    return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [dmConversations, liveMessages, myUserId]);

  return (
    <div style={mobile ? { ...panelStyle, width: "100vw", borderLeft: "none" } : panelStyle}>
      <div style={headerStyle}>
        <strong style={{ fontSize: 14 }}>💬 Chat</strong>
        <button onClick={onClose} style={closeBtnStyle} title="Fechar">✕</button>
      </div>

      <div style={tabsStyle}>
        <button
          onClick={() => setTab("global")}
          style={{ ...tabBtnStyle, ...(tab === "global" ? tabBtnActive : {}) }}
        >
          🌐 Geral
        </button>
        <button
          onClick={() => setTab("room")}
          style={{ ...tabBtnStyle, ...(tab === "room" ? tabBtnActive : {}) }}
        >
          📍 Aqui
        </button>
        <button
          onClick={() => setTab("dm")}
          style={{ ...tabBtnStyle, ...(tab === "dm" ? tabBtnActive : {}) }}
        >
          💌 DMs
        </button>
      </div>

      {tab === "dm" && !activeDmUserId && (
        <div style={dmListWrap}>
          <div style={dmSectionTitle}>Conversas</div>
          {knownDms.length === 0 && (
            <div style={emptyTextStyle}>Nenhuma DM ainda</div>
          )}
          {knownDms.map((c) => (
            <button
              key={c.userId}
              onClick={() => setActiveDmUserId(c.userId)}
              style={dmListItem}
            >
              <strong style={{ fontSize: 13 }}>{resolveName(c.userId, c.name)}</strong>
              <span style={dmLastMsg}>{c.lastContent.slice(0, 40)}</span>
            </button>
          ))}

          <div style={{ ...dmSectionTitle, marginTop: 12 }}>Iniciar com alguém online</div>
          {dmTargets.length === 0 && <div style={emptyTextStyle}>Ninguém mais online</div>}
          {dmTargets.map((p) => (
            <button
              key={p.userId}
              onClick={() => setActiveDmUserId(p.userId)}
              style={dmListItem}
            >
              <span style={{ fontSize: 13 }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {!(tab === "dm" && !activeDmUserId) && (
        <>
          {tab === "dm" && activeDmUserId && (
            <div style={dmHeaderStyle}>
              <button onClick={() => setActiveDmUserId(null)} style={backBtnStyle}>← voltar</button>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {resolveName(activeDmUserId, knownDms.find((d) => d.userId === activeDmUserId)?.name)}
              </span>
            </div>
          )}

          <div style={messagesAreaStyle}>
            {loadingHistory && <div style={emptyTextStyle}>Carregando…</div>}
            {!loadingHistory && visibleMessages.length === 0 && (
              <div style={emptyTextStyle}>
                {tab === "room"
                  ? "Mensagens da sala/proximidade aparecem aqui (não salvas)"
                  : "Nenhuma mensagem ainda"}
              </div>
            )}
            {visibleMessages.map((m) => {
              const mine = m.senderId === myUserId;
              // Reações só pra global/dm — mensagens efêmeras de sala não têm ID persistido
              const canReact = m.channelType === "global" || m.channelType === "dm";
              const reactions = reactionsOverride.get(m.id) || m.reactions || [];
              return (
                <div key={m.id} style={{ ...msgRowStyle, flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                  <div style={{ ...msgBubbleStyle, background: mine ? "#2563eb" : "#334155", position: "relative" }}>
                    {!mine && <div style={msgSenderStyle}>{resolveName(m.senderId, m.senderName)}</div>}
                    <div style={msgContentStyle}>{m.content}</div>
                    <div style={msgTimeStyle}>{formatTime(m.createdAt)}</div>
                    {canReact && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPickerOpenFor((cur) => (cur === m.id ? null : m.id));
                        }}
                        style={addReactionBtnStyle(mine)}
                        title="Reagir"
                      >
                        😊+
                      </button>
                    )}
                  </div>

                  {/* Picker de emoji */}
                  {pickerOpenFor === m.id && (
                    <div style={emojiPickerStyle}>
                      {ALLOWED_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleReaction(m.id, emoji);
                            setPickerOpenFor(null);
                          }}
                          style={emojiPickerBtnStyle}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Pills de reações existentes */}
                  {reactions.length > 0 && (
                    <div style={reactionsRowStyle}>
                      {reactions.map((r) => {
                        const reacted = r.userIds.includes(myUserId);
                        const names = r.userIds.map((uid) => resolveName(uid)).join(", ");
                        return (
                          <button
                            key={r.emoji}
                            onClick={() => onToggleReaction(m.id, r.emoji)}
                            style={{
                              ...reactionPillStyle,
                              background: reacted ? "#2563eb" : "#1e293b",
                              borderColor: reacted ? "#60a5fa" : "#334155",
                            }}
                            title={names}
                          >
                            <span>{r.emoji}</span>
                            <span style={{ fontSize: 11, marginLeft: 3 }}>{r.userIds.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div style={inputAreaStyle}>
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Impede que o Phaser receba a tecla (W/A/S/D/E/C move o avatar)
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              onKeyUp={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
              placeholder={tab === "dm" && !activeDmUserId ? "Selecione uma conversa" : "Digite uma mensagem…"}
              disabled={tab === "dm" && !activeDmUserId}
              style={inputStyle}
              maxLength={2000}
            />
            <button onClick={submit} disabled={tab === "dm" && !activeDmUserId} style={sendBtnStyle}>
              Enviar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const panelStyle: React.CSSProperties = {
  position: "absolute", top: 0, right: 0, bottom: 0,
  width: 340, background: "#0f172af0",
  borderLeft: "1px solid #334155",
  zIndex: 30, display: "flex", flexDirection: "column",
  boxShadow: "-4px 0 20px rgba(0,0,0,0.3)",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 14px", borderBottom: "1px solid #334155",
};
const closeBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", color: "#e2e8f0",
  fontSize: 16, cursor: "pointer", padding: 4,
};
const tabsStyle: React.CSSProperties = {
  display: "flex", gap: 4, padding: 8, borderBottom: "1px solid #334155",
};
const tabBtnStyle: React.CSSProperties = {
  flex: 1, padding: "6px 8px",
  background: "transparent", border: "1px solid #334155",
  color: "#94a3b8", fontSize: 12, cursor: "pointer", borderRadius: 6,
};
const tabBtnActive: React.CSSProperties = {
  background: "#334155", color: "#e2e8f0", borderColor: "#475569",
};
const messagesAreaStyle: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: 10,
  display: "flex", flexDirection: "column", gap: 6,
};
const emptyTextStyle: React.CSSProperties = {
  opacity: 0.5, textAlign: "center", padding: 20, fontSize: 12,
};
const msgRowStyle: React.CSSProperties = {
  display: "flex", width: "100%",
};
const msgBubbleStyle: React.CSSProperties = {
  maxWidth: "75%", padding: "6px 10px",
  borderRadius: 10, fontSize: 13,
  color: "#fff",
};
const msgSenderStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, opacity: 0.7, marginBottom: 2,
};
const msgContentStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap", wordBreak: "break-word",
};
const msgTimeStyle: React.CSSProperties = {
  fontSize: 9, opacity: 0.5, marginTop: 2, textAlign: "right",
};
const addReactionBtnStyle = (mine: boolean): React.CSSProperties => ({
  position: "absolute",
  top: -10,
  [mine ? "left" : "right"]: -8,
  background: "#0f172a",
  border: "1px solid #475569",
  borderRadius: 12,
  color: "#e2e8f0",
  fontSize: 10,
  padding: "1px 5px",
  cursor: "pointer",
  opacity: 0.7,
});
const emojiPickerStyle: React.CSSProperties = {
  display: "flex",
  gap: 2,
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 18,
  padding: 4,
  marginTop: 2,
  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
};
const emojiPickerBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 18,
  padding: "2px 6px",
  cursor: "pointer",
  borderRadius: 12,
};
const reactionsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flexWrap: "wrap",
  marginTop: 2,
};
const reactionPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid #334155",
  borderRadius: 12,
  padding: "1px 6px",
  color: "#e2e8f0",
  fontSize: 12,
  cursor: "pointer",
};
const inputAreaStyle: React.CSSProperties = {
  display: "flex", gap: 6, padding: 10,
  borderTop: "1px solid #334155",
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: "6px 10px",
  borderRadius: 6, border: "1px solid #334155",
  background: "#1e293b", color: "#e2e8f0",
  fontSize: 13, outline: "none",
};
const sendBtnStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 12, cursor: "pointer",
};
const dmListWrap: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: 10,
  display: "flex", flexDirection: "column", gap: 4,
};
const dmSectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, opacity: 0.6, textTransform: "uppercase",
  marginBottom: 4,
};
const dmListItem: React.CSSProperties = {
  textAlign: "left", padding: "8px 10px",
  background: "#1e293b", border: "1px solid #334155",
  color: "#e2e8f0", fontSize: 13, cursor: "pointer", borderRadius: 6,
  display: "flex", flexDirection: "column", gap: 2,
};
const dmLastMsg: React.CSSProperties = {
  fontSize: 11, opacity: 0.6,
};
const dmHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 12px", borderBottom: "1px solid #334155",
};
const backBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", color: "#60a5fa",
  fontSize: 12, cursor: "pointer", padding: 0,
};
