import { describe, expect, it } from 'vitest';
import { costBreakdown, Simulation } from '..';

describe('энергоучёт', () => {
  it('сумма по участкам равна общей мощности, энергия накапливается', () => {
    const s = new Simulation({ seed: 2, truckCount: 20, strategy: 'smart' });
    s.advance(3 * 3600);
    const e = s.energy;
    const sum = e.areas.reduce((a, x) => a + x.mw, 0);
    expect(e.totalMw).toBeCloseTo(sum, 6);
    expect(e.totalKwh).toBeCloseTo(e.areas.reduce((a, x) => a + x.kwh, 0), 0);
    expect(e.peakMw).toBeGreaterThanOrEqual(e.totalMw - 1e-9);
    expect(e.areas.find((a) => a.id === 'plant')!.kwh).toBeGreaterThan(e.areas.find((a) => a.id === 'aux')!.kwh);
  });

  it('удельный расход в правдоподобном диапазоне для медной фабрики', () => {
    const s = new Simulation({ seed: 2, truckCount: 20, strategy: 'smart' });
    s.advance(12 * 3600);
    const kwhT = s.energy.perTonneOre(s);
    expect(kwhT).toBeGreaterThan(10);
    expect(kwhT).toBeLessThan(40);
    expect(s.energy.costKzt(s)).toBeGreaterThan(0);
  });

  it('когда фабрика стоит без руды, энергия всё равно тратится', () => {
    const s = new Simulation({ seed: 2, truckCount: 20, strategy: 'smart' });
    // Опустошаем и склад, и приёмный бункер — фабрике нечего перерабатывать.
    s.stockpile.t = 0;
    s.crusher.binT = 0;
    s.crusher.binCuT = 0;
    s.advance(60);
    expect(s.energy.idleKwh).toBeGreaterThan(0);
    expect(s.energy.areas.find((a) => a.id === 'plant')!.mw).toBeGreaterThan(0);
  });
});

describe('себестоимость тонны меди', () => {
  it('сумма статей равна итогу, медь считается по двум потокам', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(12 * 3600);
    const r = costBreakdown(s);
    expect(r.lines.reduce((a, l) => a + l.kzt, 0)).toBeCloseTo(r.totalKzt, 3);
    expect(r.modelledKzt + r.estimatedKzt).toBeCloseTo(r.totalKzt, 3);
    // оплачиваемая медь: катоды целиком плюс доля меди в концентрате
    expect(r.payableCuT).toBeCloseTo(r.cathodeT + (s.stats.cuConcT * s.cfg.economics.payableCuPct) / 100, 6);
    expect(r.payableCuT).toBeLessThan(s.stats.cuConcT + r.cathodeT);
  });

  it('себестоимость в правдоподобном для медного рудника диапазоне', () => {
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    s.advance(12 * 3600);
    const r = costBreakdown(s);
    expect(r.usdPerLb).toBeGreaterThan(0.5);
    expect(r.usdPerLb).toBeLessThan(3);
    // часть статей посчитана моделью, часть принята оценкой — и то и другое заметно
    expect(r.modelledKzt / r.totalKzt).toBeGreaterThan(0.2);
    expect(r.estimatedKzt / r.totalKzt).toBeGreaterThan(0.2);
  });

  it('с системой себестоимость не выше, чем без неё', () => {
    const run = (strategy: 'smart' | 'fixed') => {
      const s = new Simulation({ seed: 3, truckCount: 20, strategy });
      s.advance(12 * 3600);
      return costBreakdown(s).usdPerLb;
    };
    expect(run('smart')).toBeLessThanOrEqual(run('fixed'));
  });
});
