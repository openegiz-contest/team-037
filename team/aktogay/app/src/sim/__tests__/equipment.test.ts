import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine';
import { UNIT_DEFS } from '../equipment';
import { serializeAll, thingDefinitions, thingIds } from '../../platform/twins';
import { computeKpis } from '../kpi';

describe('оборудование внутри зданий', () => {
  it('агрегаты живут по процессу и становятся двойниками', () => {
    const sim = new Simulation({ seed: 42, truckCount: 20, strategy: 'smart' });
    sim.advance(3 * 3600);
    const sag = sim.equipment.get('sag-mill')!;
    expect(['run', 'stop']).toContain(sag.state);
    if (sag.state === 'run') expect(Number(sag.v.power)).toBeGreaterThan(8);
    const defs = thingDefinitions(sim, 'smart');
    const id = thingIds('smart');
    for (const d of UNIT_DEFS) expect(defs[id.unit(d.key)]).toBeTruthy();
    expect(defs[id.unit('sag-mill')].attributes._parents).toBe(id.plant);
    const all = serializeAll(sim, 'smart', computeKpis(sim));
    expect(all[id.unit('crusher-drive')].power).toBeTruthy();
    sim.runToEnd();
    if (process.env.SHOW_UNITS) {
      for (const u of sim.equipment.units) console.log(u.def.key, u.state, JSON.stringify(u.v), u.fault ? `fault@${Math.round(u.fault.start / 60)}m` : '');
      console.log(sim.log.filter((l) => l.text.includes('подшипник')).map((l) => l.text));
    }
  });
});
