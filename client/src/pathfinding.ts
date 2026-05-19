import { checkCollision, OfficeLayoutData, Wall } from "./OfficeLayout";

/**
 * Pathfinding A* sobre um grid derivado do layout (móveis + paredes
 * estáticas). Portas NÃO entram como obstáculo por padrão: pro player elas
 * abrem sozinhas quando ele chega perto, então a rota atravessa os vãos.
 *
 * `extraWalls` (opcional) adiciona obstáculos dinâmicos — usado pelos NPCs
 * de segurança: NPC NÃO dispara abertura de porta (só o player, por
 * proximidade), então pra ele as portas fechadas precisam ser obstáculo,
 * senão ele traçaria rota cruzando uma porta que nunca vai abrir.
 *
 * Resolução do grid = meio-tile (16px) pra passar nos vãos de porta.
 * O avatar é amostrado com um raio um pouco maior que o real pra a rota
 * não raspar nas quinas de móvel/parede.
 */

const CELL = 16;
const SAMPLE_HALF = 14; // PLAYER_HALF (12) + folga

type Pt = { x: number; y: number };

function cellBlocked(
  cx: number,
  cy: number,
  layout: OfficeLayoutData,
  extraWalls?: Wall[]
): boolean {
  // Centro da célula em pixels. Sem extraWalls → portas são passáveis.
  return checkCollision(cx * CELL + CELL / 2, cy * CELL + CELL / 2, SAMPLE_HALF, layout, extraWalls);
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
function lineClear(a: Pt, b: Pt, layout: OfficeLayoutData, extraWalls?: Wall[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (checkCollision(a.x + dx * t, a.y + dy * t, SAMPLE_HALF, layout, extraWalls)) return false;
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
  layout: OfficeLayoutData,
  extraWalls?: Wall[]
): Pt[] | null {
  const gridW = Math.ceil(layout.width / CELL);
  const gridH = Math.ceil(layout.height / CELL);
  const N = gridW * gridH;

  // Memoiza o teste de bloqueio (checkCollision é caro): 0=desconhecido,
  // 1=livre, 2=bloqueado. Evita recalcular a mesma célula várias vezes.
  const bmemo = new Uint8Array(N);
  const blockedId = (id: number): boolean => {
    let v = bmemo[id];
    if (v === 0) {
      v = cellBlocked(id % gridW, (id / gridW) | 0, layout, extraWalls) ? 2 : 1;
      bmemo[id] = v;
    }
    return v === 2;
  };
  const blocked = (x: number, y: number) => blockedId(y * gridW + x);

  const s0 = nearestFree(Math.floor(start.x / CELL), Math.floor(start.y / CELL), gridW, gridH, blocked);
  const g0 = nearestFree(Math.floor(goal.x / CELL), Math.floor(goal.y / CELL), gridW, gridH, blocked);
  if (!s0 || !g0) return null;
  if (s0.x === g0.x && s0.y === g0.y) return [goal];

  const startId = s0.y * gridW + s0.x;
  const goalId = g0.y * gridW + g0.x;

  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  gScore[startId] = 0;

  // Binary min-heap (por fScore) — termina em O(E log V), sem cap de iter.
  const heapId: number[] = [];
  const heapF: number[] = [];
  const hpush = (id: number, f: number) => {
    heapId.push(id);
    heapF.push(f);
    let i = heapId.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      [heapId[p], heapId[i]] = [heapId[i], heapId[p]];
      i = p;
    }
  };
  const hpop = (): number => {
    const top = heapId[0];
    const lastId = heapId.pop()!;
    const lastF = heapF.pop()!;
    if (heapId.length > 0) {
      heapId[0] = lastId;
      heapF[0] = lastF;
      let i = 0;
      const n = heapId.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && heapF[l] < heapF[m]) m = l;
        if (r < n && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
        [heapId[m], heapId[i]] = [heapId[i], heapId[m]];
        i = m;
      }
    }
    return top;
  };

  const h = (x: number, y: number) => Math.hypot(g0.x - x, g0.y - y);
  hpush(startId, h(s0.x, s0.y));

  const NEI = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  while (heapId.length > 0) {
    const current = hpop();
    if (closed[current]) continue;
    closed[current] = 1;

    if (current === goalId) {
      const cells: Pt[] = [];
      let c = current;
      while (c !== -1) {
        cells.push({ x: (c % gridW) * CELL + CELL / 2, y: ((c / gridW) | 0) * CELL + CELL / 2 });
        c = came[c];
      }
      cells.reverse();
      cells[cells.length - 1] = { x: goal.x, y: goal.y };

      // String-pulling: descarta waypoints com linha de visão direta
      const out: Pt[] = [];
      let anchor: Pt = { x: start.x, y: start.y };
      for (let i = 1; i < cells.length; i++) {
        if (!lineClear(anchor, cells[i], layout, extraWalls)) {
          out.push(cells[i - 1]);
          anchor = cells[i - 1];
        }
      }
      out.push(cells[cells.length - 1]);
      return out;
    }

    const cx = current % gridW;
    const cy = (current / gridW) | 0;
    for (const [ox, oy] of NEI) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
      const nId = ny * gridW + nx;
      if (closed[nId] || blockedId(nId)) continue;
      // Diagonal: não corta quina
      if (ox !== 0 && oy !== 0 && (blocked(cx + ox, cy) || blocked(cx, cy + oy))) continue;
      const step = ox !== 0 && oy !== 0 ? 1.4142 : 1;
      const tentative = gScore[current] + step;
      if (tentative < gScore[nId]) {
        came[nId] = current;
        gScore[nId] = tentative;
        hpush(nId, tentative + h(nx, ny));
      }
    }
  }
  return null;
}
