import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { kppDirection } from '../checkpoint';
import { roadSegments, roadWidth } from '../../render3d/terrain';
import { buildSiteMap } from '../../geo/sitemap';

type Obb = { x: number; y: number; ux: number; uy: number; ha: number; hc: number };
const corners = (o: Obb, grow = 0): [number, number][] => {
  const vx = -o.uy;
  const vy = o.ux;
  const a = o.ha + grow;
  const c = o.hc + grow;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [o.x + o.ux * a * s + vx * c * t, o.y + o.uy * a * s + vy * c * t] as [number, number]);
};
const project = (pts: [number, number][], ax: number, ay: number) => {
  const v = pts.map(([x, y]) => x * ax + y * ay);
  return [Math.min(...v), Math.max(...v)];
};
const overlap = (a: Obb, b: Obb, gap: number) => {
  const A = corners(a, gap / 2);
  const B = corners(b, gap / 2);
  for (const o of [a, b]) {
    for (const [ax, ay] of [[o.ux, o.uy], [-o.uy, o.ux]]) {
      const [a0, a1] = project(A, ax, ay);
      const [b0, b1] = project(B, ax, ay);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
};
const distToRoads = (o: Obb, roads: { pts: [number, number][]; half?: number }[]) => {
  const samples: [number, number][] = [];
  const C = corners(o);
  for (let i = 0; i < 4; i++) for (let k = 0; k <= 10; k++) samples.push([C[i][0] + ((C[(i + 1) % 4][0] - C[i][0]) * k) / 10, C[i][1] + ((C[(i + 1) % 4][1] - C[i][1]) * k) / 10]);
  samples.push([o.x, o.y]);
  let best = Infinity;
  for (const r of roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, ay] = r.pts[i];
      const [bx, by] = r.pts[i + 1];
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy || 1;
      for (const [px, py] of samples) {
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
        best = Math.min(best, Math.hypot(px - ax - t * vx, py - ay - t * vy) - (r.half ?? 0));
      }
    }
  }
  return best;
};

describe('планировка промплощадки: здания не налезают друг на друга и на дороги', () => {
  const sim = new Simulation({ seed: 1, truckCount: 20, strategy: 'smart' });
  const P = sim.parking;
  const f = P.frame;
  const crossOf = (c: number) => (c - (P.cols - 1) / 2) * P.dx;
  const zMin = crossOf(0) - P.dx * 1.4;
  const zMax = crossOf(P.cols - 1) + P.dx * 0.6;
  const xMax = P.aisle0 + (P.rows - 1) * P.dy + P.depth + 55;
  const along = xMax / 2 - 5;
  const across = (zMin + zMax) / 2;
  const park: Obb = { x: f.cx + f.ox * along - f.oy * across, y: f.cy + f.oy * along + f.ox * across, ux: f.ox, uy: f.oy, ha: (xMax + 10) / 2 + 8, hc: (zMax - zMin) / 2 + 8 };
  const roads = sim.cfg.serviceRoads;
  // Всё, что лежит на земле или над ней: дороги с их шириной, конвейерные галереи, трубы на эстакадах, ЛЭП.
  const obstacles: { pts: [number, number][]; half: number }[] = [
    ...roadSegments(sim).map((g) => ({ pts: [[g.ax, g.ay], [g.bx, g.by]] as [number, number][], half: roadWidth(g.kind) / 2 })),
    ...buildSiteMap(sim)
      .lines.filter((l) => l.kind === 'conveyor' || l.kind === 'pipe')
      .map((l) => ({ pts: l.pts, half: 8 })),
  ];
  const S = sim.cfg.sites;
  const dir = kppDirection(S.rmc, roads);
  // площадки: размеры совпадают с теми, что заданы в сцене (MineScene)
  const rmc: Obb = { x: S.rmc.x, y: S.rmc.y, ux: dir.ux, uy: dir.uy, ha: 100, hc: 70 };
  const gsm: Obb = { x: S.gsm.x, y: S.gsm.y, ux: dir.ux, uy: dir.uy, ha: 70, hc: 50 };
  const garage: Obb = { x: -1329, y: 2492, ux: f.ox, uy: f.oy, ha: 150, hc: 100 };

  it('РМЦ, склад ГСМ, стоянка и гараж не пересекаются', () => {
    expect(overlap(rmc, gsm, 20)).toBe(false);
    expect(overlap(rmc, park, 20)).toBe(false);
    expect(overlap(gsm, park, 20)).toBe(false);
    expect(overlap(rmc, garage, 20)).toBe(false);
    expect(overlap(gsm, garage, 20)).toBe(false);
  });

  // Резервуары, АБК, лаборатория, склад ВМ: размеры — как ровные площадки в сцене.
  const box = (p: { x: number; y: number }, ha: number, hc: number): Obb => ({ x: p.x, y: p.y, ux: 1, uy: 0, ha, hc });
  const site = { water: box(S.water, 100, 85), abk: box(S.abk, 80, 50), lab: box(S.lab, 45, 30), magazine: box(S.magazine, 110, 80), camp: box(S.camp, 200, 130) };

  it('резервуары, АБК, лаборатория и склад ВМ не пересекаются друг с другом и с соседями', () => {
    const all: [string, Obb][] = [...Object.entries(site), ['rmc', rmc], ['gsm', gsm], ['park', park], ['garage', garage]];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(overlap(all[i][1], all[j][1], 10), `${all[i][0]} × ${all[j][0]}`).toBe(false);
  });

  it('дороги подходят к резервуарам, АБК, лаборатории и складу ВМ, но не проходят сквозь них', () => {
    // Подъезд к посёлку заканчивается у его ворот — его не считаем препятствием для самого посёлка.
    const own = sim.cfg.serviceRoads.find((r) => r.name.startsWith('Подъезд к вахтовому'))!.pts;
    const onOwn = (q: [number, number]) => own.some(([x, y]) => x === q[0] && y === q[1]);
    for (const [name, o] of Object.entries(site)) {
      const obs = name === 'camp' ? obstacles.filter((r) => !(r.pts.length === 2 && onOwn(r.pts[0]) && onOwn(r.pts[1]))) : obstacles;
      expect(distToRoads(o, obs), name).toBeGreaterThan(2); // расстояние до края дороги, галереи или эстакады
    }
  });

  it('дороги не проходят через РМЦ и склад ГСМ', () => {
    expect(distToRoads(rmc, obstacles), 'РМЦ').toBeGreaterThan(2);
    expect(distToRoads(gsm, obstacles), 'ГСМ').toBeGreaterThan(2);
  });
});
