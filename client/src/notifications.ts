/**
 * Helpers de Web Notifications.
 *
 * Pra evitar atrapalhar o user, pede permissão só uma vez (cacheado em
 * localStorage). Se ele negar, não pede de novo.
 *
 * Notificações só disparam quando a aba NÃO está visível (document.hidden).
 * Caso contrário, o user já tá vendo o evento no app — duplicaria.
 */

const PERMISSION_ASKED_KEY = "virtual-office-notif-asked-v1";

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Pede permissão uma única vez (cacheado em localStorage).
 * Se já pediu antes, retorna o estado atual sem perguntar de novo.
 */
export async function requestNotificationPermissionOnce(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;

  try {
    const askedBefore = localStorage.getItem(PERMISSION_ASKED_KEY);
    if (askedBefore === "1") return Notification.permission;
  } catch {}

  try {
    const result = await Notification.requestPermission();
    try {
      localStorage.setItem(PERMISSION_ASKED_KEY, "1");
    } catch {}
    return result;
  } catch {
    return "denied";
  }
}

interface ShowOptions {
  title: string;
  body: string;
  tag?: string;       // permite "substituir" notifs anteriores com mesmo tag
  onClick?: () => void;
}

/**
 * Mostra uma notificação só se:
 *  1. Permissão concedida
 *  2. Aba está oculta (senão o user já tá vendo o evento)
 */
export function showNotificationIfHidden(opts: ShowOptions) {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;

  try {
    const notif = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: "/favicon.ico",
    });
    notif.onclick = () => {
      try { window.focus(); } catch {}
      try { notif.close(); } catch {}
      opts.onClick?.();
    };
    // Auto-close após 8s (algumas plataformas mantêm até clique)
    setTimeout(() => {
      try { notif.close(); } catch {}
    }, 8000);
  } catch (err) {
    console.warn("[notif] falha ao criar:", err);
  }
}
