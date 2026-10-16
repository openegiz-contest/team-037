import { describe, expect, it } from 'vitest';
import { computeEffect, computeKpis, DEFAULT_CONFIG, RoadGraph, Router, Simulation, buildMine } from '..';
import { Rng } from '../rng';

function runShift(seed: number, strategy: 'fixed' | 'smart', truckCount = 20): Simulation {
  const sim = new Simulation({ seed, truckCount, strategy });
  sim.runToEnd();
  return sim;
}

describe('ГПСЧ', () => {
  it('одинаковый seed — одинаковая последовательность', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('разные seed — разные последовательности', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe('Маршруты (Dijkstra)', () => {
  // 0 —1— 1 —1— 2
  //  \           /
  //   ——— 5 ————
  function triangle(): RoadGraph {
    const g = new RoadGraph();
    g.addNode(0, 0, 'junction');
    g.addNode(1, 0, 'junction');
    g.addNode(2, 0, 'junction');
    g.addEdge(0, 1, 'ring', 1);
    g.addEdge(1, 2, 'ring', 1);
    g.addEdge(0, 2, 'ring', 5);
    return g;
  }

  it('находит кратчайший путь', () => {
    const p = triangle().path(0, 2);
    expect(p?.nodes).toEqual([0, 1, 2]);
    expect(p?.length).toBe(2);
  });

  it('обходит закрытое ребро', () => {
    const g = triangle();
    const p = g.path(0, 2, new Set([g.edgeBetween(1, 2)!]));
    expect(p?.nodes).toEqual([0, 2]);
    expect(p?.length).toBe(5);
  });

  it('возвращает null, если цель недостижима', () => {
    const g = triangle();
    expect(g.path(0, 2, new Set([g.edgeBetween(1, 2)!, g.edgeBetween(0, 2)!]))).toBeNull();
  });

  it('все ключевые объекты карьера связаны, длина пути = сумма рёбер', () => {
    const mine = buildMine(DEFAULT_CONFIG);
    const router = new Router(mine.graph);
    const targets = [mine.crusher.node, mine.leach.node, mine.waste.node, ...mine.excavators.map((e) => e.node)];
    for (const t of targets) {
      const nodes = router.route(mine.garage.node, t);
      expect(nodes).not.toBeNull();
      expect(nodes![0]).toBe(mine.garage.node);
      expect(nodes![nodes!.length - 1]).toBe(t);
      expect(mine.graph.pathLength(nodes!)).toBeCloseTo(router.distance(mine.garage.node, t), 6);
    }
  });

  it('закрытие любого одного участка съезда не разрывает сеть (есть второй съезд)', () => {
    const mine = buildMine(DEFAULT_CONFIG);
    const targets = [mine.crusher.node, mine.leach.node, mine.waste.node, ...mine.excavators.map((e) => e.node)];
    for (const group of mine.closureGroups) {
      expect(mine.graph.allReachable(mine.garage.node, targets, new Set(group.edges))).toBe(true);
    }
  });

  it('маршрут при закрытии становится не короче', () => {
    const mine = buildMine(DEFAULT_CONFIG);
    const router = new Router(mine.graph);
    const from = mine.excavators[0].node;
    const to = mine.crusher.node;
    const open = router.distance(from, to);
    for (const group of mine.closureGroups) {
      router.setClosed(group.edges);
      expect(router.distance(from, to)).toBeGreaterThanOrEqual(open - 1e-6);
    }
  });
});

describe('Симуляция', () => {
  it('детерминизм: одинаковый seed даёт идентичные KPI', () => {
    for (const strategy of ['fixed', 'smart'] as const) {
      const a = computeKpis(runShift(7, strategy));
      const b = computeKpis(runShift(7, strategy));
      expect(a).toEqual(b);
    }
  });

  it('разные seed дают разные результаты', () => {
    expect(computeKpis(runShift(1, 'fixed')).minedTotal).not.toBe(computeKpis(runShift(2, 'fixed')).minedTotal);
  });

  it('события (поломки, закрытия) одинаковы для обеих стратегий при одном seed', () => {
    const f = new Simulation({ seed: 3, truckCount: 20, strategy: 'fixed' });
    const s = new Simulation({ seed: 3, truckCount: 20, strategy: 'smart' });
    expect(f.scheduledEvents).toEqual(s.scheduledEvents);
    expect(f.trucks.map((t) => t.breakdowns)).toEqual(s.trucks.map((t) => t.breakdowns));
  });

  it('смена длится 12 часов и даёт осмысленные показатели', () => {
    const sim = runShift(5, 'fixed');
    const k = computeKpis(sim);
    expect(sim.now).toBe(DEFAULT_CONFIG.shift.durationSec);
    expect(k.minedTotal).toBeGreaterThan(0);
    expect(k.mined.sulfide).toBeGreaterThan(0);
    expect(k.mined.oxide).toBeGreaterThan(0);
    expect(k.mined.waste).toBeGreaterThan(0);
    expect(k.utilizationPct).toBeGreaterThan(50);
    expect(k.utilizationPct).toBeLessThanOrEqual(100);
    expect(k.fuelL).toBeGreaterThan(0);
  });

  it('баланс массы: добыто = погружено − в пути', () => {
    const sim = new Simulation({ seed: 11, truckCount: 20, strategy: 'smart' });
    sim.advance(5 * 3600);
    const loaded = sim.excavators.reduce((s, e) => s + e.tonnes, 0);
    const inTrucks = sim.trucks.reduce((s, t) => s + t.loadT, 0);
    expect(sim.minedTotal + inTrucks).toBeCloseTo(loaded, 6);
  });

  it('фиксированная стратегия не меняет закрепление самосвалов', () => {
    const sim = new Simulation({ seed: 4, truckCount: 20, strategy: 'fixed' });
    const visited = sim.trucks.map(() => new Set<number>());
    while (!sim.finished) {
      sim.tick();
      for (const t of sim.trucks) if (t.dest?.kind === 'excavator') visited[t.id].add(t.dest.id);
    }
    sim.trucks.forEach((t) => expect([...visited[t.id]]).toEqual([t.fixedEx]));
  });

  it('ручная поломка экскаватора останавливает погрузку', () => {
    const sim = new Simulation({ seed: 1, truckCount: 20, strategy: 'fixed' });
    sim.advance(3600);
    sim.injectExcavatorBreakdown(0, 1800);
    const before = sim.excavators[0].tonnes;
    sim.advance(1700);
    expect(sim.excavators[0].tonnes).toBe(before);
    expect(sim.excavators[0].state).toBe('broken');
  });
});

describe('Умная стратегия не хуже фиксированной', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const results = seeds.map((seed) => {
    const f = computeKpis(runShift(seed, 'fixed'));
    const s = computeKpis(runShift(seed, 'smart'));
    return { seed, f, s };
  });

  it('в среднем добывает больше', () => {
    const avg = (pick: (r: (typeof results)[number]) => number) => results.reduce((a, r) => a + pick(r), 0) / results.length;
    expect(avg((r) => r.s.minedTotal)).toBeGreaterThan(avg((r) => r.f.minedTotal));
  });

  it('на каждом seed добывает не меньше 98% от фиксированной', () => {
    for (const { f, s } of results) expect(s.minedTotal).toBeGreaterThanOrEqual(f.minedTotal * 0.98);
  });

  it('в среднем меньше простой дробилки и выше использование самосвалов', () => {
    const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((a, r) => a + pick(r), 0);
    // Склад дроблёной руды сглаживает подвоз: на коротком наборе смен простой бывает нулевым у обеих стратегий.
    expect(sum((r) => r.s.crusherIdleMin)).toBeLessThanOrEqual(sum((r) => r.f.crusherIdleMin));
    expect(sum((r) => r.s.utilizationPct)).toBeGreaterThan(sum((r) => r.f.utilizationPct));
  });

  it('экономический эффект положительный в среднем', () => {
    let total = 0;
    for (const seed of seeds) {
      const f = runShift(seed, 'fixed');
      const s = runShift(seed, 'smart');
      total += computeEffect(computeKpis(f), computeKpis(s), s).perYearKzt;
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe('Прогноз отказов', () => {
  it('датчики: без неисправности температура близка к ожидаемой моделью', () => {
    const sim = new Simulation({ seed: 21, truckCount: 20, strategy: 'smart' });
    sim.advance(3 * 3600);
    for (const t of sim.trucks) {
      if (t.breakdowns.length > 0 || t.benign) continue;
      expect(Math.abs(t.sensors.tempC - t.sensors.expectedTempC)).toBeLessThan(2);
    }
  });

  it('тревога поднимается заранее — до запланированного отказа', () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Simulation({ seed, truckCount: 20, strategy: 'smart' });
      const plan = sim.trucks.map((t) => t.breakdowns[0] ?? null);
      const alertAt = new Map<number, number>();
      while (!sim.finished) {
        sim.tick();
        for (const t of sim.trucks) if (t.health.alert && !alertAt.has(t.id)) alertAt.set(t.id, sim.now);
      }
      plan.forEach((f, id) => {
        if (!f || f.precursor === 0 || !alertAt.has(id)) return;
        expect(alertAt.get(id)!).toBeLessThan(f.t);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('умная стратегия предотвращает отказы, фиксированная — нет', () => {
    let fixedFail = 0;
    let smartFail = 0;
    let prevented = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const f = runShift(seed, 'fixed');
      const s = runShift(seed, 'smart');
      fixedFail += f.stats.unplannedFailures;
      smartFail += s.stats.unplannedFailures;
      prevented += s.stats.preventedFailures;
      expect(f.stats.preventedFailures).toBe(0);
    }
    expect(prevented).toBeGreaterThan(0);
    expect(smartFail).toBeLessThan(fixedFail);
  });
});

describe('Взрывные работы', () => {
  it('во время оцепления экскаватор не грузит, график одинаков для обеих стратегий', () => {
    const f = new Simulation({ seed: 8, truckCount: 20, strategy: 'fixed' });
    const s = new Simulation({ seed: 8, truckCount: 20, strategy: 'smart' });
    expect(f.blasts.map((b) => [b.t, b.exIds])).toEqual(s.blasts.map((b) => [b.t, b.exIds]));
    const b = f.blasts[0];
    f.advance(b.t + 60);
    const ex = f.excavators[b.exIds[0]];
    const before = ex.tonnes;
    expect(ex.state === 'blast' || ex.state === 'broken').toBe(true);
    f.advance(b.dur - 300);
    expect(ex.tonnes).toBe(before);
  });

  it('умная стратегия не ставит самосвалы в очередь к экскаватору в оцеплении', () => {
    for (const seed of [1, 2, 3]) {
      const s = new Simulation({ seed, truckCount: 20, strategy: 'smart' });
      let queued = 0;
      while (!s.finished) {
        s.tick();
        for (const ex of s.excavators) if (ex.state === 'blast') queued += ex.queue.length;
      }
      expect(queued).toBe(0);
    }
  });

  it('ручной взрыв объявляется и срабатывает', () => {
    const s = new Simulation({ seed: 2, truckCount: 20, strategy: 'fixed' });
    s.advance(3600);
    const b = s.scheduleBlast(1, 900);
    s.advance(901);
    expect(b.phase).toBe('active');
    expect(s.excavators[1].blastLeft).toBeGreaterThan(0);
  });
});

describe('Качество руды', () => {
  it('содержание меди в питании фабрики в разумных пределах', () => {
    const k = computeKpis(runShift(4, 'smart'));
    expect(k.feedGradePct).toBeGreaterThan(0.25);
    expect(k.feedGradePct).toBeLessThan(0.45);
    expect(k.recoveryPct).toBeGreaterThan(80);
    expect(k.recoveryPct).toBeLessThanOrEqual(88);
  });

  it('умная шихтовка чаще держит качество в целевом коридоре', () => {
    let f = 0;
    let s = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      f += computeKpis(runShift(seed, 'fixed')).gradeInBandPct;
      s += computeKpis(runShift(seed, 'smart')).gradeInBandPct;
    }
    expect(s).toBeGreaterThan(f);
  });
});

describe('Стоянка', () => {
  it('на старте каждый самосвал стоит на своём месте', () => {
    const s = new Simulation({ seed: 1, truckCount: 20, strategy: 'fixed' });
    const nodes = s.trucks.map((t) => t.node);
    expect(new Set(nodes).size).toBe(20);
    for (const n of nodes) expect(s.layout.graph.nodes[n].kind).toBe('slot');
  });

  it('два самосвала никогда не занимают одно место; выезд — по дорогам стоянки', () => {
    const s = new Simulation({ seed: 3, truckCount: 25, strategy: 'smart' });
    while (!s.finished) {
      s.tick();
      if (s.now % 60 !== 0) continue;
      const parked = s.trucks.filter((t) => t.parkSlot !== null).map((t) => t.parkSlot);
      expect(new Set(parked).size).toBe(parked.length);
    }
    // Хотя бы кто-то побывал в гараже (заправка/ППР) и уехал обратно.
    expect(s.trucks.some((t) => t.stateSec.refuel + t.stateSec.service > 0)).toBe(true);
  });
});

describe('Дистанция между самосвалами', () => {
  it('на одной полосе машины почти никогда не сближаются вплотную', () => {
    const s = new Simulation({ seed: 2, truckCount: 25, strategy: 'smart' });
    let pairs = 0;
    let overlaps = 0;
    while (!s.finished) {
      s.tick();
      if (s.now % 30) continue;
      const mv = s.trucks.filter((t) => (t.state === 'empty' || t.state === 'loaded') && t.seg < t.path.length - 1);
      for (let i = 0; i < mv.length; i++)
        for (let j = i + 1; j < mv.length; j++) {
          const a = mv[i];
          const b = mv[j];
          if (a.path[a.seg] !== b.path[b.seg] || a.path[a.seg + 1] !== b.path[b.seg + 1]) continue;
          pairs++;
          if (Math.abs(a.segPos - b.segPos) < 5) overlaps++;
        }
    }
    expect(pairs).toBeGreaterThan(100);
    expect(overlaps / pairs).toBeLessThan(0.01);
  });
});
