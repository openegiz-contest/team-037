import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { kppDirection } from '../checkpoint';

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
const distToRoads = (o: Obb, roads: { pts: [number, number][] }[]) => {
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
        best = Math.min(best, Math.hypot(px - ax - t * vx, py - ay - t * vy));
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

  it('дороги не проходят через РМЦ и склад ГСМ', () => {
    expect(distToRoads(rmc, roads)).toBeGreaterThan(25);
    expect(distToRoads(gsm, roads)).toBeGreaterThan(25);
  });
});
