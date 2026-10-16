/**
 * Рельеф карьера для 3D-сцены: чаша с уступами (бермы + откосы), вокруг — степь до горизонта.
 *
 * Чаша строится в полярной сетке по тем же контурам, что и граф дорог (pitPoint), поэтому
 * дороги ложатся точно на бермы; при необходимости внешние кольца можно прижать к прямоугольнику (Block).
 */
import * as THREE from 'three';
import { pitPoint, type SimConfig, type Simulation } from '../sim';
import { ROCK_GEO } from './models';
import { BERM, depthFrac, heightFromS, PIT_DEPTH, scaleAt, smoothstep } from '../geo/relief';

export { makeHeightAt, PIT_DEPTH } from '../geo/relief';


/** Границы блока-диорамы (мировые x, y карты) и отметка его основания. */
export interface Block {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  baseY: number;
}

export function blockBounds(sim: Simulation): Block {
  const b = sim.layout.bounds;
  const m = 60;
  return { minX: b.minX - m, maxX: b.maxX + m, minY: b.minY - m, maxY: b.maxY + m, baseY: -PIT_DEPTH - 150 };
}


/** Обочина: полоса, на которой врезка дороги плавно переходит в естественный склон, м. */
const SHOULDER = 14;
const CELL = 120;

/**
 * Рельеф с дорогами, врезанными в борта: в пределах ширины дороги поверхность ровная — высота
 * линейно между узлами ребра (съезд — ровный уклон, кольцевая берма — горизонталь), дальше
 * обочиной переходит в естественный склон. Так широкая карьерная дорога лежит на полке,
 * а не висит над уступами.
 */
export interface Pad {
  x: number;
  y: number;
  /** Единичный вектор «вдоль» площадки. */
  ux: number;
  uy: number;
  halfAlong: number;
  halfAcross: number;
}

export function makeRoadHeightAt(
  sim: Simulation,
  base: (x: number, y: number) => number,
  pads: Pad[] = [],
): (x: number, y: number) => number {
  const g = sim.layout.graph;
  type Seg = { ax: number; ay: number; vx: number; vy: number; l2: number; ha: number; hb: number; half: number };
  const grid = new Map<number, Seg[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  // Ровные площадки (буровые блоки на рабочем уступе): высота — по центру площадки.
  const padList = pads.map((p) => ({ ...p, h: base(p.x, p.y), r: Math.hypot(p.halfAlong, p.halfAcross) + SHOULDER }));
  for (const e of g.edges) {
    if (e.kind === 'lot' || e.kind === 'park') continue;
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const half = roadWidth(e.kind) / 2;
    const seg: Seg = { ax: a.x, ay: a.y, vx: b.x - a.x, vy: b.y - a.y, l2: (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1, ha: base(a.x, a.y), hb: base(b.x, b.y), half };
    const r = half + SHOULDER;
    const i0 = Math.floor((Math.min(a.x, b.x) - r) / CELL);
    const i1 = Math.floor((Math.max(a.x, b.x) + r) / CELL);
    const j0 = Math.floor((Math.min(a.y, b.y) - r) / CELL);
    const j1 = Math.floor((Math.max(a.y, b.y) + r) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(seg);
      }
  }
  return (x, y) => {
    const h0 = base(x, y);
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    let best = Infinity;
    let roadH = h0;
    let half = 0;
    for (const p of padList) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy > p.r * p.r) continue;
      const a = Math.abs(dx * p.ux + dy * p.uy) - p.halfAlong;
      const c = Math.abs(-dx * p.uy + dy * p.ux) - p.halfAcross;
      const d = a > 0 && c > 0 ? Math.hypot(a, c) : Math.max(a, c);
      if (d < best) {
        best = d;
        roadH = p.h;
        half = 1;
      }
    }
    if (!list && half === 0) return h0;
    for (const s of list ?? []) {
      const t = clamp(((x - s.ax) * s.vx + (y - s.ay) * s.vy) / s.l2, 0, 1);
      const d = Math.hypot(x - s.ax - s.vx * t, y - s.ay - s.vy * t) - s.half;
      if (d < best) {
        best = d;
        roadH = s.ha + (s.hb - s.ha) * t;
        half = s.half;
      }
    }
    if (best <= 0 || half === 0) return best <= 0 ? roadH : h0;
    if (best >= SHOULDER) return h0;
    return roadH + (h0 - roadH) * smoothstep(0, SHOULDER, best);
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Верх блока: чаша с уступами + поверхность до краёв блока. */
export function buildTerrain(cfg: SimConfig, blk: Block | null, heightAt?: (x: number, y: number) => number): THREE.Mesh {
  const A = 480; // сегментов по углу (мельче — чтобы полки дорог были ровными)
  const sList: number[] = [];
  for (let i = 0; i <= 30; i++) sList.push(3.6 - (i / 30) * 2.6);
  const inner = cfg.pit.benchCount * 12;
  for (let i = 1; i <= inner; i++) sList.push(1 - (i / inner) * (1 - cfg.pit.bottomScale * 0.4));
  sList.push(0);

  const R = sList.length;
  const pos = new Float32Array(R * (A + 1) * 3);
  const col = new Float32Array(R * (A + 1) * 3);
  const c = new THREE.Color();
  const sand = new THREE.Color('#d7b77f');
  const sandDark = new THREE.Color('#c09a62');
  const rockTop = new THREE.Color('#b8956a');
  const rockDeep = new THREE.Color('#6d5a4a');
  const oxideTint = new THREE.Color('#6f9a7c');
  const faceDark = new THREE.Color('#5a4433');

  let k = 0;
  for (let i = 0; i < R; i++) {
    const s0 = sList[i];
    for (let j = 0; j <= A; j++) {
      const th = (j / A) * Math.PI * 2;
      const p = pitPoint(cfg, s0, th);
      // Внешние кольца прижимаются к краю блока — получается ровный прямоугольник.
      const x = blk ? clamp(p.x, blk.minX, blk.maxX) : p.x;
      const y = blk ? clamp(p.y, blk.minY, blk.maxY) : p.y;
      const s = s0 >= 1 ? scaleAt(cfg, x, y) : s0;
      const h = heightAt ? heightAt(x, y) : heightFromS(cfg, s, x, y);
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = y;
      if (s >= 1) {
        const n = 0.5 + 0.5 * Math.sin(x * 0.004 + Math.cos(y * 0.003) * 2) * Math.cos(y * 0.0011 - x * 0.0007);
        c.copy(sandDark).lerp(sand, n);
        // Утоптанная полоса вдоль бровки.
        c.lerp(rockTop, 0.5 * (1 - smoothstep(1, 1.12, s)));
      } else {
        const u = depthFrac(cfg, s);
        const f = u * cfg.pit.benchCount;
        const onFace = f - Math.floor(f) > BERM;
        c.copy(rockTop).lerp(rockDeep, u);
        // Зона окисления в верхних горизонтах — зеленоватый оттенок (малахит).
        if (u < 0.3) c.lerp(oxideTint, 0.3 * (1 - u / 0.3));
        if (onFace) c.lerp(faceDark, 0.4);
        const noise = 0.93 + 0.07 * Math.sin(th * 37 + s * 90);
        c.multiplyScalar(noise);
      }
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
      k += 3;
    }
  }

  const idx: number[] = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < A; j++) {
      const a = i * (A + 1) + j;
      const b = a + A + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Подтопленное дно карьера. */
export function buildWater(cfg: SimConfig): THREE.Mesh {
  const shape = new THREE.Shape();
  const s = cfg.pit.bottomScale * 0.55;
  for (let i = 0; i <= 64; i++) {
    const p = pitPoint(cfg, s, (i / 64) * Math.PI * 2);
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, −y) → (x, 0, y), нормаль вверх
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: '#2f6f7b', roughness: 0.1, metalness: 0.35, transparent: true, opacity: 0.88 }),
  );
  m.position.y = -PIT_DEPTH + 1.5;
  return m;
}

/** Ширина дороги, м сцены: съезды шире (двустороннее движение карьерных самосвалов). */
export function roadWidth(kind: string): number {
  return kind === 'ramp' ? 78 : kind === 'surface' || kind === 'rim' ? 70 : 62;
}

/** Ленты дорог по рёбрам графа, повторяющие рельеф. */
export function buildRoads(sim: Simulation, heightAt: (x: number, y: number) => number): THREE.Mesh {
  const g = sim.layout.graph;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cRamp = new THREE.Color('#e3d0a6');
  const cRing = new THREE.Color('#cdb88f');
  const cSurf = new THREE.Color('#ddc79c');
  for (const e of g.edges) {
    if (e.kind === 'lot' || e.kind === 'park') continue;
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const width = roadWidth(e.kind);
    const color = e.kind === 'ramp' ? cRamp : e.kind === 'surface' || e.kind === 'rim' ? cSurf : cRing;
    const segs = Math.max(1, Math.ceil(e.len / 20));
    const dx = (b.x - a.x) / e.len;
    const dy = (b.y - a.y) / e.len;
    const nx = -dy * (width / 2);
    const ny = dx * (width / 2);
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ext = (i === 0 ? -width / 2 : i === segs ? width / 2 : 0) / e.len;
      const x = a.x + (b.x - a.x) * (t + ext);
      const y = a.y + (b.y - a.y) * (t + ext);
      const h = heightAt(x, y) + 2.2;
      pos.push(x + nx, h, y + ny, x - nx, h, y - ny);
      col.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let i = 0; i < segs; i++) {
      const p = base + i * 2;
      idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Россыпь камней по поверхности (детерминированно), в стороне от дорог и площадок. */
export function scatterRocks(sim: Simulation, blk: Block, heightAt: (x: number, y: number) => number, avoid: { x: number; y: number; r: number }[]): THREE.InstancedMesh {
  const g = sim.layout.graph;
  const segs = g.edges.map((e) => [g.nodes[e.a], g.nodes[e.b]] as const);
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    return Math.hypot(px - ax - vx * t, py - ay - vy * t);
  };
  const N = 1100;
  const mesh = new THREE.InstancedMesh(ROCK_GEO, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), N);
  const palette = ['#8a6a4a', '#a07c55', '#6e5440', '#b48d62', '#5f4a3a'].map((h) => new THREE.Color(h));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let placed = 0;
  for (let tries = 0; tries < N * 4 && placed < N; tries++) {
    const x = blk.minX + rnd() * (blk.maxX - blk.minX);
    const y = blk.minY + rnd() * (blk.maxY - blk.minY);
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) continue;
    if (segs.some(([a, b]) => distSeg(x, y, a.x, a.y, b.x, b.y) < 50)) continue;
    const h = heightAt(x, y);
    if (h < -PIT_DEPTH + 8) continue; // не на воде
    const r = 1.2 + rnd() * rnd() * 4.5;
    e.set(rnd() * 3, rnd() * 3, rnd() * 3);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, h + r * 0.35, y), q, new THREE.Vector3(r * (0.8 + rnd() * 0.5), r * (0.6 + rnd() * 0.3), r));
    mesh.setMatrixAt(placed, m);
    mesh.setColorAt(placed, palette[Math.floor(rnd() * palette.length)]);
    placed++;
  }
  mesh.count = placed;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
