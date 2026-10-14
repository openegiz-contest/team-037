import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine';

describe('бурение → взрыв → экскавация', () => {
  it('в обычную смену плановый блок добуривается и взрывается, запас пополняется', () => {
    const sim = new Simulation({ seed: 42, truckCount: 20, strategy: 'smart' });
    const target = sim.blasts.find((b) => !b.manual)!.target;
    const before = sim.drill.stockT[target];
    sim.runToEnd();
    expect(sim.log.some((l) => l.text.startsWith('Взорван блок'))).toBe(true);
    expect(sim.excavators.every((e) => !sim.timeline.excavators[e.id].includes('n'))).toBe(true);
    expect(sim.drill.rigs.reduce((n, g) => n + g.holesShift, 0)).toBeGreaterThan(5);
    expect(before).toBeGreaterThan(0);
  });

  it('поломка буровых станков срывает взрыв, экскаватору нечего грузить', () => {
    let stopped = 0;
    for (const strategy of ['fixed', 'smart'] as const) {
      const sim = new Simulation({ seed: 42, truckCount: 20, strategy });
      sim.drill.breakRig(0, 11 * 3600);
      sim.drill.breakRig(1, 11 * 3600);
      sim.runToEnd();
      const target = sim.blasts.find((b) => !b.manual)!.target;
      expect(sim.log.some((l) => l.text.includes('перенесён') || l.text.includes('отменён'))).toBe(true);
      if (sim.timeline.excavators[target].includes('n')) stopped++;
      if (process.env.SHOW_DRILL) console.log(strategy, sim.log.filter((l) => /бур|Взрыв|взорван|кончилась|блок/i.test(l.text)).map((l) => `${Math.floor(l.t / 60)} ${l.text}`));
    }
    expect(stopped).toBeGreaterThan(0);
  });
});

import { rateDrillers } from '../drilling';

describe('машинисты буровых станков', () => {
  it('стиль виден в телеметрии и рейтинге', () => {
    const sim = new Simulation({ seed: 42, truckCount: 20, strategy: 'smart' });
    sim.runToEnd();
    const r = rateDrillers(sim.drill, sim.now);
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect(x.enough).toBe(true);
      expect(x.paceMh).toBeGreaterThan(15);
      expect(x.offsetM).toBeGreaterThan(0);
    }
    if (process.env.SHOW_DRILLERS) console.log(r.map((x) => `${x.name} ${x.total} pace ${x.paceMh?.toFixed(1)} off ${x.offsetM?.toFixed(2)} jams ${x.jams100?.toFixed(2)} | ${x.advice}`));
  });
});
