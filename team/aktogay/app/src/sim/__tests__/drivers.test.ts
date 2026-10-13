import { describe, expect, it } from 'vitest';
import { rampPicks, rateDrivers } from '../drivers';
import { Simulation } from '../engine';

describe('водители', () => {
  it('у водителей разные стили, рейтинг их различает', () => {
    const sim = new Simulation({ seed: 42, truckCount: 20, strategy: 'smart' });
    sim.runToEnd();
    const r = rateDrivers(sim.trucks, sim.now);
    expect(r).toHaveLength(20);
    expect(r[0].total).toBeGreaterThan(r[r.length - 1].total);
    expect(r.every((x) => x.enough)).toBe(true);
    // Телеметрия отражает черты: у быстрого на съездах водителя темп на уклоне выше.
    const pace = (t: (typeof sim.trucks)[number]) => t.speedFactor * t.driver.rampSkill;
    const bySkill = [...sim.trucks].sort((a, b) => pace(b) - pace(a));
    const kmh = (id: number) => r.find((x) => x.truckId === id)!.rampKmh!;
    expect(kmh(bySkill[0].id)).toBeGreaterThan(kmh(bySkill[bySkill.length - 1].id));
    expect(rampPicks(r).length).toBeGreaterThan(0);
    if (process.env.SHOW_DRIVERS)
      for (const x of r)
        console.log(`${x.name.padEnd(12)} ${x.total} ramp ${x.rampKmh?.toFixed(1)} fuel ${x.fuelL100?.toFixed(0)} harsh ${x.harsh100?.toFixed(2)} tph ${x.tph.toFixed(0)} | ${x.advice}`);
  });

  it('одинаковые водители в обоих вариантах', () => {
    const a = new Simulation({ seed: 5, truckCount: 10, strategy: 'smart' });
    const b = new Simulation({ seed: 5, truckCount: 10, strategy: 'fixed' });
    expect(a.trucks.map((t) => t.driver)).toEqual(b.trucks.map((t) => t.driver));
  });
});
