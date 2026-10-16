/**
 * Рельеф карьера без 3D: высота борта и дна в любой точке (м). Общий для 3D-сцены, геологии и сервиса
 * (сервис публикует двойник геологии и не тянет за собой Three.js).
 */
import type { SimConfig } from '../sim/config';
import { pitWarp } from '../sim/mine';

/** Глубина карьера, м. Оценка: порядок сотен метров. */
export const PIT_DEPTH = 240; // реальный Актогай — до ~230 м (открытые источники, 2024)
/** Доля «ступенчатости» рельефа: 1 — чистые уступы, 0 — гладкий конус. */
export const TERRACE = 0.65;
/** Доля бермы в шаге уступа (остальное — откос). */
export const BERM = 0.55;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Глубина в долях (0 — бровка, 1 — дно) по масштабу эллипса s. */
export function depthFrac(cfg: SimConfig, s: number): number {
  return Math.min(1, Math.max(0, (1 - s) / (1 - cfg.pit.bottomScale)));
}

export function heightFromS(cfg: SimConfig, s: number, x: number, y: number): number {
  if (s >= 1) {
    // Поверхность вокруг: лёгкие холмы, плавно нарастающие от бровки.
    const k = smoothstep(1, 1.5, s);
    return k * (7 * Math.sin(x * 0.0021 + 1.3) * Math.cos(y * 0.0027) + 4 * Math.sin(x * 0.006 + y * 0.004));
  }
  const n = cfg.pit.benchCount;
  const u = depthFrac(cfg, s);
  const step = u * n;
  const terr = (Math.floor(step) + smoothstep(BERM, 1, step - Math.floor(step))) / n;
  return -PIT_DEPTH * Math.min(1, TERRACE * terr + (1 - TERRACE) * u);
}

export function scaleAt(cfg: SimConfig, x: number, y: number): number {
  const a = cfg.pit.semiMajorM;
  const b = cfg.pit.semiMinorM;
  const th = Math.atan2(y / b, x / a);
  return Math.hypot(x / a, y / b) / pitWarp(th);
}

/** Высота рельефа в произвольной точке (м). */
export function makeHeightAt(cfg: SimConfig): (x: number, y: number) => number {
  return (x, y) => heightFromS(cfg, scaleAt(cfg, x, y), x, y);
}
