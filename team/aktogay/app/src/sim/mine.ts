/**
 * Геометрия карьера: несколько выработок (как на снимке Актогая) — у каждой чаша с уступами,
 * спиральные съезды и кольцевые бермы; бровки соединены дорогами; забои экскаваторов и
 * поверхностные объекты.
 */
import type { PitSpec, Point, SimConfig } from './config';
import { RoadGraph } from './graph';

export interface SiteNodes {
  node: number;
  access: number;
}

export interface ClosureGroup {
  label: string;
  edges: number[];
}

/** Стоянка у гаража: места, проезды между рядами и продольная полоса до въезда. */
export interface ParkingLayout {
  /** Система координат стоянки: въезд (узел гаража), ось «наружу от карьера» o и поперечная ось t. */
  frame: { cx: number; cy: number; ox: number; oy: number; tx: number; ty: number };
  cols: number;
  rows: number;
  /** Шаг мест поперёк, м; шаг рядов, м. */
  dx: number;
  dy: number;
  /** Расстояние от въезда до первого проезда; глубина места (от проезда до центра места), м. */
  aisle0: number;
  depth: number;
  /** Узлы мест (row-major). */
  slots: number[];
}

export interface MineLayout {
  graph: RoadGraph;
  rings: number[][];
  ringScales: number[];
  rampA: number[];
  rampB: number[];
  /** Дороги каждой выработки (pits[0] — главный карьер). */
  pits: PitLayout[];
  /** Выработка каждого забоя. */
  excavatorPit: number[];
  closureGroups: ClosureGroup[];
  excavators: SiteNodes[];
  crusher: SiteNodes;
  leach: SiteNodes;
  waste: SiteNodes;
  /** Дополнительные отвалы (в порядке cfg.sites.wasteExtra). */
  wasteExtra: SiteNodes[];
  garage: SiteNodes;
  parking: ParkingLayout;
  plant: Point;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Неровность контура выработки — чтобы чаша не выглядела идеальным эллипсом. */
export function pitWarp(theta: number, phase = 0): number {
  return 1 + 0.045 * Math.sin(3 * theta + 0.7 + phase) + 0.03 * Math.sin(5 * theta + 2.1 + phase * 1.7) + 0.02 * Math.sin(2 * theta + 0.3 + phase * 0.6);
}

/** Точка на «уступе» выработки с масштабом s (1 — бровка) под углом theta (в её собственной системе). */
export function pitPointOf(p: PitSpec, s: number, theta: number): Point {
  const w = pitWarp(theta, p.warpPhase);
  const lx = p.semiMajorM * s * w * Math.cos(theta);
  const ly = p.semiMinorM * s * w * Math.sin(theta);
  const r = (p.rotDeg * Math.PI) / 180;
  return { x: p.cx + lx * Math.cos(r) - ly * Math.sin(r), y: p.cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

/** Масштаб «уступа» выработки в точке (обратное к pitPointOf): < 1 — внутри чаши. */
export function pitScaleAt(p: PitSpec, x: number, y: number): number {
  const r = (p.rotDeg * Math.PI) / 180;
  const dx = x - p.cx;
  const dy = y - p.cy;
  const lx = dx * Math.cos(r) + dy * Math.sin(r);
  const ly = -dx * Math.sin(r) + dy * Math.cos(r);
  const th = Math.atan2(ly / p.semiMinorM, lx / p.semiMajorM);
  return Math.hypot(lx / p.semiMajorM, ly / p.semiMinorM) / pitWarp(th, p.warpPhase);
}

/** Точка главного карьера (совместимость со старым кодом). */
export function pitPoint(cfg: SimConfig, s: number, theta: number): Point {
  return pitPointOf(cfg.pits[0], s, theta);
}

export function pitScaleAtDepth(p: PitSpec, u: number): number {
  return 1 - u * (1 - p.bottomScale);
}

export function scaleAtDepth(cfg: SimConfig, u: number): number {
  return pitScaleAtDepth(cfg.pits[0], u);
}

/** Дороги одной выработки. */
export interface PitLayout {
  rings: number[][];
  ringScales: number[];
  ramps: number[][];
}

/** Съезды и кольцевые бермы выработки pi; участки съездов — в closureGroups. */
function buildPit(g: RoadGraph, p: PitSpec, pi: number, closureGroups: ClosureGroup[]): PitLayout {
  const N = p.rampNodes;
  const M = p.ringNodes;
  const turn = p.rampTurns * 2 * Math.PI;
  const nR = p.rampStartsDeg.length;
  const start0 = (p.rampStartsDeg[0] * Math.PI) / 180;
  const ramps: number[][] = p.rampStartsDeg.map((deg) => {
    const theta0 = (deg * Math.PI) / 180;
    const ids: number[] = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const q = pitPointOf(p, pitScaleAtDepth(p, u), theta0 + u * turn);
      ids.push(g.addNode(q.x, q.y, 'ramp'));
      if (i > 0) g.addEdge(ids[i - 1], ids[i], 'ramp');
    }
    return ids;
  });
  const rampIdx = p.ringLevels.map((u) => Math.round(u * (N - 1)));
  const rings: number[][] = [];
  const ringScales: number[] = [];
  const step = M / nR; // съезды — через равные доли кольца
  p.ringLevels.forEach((u, r) => {
    const sc = pitScaleAtDepth(p, u);
    ringScales.push(sc);
    const thetaA = start0 + u * turn;
    const ids: number[] = [];
    for (let j = 0; j < M; j++) {
      if (j % step === 0) ids.push(ramps[j / step][rampIdx[r]]);
      else {
        const q = pitPointOf(p, sc, thetaA + (j * 2 * Math.PI) / M);
        ids.push(g.addNode(q.x, q.y, 'ring'));
      }
    }
    for (let j = 0; j < M; j++) g.addEdge(ids[j], ids[(j + 1) % M], r === 0 ? 'rim' : 'ring');
    rings.push(ids);
  });
  ramps.forEach((ramp, k) => {
    for (let r = 0; r + 1 < rampIdx.length; r++) {
      const edges: number[] = [];
      for (let i = rampIdx[r]; i < rampIdx[r + 1]; i++) edges.push(g.edgeBetween(ramp[i], ramp[i + 1])!);
      closureGroups.push({ label: `${p.rampNames[k]}${pi > 0 ? '' : ''}, горизонты ${r}–${r + 1}`, edges });
    }
  });
  return { rings, ringScales, ramps };
}

export function buildMine(cfg: SimConfig): MineLayout {
  const g = new RoadGraph();
  const closureGroups: ClosureGroup[] = [];
  const pits = cfg.pits.map((p, pi) => buildPit(g, p, pi, closureGroups));
  const main = pits[0];
  const rings = main.rings;
  const ringScales = main.ringScales;
  const rampA = main.ramps[0];
  const rampB = main.ramps[1] ?? main.ramps[0];

  // Забои экскаваторов: короткий заезд от бермы своей выработки к забою.
  const excavatorPit: number[] = [];
  const excavators = cfg.excavators.map((spec) => {
    const pi = Math.min(Math.max(spec.pit ?? 0, 0), pits.length - 1);
    excavatorPit.push(pi);
    const p = cfg.pits[pi];
    const pl = pits[pi];
    const M = p.ringNodes;
    const step = M / p.rampStartsDeg.length;
    const r = Math.min(Math.max(spec.ring, 1), pl.rings.length - 1);
    const thetaA = (p.rampStartsDeg[0] * Math.PI) / 180 + p.ringLevels[r] * p.rampTurns * 2 * Math.PI;
    const target = (spec.angleDeg * Math.PI) / 180;
    let bestJ = 1;
    let bestD = Infinity;
    for (let j = 0; j < M; j++) {
      if (j % step === 0) continue; // не ставим забой прямо на развязке со съездом
      const th = thetaA + (j * 2 * Math.PI) / M;
      const d = Math.abs(Math.atan2(Math.sin(th - target), Math.cos(th - target)));
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    const access = pl.rings[r][bestJ];
    const th = thetaA + (bestJ * 2 * Math.PI) / M;
    const q = pitPointOf(p, pl.ringScales[r] - 0.045, th);
    const node = g.addNode(q.x, q.y, 'face');
    g.addEdge(access, node, 'spur');
    return { node, access };
  });

  // Дороги по бровкам выработок соединены между собой (ближайшие точки).
  for (let a = 0; a < pits.length; a++)
    for (let b = a + 1; b < pits.length; b++) {
      let best: [number, number] = [pits[a].rings[0][0], pits[b].rings[0][0]];
      let bd = Infinity;
      for (const ia of pits[a].rings[0])
        for (const ib of pits[b].rings[0]) {
          const d = Math.hypot(g.nodes[ia].x - g.nodes[ib].x, g.nodes[ia].y - g.nodes[ib].y);
          if (d < bd) {
            bd = d;
            best = [ia, ib];
          }
        }
      if (bd < 700) g.addEdge(best[0], best[1], 'surface');
    }

  const rim = pits.flatMap((pl) => pl.rings[0]);
  const nearestOf = (ids: number[], pt: Point): number => {
    let id0 = ids[0];
    let bd = Infinity;
    for (const id of ids) {
      const n = g.nodes[id];
      const d = Math.hypot(n.x - pt.x, n.y - pt.y);
      if (d < bd) {
        bd = d;
        id0 = id;
      }
    }
    return id0;
  };
  // Дороги на поверхности по снимку: точки с одинаковыми координатами — общие узлы (развилки).
  const roadNodes: number[] = [];
  const roadNodeAt = (pt: Point): number => {
    for (const id of roadNodes) {
      const n = g.nodes[id];
      if (Math.hypot(n.x - pt.x, n.y - pt.y) < 5) return id;
    }
    const id = g.addNode(pt.x, pt.y, 'junction');
    roadNodes.push(id);
    return id;
  };
  for (const road of cfg.haulRoads ?? []) {
    let prev = road.fromRim ? nearestOf(rim, road.pts[0]) : -1;
    for (const pt of road.pts) {
      const id = roadNodeAt(pt);
      if (prev >= 0 && prev !== id && !g.edgeBetween(prev, id)) g.addEdge(prev, id, 'surface');
      prev = id;
    }
  }
  const surfaceNodes = [...rim, ...roadNodes];
  const attach = (pt: Point): SiteNodes => {
    let access = surfaceNodes[0];
    let best = Infinity;
    for (const id of surfaceNodes) {
      const n = g.nodes[id];
      const d = Math.hypot(n.x - pt.x, n.y - pt.y);
      if (d < best) {
        best = d;
        access = id;
      }
    }
    const node = g.addNode(pt.x, pt.y, 'site');
    g.addEdge(access, node, 'surface');
    return { node, access };
  };

  const crusher = attach(cfg.sites.crusher);
  const leach = attach(cfg.sites.leach);
  const waste = attach(cfg.sites.waste);
  const wasteExtra = cfg.sites.wasteExtra.map((w) => attach(w));
  const garage = attach(cfg.sites.garage);
  const parking = buildParking(g, garage.node);

  // Границы с запасом под площадки (их контуры рисуются дальше от карьера, чем узел дороги).
  const extra = [cfg.sites.plant, cfg.sites.leach, cfg.sites.waste, ...cfg.sites.wasteExtra, cfg.sites.garage].flatMap((p) => {
    const l = Math.hypot(p.x, p.y) || 1;
    return [p, { x: p.x + (p.x / l) * 420, y: p.y + (p.y / l) * 420 }];
  });
  const xs = [...g.nodes.map((n) => n.x), ...extra.map((p) => p.x)];
  const ys = [...g.nodes.map((n) => n.y), ...extra.map((p) => p.y)];
  const pad = 120;
  const bounds = {
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad,
    maxY: Math.max(...ys) + pad,
  };

  return {
    graph: g,
    rings,
    ringScales,
    rampA,
    rampB,
    pits,
    excavatorPit,
    closureGroups,
    excavators,
    crusher,
    leach,
    waste,
    wasteExtra,
    garage,
    parking,
    plant: cfg.sites.plant,
    bounds,
  };
}

/**
 * Стоянка: ряды мест «носом от карьера». Перед каждым рядом — проезд, слева — продольная
 * полоса, связывающая проезды с въездом. Самосвал заезжает на место вперёд и выезжает задним ходом.
 */
function buildParking(g: RoadGraph, entrance: number): ParkingLayout {
  const n = g.nodes[entrance];
  const l = Math.hypot(n.x, n.y) || 1;
  const frame = { cx: n.x, cy: n.y, ox: n.x / l, oy: n.y / l, tx: -n.y / l, ty: n.x / l };
  const P = { cols: 6, rows: 5, dx: 95, dy: 150, aisle0: 40, depth: 70 };
  const at = (along: number, cross: number) => ({
    x: frame.cx + frame.ox * along + frame.tx * cross,
    y: frame.cy + frame.oy * along + frame.ty * cross,
  });
  const crossOf = (c: number) => (c - (P.cols - 1) / 2) * P.dx;
  const spineCross = crossOf(0) - P.dx * 0.9;
  const slots: number[] = [];
  let prevSpine = -1;
  for (let r = 0; r < P.rows; r++) {
    const aisleAlong = P.aisle0 + r * P.dy;
    const sp = at(aisleAlong, spineCross);
    const spine = g.addNode(sp.x, sp.y, 'junction');
    if (prevSpine >= 0) g.addEdge(prevSpine, spine, 'lot');
    prevSpine = spine;
    let prev = spine;
    for (let c = 0; c < P.cols; c++) {
      const a = at(aisleAlong, crossOf(c));
      const aisle = g.addNode(a.x, a.y, 'junction');
      g.addEdge(prev, aisle, 'lot');
      prev = aisle;
      const p = at(aisleAlong + P.depth, crossOf(c));
      const slot = g.addNode(p.x, p.y, 'slot');
      g.addEdge(aisle, slot, 'park');
      slots.push(slot);
      // Въезд связан с первым проездом напрямую — по центру стоянки.
      if (r === 0 && (c === Math.floor((P.cols - 1) / 2) || c === Math.ceil((P.cols - 1) / 2))) g.addEdge(entrance, aisle, 'lot');
    }
    if (r === 0) g.addEdge(entrance, spine, 'lot');
  }
  return { frame, ...P, slots };
}
