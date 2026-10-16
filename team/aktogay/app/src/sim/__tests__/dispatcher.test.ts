import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine';
import { applyDispatch, emptyDispatch } from '../../platform/dispatch';

describe('приказы диспетчера', () => {
  it('самосвал едет к назначенному экскаватору и возит только туда, пока приказ действует', () => {
    const sim = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    const st = emptyDispatch();
    sim.advance(1800);
    const target = 4;
    expect(applyDispatch(st, sim, { value: 'assign', truck: 0, order: `ex:${target}` })).toBeTruthy();
    const seen = new Set<number>();
    for (let k = 0; k < 120; k++) {
      sim.advance(60);
      const t = sim.trucks[0];
      if (t.state === 'empty' && t.dest?.kind === 'excavator') seen.add(t.dest.id);
    }
    expect([...seen]).toEqual([target]);
    expect(sim.log.some((l) => l.text.startsWith('Диспетчер: самосвал №101'))).toBe(true);
  });

  it('«стоять» — машина встаёт на стоянку, «система» — выезжает снова', () => {
    const sim = new Simulation({ seed: 5, truckCount: 20, strategy: 'smart' });
    const st = emptyDispatch();
    sim.advance(1800);
    applyDispatch(st, sim, { value: 'assign', truck: 2, order: 'hold' });
    sim.advance(3600);
    expect(sim.trucks[2].state).toBe('idle');
    const trips = sim.trucks[2].trips;
    sim.advance(1800);
    expect(sim.trucks[2].trips).toBe(trips); // стоит, рейсов нет
    applyDispatch(st, sim, { value: 'assign', truck: 2, order: 'auto' });
    sim.advance(3600);
    expect(sim.trucks[2].trips).toBeGreaterThan(trips);
  });

  it('сообщения и ответы водителя попадают в состояние диспетчерской', () => {
    const sim = new Simulation({ seed: 1, truckCount: 10, strategy: 'smart' });
    const st = emptyDispatch();
    applyDispatch(st, sim, { value: 'message', to: 'all', text: 'Взрыв через 15 минут', from: 'Диспетчер смены' });
    expect(st.messages).toHaveLength(1);
    applyDispatch(st, sim, { value: 'ack', truck: 3, msg: st.messages[0].id });
    expect(st.messages[0].read).toEqual([3]);
    applyDispatch(st, sim, { value: 'driver', truck: 3, kind: 'fault' });
    expect(sim.trucks[3].serviceRequested).toBe(true);
    expect(st.events[0].kind).toBe('fault');
    expect(applyDispatch(st, sim, { value: 'assign', truck: 99, order: 'hold' })).toBeNull(); // нет такого самосвала
  });
});
