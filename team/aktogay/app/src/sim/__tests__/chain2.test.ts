import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { CHAIN2_FEED_TPH } from '../chain2';

describe('вторая цепочка: ККД-2 → склад → ОФ-2', () => {
  it('баланс руды сходится: что подвезли, то в бункере, на складе или переработано', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    const c = s.chain2;
    const start = c.dump.binT + c.stockpile.t;
    s.advance(6 * 3600);
    const brought = c.dump.tonnes; // всё, что подвезено к бункеру за смену
    const now = c.dump.binT + c.stockpile.t;
    expect(start + brought).toBeCloseTo(now + c.stats.plantFeedT, 0);
    expect(c.stats.plantFeedT).toBeGreaterThan(10_000);
  });

  it('фабрика работает на уровне первой цепочки, а подвоз близок к заданному', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(12 * 3600);
    const c = s.chain2;
    expect(c.stats.plantFeedT).toBeGreaterThan(s.stats.plantFeedT * 0.9);
    expect(c.stats.plantFeedT).toBeLessThan(s.stats.plantFeedT * 1.1);
    expect(c.inflowTph).toBeGreaterThan(CHAIN2_FEED_TPH * 0.6);
    expect(c.inflowTph).toBeLessThan(CHAIN2_FEED_TPH * 1.3);
  });

  it('при отключении энергии ККД-2 и ОФ-2 встают, а потом запускаются', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(2 * 3600);
    const before = s.chain2.stats.plantFeedT;
    s.injectPowerCut(20 * 60);
    s.advance(15 * 60);
    expect(s.chain2.stats.plantFeedT).toBeCloseTo(before, 3);
    expect(s.chain2.stockpile.crushing).toBe(false);
    expect(s.chain2.running(s)).toBe(false);
    expect(s.chain2.dump.binT).toBeGreaterThan(300); // подвоз продолжается — бункер наполняется
    s.advance(20 * 60);
    expect(s.chain2.running(s)).toBe(true);
    expect(s.chain2.stats.plantFeedT).toBeGreaterThan(before);
  });

  it('в метель подвоз падает вместе со скоростью возки', () => {
    const calm = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart', month: 7 });
    const storm = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart', month: 7 });
    storm.weather.force(storm, 'blizzard', 3600);
    calm.advance(60);
    storm.advance(60);
    expect(storm.chain2.inflowTph).toBeLessThan(calm.chain2.inflowTph * 0.7);
  });

  it('вид симуляции отдаёт данные второй цепочки, а не первой', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(3600);
    const v = s.chain2.view;
    expect(v.stockpile).toBe(s.chain2.stockpile);
    expect(v.stockpile).not.toBe(s.stockpile);
    expect(v.crusher).toBe(s.chain2.dump);
    // Статистика — отдельные объекты (значения могут совпасть: обе фабрики берут по 50 т/мин).
    expect(v.stats).toBe(s.chain2.stats);
    expect(v.stats).not.toBe(s.stats);
    expect(v.now).toBe(s.now);
    expect(v.equipment.units.length).toBe(8);
    expect(v.feedGrade).toBeGreaterThan(0.2);
  });

  it('нагрузка подстанций в сумме даёт нагрузку рудника, удельный расход сегмента не меняется', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(6 * 3600);
    const { sub, sub2 } = s.energy.substationMw;
    expect(sub + sub2).toBeCloseTo(s.energy.totalMw, 6);
    expect(s.energy.totalMw).toBeGreaterThan(s.energy.segmentMw + 30);
    const kwhT = s.energy.perTonneOre(s);
    expect(kwhT).toBeGreaterThan(15);
    expect(kwhT).toBeLessThan(30);
  });

  it('вторая цепочка не меняет ход первой: те же тонны, что считались до неё', () => {
    const a = new Simulation({ seed: 11, truckCount: 20, strategy: 'smart' });
    const b = new Simulation({ seed: 11, truckCount: 20, strategy: 'smart' });
    a.advance(4 * 3600);
    b.advance(4 * 3600);
    b.chain2.stockpile.t = 0; // хоть опустошим вторую цепочку — первая не заметит
    b.chain2.dump.binT = 0;
    a.advance(2 * 3600);
    b.advance(2 * 3600);
    expect(Math.round(a.stats.mined.sulfide)).toBe(Math.round(b.stats.mined.sulfide));
    expect(Math.round(a.stats.plantFeedT)).toBe(Math.round(b.stats.plantFeedT));
  });
});
