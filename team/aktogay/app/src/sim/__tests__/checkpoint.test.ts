import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { cargoPerHour, kppDirection } from '../checkpoint';

const mk = () => new Simulation({ seed: 7, truckCount: 20, strategy: 'smart' });

const distToRoad = (p: { x: number; y: number }, pts: [number, number][]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(p.x - ax - t * vx, p.y - ay - t * vy));
  }
  return best;
};

describe('КПП и автовесы', () => {
  it('днём грузовиков больше, чем ночью', () => {
    expect(cargoPerHour(12)).toBeGreaterThan(cargoPerHour(0) * 2);
  });

  it('в обычной работе очередь не растёт, грузы и взвешивания считаются', () => {
    const s = mk();
    s.advance(3 * 3600);
    const k = s.checkpoint;
    expect(k.mode).toBe('auto');
    expect(k.cargoVehicles).toBeGreaterThan(10);
    expect(k.weighings).toBeGreaterThan(k.cargoVehicles); // въезд и выезд
    expect(k.queue).toBeLessThan(3);
  });

  it('при отключении энергии весы на ручном режиме, одна полоса, очередь растёт, потом рассасывается', () => {
    const s = mk();
    s.advance(4 * 3600); // дневной поток
    s.injectPowerCut(2 * 3600);
    s.advance(3600);
    const k = s.checkpoint;
    expect(k.mode).toBe('manual');
    expect(k.lanesOpen).toBe(1);
    const peak = k.queue;
    expect(peak).toBeGreaterThan(5);
    s.advance(3 * 3600);
    expect(s.checkpoint.mode).toBe('auto');
    expect(s.checkpoint.queue).toBeLessThan(peak);
  });
});

describe('дороги к посёлку и КПП (по карте OSM)', () => {
  const roads = mk().cfg.serviceRoads;
  const main = roads.find((r) => r.name.startsWith('Главная дорога'))!;
  const camp = roads.find((r) => r.name.startsWith('Подъезд к вахтовому'))!;

  it('КПП стоит на главной дороге', () => {
    const c = mk().cfg.sites;
    expect(distToRoad(c.kpp, main.pts)).toBeLessThan(15);
    const d = kppDirection(c.kpp, roads);
    expect(Math.hypot(d.ux, d.uy)).toBeCloseTo(1, 3);
  });

  it('подъезд к посёлку отходит от главной дороги и заканчивается у посёлка', () => {
    const c = mk().cfg.sites;
    expect(distToRoad(camp.pts[0] ? { x: camp.pts[0][0], y: camp.pts[0][1] } : { x: 0, y: 0 }, main.pts)).toBeLessThan(10);
    const end = camp.pts[camp.pts.length - 1];
    expect(Math.hypot(end[0] - c.camp.x, end[1] - c.camp.y)).toBeLessThan(200);
  });
});
