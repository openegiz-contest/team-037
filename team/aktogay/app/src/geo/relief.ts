/**
 * Рельеф карьера без 3D: высота бортов и дна в любой точке (м). Общий для 3D-сцены, геологии и сервиса
 * (сервис публикует двойник геологии и не тянет за собой Three.js).
 *
 * Карьер — несколько выработок (как на снимке Актогая): у каждой своя чаша с уступами по 15 м.
 * Высота в точке — самая глубокая из чаш; снаружи — степь с лёгкими холмами.
 */
import { DEFAULT_CONFIG, type PitSpec, type SimConfig } from '../sim/config';
import { pitScaleAt } from '../sim/mine';

/** Наибольшая глубина карьера, м (главная выработка; у реального Актогая — до ~230 м). */
export const PIT_DEPTH = Math.max(...DEFAULT_CONFIG.pits.map((p) => p.depthM));
/** Доля «ступенчатости» рельефа: 1 — чистые уступы, 0 — гладкий конус. */
export const TERRACE = 0.65;
/** Доля бермы в шаге уступа (остальное — откос). */
export const BERM = 0.55;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Глубина в долях (0 — бровка, 1 — дно) по масштабу s выработки. */
export function pitDepthFrac(p: PitSpec, s: number): number {
  return Math.min(1, Math.max(0, (1 - s) / (1 - p.bottomScale)));
}

/** Высота внутри чаши выработки (s < 1), м: уступы — берма + откос. */
export function pitHeight(p: PitSpec, s: number): number {
  const n = p.benchCount;
  const u = pitDepthFrac(p, s);
  const step = u * n;
  const terr = (Math.floor(step) + smoothstep(BERM, 1, step - Math.floor(step))) / n;
  return -p.depthM * Math.min(1, TERRACE * terr + (1 - TERRACE) * u);
}

/** Поверхность вокруг: лёгкие холмы, плавно нарастающие от бровок. sMin — ближайшая бровка в масштабах выработок. */
export function surfaceHeight(sMin: number, x: number, y: number): number {
  const k = smoothstep(1, 1.5, sMin);
  return k * (7 * Math.sin(x * 0.0021 + 1.3) * Math.cos(y * 0.0027) + 4 * Math.sin(x * 0.006 + y * 0.004));
}

export interface PitHit {
  /** Индекс выработки (самой глубокой в точке) или -1 — снаружи всех. */
  pit: number;
  /** Масштаб уступа в этой выработке и наименьший по всем (для поверхности). */
  s: number;
  sMin: number;
  /** Доля глубины (0 — бровка, 1 — дно). */
  u: number;
  h: number;
}

/** Что в точке: какая выработка, на какой глубине. */
export function pitAt(cfg: SimConfig, x: number, y: number): PitHit {
  let sMin = Infinity;
  let best = -1;
  let bestH = Infinity;
  let bestS = Infinity;
  cfg.pits.forEach((p, i) => {
    const s = pitScaleAt(p, x, y);
    if (s < sMin) sMin = s;
    if (s < 1) {
      const h = pitHeight(p, s);
      if (h < bestH) {
        bestH = h;
        best = i;
        bestS = s;
      }
    }
  });
  if (best < 0) return { pit: -1, s: sMin, sMin, u: 0, h: surfaceHeight(sMin, x, y) };
  return { pit: best, s: bestS, sMin, u: pitDepthFrac(cfg.pits[best], bestS), h: bestH };
}

/** Внутри какой-нибудь выработки (k < 1 — с отступом от бровки внутрь). */
export function insidePits(cfg: SimConfig, x: number, y: number, k = 1): boolean {
  return cfg.pits.some((p) => pitScaleAt(p, x, y) < k);
}

/** Прямоугольник, охватывающий все выработки, м. */
export function pitsBounds(cfg: SimConfig, pad = 0): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of cfg.pits) {
    const r = Math.max(p.semiMajorM, p.semiMinorM) * 1.06;
    minX = Math.min(minX, p.cx - r);
    maxX = Math.max(maxX, p.cx + r);
    minY = Math.min(minY, p.cy - r);
    maxY = Math.max(maxY, p.cy + r);
  }
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

/** Высота рельефа в произвольной точке (м). */
export function makeHeightAt(cfg: SimConfig): (x: number, y: number) => number {
  return (x, y) => pitAt(cfg, x, y).h;
}
