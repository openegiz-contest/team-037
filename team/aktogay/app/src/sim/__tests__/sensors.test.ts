import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { SENSORS_BY_KIND } from '../../platform/sensors';
import { siteDefinitions, thingDefinitions } from '../../platform/twins';

/** Имя признака по шаблону паспорта: `block_*_cu` подходит к `block_1_cu`, `block_2_cu`… */
function matchesPattern(pattern: string, name: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === name;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  if (!name.startsWith(head) || !name.endsWith(tail) || name.length <= head.length + tail.length) return false;
  const middle = name.slice(head.length, name.length - tail.length);
  return [...middle].every((ch) => ch >= '0' && ch <= '9');
}

/** Паспорт датчика обещает признаки — проверяем, что они действительно есть и заполнены. */
describe('паспорт датчиков', () => {
  const sim = new Simulation({ seed: 1, truckCount: 20, strategy: 'smart' });
  sim.advance(3 * 3600);
  const defs = { ...siteDefinitions(), ...thingDefinitions(sim, 'smart') } as Record<
    string,
    { attributes?: Record<string, unknown>; features?: Record<string, { properties?: { value?: unknown } }> }
  >;

  it('у каждого датчика есть признак или атрибут, который он заполняет', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [id, body] of Object.entries(defs)) {
      const sensors = SENSORS_BY_KIND[String(body.attributes?.kind ?? '')];
      if (!sensors) continue;
      const feats = Object.keys(body.features ?? {});
      const attrs = Object.keys(body.attributes ?? {});
      for (const s of sensors) {
        checked++;
        for (const f of s.features) if (!feats.some((k) => matchesPattern(f, k)) && !attrs.includes(f)) missing.push(`${id} · ${s.name} · ${f}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });

  it('датчики отдают значения, а не пустые признаки', () => {
    const empty: string[] = [];
    for (const [id, body] of Object.entries(defs)) {
      const sensors = SENSORS_BY_KIND[String(body.attributes?.kind ?? '')];
      if (!sensors) continue;
      for (const s of sensors) {
        const vals = Object.entries(body.features ?? {})
          .filter(([k]) => s.features.some((f) => matchesPattern(f, k)))
          .map(([, v]) => v.properties?.value);
        if (vals.length && vals.every((v) => v === undefined || v === null || v === '')) empty.push(`${id} · ${s.name}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('у каждого датчика заполнен паспорт целиком', () => {
    for (const [kind, sensors] of Object.entries(SENSORS_BY_KIND)) {
      for (const s of sensors) {
        const where = `${kind}/${s.id}`;
        expect(s.name.length, where).toBeGreaterThan(3);
        expect(s.hardware.length, where).toBeGreaterThan(10);
        expect(s.location.length, where).toBeGreaterThanOrEqual(3);
        expect(s.measures.length, where).toBeGreaterThan(5);
        expect(s.purpose.length, where).toBeGreaterThan(10);
        expect(s.features.length, where).toBeGreaterThan(0);
      }
    }
  });
});
