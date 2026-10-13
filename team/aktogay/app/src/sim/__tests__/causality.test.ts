import { describe, expect, it } from 'vitest';
import { analyzeShift, chainTotals, hhmm, runs } from '../causality';
import { Simulation } from '../engine';

describe('цепочки последствий', () => {
  it('runs находит отрезки', () => {
    expect(runs('aabbbab', (c) => c === 'b')).toEqual([{ s: 2, e: 5 }, { s: 6, e: 7 }]);
    expect(runs('aabbbab', (c) => c === 'b', 2)).toEqual([{ s: 2, e: 5 }]);
  });

  it('смена даёт хронологию и осмысленные цепочки', () => {
    const smart = new Simulation({ seed: 42, truckCount: 20, strategy: 'smart' });
    const fixed = new Simulation({ seed: 42, truckCount: 20, strategy: 'fixed' });
    smart.runToEnd();
    fixed.runToEnd();
    expect(smart.timeline.minutes).toBe(720);
    expect(smart.timeline.trucks[0]).toHaveLength(720);
    const chains = analyzeShift(smart, fixed);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.some((c) => c.kind === 'excavator')).toBe(true);
    const tot = chainTotals(chains);
    if (process.env.SHOW_CHAINS) {
      for (const c of chains.slice().reverse()) {
        console.log(`${hhmm(c.t0)} [${c.severity}] ${c.title} | без системы: ${c.shadow ? Math.round(c.shadow.kzt / 1e6) + ' млн, простой ' + c.shadow.starvedMin : '—'}`);
        for (const s of c.steps) console.log(`    ${hhmm(s.t)} ${s.tone}: ${s.text}`);
      }
      console.log(JSON.stringify(tot));
    }
    expect(tot.shadowKzt).toBeGreaterThanOrEqual(0);
  });
});
