import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { FUEL_INITIAL_M3, FUEL_TANKS, FUEL_TANK_M3 } from '../depot';

const mk = (seed = 7) => new Simulation({ seed, truckCount: 20, strategy: 'smart' });

describe('склад ГСМ', () => {
  it('баланс: начальный запас + принято − отпущено = остаток, запас в пределах резервуаров', () => {
    const s = mk();
    s.advance(8 * 3600);
    const d = s.fuelDepot;
    expect(FUEL_INITIAL_M3 + d.receivedM3 - d.dispensedM3).toBeCloseTo(d.stockM3, 3);
    expect(d.stockM3).toBeGreaterThanOrEqual(0);
    expect(d.stockM3).toBeLessThanOrEqual(FUEL_TANKS * FUEL_TANK_M3);
    expect(d.dispensedM3).toBeGreaterThan(20);
  });

  it('когда запас низкий, идёт завоз автоцистернами', () => {
    const s = mk();
    s.fuelDepot.stockM3 = 800;
    s.advance(2 * 3600);
    expect(s.fuelDepot.tankers).toBeGreaterThan(3);
    expect(s.fuelDepot.stockM3).toBeGreaterThan(800);
  });

  it('очередь на КПП задерживает автоцистерны', () => {
    const a = mk();
    a.fuelDepot.stockM3 = 800;
    a.advance(2 * 3600);
    const b = mk();
    b.fuelDepot.stockM3 = 800;
    b.checkpoint.queue = 60; // длинная очередь на весах
    b.advance(1); // обновление ожидания
    b.checkpoint.update = () => {}; // оставить очередь как есть
    b.checkpoint.waitMin = 40;
    b.advance(2 * 3600);
    expect(b.fuelDepot.tankers).toBeLessThan(a.fuelDepot.tankers);
  });
});

describe('РМЦ', () => {
  it('заявки закрываются, запчасти и шины расходуются, занятость в пределах цеха', () => {
    const s = mk(3);
    let maxBusy = 0;
    for (let i = 0; i < 12 * 3600; i += 60) {
      s.advance(60);
      maxBusy = Math.max(maxBusy, s.repairShop.mechanicsBusy);
    }
    const r = s.repairShop;
    expect(r.plannedDone + r.breakdownDone).toBeGreaterThan(0);
    expect(r.parts).toBeLessThan(40);
    expect(maxBusy).toBeLessThanOrEqual(24);
    expect(r.baysBusy).toBeLessThanOrEqual(4);
  });
});
