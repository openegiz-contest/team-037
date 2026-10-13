import { describe, expect, it } from 'vitest';
import { defaultFleet, defaultGrade, fleetConfig, nextExcavatorName, sanitizeFleet, validateFleet, type Fleet } from '../../platform/fleet';
import { computeKpis } from '../kpi';
import { Simulation } from '../engine';

describe('парк техники', () => {
  it('исходный парк корректен', () => {
    expect(validateFleet(defaultFleet())).toEqual([]);
  });

  it('добавленный экскаватор и меньший парк самосвалов отрабатывают смену', () => {
    const f: Fleet = defaultFleet(12);
    f.excavators.push({ name: nextExcavatorName(f), material: 'sulfide', rateTpm: 50, gradePct: defaultGrade('sulfide', 3), ring: 3, angleDeg: 200 });
    expect(validateFleet(f)).toEqual([]);
    for (const strategy of ['fixed', 'smart'] as const) {
      const sim = new Simulation({ seed: 7, truckCount: f.trucks, strategy, config: fleetConfig(f) });
      expect(sim.excavators).toHaveLength(6);
      expect(sim.trucks).toHaveLength(12);
      sim.runToEnd();
      const k = computeKpis(sim);
      expect(k.minedTotal).toBeGreaterThan(0);
      expect(sim.excavators[5].tonnes).toBeGreaterThan(0);
    }
  });

  it('проверка ловит ошибки, а sanitize возвращает прежний парк', () => {
    const base = defaultFleet();
    const bad: Fleet = { trucks: 50, excavators: base.excavators.filter((e) => e.material !== 'oxide') };
    const errs = validateFleet(bad);
    expect(errs.length).toBeGreaterThanOrEqual(2);
    expect(sanitizeFleet(bad, base)).toBe(base);
    const close: Fleet = { trucks: 20, excavators: [...base.excavators, { ...base.excavators[0], name: 'Э-9', angleDeg: base.excavators[0].angleDeg + 10 }] };
    expect(validateFleet(close).some((e) => e.includes('близко'))).toBe(true);
  });
});
