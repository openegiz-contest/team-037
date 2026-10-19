import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { CELL_CAP_T, IRRIGATION_GROUPS } from '../leach';

describe('кучное выщелачивание и SX-EW', () => {
  it('руда ложится на карту отсыпки, медь идёт в раствор и в катоды', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    const loading0 = s.leach.cells.find((c) => c.stage === 'loading')!.oreT;
    s.advance(6 * 3600);
    const L = s.leach;
    expect(L.placedT).toBeCloseTo(s.dumps[1].tonnes, 0);
    expect(L.cells.find((c) => c.stage === 'loading')!.oreT).toBeCloseTo(loading0 + L.placedT, 0);
    expect(L.cuLeachedT).toBeGreaterThan(0);
    expect(L.cathodeT).toBeGreaterThan(0);
    expect(L.cathodeT).toBeLessThan(L.cuLeachedT);
    expect(L.plsGpl).toBeGreaterThan(0.5);
    expect(L.plsGpl).toBeLessThan(6);
  });

  it('поливается одна группа карт по графику', () => {
    const s = new Simulation({ seed: 1, truckCount: 20, strategy: 'smart' });
    s.advance(600);
    const wet = s.leach.cells.filter((c) => c.irrigated);
    expect(wet.length).toBeGreaterThan(0);
    expect(new Set(wet.map((c) => s.leach.groupOf(c))).size).toBe(1);
    expect(wet.length).toBeLessThan(s.leach.irrigatingCount);
    expect(IRRIGATION_GROUPS).toBeGreaterThan(1);
  });

  it('полная карта уходит в выдержку, выдержанная — под орошение', () => {
    const s = new Simulation({ seed: 1, truckCount: 20, strategy: 'smart' });
    const L = s.leach;
    const loading = L.cells.find((c) => c.stage === 'loading')!;
    const rest = L.cells.find((c) => c.stage === 'rest')!;
    s.dumps[1].tonnes += CELL_CAP_T;
    L.update(s, 1);
    expect(loading.stage).toBe('rest');
    expect(rest.stage).toBe('irrigating');
    expect(L.cells.filter((c) => c.stage === 'loading').length).toBe(1);
  });
});
