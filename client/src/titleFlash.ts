/**
 * Pisca o título da aba quando chega uma notificação (mensagem, convite,
 * chamada) e a janela NÃO está em foco — pra chamar atenção em outra aba.
 * Para sozinho e restaura o título quando o usuário volta pra aba.
 *
 * O título-base é capturado no load do módulo (vem do index.html), então
 * o piscar nunca "congela" um título já alternado.
 */

const baseTitle = typeof document !== "undefined" ? document.title : "";
let timer: number | null = null;
let listening = false;

function stop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (baseTitle && typeof document !== "undefined") document.title = baseTitle;
}

function focused(): boolean {
  return !document.hidden && document.hasFocus();
}

function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const onBack = () => { if (focused()) stop(); };
  window.addEventListener("focus", onBack);
  document.addEventListener("visibilitychange", onBack);
}

/** Começa a piscar o título com `label` (só se a aba estiver fora de
 *  foco). Chamadas repetidas trocam a mensagem. */
export function flashTitle(label: string) {
  if (typeof document === "undefined") return;
  ensureListeners();
  // Já está olhando a aba → não precisa piscar (toast/notificação cobrem).
  if (focused()) return;
  if (timer !== null) clearInterval(timer);
  let on = false;
  timer = window.setInterval(() => {
    on = !on;
    document.title = on ? label : baseTitle;
  }, 1000);
  document.title = label; // feedback imediato
}
