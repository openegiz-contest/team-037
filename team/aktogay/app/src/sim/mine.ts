/**
 * Генерация стилизованной геометрии карьера: эллиптическая чаша с уступами,
 * два спиральных съезда (восточный и западный), кольцевые бермы на нескольких горизонтах,
 * забои экскаваторов и поверхностные объекты.
 */
import type { Point, SimConfig } from './config';
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
  closureGroups: ClosureGroup[];
  excavators: SiteNodes[];
  crusher: SiteNodes;
  leach: SiteNodes;
  waste: SiteNodes;
  garage: SiteNodes;
  parking: ParkingLayout;
  plant: Point;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Неровность контура карьера — чтобы чаша не выглядела идеальным эллипсом. */
export function pitWarp(theta: number): number {
  return 1 + 0.045 * Math.sin(3 * theta + 0.7) + 0.03 * Math.sin(5 * theta + 2.1) + 0.02 * Math.sin(2 * theta + 0.3);
}

/** Точка на «уступе» с масштабом s (1 — бровка) под углом theta. */
export function pitPoint(cfg: SimConfig, s: number, theta: number): Point {
  const w = pitWarp(theta);
  return {
    x: cfg.pit.semiMajorM * s * w * Math.cos(theta),
    y: cfg.pit.semiMinorM * s * w * Math.sin(theta),
  };
}

export function scaleAtDepth(cfg: SimConfig, u: number): number {
  return 1 - u * (1 - cfg.pit.bottomScale);
}

const RAMP_NAMES = ['Восточный съезд', 'Западный съезд'];

export function buildMine(cfg: SimConfig): MineLayout {
  const g = new RoadGraph();
  const { rampNodes: N, rampTurns, ringLevels, ringNodes: M } = cfg.pit;
  const turn = rampTurns * 2 * Math.PI;

  // Два спиральных съезда, сдвинутых на 180°.
  const ramps: number[][] = [0, Math.PI].map((theta0) => {
    const ids: number[] = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const p = pitPoint(cfg, scaleAtDepth(cfg, u), theta0 + u * turn);
      ids.push(g.addNode(p.x, p.y, 'ramp'));
      if (i > 0) g.addEdge(ids[i - 1], ids[i], 'ramp');
    }
    return ids;
  });
  const [rampA, rampB] = ramps;

  // Кольцевые бермы на горизонтах ringLevels (кольцо 0 — дорога по бровке).
  const rampIdx = ringLevels.map((u) => Math.round(u * (N - 1)));
  const rings: number[][] = [];
  const ringScales: number[] = [];
  ringLevels.forEach((u, r) => {
    const s = scaleAtDepth(cfg, u);
    ringScales.push(s);
    const thetaA = u * turn;
    const ids: number[] = [];
    for (let j = 0; j < M; j++) {
      if (j === 0) ids.push(rampA[rampIdx[r]]);
      else if (j === M / 2) ids.push(rampB[rampIdx[r]]);
      else {
        const p = pitPoint(cfg, s, thetaA + (j * 2 * Math.PI) / M);
        ids.push(g.addNode(p.x, p.y, 'ring'));
      }
    }
    for (let j = 0; j < M; j++) g.addEdge(ids[j], ids[(j + 1) % M], r === 0 ? 'rim' : 'ring');
    rings.push(ids);
  });

  // Участки съездов между соседними горизонтами — кандидаты на временное закрытие.
  const closureGroups: ClosureGroup[] = [];
  ramps.forEach((ramp, k) => {
    for (let r = 0; r + 1 < rampIdx.length; r++) {
      const edges: number[] = [];
      for (let i = rampIdx[r]; i < rampIdx[r + 1]; i++) edges.push(g.edgeBetween(ramp[i], ramp[i + 1])!);
      closureGroups.push({ label: `${RAMP_NAMES[k]}, горизонты ${r}–${r + 1}`, edges });
    }
  });

  // Забои экскаваторов: короткий заезд от бермы к забою.
  const excavators = cfg.excavators.map((spec) => {
    const r = Math.min(Math.max(spec.ring, 1), rings.length - 1);
    const thetaA = ringLevels[r] * turn;
    const target = (spec.angleDeg * Math.PI) / 180;
    let bestJ = 1;
    let bestD = Infinity;
    for (let j = 0; j < M; j++) {
      if (j === 0 || j === M / 2) continue; // не ставим забой прямо на развязке со съездом
      const th = thetaA + (j * 2 * Math.PI) / M;
      const d = Math.abs(Math.atan2(Math.sin(th - target), Math.cos(th - target)));
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    const access = rings[r][bestJ];
    const th = thetaA + (bestJ * 2 * Math.PI) / M;
    const p = pitPoint(cfg, ringScales[r] - 0.045, th);
    const node = g.addNode(p.x, p.y, 'face');
    g.addEdge(access, node, 'spur');
    return { node, access };
  });

  const rim = rings[0];
  const attach = (pt: Point): SiteNodes => {
    let access = rim[0];
    let best = Infinity;
    for (const id of rim) {
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
  const garage = attach(cfg.sites.garage);
  const parking = buildParking(g, garage.node);

  // Границы с запасом под площадки (их контуры рисуются дальше от карьера, чем узел дороги).
  const extra = [cfg.sites.plant, cfg.sites.leach, cfg.sites.waste, cfg.sites.garage].flatMap((p) => {
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
    closureGroups,
    excavators,
    crusher,
    leach,
    waste,
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
