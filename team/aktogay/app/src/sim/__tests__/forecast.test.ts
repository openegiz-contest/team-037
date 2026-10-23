import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { forecastShift, FORECAST_AFTER_SEC } from '../forecast';

const mk = (seed = 5) => new Simulation({ seed, truckCount: 20, strategy: 'smart' });
const row = (s: Simulation, label: string) => forecastShift(s).rows.find((r) => r.label === label)!;

describe('прогноз до конца смены', () => {
  it('в начале смены помечен как «рано», потом готов', () => {
    const s = mk();
    s.advance(FORECAST_AFTER_SEC - 60);
    expect(forecastShift(s).ready).toBe(false);
    s.advance(120);
    expect(forecastShift(s).ready).toBe(true);
  });

  it('прогноз добычи не меньше уже добытого и близок к темпу × остаток смены', () => {
    const s = mk();
    s.advance(5 * 3600);
    const f = forecastShift(s);
    const mined = s.stats.mined.sulfide + s.stats.mined.oxide + s.stats.mined.waste;
    const r = f.rows[0];
    const num = (v: string) => Number(v.replace(/[^\d]/g, ''));
    expect(num(r.now)).toBe(Math.round(mined));
    expect(num(r.end)).toBeGreaterThan(num(r.now));
    // за 7 оставшихся часов при ~8000 т/ч добавится примерно 56 000 т — проверяем порядок
    expect(num(r.end) - num(r.now)).toBeGreaterThan(30_000);
    expect(f.leftH).toBeCloseTo(7, 1);
  });

  it('в конце смены прогноз сходится с фактом', () => {
    const s = mk(11);
    s.advance(12 * 3600 - 60);
    const f = forecastShift(s);
    const num = (v: string) => Number(v.replace(/[^\d]/g, ''));
    expect(Math.abs(num(f.rows[0].end) - num(f.rows[0].now))).toBeLessThan(500);
    expect(f.leftH).toBeLessThan(0.05);
  });

  it('пустеющий склад ГСМ попадает в прогноз как риск', () => {
    const s = mk();
    s.advance(2 * 3600);
    expect(row(s, 'Дизель на складе ГСМ').status).toBe('ok');
    s.injectFuelShortage(6 * 3600, 20);
    s.advance(600);
    const r = row(s, 'Дизель на складе ГСМ');
    expect(r.status).toBe('miss');
    expect(r.end).toContain('кончится через');
  });

  it('ливень на хвостохранилище виден в прогнозе запаса до гребня', () => {
    const s = mk();
    s.advance(2 * 3600);
    const before = row(s, 'Запас до гребня дамбы');
    s.injectStormWater(120_000, 4 * 3600);
    s.advance(900);
    const after = row(s, 'Запас до гребня дамбы');
    const m = (r: { end: string }) => Number(r.end.replace(',', '.').replace(/[^\d.-]/g, ''));
    expect(m(after)).toBeLessThan(m(before));
    expect(after.status).not.toBe('ok');
  });
});
