import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { buildShiftReport, reportCsv } from '../../ui/shiftReport';

const pair = (seed = 6) => {
  const fixed = new Simulation({ seed, truckCount: 20, strategy: 'fixed' });
  const smart = new Simulation({ seed, truckCount: 20, strategy: 'smart' });
  return { fixed, smart };
};

describe('сводка смены', () => {
  it('собирается из данных смены: все разделы заполнены, добыча совпадает с моделью', () => {
    const { fixed, smart } = pair();
    fixed.advance(4 * 3600);
    smart.advance(4 * 3600);
    const r = buildShiftReport(smart, fixed);
    expect(r.sections).toHaveLength(6);
    for (const s of r.sections) expect(s.rows.length, s.title).toBeGreaterThan(3);
    const mined = smart.stats.mined.sulfide + smart.stats.mined.oxide + smart.stats.mined.waste;
    const row = r.sections[0].rows[0];
    expect(row.value).toBe(`${Math.round(mined).toLocaleString('ru-RU')} т`);
    expect(r.effectReady).toBe(true);
    expect(r.effectShiftKzt).toBeGreaterThan(0);
    expect(r.effectYearKzt).toBeGreaterThan(r.effectShiftKzt);
  });

  it('без теневого расчёта сводка строится, но эффект нулевой', () => {
    const { smart } = pair();
    smart.advance(3600);
    const r = buildShiftReport(smart);
    expect(r.sections).toHaveLength(6);
    expect(r.effectReady).toBe(false);
    expect(r.effectShiftKzt).toBe(0);
  });

  it('CSV содержит все разделы, происшествия и эффект', () => {
    const { fixed, smart } = pair(9);
    fixed.advance(5 * 3600);
    smart.advance(5 * 3600);
    const r = buildShiftReport(smart, fixed);
    const csv = reportCsv(r);
    expect(csv.startsWith('﻿')).toBe(true);
    for (const s of r.sections) expect(csv).toContain(s.title);
    expect(csv).toContain('Эффект системы за смену, ₸');
    const rows = csv.slice(1).split('\r\n').filter((l) => l.startsWith('Добыча и план;'));
    expect(rows.length).toBe(r.sections[0].rows.length);
  });
});
