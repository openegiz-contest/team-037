import { describe, expect, it } from 'vitest';
import { computeKpis, Simulation } from '..';
import { impactRows, reportCsv, takeSnapshot } from '../../ui/scenarioReport';

describe('отчёт по сценарию', () => {
  it('CSV: снимок «до», показатели сейчас, разница и история команд', () => {
    const sims = [new Simulation({ seed: 4, truckCount: 20, strategy: 'fixed' }), new Simulation({ seed: 4, truckCount: 20, strategy: 'smart' })];
    sims.forEach((s) => s.advance(1800));
    takeSnapshot(sims[1].now, 'Поломка экскаватора', impactRows(sims, sims.map((s) => computeKpis(s))));
    sims.forEach((s) => s.advance(1800));
    const rows = impactRows(sims, sims.map((s) => computeKpis(s)));
    const csv = reportCsv({ now: sims[1].now, seed: 4, rows, history: [[1800, 'поломка экскаватора Э-1 на 50 мин']] });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    const mined = lines.find((l) => l.startsWith('Добыто, т'))!.split(';');
    expect(mined).toHaveLength(8);
    // «до» меньше «сейчас»: добыча за полчаса выросла
    expect(Number(mined[3].replace(',', '.'))).toBeGreaterThan(Number(mined[1].replace(',', '.')));
    expect(csv).toContain('поломка экскаватора Э-1');
    expect(csv).toContain('Поломка экскаватора');
  });
});
