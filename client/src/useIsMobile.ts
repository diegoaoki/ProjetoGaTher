import { useEffect, useState } from "react";

/**
 * Detecta se o user está em mobile. Critério: largura <= 768px E dispositivo
 * de toque (pointer: coarse). Pega celular + tablet, evita falso positivo
 * em laptop com touchscreen e em tela pequena de desktop.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => check());
  useEffect(() => {
    const onResize = () => setIsMobile(check());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return isMobile;
}

function check(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth <= 768;
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  return narrow && coarse;
}
