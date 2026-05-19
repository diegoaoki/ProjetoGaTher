import { useRef, useState, useCallback } from "react";

/**
 * Torna um painel arrastável pelo "handle" (ex: o header).
 *
 * Uso:
 *   const drag = useDraggable();
 *   <div style={{ ...panelStyle, ...drag.style }}>
 *     <div onPointerDown={drag.onHandlePointerDown} style={{cursor:"move"}}>…</div>
 *   </div>
 *
 * Move via `transform: translate(...)`, então funciona seja o painel
 * ancorado por top/left/right/bottom (não brigamos com o CSS existente).
 * Pointer events = mouse + toque. Ignora drag se clicar num <button>
 * (não atrapalha o ✕ de fechar nem os botões internos do header).
 */
export function useDraggable() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const onMove = useCallback((e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    setOffset({ x: s.ox + (e.clientX - s.px), y: s.oy + (e.clientY - s.py) });
  }, []);

  const onUp = useCallback(() => {
    start.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Não inicia drag ao clicar num botão dentro do handle (ex: ✕).
      if ((e.target as HTMLElement).closest("button")) return;
      start.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [offset.x, offset.y, onMove, onUp]
  );

  return {
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` } as React.CSSProperties,
    onHandlePointerDown,
  };
}
