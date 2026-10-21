import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { CAMP_BEDS, CAMP_RESIDENTS, FUEL_TANK_L } from '../camp';

const run = (sim: Simulation, sec: number) => sim.advance(sec);
const mk = () => new Simulation({ seed: 7, truckCount: 20, strategy: 'smart' });

describe('вахтовый посёлок', () => {
  it('людей в посёлке, в пути и на смене в сумме столько, сколько живёт на вахте', () => {
    const sim = mk();
    for (const h of [0, 1, 3, 5, 9]) {
      run(sim, h === 0 ? 1 : 3600);
      const c = sim.camp;
      expect(Math.abs(c.inCamp + c.inTransit + c.onShift - CAMP_RESIDENTS)).toBeLessThanOrEqual(1);
      expect(c.inCamp).toBeLessThanOrEqual(CAMP_BEDS);
    }
  });

  it('в пересменку автобусы в пути, в середине смены — нет', () => {
    const sim = mk();
    run(sim, 1);
    expect(sim.camp.inTransit).toBeGreaterThan(500); // начало смены — пересменка
    run(sim, 3 * 3600);
    expect(sim.camp.inTransit).toBe(0);
    expect(sim.camp.buses).toBe(0);
  });

  it('при отключении энергии берёт топливо из бака, из сети не берёт, после — заправляется', () => {
    const sim = mk();
    run(sim, 60);
    expect(sim.camp.genOn).toBe(false);
    expect(sim.camp.gridMw).toBeGreaterThan(0.5);
    sim.injectPowerCut(1800);
    run(sim, 600);
    expect(sim.camp.genOn).toBe(true);
    expect(sim.camp.gridMw).toBe(0);
    expect(sim.camp.fuelL).toBeLessThan(FUEL_TANK_L);
    run(sim, 1500);
    expect(sim.camp.genOn).toBe(false);
    expect(sim.camp.gridMw).toBeGreaterThan(0.5);
  });

  it('участок посёлка входит в нагрузку рудника, но не в удельный расход сегмента', () => {
    const sim = mk();
    run(sim, 600);
    const a = sim.energy.areas.find((x) => x.id === 'camp')!;
    expect(a.outside).toBe(true);
    expect(a.mw).toBeGreaterThan(0.5);
    expect(sim.energy.totalMw - sim.energy.segmentMw).toBeGreaterThan(a.mw);
  });
});
