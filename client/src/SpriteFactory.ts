import Phaser from "phaser";

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * scale, y * scale, scale, scale);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, scale = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
}

function outlineRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, scale = 2) {
  for (let i = 0; i < w; i++) {
    px(ctx, x + i, y, color, scale);
    px(ctx, x + i, y + h - 1, color, scale);
  }
  for (let j = 0; j < h; j++) {
    px(ctx, x, y + j, color, scale);
    px(ctx, x + w - 1, y + j, color, scale);
  }
}

function shadeColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/* ============================================================ AVATAR ============================================================ */

interface AvatarColors {
  bodyColor: string;
  hairColor?: string;
  skinColor?: string;
  pantsColor?: string;
}

function drawAvatarFrame(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  direction: "down" | "up" | "left" | "right",
  step: boolean,
  colors: AvatarColors,
  scale = 2
) {
  const skin = colors.skinColor || "#f5cfa0";
  const skinShadow = shadeColor(skin, -15);
  const hair = colors.hairColor || "#3b2c20";
  const shirt = colors.bodyColor;
  const shirtShadow = shadeColor(shirt, -20);
  const pants = colors.pantsColor || "#2c3e50";
  const pantsShadow = shadeColor(pants, -20);
  const shoes = "#1a1a1a";
  const outline = "#1a1a2a";

  const ox = offsetX;
  const oy = offsetY;

  // Sombra
  for (let x = 4; x < 12; x++) px(ctx, ox + x, oy + 19, "#00000055", scale);
  for (let x = 5; x < 11; x++) px(ctx, ox + x, oy + 18, "#00000033", scale);

  if (direction === "down") {
    for (let x = 5; x < 11; x++) {
      px(ctx, ox + x, oy + 2, hair, scale);
      px(ctx, ox + x, oy + 3, hair, scale);
    }
    px(ctx, ox + 4, oy + 3, hair, scale);
    px(ctx, ox + 11, oy + 3, hair, scale);

    for (let x = 5; x < 11; x++) {
      px(ctx, ox + x, oy + 4, skin, scale);
      px(ctx, ox + x, oy + 5, skin, scale);
      px(ctx, ox + x, oy + 6, skin, scale);
    }
    px(ctx, ox + 5, oy + 5, skinShadow, scale);
    px(ctx, ox + 5, oy + 6, skinShadow, scale);

    px(ctx, ox + 6, oy + 5, outline, scale);
    px(ctx, ox + 9, oy + 5, outline, scale);

    for (let y = 7; y < 13; y++) {
      for (let x = 4; x < 12; x++) px(ctx, ox + x, oy + y, shirt, scale);
    }
    for (let y = 7; y < 13; y++) px(ctx, ox + 4, oy + y, shirtShadow, scale);

    for (let y = 8; y < 12; y++) {
      px(ctx, ox + 3, oy + y, shirt, scale);
      px(ctx, ox + 12, oy + y, shirt, scale);
    }
    px(ctx, ox + 3, oy + 12, skin, scale);
    px(ctx, ox + 12, oy + 12, skin, scale);

    for (let y = 13; y < 17; y++) {
      px(ctx, ox + 5, oy + y, pants, scale);
      px(ctx, ox + 6, oy + y, pants, scale);
      px(ctx, ox + 9, oy + y, pants, scale);
      px(ctx, ox + 10, oy + y, pants, scale);
      if (!step) {
        px(ctx, ox + 7, oy + y, pantsShadow, scale);
        px(ctx, ox + 8, oy + y, pantsShadow, scale);
      }
    }

    if (step) {
      for (let x = 4; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 12; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    } else {
      for (let x = 5; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 11; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    }
  } else if (direction === "up") {
    for (let x = 4; x < 12; x++) {
      for (let y = 2; y < 7; y++) px(ctx, ox + x, oy + y, hair, scale);
    }
    px(ctx, ox + 7, oy + 6, skin, scale);
    px(ctx, ox + 8, oy + 6, skin, scale);

    for (let y = 7; y < 13; y++) {
      for (let x = 4; x < 12; x++) px(ctx, ox + x, oy + y, shirt, scale);
    }
    for (let y = 7; y < 13; y++) px(ctx, ox + 11, oy + y, shirtShadow, scale);

    for (let y = 8; y < 12; y++) {
      px(ctx, ox + 3, oy + y, shirt, scale);
      px(ctx, ox + 12, oy + y, shirt, scale);
    }
    px(ctx, ox + 3, oy + 12, skin, scale);
    px(ctx, ox + 12, oy + 12, skin, scale);

    for (let y = 13; y < 17; y++) {
      px(ctx, ox + 5, oy + y, pants, scale);
      px(ctx, ox + 6, oy + y, pants, scale);
      px(ctx, ox + 9, oy + y, pants, scale);
      px(ctx, ox + 10, oy + y, pants, scale);
    }
    if (step) {
      for (let x = 4; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 12; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    } else {
      for (let x = 5; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 11; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    }
  } else {
    const flip = direction === "right";
    const f = (x: number) => (flip ? 15 - x : x);

    for (let x = 5; x < 11; x++) {
      px(ctx, ox + f(x), oy + 2, hair, scale);
      px(ctx, ox + f(x), oy + 3, hair, scale);
    }
    px(ctx, ox + f(4), oy + 3, hair, scale);
    px(ctx, ox + f(4), oy + 4, hair, scale);
    px(ctx, ox + f(11), oy + 3, hair, scale);

    for (let x = 5; x < 11; x++) {
      for (let y = 4; y < 7; y++) px(ctx, ox + f(x), oy + y, skin, scale);
    }
    px(ctx, ox + f(4), oy + 5, skin, scale);
    px(ctx, ox + f(6), oy + 5, outline, scale);

    for (let y = 7; y < 13; y++) {
      for (let x = 5; x < 11; x++) px(ctx, ox + f(x), oy + y, shirt, scale);
    }
    for (let y = 7; y < 13; y++) px(ctx, ox + f(10), oy + y, shirtShadow, scale);

    const armOffset = step ? 1 : 0;
    for (let y = 8; y < 12; y++) px(ctx, ox + f(4), oy + y + armOffset, shirt, scale);
    px(ctx, ox + f(4), oy + 12 + armOffset, skin, scale);

    const legOffset = step ? 1 : 0;
    for (let y = 13; y < 17; y++) {
      px(ctx, ox + f(6), oy + y, pants, scale);
      px(ctx, ox + f(7), oy + y, pants, scale);
      px(ctx, ox + f(8), oy + y, pants, scale);
    }
    for (let x = 5; x < 9; x++) px(ctx, ox + f(x), oy + 17 + legOffset, shoes, scale);
  }
}

/**
 * Cria textura de avatar com cores customizadas.
 * key deve ser único por combinação (ex: "avatar_#4ade80_#3b2c20")
 */
export function createAvatarTexture(
  scene: Phaser.Scene,
  key: string,
  bodyColor: string,
  hairColor?: string
): string {
  if (scene.textures.exists(key)) return key;

  const SCALE = 2;
  const FRAME_W = 16 * SCALE;
  const FRAME_H = 20 * SCALE;
  const COLS = 2;
  const ROWS = 4;

  const { canvas } = (() => {
    const c = document.createElement("canvas");
    c.width = FRAME_W * COLS;
    c.height = FRAME_H * ROWS;
    return { canvas: c };
  })();
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const directions: Array<"down" | "up" | "left" | "right"> = ["down", "up", "left", "right"];
  const colors: AvatarColors = {
    bodyColor,
    hairColor: hairColor || "#3b2c20",
    skinColor: "#f5cfa0",
    pantsColor: "#2c3e50",
  };

  directions.forEach((dir, row) => {
    [false, true].forEach((step, col) => {
      drawAvatarFrame(ctx, col * 16, row * 20, dir, step, colors, SCALE);
    });
  });

  scene.textures.addCanvas(key, canvas);
  const tex = scene.textures.get(key);
  let frameIdx = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      tex.add(frameIdx, 0, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
      frameIdx++;
    }
  }

  return key;
}

/* ============================================================ MOBÍLIA ============================================================ */

export function createFurnitureTextures(scene: Phaser.Scene) {
  createDesk(scene);
  createChair(scene);
  createMonitor(scene);
  createPlant(scene);
  createSofa(scene);
  createCoffeeTable(scene);
  createMeetingTable(scene);
  createRug(scene);
  createWhiteboard(scene);
  createBookshelf(scene);
  createTV(scene);
  createEscalator(scene);
  createCrate(scene);
  createTree(scene);
  createBush(scene);
}

/** Árvore (decoração externa). ~32×44, copa redonda + tronco. */
function createTree(scene: Phaser.Scene) {
  if (scene.textures.exists("tree")) return;
  const SCALE = 2, W = 32, H = 44;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  // tronco
  rect(ctx, 14, 30, 4, 12, "#5b3a1e", SCALE);
  rect(ctx, 14, 30, 2, 12, "#6e4a28", SCALE);
  // copa (3 círculos sobrepostos via blocos)
  const blob = (cx: number, cy: number, r: number, col: string) => {
    for (let yy = -r; yy <= r; yy++) {
      const span = Math.floor(Math.sqrt(r * r - yy * yy));
      rect(ctx, cx - span, cy + yy, span * 2, 1, col, SCALE);
    }
  };
  blob(16, 16, 13, "#2f6b30");
  blob(11, 18, 8, "#37803a");
  blob(21, 14, 8, "#37803a");
  blob(16, 13, 7, "#46994a");
  scene.textures.addCanvas("tree", canvas);
}

/** Arbusto (decoração externa). ~22×16, mound verde. */
function createBush(scene: Phaser.Scene) {
  if (scene.textures.exists("bush")) return;
  const SCALE = 2, W = 22, H = 16;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  const blob = (cx: number, cy: number, rx: number, ry: number, col: string) => {
    for (let yy = -ry; yy <= ry; yy++) {
      const span = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
      rect(ctx, cx - span, cy + yy, span * 2, 1, col, SCALE);
    }
  };
  blob(11, 10, 10, 6, "#2f6b30");
  blob(8, 9, 6, 4, "#3c8540");
  blob(15, 8, 5, 4, "#46994a");
  scene.textures.addCanvas("bush", canvas);
}

function createDesk(scene: Phaser.Scene) {
  if (scene.textures.exists("desk")) return;
  const SCALE = 2, W = 48, H = 28;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 4, W, 10, "#d4a373", SCALE);
  rect(ctx, 0, 4, W, 1, "#e8c39e", SCALE);
  rect(ctx, 0, 13, W, 1, "#a0784f", SCALE);
  rect(ctx, 2, 14, 3, 12, "#8b6332", SCALE);
  rect(ctx, W - 5, 14, 3, 12, "#8b6332", SCALE);
  rect(ctx, 2, 14, 1, 12, "#a0784f", SCALE);
  rect(ctx, W - 5, 14, 1, 12, "#a0784f", SCALE);
  rect(ctx, 1, 26, W - 2, 2, "#00000044", SCALE);
  scene.textures.addCanvas("desk", canvas);
}

function createChair(scene: Phaser.Scene) {
  if (scene.textures.exists("chair")) return;
  const SCALE = 2, W = 16, H = 20;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 4, 2, 8, 8, "#2c3e50", SCALE);
  rect(ctx, 4, 2, 8, 1, "#3a536e", SCALE);
  rect(ctx, 4, 9, 8, 1, "#1a242f", SCALE);
  rect(ctx, 3, 10, 10, 4, "#34495e", SCALE);
  rect(ctx, 3, 10, 10, 1, "#4a637c", SCALE);
  rect(ctx, 3, 13, 10, 1, "#1a242f", SCALE);
  rect(ctx, 7, 14, 2, 4, "#7f8c8d", SCALE);
  rect(ctx, 4, 17, 8, 2, "#2c3e50", SCALE);
  px(ctx, 4, 18, "#1a1a1a", SCALE);
  px(ctx, 11, 18, "#1a1a1a", SCALE);
  rect(ctx, 3, 19, 10, 1, "#00000044", SCALE);
  scene.textures.addCanvas("chair", canvas);
}

function createMonitor(scene: Phaser.Scene) {
  if (scene.textures.exists("monitor")) return;
  const SCALE = 2, W = 20, H = 16;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 1, 0, 18, 11, "#1a1a1a", SCALE);
  rect(ctx, 2, 1, 16, 9, "#5dade2", SCALE);
  rect(ctx, 3, 2, 14, 1, "#85c1e2", SCALE);
  rect(ctx, 4, 4, 5, 1, "#ffffff", SCALE);
  rect(ctx, 4, 6, 8, 1, "#ffffff", SCALE);
  rect(ctx, 4, 8, 4, 1, "#ffffff", SCALE);
  rect(ctx, 8, 11, 4, 2, "#1a1a1a", SCALE);
  rect(ctx, 5, 13, 10, 2, "#1a1a1a", SCALE);
  scene.textures.addCanvas("monitor", canvas);
}

function createPlant(scene: Phaser.Scene) {
  if (scene.textures.exists("plant")) return;
  const SCALE = 2, W = 16, H = 24;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  const leafDark = "#2d5016", leafMid = "#4a7c2c", leafLight = "#6fa84e";
  for (let x = 2; x < 14; x++) for (let y = 2; y < 14; y++) {
    if ((x - 8) * (x - 8) + (y - 8) * (y - 8) < 36) px(ctx, x, y, leafDark, SCALE);
  }
  for (let x = 3; x < 13; x++) for (let y = 1; y < 12; y++) {
    if ((x - 8) * (x - 8) + (y - 7) * (y - 7) < 25) px(ctx, x, y, leafMid, SCALE);
  }
  px(ctx, 6, 4, leafLight, SCALE);
  px(ctx, 9, 3, leafLight, SCALE);
  px(ctx, 5, 7, leafLight, SCALE);
  px(ctx, 10, 6, leafLight, SCALE);
  px(ctx, 7, 10, leafLight, SCALE);
  px(ctx, 11, 9, leafLight, SCALE);
  rect(ctx, 4, 14, 8, 8, "#8b4513", SCALE);
  rect(ctx, 4, 14, 8, 1, "#a0522d", SCALE);
  rect(ctx, 4, 21, 8, 1, "#5c2e0a", SCALE);
  outlineRect(ctx, 4, 14, 8, 8, "#3a1f0a", SCALE);
  rect(ctx, 3, 22, 10, 1, "#00000044", SCALE);
  scene.textures.addCanvas("plant", canvas);
}

function createSofa(scene: Phaser.Scene) {
  if (scene.textures.exists("sofa")) return;
  const SCALE = 2, W = 40, H = 20;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  const main = "#c97b63", dark = "#a25a44", light = "#d99b85";
  rect(ctx, 0, 0, W, 8, main, SCALE);
  rect(ctx, 0, 0, W, 1, light, SCALE);
  rect(ctx, 0, 7, W, 1, dark, SCALE);
  rect(ctx, W / 2 - 1, 1, 1, 6, dark, SCALE);
  rect(ctx, 8, 2, 2, 4, light, SCALE);
  rect(ctx, W - 10, 2, 2, 4, light, SCALE);
  rect(ctx, 0, 4, 3, 14, main, SCALE);
  rect(ctx, W - 3, 4, 3, 14, main, SCALE);
  rect(ctx, 0, 4, 3, 1, light, SCALE);
  rect(ctx, W - 3, 4, 3, 1, light, SCALE);
  rect(ctx, 3, 8, W - 6, 8, main, SCALE);
  rect(ctx, 3, 8, W - 6, 1, light, SCALE);
  rect(ctx, 3, 15, W - 6, 1, dark, SCALE);
  rect(ctx, W / 2 - 1, 8, 1, 8, dark, SCALE);
  rect(ctx, 2, 16, 3, 3, "#3a1f0a", SCALE);
  rect(ctx, W - 5, 16, 3, 3, "#3a1f0a", SCALE);
  rect(ctx, 1, 19, W - 2, 1, "#00000044", SCALE);
  scene.textures.addCanvas("sofa", canvas);
}

/** Mesa de reunião retangular grande (5 tiles × 2 tiles = 160×64 px).
 *  Estilo madeira escura com pratinho/frutas no centro. */
function createMeetingTable(scene: Phaser.Scene) {
  if (scene.textures.exists("meetingTable")) return;
  const SCALE = 2, W = 80, H = 32;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  // tampo (madeira escura)
  rect(ctx, 0, 4, W, 22, "#5c3f25", SCALE);
  rect(ctx, 0, 4, W, 1, "#7a5a3e", SCALE);  // highlight topo
  rect(ctx, 0, 25, W, 1, "#3d2817", SCALE); // sombra inferior
  // veios sutis da madeira
  for (let y = 8; y < 24; y += 4) rect(ctx, 2, y, W - 4, 1, "#4a3320", SCALE);
  // pratinho central
  rect(ctx, W / 2 - 4, 13, 8, 4, "#e8e8e8", SCALE);
  rect(ctx, W / 2 - 4, 13, 8, 1, "#ffffff", SCALE);
  rect(ctx, W / 2 - 3, 14, 6, 2, "#e8a070", SCALE); // "comida" laranja
  // sombra ao chão
  rect(ctx, 2, 26, W - 4, 4, "#2a1c10", SCALE);
  rect(ctx, 1, 30, W - 2, 2, "#00000055", SCALE);
  scene.textures.addCanvas("meetingTable", canvas);
}

function createCoffeeTable(scene: Phaser.Scene) {
  if (scene.textures.exists("coffeeTable")) return;
  const SCALE = 2, W = 24, H = 14;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 2, W, 6, "#3d2817", SCALE);
  rect(ctx, 0, 2, W, 1, "#5c3f25", SCALE);
  rect(ctx, 0, 7, W, 1, "#2a1c10", SCALE);
  rect(ctx, 1, 8, 3, 4, "#2a1c10", SCALE);
  rect(ctx, W - 4, 8, 3, 4, "#2a1c10", SCALE);
  rect(ctx, 0, 12, W, 2, "#00000033", SCALE);
  scene.textures.addCanvas("coffeeTable", canvas);
}

function createRug(scene: Phaser.Scene) {
  if (scene.textures.exists("rug")) return;
  const SCALE = 2, W = 80, H = 60;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 0, W, H, "#c9a87c", SCALE);
  outlineRect(ctx, 0, 0, W, H, "#8b6332", SCALE);
  outlineRect(ctx, 2, 2, W - 4, H - 4, "#a0784f", SCALE);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    rect(ctx, 10 + i * 12, 10 + j * 12, 2, 2, "#8b6332", SCALE);
    rect(ctx, 14 + i * 12, 14 + j * 12, 2, 2, "#8b6332", SCALE);
  }
  scene.textures.addCanvas("rug", canvas);
}

function createWhiteboard(scene: Phaser.Scene) {
  if (scene.textures.exists("whiteboard")) return;
  const SCALE = 2, W = 40, H = 28;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 0, W, H - 4, "#9ca3af", SCALE);
  rect(ctx, 2, 2, W - 4, H - 10, "#f8fafc", SCALE);
  rect(ctx, 5, 5, 10, 1, "#3b82f6", SCALE);
  rect(ctx, 5, 8, 14, 1, "#1e293b", SCALE);
  rect(ctx, 5, 11, 8, 1, "#1e293b", SCALE);
  rect(ctx, 5, 14, 12, 1, "#dc2626", SCALE);
  rect(ctx, 4, H - 4, W - 8, 2, "#6b7280", SCALE);
  rect(ctx, 6, H - 2, 2, 2, "#374151", SCALE);
  rect(ctx, W - 8, H - 2, 2, 2, "#374151", SCALE);
  scene.textures.addCanvas("whiteboard", canvas);
}

function createBookshelf(scene: Phaser.Scene) {
  if (scene.textures.exists("bookshelf")) return;
  const SCALE = 2, W = 24, H = 32;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 0, W, H - 2, "#3d2817", SCALE);
  rect(ctx, 1, 1, W - 2, H - 4, "#5c3f25", SCALE);
  [10, 18, 26].forEach((y) => rect(ctx, 1, y, W - 2, 1, "#2a1c10", SCALE));
  const bookColors = ["#dc2626", "#16a34a", "#2563eb", "#ca8a04", "#9333ea", "#0891b2"];
  [2, 11, 19].forEach((shelfY) => {
    let xp = 2;
    while (xp < W - 4) {
      const w = 1 + Math.floor(((xp + shelfY) * 7) % 3);
      const c = bookColors[(xp + shelfY) % bookColors.length];
      const h = 6 + (((xp * 3 + shelfY) % 3) - 1);
      rect(ctx, xp, shelfY + (8 - h), w, h, c, SCALE);
      xp += w + 1;
    }
  });
  rect(ctx, 1, H - 1, W - 2, 1, "#00000044", SCALE);
  scene.textures.addCanvas("bookshelf", canvas);
}

/** Escada rolante (sobe pro 2º andar). Visual procedural — sem asset. */
function createEscalator(scene: Phaser.Scene) {
  if (scene.textures.exists("escalator")) return;
  const SCALE = 2, W = 48, H = 64;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  // corpo metálico
  rect(ctx, 0, 0, W, H, "#1f2937", SCALE);
  rect(ctx, 2, 2, W - 4, H - 4, "#374151", SCALE);
  // corrimãos laterais
  rect(ctx, 1, 1, 4, H - 2, "#0f172a", SCALE);
  rect(ctx, W - 5, 1, 4, H - 2, "#0f172a", SCALE);
  rect(ctx, 2, 1, 2, H - 2, "#64748b", SCALE);
  rect(ctx, W - 4, 1, 2, H - 2, "#64748b", SCALE);
  // degraus (linhas horizontais com sombra)
  for (let y = 6; y < H - 4; y += 6) {
    rect(ctx, 6, y, W - 12, 3, "#475569", SCALE);
    rect(ctx, 6, y + 3, W - 12, 1, "#1e293b", SCALE);
  }
  // seta pra cima (ciano brilhante) indicando que sobe
  const cx = W / 2;
  rect(ctx, cx - 1, 14, 2, 26, "#22d3ee", SCALE);
  for (let i = 0; i < 8; i++) {
    rect(ctx, cx - 1 - i, 22 + i, 2, 2, "#22d3ee", SCALE);
    rect(ctx, cx - 1 + i, 22 + i, 2, 2, "#22d3ee", SCALE);
  }
  scene.textures.addCanvas("escalator", canvas);
}

/** Caixa de madeira (decoração — canto do 2º andar vazio). */
function createCrate(scene: Phaser.Scene) {
  if (scene.textures.exists("crate")) return;
  const SCALE = 2, W = 24, H = 24;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);
  rect(ctx, 0, 0, W, H, "#5c3f25", SCALE);
  rect(ctx, 1, 1, W - 2, H - 2, "#7a5230", SCALE);
  rect(ctx, 1, 1, W - 2, 2, "#8a6038", SCALE);
  // moldura + X
  rect(ctx, 1, 1, W - 2, 1, "#3d2817", SCALE);
  rect(ctx, 1, H - 2, W - 2, 1, "#3d2817", SCALE);
  rect(ctx, 1, 1, 1, H - 2, "#3d2817", SCALE);
  rect(ctx, W - 2, 1, 1, H - 2, "#3d2817", SCALE);
  for (let i = 2; i < W - 2; i++) {
    rect(ctx, i, i, 1, 1, "#3d2817", SCALE);
    rect(ctx, W - i, i, 1, 1, "#3d2817", SCALE);
  }
  scene.textures.addCanvas("crate", canvas);
}

/**
 * TV de apresentação. Estado "off" (preto). Quando alguém compartilha tela,
 * a OfficeScene cobre o "display" com o vídeo do LiveKit.
 */
function createTV(scene: Phaser.Scene) {
  if (scene.textures.exists("tv")) return;
  const SCALE = 2, W = 72, H = 42;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Moldura
  rect(ctx, 0, 0, W, 32, "#0a0a0a", SCALE);
  rect(ctx, 0, 0, W, 1, "#1a1a1a", SCALE);
  rect(ctx, 0, 31, W, 1, "#000000", SCALE);

  // Tela "desligada"
  rect(ctx, 2, 2, W - 4, 28, "#1e293b", SCALE);
  // Padrão sutil pra indicar tela
  rect(ctx, 4, 4, W - 8, 1, "#334155", SCALE);
  rect(ctx, 4, 28, W - 8, 1, "#0f172a", SCALE);
  // Logo/texto "OFF"
  const cx = W / 2;
  const cy = 16;
  rect(ctx, cx - 6, cy - 2, 4, 4, "#475569", SCALE);
  rect(ctx, cx - 1, cy - 2, 1, 4, "#475569", SCALE);
  rect(ctx, cx + 1, cy - 2, 4, 1, "#475569", SCALE);
  rect(ctx, cx + 1, cy + 1, 4, 1, "#475569", SCALE);

  // LED indicador
  rect(ctx, W - 6, 29, 1, 1, "#dc2626", SCALE);

  // Suporte (pé)
  rect(ctx, cx - 8, 32, 16, 2, "#1a1a1a", SCALE);
  rect(ctx, cx - 12, 34, 24, 3, "#1a1a1a", SCALE);
  rect(ctx, cx - 12, 34, 24, 1, "#2a2a2a", SCALE);

  // Sombra
  rect(ctx, 0, 40, W, 2, "#00000044", SCALE);

  scene.textures.addCanvas("tv", canvas);
}

/* ============================================================ PISO ============================================================ */

export function createFloorTextures(scene: Phaser.Scene) {
  createWoodFloorTile(scene);
  createCarpetTile(scene);
  createGrassTile(scene);
}

/** Grama (área verde decorativa ao redor do prédio). Tileável. */
function createGrassTile(scene: Phaser.Scene) {
  if (scene.textures.exists("grass")) return;
  const SCALE = 2, SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE * SCALE, SIZE * SCALE);
  rect(ctx, 0, 0, SIZE, SIZE, "#5a8a3c", SCALE);
  // tufos/variação pra não ficar chapado
  for (let i = 0; i < 60; i++) {
    const x = (i * 7 + (i % 5) * 3) % SIZE;
    const y = (i * 11 + (i % 3) * 5) % SIZE;
    const c = i % 3 === 0 ? "#4d7a33" : i % 3 === 1 ? "#6b9c47" : "#54823a";
    px(ctx, x, y, c, SCALE);
    if (i % 4 === 0) rect(ctx, x, y, 1, 2, "#3f6b2b", SCALE);
  }
  scene.textures.addCanvas("grass", canvas);
}

function createWoodFloorTile(scene: Phaser.Scene) {
  if (scene.textures.exists("floorWood")) return;
  const SCALE = 2, SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE * SCALE, SIZE * SCALE);
  rect(ctx, 0, 0, SIZE, SIZE, "#c9a87c", SCALE);
  const plankH = 8;
  for (let y = 0; y < SIZE; y += plankH) {
    rect(ctx, 0, y + plankH - 1, SIZE, 1, "#8b6332", SCALE);
    const variation = ((y / plankH) % 2 === 0) ? 0 : -5;
    if (variation) rect(ctx, 0, y, SIZE, plankH - 1, shadeColor("#c9a87c", variation), SCALE);
    rect(ctx, 4, y + 3, 6, 1, "#a0784f", SCALE);
    rect(ctx, 18, y + 5, 8, 1, "#a0784f", SCALE);
  }
  scene.textures.addCanvas("floorWood", canvas);
}

function createCarpetTile(scene: Phaser.Scene) {
  if (scene.textures.exists("floorCarpet")) return;
  const SCALE = 2, SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE * SCALE, SIZE * SCALE);
  rect(ctx, 0, 0, SIZE, SIZE, "#475569", SCALE);
  for (let y = 0; y < SIZE; y += 2) {
    for (let xp = (y % 4 === 0 ? 0 : 2); xp < SIZE; xp += 4) px(ctx, xp, y, "#3d4a5c", SCALE);
  }
  scene.textures.addCanvas("floorCarpet", canvas);
}

export function createAvatarAnimations(scene: Phaser.Scene, key: string) {
  const animKey = (dir: string, type: "walk" | "idle") => `${key}_${dir}_${type}`;
  const config = [
    { dir: "down", idle: 0, step: 1 },
    { dir: "up", idle: 2, step: 3 },
    { dir: "left", idle: 4, step: 5 },
    { dir: "right", idle: 6, step: 7 },
  ];
  config.forEach(({ dir, idle, step }) => {
    if (!scene.anims.exists(animKey(dir, "walk"))) {
      scene.anims.create({
        key: animKey(dir, "walk"),
        frames: [{ key, frame: idle }, { key, frame: step }],
        frameRate: 6,
        repeat: -1,
      });
    }
    if (!scene.anims.exists(animKey(dir, "idle"))) {
      scene.anims.create({
        key: animKey(dir, "idle"),
        frames: [{ key, frame: idle }],
        frameRate: 1,
        repeat: 0,
      });
    }
  });
}
