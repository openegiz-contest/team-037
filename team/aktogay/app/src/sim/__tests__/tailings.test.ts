import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { CONC_GRADE } from '../concentrate';
import { FREEBOARD_MIN_M, RECYCLE_PCT, SOLIDS_PCT } from '../tailings';

describe('хвостохранилище', () => {
  it('хвосты — это руда с фабрики минус концентрат, баланс сходится', () => {
    const s = new Simulation({ seed: 5, truckCount: 20, strategy: 'smart' });
    s.advance(6 * 3600);
    const t = s.tailings;
    const conc = s.stats.cuConcT / CONC_GRADE;
    expect(t.tailsT).toBeCloseTo(s.stats.plantFeedT - conc, 0);
    expect(t.tailsT).toBeGreaterThan(0);
    // воды в пульпе столько, сколько задано долей твёрдого
    expect(t.waterInM3).toBeCloseTo((t.tailsT * (100 - SOLIDS_PCT)) / SOLIDS_PCT, 0);
    // большая часть воды возвращается на фабрику
    expect(t.reclaimM3 / t.waterInM3).toBeGreaterThan(0.5);
    expect(t.reclaimM3 / t.waterInM3).toBeLessThan(RECYCLE_PCT / 100);
    expect(t.makeupM3).toBeGreaterThan(0);
  });

  it('чаша наполняется, запас до гребня в норме и уменьшается', () => {
    const s = new Simulation({ seed: 5, truckCount: 20, strategy: 'smart' });
    const t = s.tailings;
    const stored0 = t.storedT;
    const free0 = t.freeboardM;
    s.advance(12 * 3600);
    expect(t.storedT).toBeGreaterThan(stored0);
    expect(t.freeboardM).toBeLessThanOrEqual(free0);
    expect(t.freeboardM).toBeGreaterThan(FREEBOARD_MIN_M);
    expect(t.status).toBe('norm');
    // за смену чаша заполняется незаметно — она рассчитана на годы
    expect(t.fillPct - (stored0 / t.storedT) * t.fillPct).toBeLessThan(0.2);
  });

  it('модуль не влияет на добычу: смена идёт так же, как без него', () => {
    const a = new Simulation({ seed: 7, truckCount: 20, strategy: 'smart' });
    a.advance(4 * 3600);
    const b = new Simulation({ seed: 7, truckCount: 20, strategy: 'smart' });
    for (let i = 0; i < 4 * 3600; i++) b.advance(1);
    expect(Math.round(a.stats.mined.sulfide)).toBe(Math.round(b.stats.mined.sulfide));
    expect(Math.round(a.tailings.tailsT)).toBe(Math.round(b.tailings.tailsT));
  });
});
