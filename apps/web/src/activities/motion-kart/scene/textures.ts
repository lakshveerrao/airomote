/**
 * Procedural canvas textures for the kart world. Everything is generated at runtime so the
 * game ships with zero binary assets and works offline.
 */
import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, opts: { repeat?: [number, number]; srgb?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.anisotropy = opts.anisotropy ?? 8;
  return t;
}

/** Soft radial disc: particles, halos, cloud puffs. */
export function softDiscTexture(size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
}

/** Fluffy cloud: several overlapping soft blobs. */
export function cloudTexture(seed = 1, size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  let a = seed >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 14; i++) {
    const x = size * (0.25 + rnd() * 0.5);
    const y = size * (0.42 + rnd() * 0.25);
    const r = size * (0.12 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return finish(c);
}

/** Asphalt / dirt surface noise, tiled along the road. */
export function roadTexture(base: string, speck: string, dirt = false, size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let a = 7;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < (dirt ? 2600 : 4200); i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? speck : `rgba(0,0,0,${0.08 + rnd() * 0.18})`;
    const s = dirt ? 1 + rnd() * 3 : 1 + rnd() * 1.6;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
  if (dirt) {
    // wheel ruts
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (const x of [size * 0.28, size * 0.72]) ctx.fillRect(x - 10, 0, 20, size);
  }
  return finish(c, { repeat: [1, 1] });
}

/** Ground detail (grass blades / sand grain) tiled over the terrain. */
export function groundTexture(base: string, dark: string, light: string, size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let a = 99;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.25 + rnd() * 0.45;
    const w = 1 + rnd() * 2;
    ctx.fillRect(rnd() * size, rnd() * size, w, w * (1 + rnd() * 2));
  }
  ctx.globalAlpha = 1;
  return finish(c, { repeat: [60, 60] });
}

/** Checkered flag pattern. */
export function checkerTexture(cols = 8, rows = 2, cell = 32): THREE.CanvasTexture {
  const [c, ctx] = canvas(cols * cell, rows * cell);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#0d0d10' : '#f6f6f2';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  return finish(c);
}

/** Sponsor / circuit banner: bold text on a coloured board with a thin border. */
export function bannerTexture(text: string, bg: string, fg: string, opts: { sub?: string; width?: number; height?: number; stripe?: string } = {}): THREE.CanvasTexture {
  const w = opts.width ?? 1024;
  const h = opts.height ?? 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (opts.stripe) {
    ctx.fillStyle = opts.stripe;
    ctx.fillRect(0, h - 22, w, 22);
    ctx.fillRect(0, 0, 26, h);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = opts.sub ? h * 0.46 : h * 0.6;
  ctx.font = `900 ${size}px "Segoe UI", Inter, system-ui, Arial, sans-serif`;
  ctx.letterSpacing = '6px';
  ctx.fillText(text.toUpperCase(), w / 2, opts.sub ? h * 0.4 : h / 2 + 4, w * 0.92);
  if (opts.sub) {
    ctx.font = `700 ${h * 0.2}px "Segoe UI", Inter, system-ui, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(opts.sub.toUpperCase(), w / 2, h * 0.76, w * 0.9);
  }
  return finish(c, { anisotropy: 16 });
}

/** Round team emblem for the kart nose / helmet. */
export function emblemTexture(letter: string, ring: string, fill = '#ffffff', size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.fillStyle = ring;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${size * 0.6}px "Segoe UI", Inter, system-ui, Arial, sans-serif`;
  ctx.fillText(letter, size / 2, size / 2 + size * 0.03);
  return finish(c);
}

/** Tyre-wall / barrier stripes. */
export function stripeTexture(a: string, b: string, size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size / 4);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size, size / 4);
  ctx.fillStyle = b;
  ctx.fillRect(size / 2, 0, size / 2, size / 4);
  return finish(c, { repeat: [1, 1] });
}
