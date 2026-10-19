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
import { insidePits, makeHeightAt, PIT_DEPTH, pitsBounds } from './relief';
import type { Simulation } from '../sim/engine';

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
  const target = (e: Simulation['excavators'][number]) => (e.material === 'waste' ? 0.07 : e.gradeBase);
  const ctrl = [
    ...sim.excavators.map((e) => ({ x: e.x, y: e.y, z: surface(e.x, e.y), target: target(e), delta: 0 })),
    // Буровой блок экскаватора — та же порода, что он грузит (вскрышной блок не должен оказаться рудным).
    ...sim.drill.blocks.map((bl) => ({ x: bl.x, y: bl.y, z: surface(bl.x, bl.y) - 8, target: target(sim.excavators[bl.exId]), delta: 0 })),
  ];
  const raw = (x: number, y: number, z: number) => {
    let v = base(x, y, z);
    for (const c of ctrl) {
      const w = Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (2 * 230 ** 2) - (z - c.z) ** 2 / (2 * 160 ** 2));
      v += c.delta * w;
    }
    return v;
  };
  // Поправки влияют друг на друга — подгоняем в несколько проходов.
  for (let it = 0; it < 60; it++) for (const c of ctrl) c.delta += c.target - raw(c.x, c.y, c.z);
  const cu = (x: number, y: number, z: number) => Math.max(0.01, raw(x, y, z));
  // Зона окисления: ~95–125 м от поверхности, граница неровная.
  const oxideBase0 = (x: number, y: number) => -(110 + 18 * fbm(x / 300 + 40, y / 300, 3));
  // Забой и буровой блок оксидного экскаватора должны лежать в зоне окисления — там граница глубже.
  const oxidePts = ctrl
    .filter((_, i) => {
      const e = i < sim.excavators.length ? sim.excavators[i] : sim.excavators[sim.drill.blocks[i - sim.excavators.length].exId];
      return e.material === 'oxide';
    })
    .map((c) => ({ x: c.x, y: c.y, need: Math.max(0, oxideBase0(c.x, c.y) - c.z + 20) }));
  const oxideBase = (x: number, y: number) => {
    let zb = oxideBase0(x, y);
    for (const o of oxidePts) zb -= o.need * Math.exp(-((x - o.x) ** 2 + (y - o.y) ** 2) / (2 * 180 ** 2));
    return zb;
  };
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

export interface HoleAssay {
  x: number;
  y: number;
  z: number;
  cu: number;
  block: number;
}

/** Пробы шлама: все скважины, пробуренные на буровых блоках (середина 16-метровой скважины). */
export function holeAssays(sim: Simulation, m: OreModel): HoleAssay[] {
  const out: HoleAssay[] = [];
  sim.drill.blocks.forEach((b, bi) => {
    for (let j = 0; j < b.holesDone; j++) {
      const p = sim.drill.holePos(b, j);
      const z = m.surface(p.x, p.y) - 8;
      out.push({ x: p.x, y: p.y, z, cu: xrfAssay(m, p.x, p.y, z, bi * 100 + j), block: bi });
    }
  });
  return out;
}

export type BlockDest = 'plant' | 'leach' | 'dump' | 'unknown';
export const DEST_RU: Record<BlockDest, string> = { plant: 'на фабрику', leach: 'на выщелачивание', dump: 'в отвал', unknown: '—' };

/** Рудный контроль по буровому блоку: среднее по пробам и куда пойдёт взорванная масса. */
export function blockSummary(sim: Simulation, holes: HoleAssay[]) {
  return sim.drill.blocks.map((b, bi) => {
    const hs = holes.filter((h) => h.block === bi);
    const avg = hs.length ? hs.reduce((n, h) => n + h.cu, 0) / hs.length : null;
    const ex = sim.excavators[b.exId];
    const dest: BlockDest = avg === null ? 'unknown' : avg < CUTOFF ? 'dump' : ex.material === 'oxide' ? 'leach' : 'plant';
    return { exId: b.exId, name: ex.name, n: hs.length, total: b.holesTotal, avg, ore: hs.filter((h) => h.cu >= CUTOFF).length, dest };
  });
}

/** Запасы под текущей поверхностью карьера в контуре бровки, до отметки zBottom. */
export function pitResources(sim: Simulation, m: OreModel, zBottom = -480) {
  const b = pitsBounds(sim.cfg);
  let sT = 0, sCu = 0, oT = 0, oCu = 0, wT = 0;
  const step = BLOCK_M * 2; // для сводки достаточно блоков 50 м
  const t = BLOCK_T * 4;
  for (let z = -BENCH_M / 2; z > zBottom; z -= BENCH_M)
    for (let x = b.minX; x <= b.maxX; x += step)
      for (let y = b.minY; y <= b.maxY; y += step) {
        if (!insidePits(sim.cfg, x, y) || m.surface(x, y) < z) continue;
        const zone = m.zone(x, y, z);
        const cu = m.cu(x, y, z);
        if (zone === 'sulfide') { sT += t; sCu += cu * t; }
        else if (zone === 'oxide') { oT += t; oCu += cu * t; }
        else wT += t;
      }
  return { sulfideT: sT, oxideT: oT, wasteT: wT, sulfideCu: sT ? sCu / sT : 0, oxideCu: oT ? oCu / oT : 0, cuT: (sCu + oCu) / 100, strip: sT + oT ? wT / (sT + oT) : 0 };
}
