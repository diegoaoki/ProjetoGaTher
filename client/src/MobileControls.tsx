import { useEffect, useRef, useState } from "react";

interface Props {
  /** Chamado quando o joystick move. (0,0) = parado. Magnitude até 1. */
  onMove: (x: number, y: number) => void;
  /** Chamado quando o usuário toca no botão E (reservar/liberar mesa). */
  onAction: () => void;
  /** Chamado quando o usuário toca no botão G (conversa de mesa / fantasma). */
  onGhost: () => void;
}

const STICK_RADIUS = 60;     // raio do círculo externo
const KNOB_RADIUS = 24;      // raio do bolinha interna
const STICK_MARGIN = 24;     // distância da borda

/**
 * Controles touch para mobile:
 *  - Joystick virtual à esquerda inferior (move o avatar)
 *  - Botão E grande à direita inferior (interage com mesa)
 *
 * Joystick captura touchstart/move/end e emite x/y normalizado (-1..1).
 * Outros toques fora dos controles passam pelo Phaser normalmente.
 */
export default function MobileControls({ onMove, onAction, onGhost }: Props) {
  const stickRef = useRef<HTMLDivElement>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeTouchId = useRef<number | null>(null);

  useEffect(() => {
    const el = stickRef.current;
    if (!el) return;

    function startTouch(e: TouchEvent) {
      if (activeTouchId.current !== null) return;
      const touch = e.changedTouches[0];
      activeTouchId.current = touch.identifier;
      e.preventDefault();
      moveKnob(touch);
    }
    function moveTouch(e: TouchEvent) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === activeTouchId.current) {
          e.preventDefault();
          moveKnob(t);
          return;
        }
      }
    }
    function endTouch(e: TouchEvent) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === activeTouchId.current) {
          activeTouchId.current = null;
          setKnobOffset({ x: 0, y: 0 });
          onMove(0, 0);
          return;
        }
      }
    }
    function moveKnob(touch: Touch) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = touch.clientX - cx;
      let dy = touch.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > STICK_RADIUS) {
        dx = (dx / dist) * STICK_RADIUS;
        dy = (dy / dist) * STICK_RADIUS;
      }
      setKnobOffset({ x: dx, y: dy });
      // Normaliza pra -1..1
      onMove(dx / STICK_RADIUS, dy / STICK_RADIUS);
    }

    el.addEventListener("touchstart", startTouch, { passive: false });
    el.addEventListener("touchmove", moveTouch, { passive: false });
    el.addEventListener("touchend", endTouch);
    el.addEventListener("touchcancel", endTouch);
    return () => {
      el.removeEventListener("touchstart", startTouch);
      el.removeEventListener("touchmove", moveTouch);
      el.removeEventListener("touchend", endTouch);
      el.removeEventListener("touchcancel", endTouch);
    };
  }, [onMove]);

  return (
    <>
      {/* Joystick à esquerda inferior */}
      <div
        ref={stickRef}
        style={{
          position: "fixed",
          left: `calc(${STICK_MARGIN}px + env(safe-area-inset-left, 0px))`,
          bottom: `calc(${STICK_MARGIN}px + env(safe-area-inset-bottom, 0px))`,
          width: STICK_RADIUS * 2,
          height: STICK_RADIUS * 2,
          borderRadius: "50%",
          background: "#1e293b99",
          border: "2px solid #475569",
          zIndex: 50,
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: STICK_RADIUS - KNOB_RADIUS + knobOffset.x,
            top: STICK_RADIUS - KNOB_RADIUS + knobOffset.y,
            width: KNOB_RADIUS * 2,
            height: KNOB_RADIUS * 2,
            borderRadius: "50%",
            background: "#4ade80",
            border: "2px solid #052e16",
            transition: activeTouchId.current === null ? "all 0.15s ease-out" : "none",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Botão G — conversa de mesa / fantasma (acima do E) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onGhost();
        }}
        style={{
          position: "fixed",
          right: `calc(${STICK_MARGIN}px + env(safe-area-inset-right, 0px))`,
          bottom: `calc(${STICK_MARGIN + 72 + 14}px + env(safe-area-inset-bottom, 0px))`,
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "#7c3aed",
          border: "3px solid #4c1d95",
          color: "#fff",
          fontSize: 24,
          fontWeight: 700,
          cursor: "pointer",
          zIndex: 50,
          touchAction: "manipulation",
          userSelect: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
        title="Entrar/sair da conversa de mesa (fantasma)"
      >
        G
      </button>

      {/* Botão E à direita inferior */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        style={{
          position: "fixed",
          right: `calc(${STICK_MARGIN}px + env(safe-area-inset-right, 0px))`,
          bottom: `calc(${STICK_MARGIN}px + env(safe-area-inset-bottom, 0px))`,
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "#2563eb",
          border: "3px solid #1e3a8a",
          color: "#fff",
          fontSize: 28,
          fontWeight: 700,
          cursor: "pointer",
          zIndex: 50,
          touchAction: "manipulation",
          userSelect: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
        title="Interagir (reservar/liberar mesa)"
      >
        E
      </button>
    </>
  );
}
