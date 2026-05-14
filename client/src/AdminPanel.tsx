import { useEffect, useState } from "react";
import { AdminUser, deleteUser, listUsers, resetUserPassword } from "./auth";

interface Props {
  httpUrl: string;
  token: string;
  currentUserId: string;
  onClose: () => void;
}

type ConfirmKind = { type: "reset"; user: AdminUser } | { type: "delete"; user: AdminUser } | null;

export default function AdminPanel({ httpUrl, token, currentUserId, onClose }: Props) {
  const [list, setList] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const users = await listUsers(httpUrl, token);
      setList(users);
    } catch (e: any) {
      setError(e?.message || "Falha ao listar usuários");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doReset() {
    if (!confirm || confirm.type !== "reset") return;
    if (newPassword.length < 8) {
      setError("Senha precisa ter ao menos 8 caracteres");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await resetUserPassword(httpUrl, token, confirm.user.id, newPassword);
      setToast(`Senha de ${confirm.user.email} alterada`);
      setConfirm(null);
      setNewPassword("");
    } catch (e: any) {
      setError(e?.message || "Falha ao resetar senha");
    } finally {
      setSubmitting(false);
    }
  }

  async function doDelete() {
    if (!confirm || confirm.type !== "delete") return;
    setSubmitting(true);
    setError("");
    try {
      await deleteUser(httpUrl, token, confirm.user.id);
      setToast(`${confirm.user.email} apagado`);
      setConfirm(null);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Falha ao apagar usuário");
    } finally {
      setSubmitting(false);
    }
  }

  // Limpa toast automaticamente
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div style={modalStyle} onClick={() => !submitting && !confirm && onClose()}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 20 }}>🛡️ Painel de administração</h2>
          <button onClick={onClose} style={closeBtnStyle} title="Fechar">✕</button>
        </div>

        {toast && <div style={toastStyle}>{toast}</div>}
        {error && <div style={errorBoxStyle}>{error}</div>}

        {loading ? (
          <p style={{ opacity: 0.7, textAlign: "center", padding: 20 }}>Carregando…</p>
        ) : (
          <div style={listWrapStyle}>
            <div style={{ ...rowStyle, ...headerRowStyle }}>
              <div style={{ flex: 2 }}>Email</div>
              <div style={{ flex: 1 }}>Nome</div>
              <div style={{ width: 180, textAlign: "right" }}>Ações</div>
            </div>
            {list.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <div key={u.id} style={rowStyle}>
                  <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.email}
                    {u.isAdmin && <span style={badgeStyle}>admin</span>}
                    {isSelf && <span style={{ ...badgeStyle, background: "#0e7490" }}>você</span>}
                  </div>
                  <div style={{ flex: 1, opacity: 0.8 }}>{u.displayName || "—"}</div>
                  <div style={{ width: 180, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => {
                        setNewPassword("");
                        setError("");
                        setConfirm({ type: "reset", user: u });
                      }}
                      style={actionBtnStyle("#2563eb")}
                      title="Resetar senha"
                    >
                      🔑
                    </button>
                    <button
                      onClick={() => {
                        setError("");
                        setConfirm({ type: "delete", user: u });
                      }}
                      style={{ ...actionBtnStyle("#b91c1c"), opacity: isSelf ? 0.4 : 1 }}
                      disabled={isSelf}
                      title={isSelf ? "Você não pode apagar a si mesmo" : "Apagar usuário"}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
            {list.length === 0 && <p style={{ opacity: 0.6, textAlign: "center", padding: 20 }}>Nenhum usuário</p>}
          </div>
        )}

        {/* Modal de confirmação: reset senha */}
        {confirm?.type === "reset" && (
          <div style={confirmOverlayStyle}>
            <div style={confirmCardStyle}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Resetar senha</h3>
              <p style={{ margin: "0 0 12px", opacity: 0.75, fontSize: 13 }}>
                Definindo nova senha para <strong>{confirm.user.email}</strong>.
              </p>
              <label style={labelStyle}>Nova senha (mínimo 8 chars)</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doReset()}
                style={inputStyle}
                disabled={submitting}
                autoFocus
                placeholder="Ex: nova-senha-temp"
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    setConfirm(null);
                    setNewPassword("");
                  }}
                  disabled={submitting}
                  style={{ ...primaryBtnStyle, background: "#334155", color: "#e2e8f0" }}
                >
                  Cancelar
                </button>
                <button onClick={doReset} disabled={submitting} style={primaryBtnStyle}>
                  {submitting ? "Salvando…" : "Resetar"}
                </button>
              </div>
              <p style={{ marginTop: 10, fontSize: 11, opacity: 0.55 }}>
                ⚠ Anota essa senha e manda pro usuário por outro canal. Não é mostrada de novo.
              </p>
            </div>
          </div>
        )}

        {/* Modal de confirmação: delete */}
        {confirm?.type === "delete" && (
          <div style={confirmOverlayStyle}>
            <div style={confirmCardStyle}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Apagar usuário</h3>
              <p style={{ margin: "0 0 12px", fontSize: 13 }}>
                Tem certeza que quer apagar <strong>{confirm.user.email}</strong>?<br />
                <span style={{ opacity: 0.7 }}>Essa ação não pode ser desfeita.</span>
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setConfirm(null)}
                  disabled={submitting}
                  style={{ ...primaryBtnStyle, background: "#334155", color: "#e2e8f0" }}
                >
                  Cancelar
                </button>
                <button onClick={doDelete} disabled={submitting} style={{ ...primaryBtnStyle, background: "#b91c1c", color: "#fff" }}>
                  {submitting ? "Apagando…" : "Apagar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const modalStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "#000c", zIndex: 100,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};
const panelStyle: React.CSSProperties = {
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 12, padding: 20, width: 720, maxWidth: "92vw",
  maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
  cursor: "default",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #334155",
};
const closeBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", color: "#e2e8f0",
  fontSize: 18, cursor: "pointer", padding: 4,
};
const listWrapStyle: React.CSSProperties = {
  overflowY: "auto", flex: 1,
};
const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "8px 6px", borderBottom: "1px solid #1f2937",
  fontSize: 13,
};
const headerRowStyle: React.CSSProperties = {
  fontWeight: 600, opacity: 0.7, fontSize: 11, textTransform: "uppercase",
};
const actionBtnStyle = (color: string): React.CSSProperties => ({
  padding: "4px 8px", borderRadius: 4, border: "none",
  background: color, color: "#fff", fontSize: 12, cursor: "pointer",
});
const badgeStyle: React.CSSProperties = {
  display: "inline-block", marginLeft: 8,
  background: "#7c3aed", color: "#fff", borderRadius: 4,
  padding: "1px 6px", fontSize: 10, fontWeight: 600,
};
const toastStyle: React.CSSProperties = {
  background: "#065f46", color: "#d1fae5",
  padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13,
};
const errorBoxStyle: React.CSSProperties = {
  background: "#7f1d1d", color: "#fee2e2",
  padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13,
};
const confirmOverlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0,
  background: "#000a", display: "flex",
  alignItems: "center", justifyContent: "center",
  borderRadius: 12,
};
const confirmCardStyle: React.CSSProperties = {
  background: "#0f172a", border: "1px solid #334155",
  borderRadius: 10, padding: 20, width: 380, maxWidth: "90%",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, marginBottom: 6, opacity: 0.7,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px",
  borderRadius: 6, border: "1px solid #334155",
  background: "#1e293b", color: "#e2e8f0",
  fontSize: 13, outline: "none", boxSizing: "border-box",
};
const primaryBtnStyle: React.CSSProperties = {
  flex: 1, padding: "8px 14px",
  borderRadius: 6, border: "none",
  background: "#4ade80", color: "#052e16",
  fontWeight: 600, fontSize: 13, cursor: "pointer",
};
