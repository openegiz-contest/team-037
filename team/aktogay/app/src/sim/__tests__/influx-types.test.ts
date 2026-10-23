import { describe, expect, it } from 'vitest';
import { computeKpis, Simulation } from '..';
import { serializeAll } from '../../platform/twins';

/**
 * Telegraf кладёт признаки всех двойников в одну таблицу InfluxDB (mqtt_consumer): поле называется
 * по имени признака. Если у двух двойников признак с одним именем, но разного типа (число и строка),
 * InfluxDB отбрасывает каждое сообщение с «чужим» типом целиком — вместе с остальными признаками
 * двойника. Поэтому один признак — один тип во всех двойниках.
 */
describe('признаки двойников для InfluxDB', () => {
  it('признак с одним именем имеет один тип во всех двойниках', () => {
    const types = new Map<string, Map<string, string>>();
    for (const strategy of ['smart', 'fixed'] as const) {
      const sim = new Simulation({ seed: 3, truckCount: 20, strategy });
      sim.advance(3600);
      const all = serializeAll(sim, strategy, computeKpis(sim));
      for (const [thing, features] of Object.entries(all)) {
        for (const [name, feat] of Object.entries(features)) {
          const v = (feat as { properties?: { value?: unknown } }).properties?.value;
          // целые и дробные числа Telegraf пишет одним типом float
          const t = typeof v === 'boolean' ? 'boolean' : typeof v;
          const m = types.get(name) ?? new Map<string, string>();
          if (!m.has(t)) m.set(t, thing);
          types.set(name, m);
        }
      }
    }
    const conflicts = [...types].filter(([, m]) => m.size > 1).map(([name, m]) => `${name}: ${[...m].map(([t, th]) => `${t} (${th})`).join(' / ')}`);
    expect([...types.values()].filter((m) => m.has('number')).length).toBeGreaterThan(100); // проверка не пустая
    expect(conflicts).toEqual([]);
  });
});
