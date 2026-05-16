import { checkCollision, OfficeLayoutData } from "./OfficeLayout";

/**
 * Pathfinding A* sobre um grid derivado do layout (móveis + paredes
 * estáticas). Portas NÃO entram como obstáculo: elas abrem sozinhas quando
 * o avatar chega perto, então a rota pode atravessar os vãos normalmente.
 *
 * Resolução do grid = meio-tile (16px) pra passar nos vãos de porta.
 * O avatar é amostrado com um raio um pouco maior que o real pra a rota
 * não raspar nas quinas de móvel/parede.
 */

const CELL = 16;
const SAMPLE_HALF = 14; // PLAYER_HALF (12) + folga

type Pt = { x: number; y: number };

function cellBlocked(cx: number, cy: number, layout: OfficeLayoutData): boolean {
  // Centro da célula em pixels. Sem extraWalls → portas são passáveis.
  return checkCollision(cx * CELL + CELL / 2, cy * CELL + CELL / 2, SAMPLE_HALF, layout);
}

/** Acha a célula livre mais próxima de (gx,gy) por busca em anel (BFS espiral). */
function nearestFree(
  gx: number,
  gy: number,
  gridW: number,
  gridH: number,
  blocked: (x: number, y: number) => boolean
): { x: number; y: number } | null {
  if (gx >= 0 && gy >= 0 && gx < gridW && gy < gridH && !blocked(gx, gy)) return { x: gx, y: gy };
  for (let r = 1; r < Math.max(gridW, gridH); r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // só o anel
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        if (!blocked(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** Linha de visão livre entre dois pontos em pixels (amostra a cada ~CELL/2). */
function lineClear(a: Pt, b: Pt, layout: OfficeLayoutData): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (checkCollision(a.x + dx * t, a.y + dy * t, SAMPLE_HALF, layout)) return false;
  }
  return true;
}

/**
 * Retorna a lista de waypoints (em pixels) de start até goal, já suavizada
 * (string-pulling). Não inclui o start. Retorna null se não há rota.
 */
export function findPath(
  start: Pt,
  goal: Pt,
  layout: OfficeLayoutData
): Pt[] | null {
  const gridW = Math.ceil(layout.width / CELL);
  const gridH = Math.ceil(layout.height / CELL);
  const blocked = (x: number, y: number) => cellBlocked(x, y, layout);

  const s0 = nearestFree(Math.floor(start.x / CELL), Math.floor(start.y / CELL), gridW, gridH, blocked);
  const g0 = nearestFree(Math.floor(goal.x / CELL), Math.floor(goal.y / CELL), gridW, gridH, blocked);
  if (!s0 || !g0) return null;
  if (s0.x === g0.x && s0.y === g0.y) return [goal];

  const idx = (x: number, y: number) => y * gridW + x;
  const open: number[] = [s0.x + s0.y * gridW]; // heap simples (array + sort)
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const came = new Map<number, number>();
  gScore.set(idx(s0.x, s0.y), 0);
  fScore.set(idx(s0.x, s0.y), Math.hypot(g0.x - s0.x, g0.y - s0.y));

  const NEI = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const goalId = idx(g0.x, g0.y);
  let iterations = 0;
  const MAX_ITER = gridW * gridH; // limite de segurança

  while (open.length > 0) {
    if (++iterations > MAX_ITER) return null;
    // pega o nó de menor fScore (O(n) — grid pequeno, ok)
    let bestI = 0;
    for (let i = 1; i < open.length; i++) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestI]) ?? Infinity)) bestI = i;
    }
    const current = open.splice(bestI, 1)[0];
    if (current === goalId) {
      // reconstrói
      const cells: Pt[] = [];
      let c: number | undefined = current;
      while (c !== undefined) {
        const cx = c % gridW;
        const cy = Math.floor(c / gridW);
        cells.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
        c = came.get(c);
      }
      cells.reverse();
      cells[cells.length - 1] = { x: goal.x, y: goal.y }; // ponto exato no fim

      // String-pulling: descarta waypoints com linha de visão direta
      const out: Pt[] = [];
      let anchor: Pt = { x: start.x, y: start.y };
      for (let i = 1; i < cells.length; i++) {
        if (!lineClear(anchor, cells[i], layout)) {
          out.push(cells[i - 1]);
          anchor = cells[i - 1];
        }
      }
      out.push(cells[cells.length - 1]);
      return out;
    }

    const cx = current % gridW;
    const cy = Math.floor(current / gridW);
    for (const [ox, oy] of NEI) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
      if (blocked(nx, ny)) continue;
      // Diagonal: não corta quina (ambos ortogonais precisam estar livres)
      if (ox !== 0 && oy !== 0) {
        if (blocked(cx + ox, cy) || blocked(cx, cy + oy)) continue;
      }
      const nId = idx(nx, ny);
      const step = ox !== 0 && oy !== 0 ? 1.4142 : 1;
      const tentative = (gScore.get(current) ?? Infinity) + step;
      if (tentative < (gScore.get(nId) ?? Infinity)) {
        came.set(nId, current);
        gScore.set(nId, tentative);
        fScore.set(nId, tentative + Math.hypot(g0.x - nx, g0.y - ny));
        if (!open.includes(nId)) open.push(nId);
      }
    }
  }
  return null;
}
