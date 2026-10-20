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

  it('в мороз орошение карт останавливается, катодов нет', () => {
    const s = new Simulation({ seed: 4, truckCount: 20, strategy: 'smart', month: 1 });
    s.advance(6 * 3600);
    expect(s.weather.tempC).toBeLessThan(LEACH_FROST_C);
    expect(s.weather.irrigationOn).toBe(false);
    expect(s.leach.cells.every((c) => !c.irrigated)).toBe(true);
    expect(s.leach.cathodeT).toBe(0);
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
