/**
 * Layout declarativo do escritório.
 * Cada item tem posição em pixels e tipo (chave da textura).
 *
 * O mundo é 32x32 tiles de 32px = 1024x1024 pixels (mesmo do server).
 *
 * Tipos de chão por região: 'wood' (geral) e 'carpet' (lounge).
 */

export interface FurnitureItem {
  type: string;
  x: number;
  y: number;
  // Profundidade visual: itens com depth maior aparecem na frente
  depth?: number;
  // Indica se bloqueia movimento (colisão) — pra futura fase
  solid?: boolean;
}

export interface OfficeLayoutData {
  width: number;
  height: number;
  // Áreas de chão diferenciado (tapetes/carpetes)
  floorRegions: Array<{ x: number; y: number; w: number; h: number; type: "carpet" | "rug" }>;
  furniture: FurnitureItem[];
}

/**
 * Layout "open space" — algumas estações de trabalho em fileiras,
 * uma área de café/lounge com sofá, plantas decorativas, whiteboard
 * pra reuniões rápidas, e estantes nos cantos.
 */
export function getDefaultLayout(): OfficeLayoutData {
  const items: FurnitureItem[] = [];

  // Estações de trabalho — 2 fileiras de 4 mesas no centro
  // Cada estação = mesa + cadeira + monitor
  const desks: Array<[number, number]> = [
    // Fileira superior (mesas voltadas pra baixo)
    [180, 280],
    [310, 280],
    [440, 280],
    [570, 280],
    // Fileira inferior
    [180, 540],
    [310, 540],
    [440, 540],
    [570, 540],
  ];

  desks.forEach(([x, y]) => {
    items.push({ type: "desk", x, y, depth: 1 });
    items.push({ type: "monitor", x, y: y - 18, depth: 2 });
    items.push({ type: "chair", x, y: y + 36, depth: 0 });
  });

  // Área de lounge (canto inferior direito)
  items.push({ type: "sofa", x: 800, y: 800, depth: 1 });
  items.push({ type: "coffeeTable", x: 800, y: 860, depth: 2 });
  items.push({ type: "plant", x: 750, y: 770, depth: 3 });
  items.push({ type: "plant", x: 870, y: 770, depth: 3 });

  // Whiteboard / área de reunião (canto superior esquerdo)
  items.push({ type: "whiteboard", x: 120, y: 130, depth: 0 });

  // Estantes (paredes)
  items.push({ type: "bookshelf", x: 80, y: 460, depth: 1 });
  items.push({ type: "bookshelf", x: 80, y: 540, depth: 1 });

  // Plantas decorativas
  items.push({ type: "plant", x: 130, y: 800, depth: 3 });
  items.push({ type: "plant", x: 880, y: 200, depth: 3 });
  items.push({ type: "plant", x: 480, y: 920, depth: 3 });

  return {
    width: 1024,
    height: 1024,
    floorRegions: [
      // Tapete da área de lounge
      { x: 720, y: 760, w: 220, h: 160, type: "rug" },
      // Tapete da área de reunião (whiteboard)
      { x: 60, y: 80, w: 240, h: 200, type: "rug" },
    ],
    furniture: items,
  };
}
