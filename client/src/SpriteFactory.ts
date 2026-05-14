import Phaser from "phaser";

/**
 * SpriteFactory: cria texturas de pixel art em runtime via canvas.
 *
 * Estratégia: cada sprite é desenhado em um canvas off-screen pixel a pixel
 * e adicionado ao texture cache do Phaser pra ser usado normalmente.
 *
 * Pixel size: trabalhamos numa "grid lógica" de 16x16 ou 32x32 pixels,
 * cada "pixel lógico" desenhado como retângulo 2x2 pra ter charm sem
 * precisar de upscale do Phaser.
 */

type Color = string;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: Color, scale = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * scale, y * scale, scale, scale);
}

// Desenha um retângulo cheio com pixels lógicos
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: Color, scale = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
}

// Outline de um retângulo
function outlineRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: Color, scale = 2) {
  for (let i = 0; i < w; i++) {
    px(ctx, x + i, y, color, scale);
    px(ctx, x + i, y + h - 1, color, scale);
  }
  for (let j = 0; j < h; j++) {
    px(ctx, x, y + j, color, scale);
    px(ctx, x + w - 1, y + j, color, scale);
  }
}

/* ============================================================
 * AVATAR
 *
 * 16x20 pixels lógicos, com 4 direções (down/up/left/right) e
 * 2 frames de animação (idle e step). Total: 8 frames.
 *
 * Layout do spritesheet:
 *   col 0: idle    | col 1: step
 *   row 0: down
 *   row 1: up
 *   row 2: left
 *   row 3: right
 * ============================================================ */

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
  const skinShadow = "#d9a878";
  const hair = colors.hairColor || "#3b2c20";
  const shirt = colors.bodyColor;
  const shirtShadow = shadeColor(shirt, -20);
  const pants = colors.pantsColor || "#2c3e50";
  const pantsShadow = shadeColor(pants, -20);
  const shoes = "#1a1a1a";
  const outline = "#1a1a2a";

  const ox = offsetX;
  const oy = offsetY;

  // Sombra elíptica embaixo
  for (let x = 4; x < 12; x++) px(ctx, ox + x, oy + 19, "#00000055", scale);
  for (let x = 5; x < 11; x++) px(ctx, ox + x, oy + 18, "#00000033", scale);

  if (direction === "down") {
    // Cabelo (topo)
    for (let x = 5; x < 11; x++) {
      px(ctx, ox + x, oy + 2, hair, scale);
      px(ctx, ox + x, oy + 3, hair, scale);
    }
    px(ctx, ox + 4, oy + 3, hair, scale);
    px(ctx, ox + 11, oy + 3, hair, scale);

    // Rosto
    for (let x = 5; x < 11; x++) {
      px(ctx, ox + x, oy + 4, skin, scale);
      px(ctx, ox + x, oy + 5, skin, scale);
      px(ctx, ox + x, oy + 6, skin, scale);
    }
    // Sombra do rosto (lado esquerdo)
    px(ctx, ox + 5, oy + 5, skinShadow, scale);
    px(ctx, ox + 5, oy + 6, skinShadow, scale);

    // Olhos
    px(ctx, ox + 6, oy + 5, outline, scale);
    px(ctx, ox + 9, oy + 5, outline, scale);

    // Corpo (camisa)
    for (let y = 7; y < 13; y++) {
      for (let x = 4; x < 12; x++) {
        px(ctx, ox + x, oy + y, shirt, scale);
      }
    }
    // Sombra lateral da camisa
    for (let y = 7; y < 13; y++) px(ctx, ox + 4, oy + y, shirtShadow, scale);

    // Braços
    for (let y = 8; y < 12; y++) {
      px(ctx, ox + 3, oy + y, shirt, scale);
      px(ctx, ox + 12, oy + y, shirt, scale);
    }
    // Mãos
    px(ctx, ox + 3, oy + 12, skin, scale);
    px(ctx, ox + 12, oy + 12, skin, scale);

    // Pernas
    for (let y = 13; y < 17; y++) {
      px(ctx, ox + 5, oy + y, pants, scale);
      px(ctx, ox + 6, oy + y, pants, scale);
      px(ctx, ox + 9, oy + y, pants, scale);
      px(ctx, ox + 10, oy + y, pants, scale);
      // Centro - aparece quando andando
      if (!step) {
        px(ctx, ox + 7, oy + y, pantsShadow, scale);
        px(ctx, ox + 8, oy + y, pantsShadow, scale);
      }
    }

    // Sapatos
    if (step) {
      // Frame de "passo": pé esquerdo na frente
      for (let x = 4; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 12; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    } else {
      for (let x = 5; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 11; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    }
  } else if (direction === "up") {
    // Costas: cabelo cobre todo o topo
    for (let x = 4; x < 12; x++) {
      for (let y = 2; y < 7; y++) {
        px(ctx, ox + x, oy + y, hair, scale);
      }
    }
    // Pescoço (pequeno triângulo de pele)
    px(ctx, ox + 7, oy + 6, skin, scale);
    px(ctx, ox + 8, oy + 6, skin, scale);

    // Corpo
    for (let y = 7; y < 13; y++) {
      for (let x = 4; x < 12; x++) {
        px(ctx, ox + x, oy + y, shirt, scale);
      }
    }
    // Sombra
    for (let y = 7; y < 13; y++) px(ctx, ox + 11, oy + y, shirtShadow, scale);

    // Braços
    for (let y = 8; y < 12; y++) {
      px(ctx, ox + 3, oy + y, shirt, scale);
      px(ctx, ox + 12, oy + y, shirt, scale);
    }
    px(ctx, ox + 3, oy + 12, skin, scale);
    px(ctx, ox + 12, oy + 12, skin, scale);

    // Pernas
    for (let y = 13; y < 17; y++) {
      px(ctx, ox + 5, oy + y, pants, scale);
      px(ctx, ox + 6, oy + y, pants, scale);
      px(ctx, ox + 9, oy + y, pants, scale);
      px(ctx, ox + 10, oy + y, pants, scale);
    }
    // Sapatos
    if (step) {
      for (let x = 4; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 12; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    } else {
      for (let x = 5; x < 7; x++) px(ctx, ox + x, oy + 17, shoes, scale);
      for (let x = 9; x < 11; x++) px(ctx, ox + x, oy + 17, shoes, scale);
    }
  } else {
    // Perfil (left / right). Desenha "left" e espelha pra "right".
    const flip = direction === "right";
    const f = (x: number) => (flip ? 15 - x : x); // espelha em torno do centro

    // Cabelo
    for (let x = 5; x < 11; x++) {
      px(ctx, ox + f(x), oy + 2, hair, scale);
      px(ctx, ox + f(x), oy + 3, hair, scale);
    }
    px(ctx, ox + f(4), oy + 3, hair, scale);
    px(ctx, ox + f(4), oy + 4, hair, scale); // cabelo cobrindo orelha esquerda
    px(ctx, ox + f(11), oy + 3, hair, scale);

    // Rosto
    for (let x = 5; x < 11; x++) {
      for (let y = 4; y < 7; y++) px(ctx, ox + f(x), oy + y, skin, scale);
    }
    // Nariz (saliência à esquerda)
    px(ctx, ox + f(4), oy + 5, skin, scale);
    // Olho (só um, perfil)
    px(ctx, ox + f(6), oy + 5, outline, scale);

    // Corpo
    for (let y = 7; y < 13; y++) {
      for (let x = 5; x < 11; x++) px(ctx, ox + f(x), oy + y, shirt, scale);
    }
    // Sombra atrás
    for (let y = 7; y < 13; y++) px(ctx, ox + f(10), oy + y, shirtShadow, scale);

    // Braço da frente (visível, balança)
    const armOffset = step ? 1 : 0;
    for (let y = 8; y < 12; y++) px(ctx, ox + f(4), oy + y + armOffset, shirt, scale);
    px(ctx, ox + f(4), oy + 12 + armOffset, skin, scale);

    // Pernas (perfil)
    const legOffset = step ? 1 : 0;
    for (let y = 13; y < 17; y++) {
      px(ctx, ox + f(6), oy + y, pants, scale);
      px(ctx, ox + f(7), oy + y, pants, scale);
      px(ctx, ox + f(8), oy + y, pants, scale);
    }
    // Sapato
    for (let x = 5; x < 9; x++) px(ctx, ox + f(x), oy + 17 + legOffset, shoes, scale);
  }
}

function shadeColor(hex: string, percent: number): string {
  // percent negativo = mais escuro, positivo = mais claro
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/**
 * Gera spritesheet completo do avatar com a cor especificada.
 * Retorna o nome da textura registrada no Phaser.
 */
export function createAvatarTexture(scene: Phaser.Scene, key: string, color: string): string {
  if (scene.textures.exists(key)) return key;

  const SCALE = 2;
  const FRAME_W = 16 * SCALE;
  const FRAME_H = 20 * SCALE;
  const COLS = 2; // idle, step
  const ROWS = 4; // down, up, left, right

  const { canvas, ctx } = makeCanvas(FRAME_W * COLS, FRAME_H * ROWS);

  const directions: Array<"down" | "up" | "left" | "right"> = ["down", "up", "left", "right"];
  const colors: AvatarColors = {
    bodyColor: color,
    hairColor: pickHairColor(color),
    skinColor: "#f5cfa0",
    pantsColor: "#2c3e50",
  };

  directions.forEach((dir, row) => {
    [false, true].forEach((step, col) => {
      drawAvatarFrame(ctx, col * 16 + 0, row * 20 + 0, dir, step, colors, SCALE);
    });
  });

  scene.textures.addCanvas(key, canvas);

  // Registra os frames
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

function pickHairColor(bodyColor: string): string {
  // Varia a cor do cabelo de acordo com a cor da camisa, mas mantém naturais
  const hairOptions = ["#3b2c20", "#5d4037", "#8b4513", "#2c1810", "#4a3520"];
  // Hash simples do hex pra ter cabelo "consistente" pra mesma cor
  let h = 0;
  for (let i = 0; i < bodyColor.length; i++) h = (h * 31 + bodyColor.charCodeAt(i)) & 0xffffff;
  return hairOptions[Math.abs(h) % hairOptions.length];
}

/* ============================================================
 * MOBÍLIA DE ESCRITÓRIO
 * ============================================================ */

export function createFurnitureTextures(scene: Phaser.Scene) {
  createDesk(scene);
  createChair(scene);
  createMonitor(scene);
  createPlant(scene);
  createSofa(scene);
  createCoffeeTable(scene);
  createRug(scene);
  createWhiteboard(scene);
  createBookshelf(scene);
}

function createDesk(scene: Phaser.Scene) {
  if (scene.textures.exists("desk")) return;
  const SCALE = 2;
  const W = 48;
  const H = 28;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Topo da mesa (madeira clara)
  rect(ctx, 0, 4, W, 10, "#d4a373", SCALE);
  // Highlight no topo
  rect(ctx, 0, 4, W, 1, "#e8c39e", SCALE);
  // Borda inferior do topo
  rect(ctx, 0, 13, W, 1, "#a0784f", SCALE);

  // Pernas
  rect(ctx, 2, 14, 3, 12, "#8b6332", SCALE);
  rect(ctx, W - 5, 14, 3, 12, "#8b6332", SCALE);
  rect(ctx, 2, 14, 1, 12, "#a0784f", SCALE);
  rect(ctx, W - 5, 14, 1, 12, "#a0784f", SCALE);

  // Sombra no chão
  rect(ctx, 1, 26, W - 2, 2, "#00000044", SCALE);

  scene.textures.addCanvas("desk", canvas);
}

function createChair(scene: Phaser.Scene) {
  if (scene.textures.exists("chair")) return;
  const SCALE = 2;
  const W = 16;
  const H = 20;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Encosto
  rect(ctx, 4, 2, 8, 8, "#2c3e50", SCALE);
  rect(ctx, 4, 2, 8, 1, "#3a536e", SCALE); // highlight
  rect(ctx, 4, 9, 8, 1, "#1a242f", SCALE); // sombra

  // Assento
  rect(ctx, 3, 10, 10, 4, "#34495e", SCALE);
  rect(ctx, 3, 10, 10, 1, "#4a637c", SCALE);
  rect(ctx, 3, 13, 10, 1, "#1a242f", SCALE);

  // Base/pernas (rodízios)
  rect(ctx, 7, 14, 2, 4, "#7f8c8d", SCALE);
  rect(ctx, 4, 17, 8, 2, "#2c3e50", SCALE);
  px(ctx, 4, 18, "#1a1a1a", SCALE);
  px(ctx, 11, 18, "#1a1a1a", SCALE);

  // Sombra
  rect(ctx, 3, 19, 10, 1, "#00000044", SCALE);

  scene.textures.addCanvas("chair", canvas);
}

function createMonitor(scene: Phaser.Scene) {
  if (scene.textures.exists("monitor")) return;
  const SCALE = 2;
  const W = 20;
  const H = 16;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Tela (frame)
  rect(ctx, 1, 0, 18, 11, "#1a1a1a", SCALE);
  // Tela (display)
  rect(ctx, 2, 1, 16, 9, "#5dade2", SCALE);
  // Conteúdo da tela
  rect(ctx, 3, 2, 14, 1, "#85c1e2", SCALE); // header
  rect(ctx, 4, 4, 5, 1, "#ffffff", SCALE);
  rect(ctx, 4, 6, 8, 1, "#ffffff", SCALE);
  rect(ctx, 4, 8, 4, 1, "#ffffff", SCALE);

  // Pé do monitor
  rect(ctx, 8, 11, 4, 2, "#1a1a1a", SCALE);
  rect(ctx, 5, 13, 10, 2, "#1a1a1a", SCALE);

  scene.textures.addCanvas("monitor", canvas);
}

function createPlant(scene: Phaser.Scene) {
  if (scene.textures.exists("plant")) return;
  const SCALE = 2;
  const W = 16;
  const H = 24;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Folhas (várias camadas pra dar volume)
  const leafDark = "#2d5016";
  const leafMid = "#4a7c2c";
  const leafLight = "#6fa84e";

  // Camada de fundo
  for (let x = 2; x < 14; x++) {
    for (let y = 2; y < 14; y++) {
      if ((x - 8) * (x - 8) + (y - 8) * (y - 8) < 36) px(ctx, x, y, leafDark, SCALE);
    }
  }
  // Camada média
  for (let x = 3; x < 13; x++) {
    for (let y = 1; y < 12; y++) {
      if ((x - 8) * (x - 8) + (y - 7) * (y - 7) < 25) px(ctx, x, y, leafMid, SCALE);
    }
  }
  // Highlights
  px(ctx, 6, 4, leafLight, SCALE);
  px(ctx, 9, 3, leafLight, SCALE);
  px(ctx, 5, 7, leafLight, SCALE);
  px(ctx, 10, 6, leafLight, SCALE);
  px(ctx, 7, 10, leafLight, SCALE);
  px(ctx, 11, 9, leafLight, SCALE);

  // Vaso
  rect(ctx, 4, 14, 8, 8, "#8b4513", SCALE);
  rect(ctx, 4, 14, 8, 1, "#a0522d", SCALE); // highlight topo
  rect(ctx, 4, 21, 8, 1, "#5c2e0a", SCALE); // sombra base
  outlineRect(ctx, 4, 14, 8, 8, "#3a1f0a", SCALE);

  // Sombra no chão
  rect(ctx, 3, 22, 10, 1, "#00000044", SCALE);

  scene.textures.addCanvas("plant", canvas);
}

function createSofa(scene: Phaser.Scene) {
  if (scene.textures.exists("sofa")) return;
  const SCALE = 2;
  const W = 40;
  const H = 20;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  const main = "#c97b63";
  const dark = "#a25a44";
  const light = "#d99b85";

  // Encosto
  rect(ctx, 0, 0, W, 8, main, SCALE);
  rect(ctx, 0, 0, W, 1, light, SCALE);
  rect(ctx, 0, 7, W, 1, dark, SCALE);

  // Almofadas (divisão)
  rect(ctx, W / 2 - 1, 1, 1, 6, dark, SCALE);
  rect(ctx, 8, 2, 2, 4, light, SCALE);
  rect(ctx, W - 10, 2, 2, 4, light, SCALE);

  // Apoios laterais
  rect(ctx, 0, 4, 3, 14, main, SCALE);
  rect(ctx, W - 3, 4, 3, 14, main, SCALE);
  rect(ctx, 0, 4, 3, 1, light, SCALE);
  rect(ctx, W - 3, 4, 3, 1, light, SCALE);

  // Assento
  rect(ctx, 3, 8, W - 6, 8, main, SCALE);
  rect(ctx, 3, 8, W - 6, 1, light, SCALE);
  rect(ctx, 3, 15, W - 6, 1, dark, SCALE);
  // Divisão do assento
  rect(ctx, W / 2 - 1, 8, 1, 8, dark, SCALE);

  // Pés
  rect(ctx, 2, 16, 3, 3, "#3a1f0a", SCALE);
  rect(ctx, W - 5, 16, 3, 3, "#3a1f0a", SCALE);

  // Sombra
  rect(ctx, 1, 19, W - 2, 1, "#00000044", SCALE);

  scene.textures.addCanvas("sofa", canvas);
}

function createCoffeeTable(scene: Phaser.Scene) {
  if (scene.textures.exists("coffeeTable")) return;
  const SCALE = 2;
  const W = 24;
  const H = 14;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Topo
  rect(ctx, 0, 2, W, 6, "#3d2817", SCALE);
  rect(ctx, 0, 2, W, 1, "#5c3f25", SCALE);
  rect(ctx, 0, 7, W, 1, "#2a1c10", SCALE);

  // Pernas
  rect(ctx, 1, 8, 3, 4, "#2a1c10", SCALE);
  rect(ctx, W - 4, 8, 3, 4, "#2a1c10", SCALE);

  // Sombra
  rect(ctx, 0, 12, W, 2, "#00000033", SCALE);

  scene.textures.addCanvas("coffeeTable", canvas);
}

function createRug(scene: Phaser.Scene) {
  if (scene.textures.exists("rug")) return;
  const SCALE = 2;
  const W = 80;
  const H = 60;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Tapete bege com padrão
  rect(ctx, 0, 0, W, H, "#c9a87c", SCALE);
  // Borda
  outlineRect(ctx, 0, 0, W, H, "#8b6332", SCALE);
  outlineRect(ctx, 2, 2, W - 4, H - 4, "#a0784f", SCALE);

  // Padrão central simples
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = 10 + i * 12;
      const cy = 10 + j * 12;
      rect(ctx, cx, cy, 2, 2, "#8b6332", SCALE);
      rect(ctx, cx + 4, cy + 4, 2, 2, "#8b6332", SCALE);
    }
  }

  scene.textures.addCanvas("rug", canvas);
}

function createWhiteboard(scene: Phaser.Scene) {
  if (scene.textures.exists("whiteboard")) return;
  const SCALE = 2;
  const W = 40;
  const H = 28;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Moldura
  rect(ctx, 0, 0, W, H - 4, "#9ca3af", SCALE);
  // Superfície
  rect(ctx, 2, 2, W - 4, H - 10, "#f8fafc", SCALE);

  // "Escritos" no quadro
  rect(ctx, 5, 5, 10, 1, "#3b82f6", SCALE);
  rect(ctx, 5, 8, 14, 1, "#1e293b", SCALE);
  rect(ctx, 5, 11, 8, 1, "#1e293b", SCALE);
  rect(ctx, 5, 14, 12, 1, "#dc2626", SCALE);

  // Bandeja
  rect(ctx, 4, H - 4, W - 8, 2, "#6b7280", SCALE);
  // Pés
  rect(ctx, 6, H - 2, 2, 2, "#374151", SCALE);
  rect(ctx, W - 8, H - 2, 2, 2, "#374151", SCALE);

  scene.textures.addCanvas("whiteboard", canvas);
}

function createBookshelf(scene: Phaser.Scene) {
  if (scene.textures.exists("bookshelf")) return;
  const SCALE = 2;
  const W = 24;
  const H = 32;
  const { canvas, ctx } = makeCanvas(W * SCALE, H * SCALE);

  // Móvel (fundo)
  rect(ctx, 0, 0, W, H - 2, "#3d2817", SCALE);
  rect(ctx, 1, 1, W - 2, H - 4, "#5c3f25", SCALE);

  // Prateleiras (linhas horizontais)
  const shelves = [10, 18, 26];
  shelves.forEach((y) => {
    rect(ctx, 1, y, W - 2, 1, "#2a1c10", SCALE);
  });

  // Livros em cada prateleira
  const bookColors = ["#dc2626", "#16a34a", "#2563eb", "#ca8a04", "#9333ea", "#0891b2"];
  [2, 11, 19].forEach((shelfY) => {
    let x = 2;
    while (x < W - 4) {
      const w = 1 + Math.floor(((x + shelfY) * 7) % 3);
      const c = bookColors[(x + shelfY) % bookColors.length];
      const h = 6 + (((x * 3 + shelfY) % 3) - 1);
      rect(ctx, x, shelfY + (8 - h), w, h, c, SCALE);
      x += w + 1;
    }
  });

  // Sombra
  rect(ctx, 1, H - 1, W - 2, 1, "#00000044", SCALE);

  scene.textures.addCanvas("bookshelf", canvas);
}

/* ============================================================
 * TILES DE PISO
 * ============================================================ */

export function createFloorTextures(scene: Phaser.Scene) {
  createWoodFloorTile(scene);
  createCarpetTile(scene);
}

function createWoodFloorTile(scene: Phaser.Scene) {
  if (scene.textures.exists("floorWood")) return;
  const SCALE = 2;
  const SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE * SCALE, SIZE * SCALE);

  // Base
  rect(ctx, 0, 0, SIZE, SIZE, "#c9a87c", SCALE);

  // Tábuas horizontais
  const plankH = 8;
  for (let y = 0; y < SIZE; y += plankH) {
    // Sombra entre tábuas
    rect(ctx, 0, y + plankH - 1, SIZE, 1, "#8b6332", SCALE);
    // Variação de tom por tábua
    const variation = ((y / plankH) % 2 === 0) ? 0 : -5;
    if (variation) {
      rect(ctx, 0, y, SIZE, plankH - 1, shadeColor("#c9a87c", variation), SCALE);
    }
    // Veio da madeira (linha sutil)
    rect(ctx, 4, y + 3, 6, 1, "#a0784f", SCALE);
    rect(ctx, 18, y + 5, 8, 1, "#a0784f", SCALE);
  }

  scene.textures.addCanvas("floorWood", canvas);
}

function createCarpetTile(scene: Phaser.Scene) {
  if (scene.textures.exists("floorCarpet")) return;
  const SCALE = 2;
  const SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE * SCALE, SIZE * SCALE);

  // Carpete cinza com textura
  rect(ctx, 0, 0, SIZE, SIZE, "#475569", SCALE);

  // Padrão pontilhado
  for (let y = 0; y < SIZE; y += 2) {
    for (let x = (y % 4 === 0 ? 0 : 2); x < SIZE; x += 4) {
      px(ctx, x, y, "#3d4a5c", SCALE);
    }
  }

  scene.textures.addCanvas("floorCarpet", canvas);
}

/**
 * Cria animações reutilizáveis baseadas no spritesheet do avatar.
 * Chamar UMA vez por scene após criar a textura.
 */
export function createAvatarAnimations(scene: Phaser.Scene, key: string) {
  const animKey = (dir: string, type: "walk" | "idle") => `${key}_${dir}_${type}`;

  // Frames: 0=down idle, 1=down step, 2=up idle, 3=up step, 4=left idle, 5=left step, 6=right idle, 7=right step
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
