/**
 * Стратегии диспетчеризации самосвалов.
 *
 * 1. FixedStrategy — самосвал закреплён за одним экскаватором на всю смену (как на многих карьерах сейчас).
 * 2. SmartStrategy — при каждом освобождении самосвал отправляется туда, где минимально ожидаемое
 *    время до окончания погрузки (ETA проезда + прогноз очереди + время погрузки), с поправками
 *    на отставание от плана по каждому материалу и на угрозу простоя дробилки.
 */
import type { Simulation } from './engine';
import { gradeAt } from './ore';
import { MATERIALS, type DumpSite, type Excavator, type Material, type StrategyName, type Truck } from './types';

export interface DispatchStrategy {
  readonly name: StrategyName;
  /** Выбрать экскаватор для порожнего самосвала. */
  choose(sim: Simulation, truck: Truck): number;
  /** Реакция на поломку экскаватора. */
  onExcavatorDown?(sim: Simulation, ex: Excavator): void;
  /** Реакция на любое изменение обстановки (дороги, ремонт). */
  onDisruption?(sim: Simulation): void;
  /** Выбрать пункт разгрузки, когда их несколько (отвалы вскрыши). */
  chooseDump?(sim: Simulation, truck: Truck, ex: Excavator, candidates: DumpSite[]): number;
}

export class FixedStrategy implements DispatchStrategy {
  readonly name = 'fixed' as const;

  choose(_sim: Simulation, truck: Truck): number {
    return truck.fixedEx;
  }
}

export interface Evaluation {
  best: number;
  /** Оценка (с) для каждого экскаватора: меньше — лучше. */
  scores: number[];
  /** Ожидаемое время до начала погрузки, с. */
  waits: number[];
  bonus: Record<Material, number>;
}

export class SmartStrategy implements DispatchStrategy {
  readonly name = 'smart' as const;

  /**
   * Самосвал по умолчанию остаётся на своей «петле» (стартовое закрепление — как у плановика),
   * но перезакрепляется, если другой экскаватор даёт выигрыш больше порога: очередь, поломка,
   * отставание от плана, угроза простоя дробилки.
   */
  choose(sim: Simulation, truck: Truck): number {
    const ev = this.evaluate(sim, truck);
    const home = truck.homeEx;
    if (ev.best !== home && !(ev.scores[home] - ev.scores[ev.best] <= sim.cfg.smart.stickinessSec)) truck.homeEx = ev.best;
    return truck.homeEx;
  }

  evaluate(sim: Simulation, truck: Truck): Evaluation {
    const { node, extra } = sim.routeOrigin(truck);
    const dist = sim.router.from(node).dist;
    const v = sim.speedEmpty;
    const now = sim.now;

    // Прогноз прибытия других самосвалов к каждому экскаватору: порожние — по оставшемуся пути,
    // гружёные — вернутся на свою петлю после разгрузки.
    const arrivals: number[][] = sim.excavators.map(() => []);
    for (const o of sim.trucks) {
      if (o === truck) continue;
      if (o.dest?.kind === 'excavator') {
        if (o.state === 'empty') arrivals[o.dest.id].push(now + sim.remainingDistance(o) / v);
        else if (o.state === 'broken' && o.resumeState === 'empty')
          arrivals[o.dest.id].push(now + o.timer + sim.remainingDistance(o) / v);
      } else if (o.dest?.kind === 'dump' && o.loadT > 0) {
        const dump = sim.dumps[o.dest.id];
        const haul = o.state === 'loaded' || o.state === 'broken' ? sim.remainingDistance(o) / sim.speedLoaded : 0;
        const repair = o.state === 'broken' ? o.timer : 0;
        const back = sim.router.distance(dump.node, sim.excavators[o.homeEx].node) / v;
        arrivals[o.homeEx].push(now + repair + haul + dump.dumpTimeSec + back);
      }
    }

    const bonus = this.materialBonus(sim, truck);
    const share = this.shareBonus(sim, truck);
    const grade = this.gradeBonus(sim, truck);
    const scores: number[] = [];
    const waits: number[] = [];
    let best = truck.fixedEx;
    let bestScore = Infinity;
    for (const ex of sim.excavators) {
      const d = dist[ex.node] + extra;
      if (!Number.isFinite(d)) {
        scores.push(Infinity);
        waits.push(Infinity);
        continue;
      }
      const arrive = now + d / v;
      const lt = sim.expectedLoadTime(ex);
      const down = Math.max(ex.state === 'broken' ? ex.brokenLeft : ex.state === 'nostock' ? 4 * 3600 : 0, ex.blastLeft);
      const free0 = now + down + (ex.loading !== null ? ex.loadLeft : 0) + ex.queue.length * lt;
      // Прогоняем очередь с учётом уже едущих самосвалов: когда начнём грузиться мы
      // и насколько наш приезд задержит тех, кто приедет позже (их ожидание — тоже потеря).
      const arr = arrivals[ex.id].sort((x, y) => x - y);
      let free = free0;
      let freeWithout = free0;
      let start = -1;
      let pushed = 0;
      for (const a of arr) {
        if (start < 0 && a > arrive) {
          start = Math.max(free, arrive);
          free = start + lt;
        }
        const s1 = Math.max(free, a);
        const s0 = Math.max(freeWithout, a);
        if (start >= 0) pushed += s1 - s0;
        free = s1 + lt;
        freeWithout = s0 + lt;
      }
      if (start < 0) start = Math.max(free, arrive);
      // График взрывов известен: если погрузка попадёт в оцепление — начнём только после него.
      const win = sim.blastWindow(ex.id, now);
      if (win && start + lt > win[0] && start < win[1]) start = win[1];
      // Время до окончания погрузки (доезд + ожидание + погрузка) + задержка, которую мы создадим другим.
      // Длину петли не сравниваем: сколько машин нужно на каждую петлю, задаёт план (shareBonus).
      const score = start + lt - now + pushed - bonus[ex.material] - share[ex.id] - grade[ex.id];
      scores.push(score);
      waits.push(start - arrive);
      if (score < bestScore) {
        bestScore = score;
        best = ex.id;
      }
    }
    return { best, scores, waits, bonus };
  }

  /**
   * Бонус (с) экскаватору, отстающему от своей целевой доли потока. Целевая доля — из плана смены
   * (как у плановика), но сломанные экскаваторы из неё временно исключаются, а самосвалы
   * не привязаны: доля «добирается» любым ближайшим свободным самосвалом.
   */
  shareBonus(sim: Simulation, truck: Truck): number[] {
    const payload = sim.cfg.truck.payloadT;
    const allocated = sim.excavators.map((e) => e.tonnes);
    for (const o of sim.trucks) {
      if (o === truck || o.dest?.kind !== 'excavator' || o.state === 'idle') continue;
      allocated[o.dest.id] += payload;
    }
    const active = sim.excavators.map((e) => (e.state === 'broken' || e.state === 'nostock' ? 0 : sim.targetShare[e.id]));
    const shareSum = active.reduce((a, b) => a + b, 0) || 1;
    const activeAllocated = allocated.reduce((s, a, i) => s + (active[i] > 0 ? a : 0), 0);
    return active.map((a, i) => {
      if (a === 0) return 0;
      const deficitLoads = ((a / shareSum) * activeAllocated - allocated[i]) / payload;
      // Мёртвая зона: небольшие отклонения от доли не стоят переезда через весь карьер.
      const db = sim.cfg.smart.shareDeadbandLoads;
      const excess = Math.sign(deficitLoads) * Math.max(0, Math.abs(deficitLoads) - db);
      return sim.cfg.smart.shareWeightSec * clamp(excess, -2, 2);
    });
  }

  /**
   * Шихтовка: если руда в бункере (с учётом уже везущих) беднее цели — бонус богатому забою,
   * если богаче — бедному. Так содержание меди на фабрике держится в коридоре.
   */
  gradeBonus(sim: Simulation, truck: Truck): number[] {
    const gc = sim.cfg.grade;
    const c = sim.crusher;
    // Шихтуется всё, что ещё не ушло на фабрику: приёмный бункер + склад.
    let t = c.binT + sim.stockpile.t;
    let cu = c.binCuT + sim.stockpile.cuT;
    for (const o of sim.trucks) {
      if (o === truck || o.material !== 'sulfide' || o.loadT <= 0) continue;
      t += o.loadT;
      cu += (o.loadT * o.gradePct) / 100;
    }
    const projected = t > 1 ? (cu / t) * 100 : gc.targetPct;
    const need = Math.max(-1, Math.min(1, (gc.targetPct - projected) / gc.bandPct));
    return sim.excavators.map((ex) => {
      if (ex.material !== 'sulfide') return 0;
      const rich = Math.max(-1, Math.min(1, (gradeAt(ex, sim.now) - gc.targetPct) / gc.bandPct));
      return sim.cfg.smart.gradeWeightSec * need * rich;
    });
  }

  /** Бонус (в секундах) материалу, отстающему от плана; сульфиду — ещё и при угрозе простоя дробилки. */
  materialBonus(sim: Simulation, truck: Truck): Record<Material, number> {
    const cfg = sim.cfg;
    const payload = cfg.truck.payloadT;
    const committed: Record<Material, number> = { sulfide: 0, oxide: 0, waste: 0 };
    for (const o of sim.trucks) {
      if (o === truck) continue;
      if (o.loadT > 0 && o.material) {
        committed[o.material] += o.loadT;
      } else if (o.dest?.kind === 'excavator' && o.state !== 'idle') {
        committed[sim.excavators[o.dest.id].material] += payload;
      }
    }
    const T = cfg.shift.durationSec;
    const horizon = cfg.smart.planHorizonMin * 60;
    const bonus = {} as Record<Material, number>;
    for (const m of MATERIALS) {
      const plan = cfg.planT[m];
      const expected = plan * Math.min(1, (sim.now + horizon) / T);
      const frac = (expected - sim.stats.mined[m] - committed[m]) / plan;
      bonus[m] = cfg.smart.planWeightSec * clamp(frac / 0.05, -1, 1);
    }
    // Прогноз бункера дробилки на горизонте доставки: всё, что уже везут или грузят на сульфид,
    // минус потребление фабрики. Очередь у дробилки допустима — её простой дороже простоя самосвала.
    const projected = sim.oreBufferT + committed.sulfide - cfg.dumps.crusher.plantFeedTpm * cfg.smart.binHorizonMin;
    const urgency = clamp((cfg.smart.binLowT - projected) / cfg.smart.binLowT, 0, 1);
    bonus.sulfide += cfg.smart.crusherWeightSec * urgency;
    return bonus;
  }

  /** Отвал: время гружёного рейса + ожидаемая очередь (с учётом уже едущих туда) + обратный путь к забою. */
  chooseDump(sim: Simulation, _truck: Truck, ex: Excavator, candidates: DumpSite[]): number {
    let best = candidates[0].id;
    let bestScore = Infinity;
    for (const d of candidates) {
      const haul = sim.router.distance(ex.node, d.node) / sim.speedLoaded;
      const back = sim.router.distance(d.node, ex.node) / sim.speedEmpty;
      const heading = sim.trucks.filter((o) => o.state === 'loaded' && o.dest?.kind === 'dump' && o.dest.id === d.id).length;
      const ahead = d.queue.length + d.active.length + heading;
      const wait = Math.max(0, ahead - d.bays + 1) * (d.dumpTimeSec / Math.max(1, d.bays));
      const score = haul + wait + back;
      if (score < bestScore) {
        bestScore = score;
        best = d.id;
      }
    }
    return best;
  }

  onExcavatorDown(sim: Simulation, ex: Excavator): void {
    // Самосвал под погрузкой: если набрано ≥30% — отправляем на разгрузку недогруженным.
    if (ex.loading !== null) {
      const fraction = 1 - ex.loadLeft / Math.max(1, sim.loadTotal[ex.id]);
      if (fraction >= 0.3) sim.finishLoading(ex, fraction);
      else {
        const t = sim.trucks[ex.loading];
        ex.loading = null;
        sim.dispatchEmpty(t);
      }
    }
    // Очередь — перераспределяем на другие экскаваторы.
    for (const id of sim.removeFromExcavatorQueue(ex)) sim.dispatchEmpty(sim.trucks[id]);
    this.onDisruption(sim);
  }

  /** Пересмотреть цели самосвалов, уже едущих порожними, если выигрыш заметный. */
  onDisruption(sim: Simulation): void {
    for (const t of sim.trucks) {
      if (t.state !== 'empty' || t.dest?.kind !== 'excavator') continue;
      if (sim.manual.has(t.id)) continue; // приказ диспетчера не перебиваем
      const ev = this.evaluate(sim, t);
      const cur = t.dest.id;
      if (ev.best !== cur && ev.scores[cur] - ev.scores[ev.best] > sim.cfg.smart.switchGainSec) {
        t.homeEx = ev.best;
        sim.setDestination(t, { kind: 'excavator', id: ev.best });
      }
    }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function createStrategy(name: StrategyName): DispatchStrategy {
  return name === 'smart' ? new SmartStrategy() : new FixedStrategy();
}
