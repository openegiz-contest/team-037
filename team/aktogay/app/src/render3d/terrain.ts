/**
 * Рельеф карьера для 3D-сцены: чаша с уступами (бермы + откосы), вокруг — степь до горизонта.
 *
 * Карьер — несколько выработок; высоты берутся из рельефа (geo/relief), дороги врезаются полками.
 * Внешние кольца при необходимости прижимаются к прямоугольнику (Block).
 */
import * as THREE from 'three';
import { pitPointOf, type SimConfig, type Simulation } from '../sim';
import { ROCK_GEO } from './models';
import { BERM, makeHeightAt, PIT_DEPTH, pitAt, pitsBounds, smoothstep } from '../geo/relief';

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

/**
 * Все отрезки дорог для рельефа и отрисовки: дороги графа маршрутов плюс служебные из конфига
 * (по служебным самосвалы не ездят, но в рельеф они врезаны и на сцене видны).
 */
export function roadSegments(sim: Simulation): { ax: number; ay: number; bx: number; by: number; kind: string }[] {
  const g = sim.layout.graph;
  const out: { ax: number; ay: number; bx: number; by: number; kind: string }[] = [];
  for (const e of g.edges) {
    if (e.kind === 'lot' || e.kind === 'park') continue;
    out.push({ ax: g.nodes[e.a].x, ay: g.nodes[e.a].y, bx: g.nodes[e.b].x, by: g.nodes[e.b].y, kind: e.kind });
  }
  for (const r of sim.cfg.serviceRoads ?? [])
    for (let i = 0; i + 1 < r.pts.length; i++) out.push({ ax: r.pts[i][0], ay: r.pts[i][1], bx: r.pts[i + 1][0], by: r.pts[i + 1][1], kind: 'service' });
  return out;
}

export function makeRoadHeightAt(
  sim: Simulation,
  base: (x: number, y: number) => number,
  pads: Pad[] = [],
): (x: number, y: number) => number {
  type Seg = { ax: number; ay: number; vx: number; vy: number; l2: number; ha: number; hb: number; half: number };
  const grid = new Map<number, Seg[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  // Ровные площадки (буровые блоки на рабочем уступе): высота — по центру площадки.
  const padList = pads.map((p) => ({ ...p, h: base(p.x, p.y), r: Math.hypot(p.halfAlong, p.halfAcross) + SHOULDER }));
  for (const e of roadSegments(sim)) {
    // Служебные дороги в рельеф не врезаем: они узкие, а сетка степи вдали крупная — врезка
    // попала бы не во все вершины и дорога торчала бы гранями. Они просто ложатся на склон.
    if (e.kind === 'service') continue;
    const a = { x: e.ax, y: e.ay };
    const b = { x: e.bx, y: e.by };
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

/**
 * Рельеф: плотная полярная сетка вокруг всех выработок (уступы каждой чаши ложатся на неё через
 * высоту в точке) и кольца степи до горизонта.
 *
 * Снаружи выработок сетка тоже должна быть достаточно частой: там проходят технологические дороги
 * шириной 36–78 м, врезанные в рельеф. Если шаг по радиусу крупнее ширины дороги, врезка попадает
 * не во все вершины и дорога торчит из склона длинными гранями.
 */
export function buildTerrain(cfg: SimConfig, blk: Block | null, heightAt?: (x: number, y: number) => number, light = false): THREE.Mesh {
  const A = 520; // сегментов по углу
  const pb = pitsBounds(cfg, 140);
  const gx = (pb.minX + pb.maxX) / 2;
  const gy = (pb.minY + pb.maxY) / 2;
  // Эллипс, охватывающий все выработки: внутри — частые кольца (шаг ~5–7 м), снаружи — редкие.
  const ga = ((pb.maxX - pb.minX) / 2) * 1.42;
  const gb = ((pb.maxY - pb.minY) / 2) * 1.42;
  const sList: number[] = [];
  // Степь снаружи: у бровки шаг по радиусу ~14 м (дороги и площадки), дальше реже.
  const outer: [number, number, number][] = [
    [4.2, 2.6, light ? 16 : 33],
    [2.6, 1.5, light ? 30 : 64],
    [1.5, 1.0, light ? 36 : 73],
  ];
  for (const [from, to, n] of outer) for (let i = 0; i < n; i++) sList.push(from + ((to - from) * i) / n);
  const inner = light ? 240 : 340;
  for (let i = 0; i <= inner; i++) sList.push(1 - i / inner);
  const height = heightAt ?? makeHeightAt(cfg);

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
      let x = gx + ga * s0 * Math.cos(th);
      let y = gy + gb * s0 * Math.sin(th);
      // Внешние кольца прижимаются к краю блока — получается ровный прямоугольник.
      if (blk) {
        x = clamp(x, blk.minX, blk.maxX);
        y = clamp(y, blk.minY, blk.maxY);
      }
      const hit = pitAt(cfg, x, y);
      const h = height(x, y);
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = y;
      if (hit.pit < 0) {
        const n = 0.5 + 0.5 * Math.sin(x * 0.004 + Math.cos(y * 0.003) * 2) * Math.cos(y * 0.0011 - x * 0.0007);
        c.copy(sandDark).lerp(sand, n);
        // Утоптанная полоса вдоль бровок.
        c.lerp(rockTop, 0.5 * (1 - smoothstep(1, 1.12, hit.sMin)));
      } else {
        const pit = cfg.pits[hit.pit];
        const u = hit.u;
        const f = u * pit.benchCount;
        const onFace = f - Math.floor(f) > BERM;
        c.copy(rockTop).lerp(rockDeep, Math.min(1, (u * pit.depthM) / PIT_DEPTH));
        // Зона окисления в верхних горизонтах — зеленоватый оттенок (малахит).
        const zd = u * pit.depthM;
        if (zd < 70) c.lerp(oxideTint, 0.3 * (1 - zd / 70));
        if (onFace) c.lerp(faceDark, 0.4);
        const noise = 0.93 + 0.07 * Math.sin(th * 37 + hit.s * 90);
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

/** Подтопленное дно каждой выработки (на снимке у глубоких — вода на дне). */
export function buildWater(cfg: SimConfig): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#2f6f7b', roughness: 0.1, metalness: 0.35, transparent: true, opacity: 0.88 });
  for (const pit of cfg.pits) {
    if (pit.depthM < 150) continue; // мелкая выработка — без воды
    const shape = new THREE.Shape();
    const sc = pit.bottomScale * 0.55;
    for (let i = 0; i <= 64; i++) {
      const q = pitPointOf(pit, sc, (i / 64) * Math.PI * 2);
      if (i === 0) shape.moveTo(q.x, -q.y);
      else shape.lineTo(q.x, -q.y);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // (x, −y) → (x, 0, y), нормаль вверх
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -pit.depthM + 1.5;
    g.add(m);
  }
  return g;
}

/** Ширина дороги, м сцены: съезды шире (двустороннее движение карьерных самосвалов). */
/**
 * Хвостохранилище: ограждающая дамба по реальному контуру чаши (OpenStreetMap), намытый пляж
 * хвостов и пруд оборотной воды. Низовой откос ложится на рельеф, гребень ровный — как у настоящей
 * дамбы; отметки пляжа и пруда берутся из модели, поэтому зеркало воды живое.
 */
export function buildTailings(sim: Simulation, heightAt: (x: number, y: number) => number): { group: THREE.Group; water: THREE.Mesh; crest: THREE.Vector3[]; baseY: number } {
  const out = sim.cfg.sites.tsfOutline;
  const cx = out.reduce((a, p) => a + p[0], 0) / out.length;
  const cy = out.reduce((a, p) => a + p[1], 0) / out.length;
  const ringXY = (k: number) => out.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]);
  const lift = (pts: [number, number][], y: number | null) => pts.map(([x, z]) => new THREE.Vector3(x, y ?? heightAt(x, z), z));

  // Отметка подошвы: берём самую высокую точку рельефа внутри контура, чтобы намытый пляж
  // накрыл естественные бугры в чаше, а дамба стояла выше всего, что внутри.
  const samples: number[] = [heightAt(cx, cy)];
  for (const k of [0.3, 0.55, 0.8, 1]) for (const [x, y] of ringXY(k)) samples.push(heightAt(x, y));
  const baseY = Math.max(...samples);
  const t = sim.tailings;
  // Гребень идёт над намытым пляжем: дамбу наращивают ярусами по мере заполнения чаши.
  const crestY = baseY + t.crestM;
  const beachY = baseY + t.beachM;
  const waterY = beachY + t.pondM;

  const toe = lift(ringXY(1.0), null);
  const crestOut = lift(ringXY(0.962), crestY);
  const crestIn = lift(ringXY(0.945), crestY);
  const beachEdge = lift(ringXY(0.925), beachY);

  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const push = (v: THREE.Vector3, c: THREE.Color) => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  const strip = (a: THREE.Vector3[], b: THREE.Vector3[], ca: THREE.Color, cb: THREE.Color) => {
    const n = a.length;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      push(a[i], ca);
      push(b[i], cb);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(base + i * 2, base + j * 2, base + i * 2 + 1, base + i * 2 + 1, base + j * 2, base + j * 2 + 1);
    }
  };
  const fan = (ring: THREE.Vector3[], y: number, c: THREE.Color) => {
    const centre = push(new THREE.Vector3(cx, y, cy), c);
    const base = pos.length / 3;
    for (const v of ring) push(v, c);
    for (let i = 0; i < ring.length; i++) idx.push(centre, base + i, base + ((i + 1) % ring.length));
  };

  const cSlope = new THREE.Color('#8d7a62');
  const cCrest = new THREE.Color('#b3a287');
  const cInner = new THREE.Color('#9a8c77');
  const cBeach = new THREE.Color('#c4b9a4');
  strip(toe, crestOut, cSlope, cCrest); // низовой откос
  strip(crestOut, crestIn, cCrest, cCrest); // гребень
  strip(crestIn, beachEdge, cInner, cBeach); // верховой откос
  fan(beachEdge, beachY, cBeach); // намытый пляж

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const dam = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  dam.castShadow = true;
  dam.receiveShadow = true;
  const group = new THREE.Group();
  group.add(dam);

  // Пруд отстоявшейся воды в низине чаши — зеркало живое: отметка от уровня пруда в модели.
  const pondXY = ringXY(0.58);
  // Плоскость строим в координатах (x, −z): после поворота на −90° она ложится лицом вверх.
  const shape = new THREE.Shape(pondXY.map(([x, y]) => new THREE.Vector2(x, -y)));
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#2d6f7d', roughness: 0.08, metalness: 0.35 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterY;
  water.receiveShadow = true;
  group.add(water);

  // Распределительный пульпопровод по гребню и выпуски (спиготы) внутрь чаши.
  const steel = new THREE.MeshStandardMaterial({ color: '#7f8893', metalness: 0.4, roughness: 0.5 });
  const crestCurve = new THREE.CatmullRomCurve3(crestIn.map((v) => v.clone().setY(crestY + 3)), true);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(crestCurve, crestIn.length * 3, 1.9, 7, true), steel));
  for (let i = 0; i < crestIn.length; i += 3) {
    const a = crestIn[i];
    const dir = new THREE.Vector3(cx - a.x, 0, cy - a.z).normalize();
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 16, 6), steel);
    sp.position.set(a.x + dir.x * 10, crestY - 4, a.z + dir.z * 10);
    sp.rotation.z = Math.PI / 2.6;
    group.add(sp);
  }

  // Водозаборная башня оборотной воды у пруда и насосная на гребне рядом с ней.
  const tw = pondXY[Math.floor(pondXY.length * 0.55)];
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, Math.max(14, waterY - baseY + 16), 12), new THREE.MeshStandardMaterial({ color: '#b8b5ad', roughness: 0.85 }));
  tower.position.set(tw[0], baseY + Math.max(14, waterY - baseY + 16) / 2, tw[1]);
  tower.castShadow = true;
  group.add(tower);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(46, 16, 30), new THREE.MeshStandardMaterial({ color: '#cfd2d6', roughness: 0.7 }));
  const pumpAt = crestIn[Math.floor(crestIn.length * 0.55)];
  pump.position.set(pumpAt.x, crestY + 8, pumpAt.z);
  pump.castShadow = true;
  group.add(pump);

  return { group, water, crest: crestIn, baseY };
}

export function roadWidth(kind: string): number {
  if (kind === 'service') return 36;
  return kind === 'ramp' ? 78 : kind === 'surface' || kind === 'rim' ? 70 : 62;
}

/** Ленты дорог по рёбрам графа, повторяющие рельеф. */
export function buildRoads(sim: Simulation, heightAt: (x: number, y: number) => number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cRamp = new THREE.Color('#e3d0a6');
  const cRing = new THREE.Color('#cdb88f');
  const cSurf = new THREE.Color('#ddc79c');
  const cServ = new THREE.Color('#c4b393');
  for (const e of roadSegments(sim)) {
    const a = { x: e.ax, y: e.ay };
    const b = { x: e.bx, y: e.by };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const width = roadWidth(e.kind);
    const color = e.kind === 'ramp' ? cRamp : e.kind === 'service' ? cServ : e.kind === 'surface' || e.kind === 'rim' ? cSurf : cRing;
    const segs = Math.max(1, Math.ceil(len / 20));
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const nx = -dy * (width / 2);
    const ny = dx * (width / 2);
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ext = (i === 0 ? -width / 2 : i === segs ? width / 2 : 0) / len;
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
    const hit = pitAt(sim.cfg, x, y);
    if (hit.pit >= 0 && hit.u > 0.9) continue; // не на дне (вода)
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
