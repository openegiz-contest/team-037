import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { LEACH_FROST_C, SKY } from '../weather';

describe('погода и сезон', () => {
  it('зимой возят медленнее, чем летом, и добывают меньше', () => {
    const total = (m: number) => {
      const s = new Simulation({ seed: 4, truckCount: 20, strategy: 'smart', month: m });
      s.advance(12 * 3600);
      return s.stats.mined.sulfide + s.stats.mined.oxide + s.stats.mined.waste;
    };
    expect(total(1)).toBeLessThan(total(7));
  });

  it('в мороз орошение карт останавливается, зимой катодов почти нет', () => {
    // Смена начинается в 8 утра — самое холодное время суток.
    const s = new Simulation({ seed: 4, truckCount: 20, strategy: 'smart', month: 1 });
    s.advance(60);
    expect(s.weather.tempC).toBeLessThan(LEACH_FROST_C);
    expect(s.weather.irrigationOn).toBe(false);
    expect(s.leach.cells.every((c) => !c.irrigated)).toBe(true);
    // За смену январь даёт кратно меньше катодной меди, чем июль: холод тормозит химию.
    const cathode = (month: number) => {
      const w = new Simulation({ seed: 4, truckCount: 20, strategy: 'smart', month });
      w.advance(12 * 3600);
      return w.leach.cathodeT;
    };
    const winter = cathode(1);
    const summer = cathode(7);
    expect(winter).toBeLessThan(summer * 0.2);
    expect(summer).toBeGreaterThan(5);
  });

  it('сценарий «метель» замедляет возку и запрещает взрывы', () => {
    const s = new Simulation({ seed: 4, truckCount: 20, strategy: 'smart' });
    s.advance(600);
    s.weather.force(s, 'blizzard', 3600);
    expect(s.weather.speedFactor).toBeLessThanOrEqual(SKY.blizzard.speed);
    expect(s.weather.blastOk).toBe(false);
    // после окончания сценария погода возвращается к обычной для сезона
    s.advance(3700);
    expect(s.weather.forcedLeft).toBe(0);
  });

  it('погода воспроизводима: тот же seed и месяц — та же смена', () => {
    const run = () => {
      const s = new Simulation({ seed: 9, truckCount: 20, strategy: 'smart', month: 2 });
      s.advance(4 * 3600);
      return [s.weather.sky, Math.round(s.stats.mined.waste)] as const;
    };
    expect(run()).toEqual(run());
  });
});
