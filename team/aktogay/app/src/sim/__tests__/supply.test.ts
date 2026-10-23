import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { applyScenario } from '../../platform/scenarios';

const mk = (seed = 5) => new Simulation({ seed, truckCount: 20, strategy: 'smart' });

describe('сценарии снабжения', () => {
  it('без сценариев склад ГСМ не пустеет, шины есть, КПП работает, реагентов хватает', () => {
    const s = mk();
    s.advance(12 * 3600);
    expect(s.fuelDepot.stockM3).toBeGreaterThan(500);
    expect(s.repairShop.tyres).toBeGreaterThan(0);
    expect(s.checkpoint.reagentFactor).toBe(1);
  });

  it('перебои с топливом: склад пустеет, самосвалы ждут на АЗС, добыча падает', () => {
    const a = mk();
    const b = mk();
    a.advance(3600);
    b.advance(3600);
    applyScenario([b], { value: 'fuel_shortage', dur: 300 });
    let waited = 0;
    for (let i = 0; i < 4 * 60; i++) {
      a.advance(60);
      b.advance(60);
      waited = Math.max(waited, b.fuelDepot.waitingNow);
    }
    expect(b.fuelDepot.stockM3).toBe(0);
    expect(waited).toBeGreaterThan(0);
    expect(b.stats.mined.sulfide + b.stats.mined.oxide + b.stats.mined.waste).toBeLessThan(a.stats.mined.sulfide + a.stats.mined.oxide + a.stats.mined.waste);
  });

  it('закрыт КПП: реагенты кончаются и фабрика перерабатывает меньше; после открытия запас восстанавливается', () => {
    const a = mk();
    const b = mk();
    applyScenario([b], { value: 'kpp_closed', dur: 600 });
    a.advance(7 * 3600);
    b.advance(7 * 3600);
    expect(b.checkpoint.reagentFactor).toBeLessThan(1);
    expect(b.stats.plantFeedT).toBeLessThan(a.stats.plantFeedT);
    applyScenario([b], { value: 'kpp_open' });
    b.advance(3 * 3600);
    expect(b.checkpoint.mode).not.toBe('closed');
    expect(b.checkpoint.reagentFactor).toBe(1);
  });

  it('нет шин: склад обнулён, после поставки шины снова есть', () => {
    const s = mk();
    applyScenario([s], { value: 'no_tyres', dur: 60 });
    expect(s.repairShop.tyres).toBe(0);
    s.advance(2 * 3600);
    expect(s.repairShop.tyres).toBeGreaterThan(0);
  });
});
