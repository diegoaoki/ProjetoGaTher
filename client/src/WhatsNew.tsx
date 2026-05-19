/**
 * "Novidades da versão" — changelog amigável mostrado num modal.
 * Abre automaticamente 1x por versão (chave localStorage abaixo) e pelo
 * item de menu "✨ Novidades". App.tsx envolve em modalStyle/cardStyle.
 *
 * Pra anunciar uma nova versão: suba WHATSNEW_VERSION e adicione um
 * bloco no topo de CHANGELOG.
 */

/** Versão atual — bump junto com um novo bloco no CHANGELOG.
 *  É a chave do "já vi" no localStorage (auto-abre só 1x por versão). */
export const WHATSNEW_VERSION = "2026-05-19";
export const WHATSNEW_KEY = `virtual-office-whatsnew-${WHATSNEW_VERSION}`;

interface Release {
  version: string;
  date: string;
  items: string[];
}

const CHANGELOG: Release[] = [
  {
    version: "Atualização",
    date: "19/05/2026",
    items: [
      "🧑‍🎨 Editor de avatar por partes — monte seu personagem escolhendo corpo, roupa, cabelo (estilo + cor) e acessório no menu “🎨 Editar avatar”.",
      "🪑 Editar a sua mesa — clique na sua mesa reservada → “✏️ Editar mesa” pra trocar o modelo e adicionar decoração (monitor, planta, impressora).",
      "💺 Sentar — pare na cadeira/mesa e o avatar fica virado pra mesa.",
      "🔊 Áudio mais natural — no corredor você só ouve quem está do lado; numa mesa, só quem está na mesma mesa; as áreas (Financeiro, Dados…) são só demarcação (contam como corredor).",
      "📱 Chat responsivo no celular — tela cheia, sem o teclado cobrir o campo, alvos de toque maiores.",
      "🎥 Câmera e microfone começam desligados e ligam de primeira (sem mais aquele card preto / precisar clicar duas vezes).",
      "🖱️ Menu do avatar (botão direito) — “📢 Pedir pra vir aqui”, “📍 Ir até” e “🫧 Abrir bolha”.",
      "🛗 2º andar via escada rolante e 🛡️ guarda da segurança vigiando a porta.",
      "🐞 Vários bugs corrigidos (entrar/reconectar, chat de visitante, lista de online, etc.).",
    ],
  },
];

export default function WhatsNew({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>✨ Novidades</h2>
        <button
          onClick={onClose}
          title="Fechar"
          style={{
            background: "transparent", border: "none", color: "#94a3b8",
            fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
        {CHANGELOG.map((rel, i) => (
          <div key={i} style={{ marginBottom: i === CHANGELOG.length - 1 ? 0 : 16 }}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
              {rel.version} · {rel.date}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {rel.items.map((it, j) => (
                <li key={j} style={{ fontSize: 13, lineHeight: 1.45 }}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          marginTop: 16, width: "100%", background: "#2563eb", border: "none",
          color: "#fff", borderRadius: 8, padding: "10px 0", cursor: "pointer",
          fontSize: 14, fontWeight: 600,
        }}
      >
        Entendi
      </button>
    </div>
  );
}
