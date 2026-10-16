/**
 * Модель рудного тела (блочная модель месторождения) для раздела «Геология».
 *
 * Медно-порфировое месторождение: богатое ядро, вытянутое вдоль карьера, содержание падает к краям;
 * сверху — зона окисления (оксидная руда), ниже — сульфидная; за бортом рудного тела — пустая порода.
 * Модель подогнана к забоям экскаваторов: в точке каждого забоя содержание совпадает с тем, что
 * экскаватор реально грузит в модели добычи (у вскрышных — ниже бортового содержания).
 *
 * Геология постоянна и от seed смены не зависит. Модель добычи её не использует — бенчмарк не меняется.
 */
import { makeHeightAt, PIT_DEPTH } from '../render3d/terrain';
import type { Simulation } from '../sim';

export type Zone = 'oxide' | 'sulfide' | 'waste';

/** Бортовое содержание: ниже — пустая порода (в отвал), % Cu. */
export const CUTOFF = 0.2;
/** Размер блока модели, м (в плане) и высота уступа, м. */
export const BLOCK_M = 25;
export const BENCH_M = 15;
/** Плотность руды, т/м³. */
export const DENSITY = 2.7;
export const BLOCK_T = BLOCK_M * BLOCK_M * BENCH_M * DENSITY;

export interface OreModel {
  /** Содержание меди, %. z — отметка (0 — поверхность, вниз отрицательная), м. */
  cu(x: number, y: number, z: number): number;
  zone(x: number, y: number, z: number): Zone;
  /** Нижняя граница зоны окисления, м (отрицательная). */
  oxideBase(x: number, y: number): number;
  /** Текущая поверхность карьера (борта и дно), м. */
  surface(x: number, y: number): number;
  /** Отметки горизонтов (середины уступов) сверху вниз до дна карьера. */
  benches: number[];
}

// Детерминированный гладкий шум (value noise) — неоднородность рудного тела.
function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * (3 - 2 * t);
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}
/** Шум −1…1 из двух октав. */
const fbm = (x: number, y: number, z: number) => (noise3(x, y, z) * 0.65 + noise3(x * 2.3 + 17, y * 2.3 + 5, z * 2.3 + 11) * 0.35) * 2 - 1;

export function buildOreModel(sim: Simulation): OreModel {
  const surface = makeHeightAt(sim.cfg);
  const sulf = sim.excavators.filter((e) => e.material === 'sulfide');
  // Ядро порфира — между сульфидными забоями, ближе к богатому.
  const wsum = sulf.reduce((n, e) => n + e.gradeBase, 0) || 1;
  const cx = sulf.reduce((n, e) => n + e.x * e.gradeBase, 0) / wsum;
  const cy = sulf.reduce((n, e) => n + e.y * e.gradeBase, 0) / wsum;

  const trend = (x: number, y: number, z: number) => {
    const r2 = ((x - cx) / 950) ** 2 + ((y - cy) / 540) ** 2;
    const deep = 0.88 + 0.12 * Math.min(1, -z / 400);
    return 0.5 * Math.exp(-r2 / 2) * deep;
  };
  const base = (x: number, y: number, z: number) => trend(x, y, z) + 0.07 * fbm(x / 160, y / 160, z / 90);

  // Подгонка к забоям: в точке забоя — то, что грузит экскаватор (вскрыша — заведомо ниже бортового).
  const ctrl = sim.excavators.map((e) => ({ x: e.x, y: e.y, z: surface(e.x, e.y), target: e.material === 'waste' ? 0.07 : e.gradeBase, delta: 0 }));
  const raw = (x: number, y: number, z: number) => {
    let v = base(x, y, z);
    for (const c of ctrl) {
      const w = Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (2 * 230 ** 2) - (z - c.z) ** 2 / (2 * 160 ** 2));
      v += c.delta * w;
    }
    return v;
  };
  // Поправки влияют друг на друга — подгоняем в несколько проходов.
  for (let it = 0; it < 12; it++) for (const c of ctrl) c.delta += c.target - raw(c.x, c.y, c.z);
  const cu = (x: number, y: number, z: number) => Math.max(0.01, raw(x, y, z));
  // Зона окисления: ~95–125 м от поверхности, граница неровная.
  const oxideBase = (x: number, y: number) => -(110 + 18 * fbm(x / 300 + 40, y / 300, 3));
  const zone = (x: number, y: number, z: number): Zone => {
    if (cu(x, y, z) < CUTOFF) return 'waste';
    return z > oxideBase(x, y) ? 'oxide' : 'sulfide';
  };
  const benches: number[] = [];
  for (let z = -BENCH_M / 2; z > -PIT_DEPTH; z -= BENCH_M) benches.push(z);
  return { cu, zone, oxideBase, surface, benches };
}

/** Замер XRF шлама взрывной скважины: модель + погрешность пробы (детерминированно по номеру). */
export function xrfAssay(m: OreModel, x: number, y: number, z: number, k: number): number {
  const err = (hash(Math.round(x), Math.round(y), k) - 0.5) * 0.06;
  return Math.max(0.01, m.cu(x, y, z) + err);
}
