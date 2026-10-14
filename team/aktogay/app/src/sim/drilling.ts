/**
 * Буровзрывная подготовка: буровые станки бурят сетку скважин на блоке у каждого забоя,
 * взрыв обуренного блока пополняет запас взорванной горной массы экскаватора, экскаватор
 * грузит из этого запаса. Цепочка «бурение → взрыв → экскавация».
 *
 * Калибровка: в обычную смену запасов хватает, а блок планового взрыва успевает добуриться —
 * модель перевозки не меняется. Последствия появляются, когда бурение срывается (поломка
 * станка): взрыв переносится, запас у экскаватора кончается, он встаёт.
 */
import { Rng, subSeed } from './rng';
import type { Simulation } from './engine';

/** Блок у забоя: сетка скважин вокруг центра будущего взрыва. */
export interface DrillBlock {
  exId: number;
  x: number;
  y: number;
  /** Направление «вдоль уступа» (единичный вектор) — для раскладки сетки. */
  ux: number;
  uy: number;
  holesTotal: number;
  holesDone: number;
  /** Крепость породы: множитель скорости бурения (0.8…1.2). */
  hardness: number;
  /** Масса взорванной горной массы с блока, т. */
  tonnes: number;
}

export type DrillState = 'drilling' | 'moving' | 'idle' | 'broken';

/** Машинист бурового станка (вымышленный): стиль работы. */
export interface DrillOperator {
  name: string;
  years: number;
  /** Темп бурения: множитель скорости проходки, 0.92…1.08. */
  pace: number;
  /** Точность наведения на проектную точку: среднее отклонение устья скважины, м (0.1…0.6). */
  offsetM: number;
  /** Бережность 0.55…0.98: чем выше, тем реже заклинивание става. */
  care: number;
}

/** Телеметрия машиниста за смену. */
export interface DrillOperatorStats {
  /** Чистое время бурения, с (для средней скорости проходки). */
  drillSec: number;
  /** Сумма отклонений устьев от проекта, м, и число скважин. */
  offsetSum: number;
  holes: number;
  /** Заклинивания бурового става. */
  jams: number;
  /** Сколько метров пробурил бы машинист нормального темпа за то же время на той же породе. */
  expectedM: number;
}

const OPERATOR_NAMES = ['Бахыт С.', 'Николай Р.', 'Ержан Т.', 'Андрей К.'];

export interface DrillRig {
  id: number;
  name: string;
  state: DrillState;
  x: number;
  y: number;
  /** Блок, который бурит (номер экскаватора) или к которому едет. */
  target: number | null;
  /** Маршрут переезда: точки (x, y) и пройденная дистанция. */
  path: { x: number; y: number }[];
  pathPos: number;
  /** Текущая скважина: пробурено, м; скорость, м/ч. */
  holeDepth: number;
  penetration: number;
  /** Пауза на переезд к следующей скважине, с. */
  reposition: number;
  brokenLeft: number;
  metersShift: number;
  holesShift: number;
  /** Показания датчиков бурения. */
  pulldown: number;
  torque: number;
  air: number;
  /** Машинист смены и его телеметрия. */
  operator: DrillOperator;
  opStats: DrillOperatorStats;
  /** Отклонение текущей скважины от проекта, м (GNSS). */
  holeOffset: number;
}

export const HOLE_DEPTH_M = 16;
const HOLES = 30;
const BLOCK_T = 50000;
/** Скорость переезда гусеничного станка, м/с (≈1,5 км/ч). */
const TRAVEL_MS = 0.42;
const REPOSITION_SEC = 240;

export class DrillOps {
  readonly blocks: DrillBlock[];
  readonly rigs: DrillRig[];
  /** Запас взорванной горной массы у экскаваторов, т. */
  readonly stockT: number[];
  private readonly rng: Rng;
  /** События машинистов (заклинивания, отклонения) — отдельный поток, чтобы не сдвигать остальное. */
  private readonly opRng: Rng;
  /** Взрывы, о переносе которых уже написали в журнал. */
  readonly postponed = new Set<number>();

  constructor(private readonly sim: Simulation) {
    this.rng = new Rng(subSeed(sim.seed, 9500));
    this.opRng = new Rng(subSeed(sim.seed, 9650));
    const r = new Rng(subSeed(sim.seed, 9501));
    const planned = sim.blasts.filter((b) => !b.manual && b.phase !== 'done').map((b) => b.target);
    this.blocks = sim.excavators.map((ex) => {
      const l = Math.hypot(ex.x, ex.y) || 1;
      const x = ex.x - (ex.x / l) * 90;
      const y = ex.y - (ex.y / l) * 90;
      // Сетка вытянута вдоль уступа (касательная к окружности карьера).
      const ux = -ex.y / l;
      const uy = ex.x / l;
      const isPlanned = planned.includes(ex.id);
      return {
        exId: ex.id,
        x,
        y,
        ux,
        uy,
        holesTotal: HOLES,
        holesDone: isPlanned ? Math.round(HOLES * r.range(0.55, 0.7)) : Math.round(HOLES * r.range(0, 0.4)),
        hardness: r.range(0.8, 1.2),
        tonnes: BLOCK_T,
      };
    });
    // Запас (в часах работы на полной производительности): экскаватору планового взрыва — 6–6,5 ч
    // (до взрыва на 20 сменах он отгружает не больше 4,7 ч, за смену — 8–9 ч: без взрыва запаса
    // не хватит), остальным — на полторы смены.
    this.stockT = sim.excavators.map((ex) => {
      const perHour = ex.rateTpm * 60;
      const hours = planned.includes(ex.id) ? r.range(6, 6.5) : r.range(1.4, 1.8) * (sim.cfg.shift.durationSec / 3600);
      return Math.round(perHour * hours);
    });
    // Оба станка в начале смены добуривают блок ближайшего планового взрыва.
    const first = planned.length ? planned[0] : 0;
    this.rigs = [0, 1].map((i) => {
      const target: number | null = first;
      const b = this.blocks[first];
      const p = this.holePos(b, b.holesDone + i);
      return {
        id: i,
        name: `БУ-${i + 1}`,
        state: 'drilling' as DrillState,
        x: p.x,
        y: p.y,
        target,
        path: [],
        pathPos: 0,
        holeDepth: r.range(0, HOLE_DEPTH_M * 0.8),
        penetration: 30,
        reposition: 0,
        brokenLeft: 0,
        metersShift: 0,
        holesShift: 0,
        pulldown: 0,
        torque: 0,
        air: 0,
        operator: (() => {
          const o = new Rng(subSeed(sim.seed, 9600 + i));
          const skill = o.next();
          return {
            name: OPERATOR_NAMES[(i + Math.floor(o.next() * 2) * 2) % OPERATOR_NAMES.length],
            years: Math.round(2 + 20 * (0.7 * skill + 0.3 * o.next())),
            pace: 0.92 + 0.16 * (0.6 * skill + 0.4 * o.next()),
            offsetM: 0.6 - 0.5 * (0.5 * skill + 0.5 * o.next()),
            care: 0.55 + 0.43 * (0.5 * skill + 0.5 * o.next()),
          };
        })(),
        opStats: { drillSec: 0, offsetSum: 0, holes: 0, jams: 0, expectedM: 0 },
        holeOffset: 0,
      };
    });
  }

  /** Координаты скважины k на блоке (сетка 5 × 6, шаг 8 м). */
  holePos(b: DrillBlock, k: number): { x: number; y: number } {
    const row = Math.floor(k / 6);
    const col = k % 6;
    const along = (col - 2.5) * 8;
    const across = (row - 2) * 8;
    // «Поперёк» — к центру карьера.
    const l = Math.hypot(b.x, b.y) || 1;
    return { x: b.x + b.ux * along - (b.x / l) * across, y: b.y + b.uy * along - (b.y / l) * across };
  }

  /** Сколько смен хватит запаса экскаватору при обычном темпе (оценка). */
  stockShifts(exId: number): number {
    const ex = this.sim.excavators[exId];
    const perShift = ex.rateTpm * 60 * (this.sim.cfg.shift.durationSec / 3600) * 0.65;
    return this.stockT[exId] / Math.max(1, perShift);
  }

  /** Какой блок бурить: блок ближайшего планового взрыва (вдвоём), иначе — у кого меньше запас (по одному). */
  private pickBlock(rig: DrillRig): number | null {
    const sim = this.sim;
    const open = this.blocks.filter((b) => b.holesDone < b.holesTotal);
    const next = sim.blasts
      .filter((b) => (b.phase === 'planned' || b.phase === 'warning') && open.some((o) => o.exId === b.target))
      .sort((a, b) => a.t - b.t)[0];
    if (next) return next.target;
    const other = new Set(this.rigs.filter((g) => g !== rig && g.target !== null).map((g) => g.target));
    const cand = open.filter((b) => !other.has(b.exId)).sort((a, b) => this.stockT[a.exId] - this.stockT[b.exId]);
    return cand[0]?.exId ?? null;
  }

  /** Отгрузка из забоя: уменьшить запас. */
  consume(exId: number, t: number): void {
    this.stockT[exId] = Math.max(0, this.stockT[exId] - t);
  }

  /** Обуренность блока, 0…1. */
  drilled(exId: number): number {
    const b = this.blocks[exId];
    return b.holesDone / b.holesTotal;
  }

  /** Взрыв блока: запас пополняется пропорционально обуренности, блок «новый». */
  blastBlock(exId: number): number {
    const b = this.blocks[exId];
    const add = Math.round(b.tonnes * (b.holesDone / b.holesTotal));
    this.stockT[exId] += add;
    b.holesDone = 0;
    b.hardness = this.rng.range(0.8, 1.2);
    return add;
  }

  breakRig(id: number, durSec: number): boolean {
    const g = this.rigs[id];
    if (!g) return false;
    g.state = 'broken';
    g.brokenLeft = Math.max(g.brokenLeft, durSec);
    return true;
  }

  repairRig(id: number): boolean {
    const g = this.rigs[id];
    if (!g || g.state !== 'broken') return false;
    g.brokenLeft = 0;
    g.state = g.target !== null && g.path.length === 0 ? 'drilling' : 'idle';
    return true;
  }

  tick(dt: number): void {
    const sim = this.sim;
    const n = (sd: number) => (this.rng.next() * 2 - 1) * sd;
    for (const g of this.rigs) {
      if (g.state === 'broken') {
        g.brokenLeft -= dt;
        g.pulldown = g.torque = g.air = 0;
        if (g.brokenLeft <= 0) {
          g.brokenLeft = 0;
          g.state = 'idle';
          sim.addLog(`Буровой станок ${g.name} отремонтирован`, 'info');
        }
        continue;
      }
      if (g.state === 'moving') {
        g.pulldown = g.torque = 0;
        g.air = 0;
        g.pathPos += TRAVEL_MS * dt;
        let d = g.pathPos;
        let arrived = true;
        for (let i = 0; i + 1 < g.path.length; i++) {
          const a = g.path[i];
          const b = g.path[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (d <= len) {
            g.x = a.x + ((b.x - a.x) * d) / (len || 1);
            g.y = a.y + ((b.y - a.y) * d) / (len || 1);
            arrived = false;
            break;
          }
          d -= len;
        }
        if (arrived) {
          const last = g.path[g.path.length - 1];
          g.x = last.x;
          g.y = last.y;
          g.path = [];
          g.state = 'drilling';
          g.holeDepth = 0;
          g.reposition = REPOSITION_SEC;
        }
        continue;
      }
      if (g.state === 'idle' || g.target === null || this.blocks[g.target].holesDone >= this.blocks[g.target].holesTotal) {
        this.assign(g);
        continue;
      }
      // Бурение.
      const b = this.blocks[g.target];
      if (g.reposition > 0) {
        g.reposition -= dt;
        g.pulldown = g.torque = 0;
        g.air = 2;
        continue;
      }
      g.penetration = Math.max(10, (32 / b.hardness) * g.operator.pace + n(1.5));
      g.opStats.drillSec += dt;
      g.opStats.expectedM += ((32 / b.hardness) * dt) / 3600;
      g.holeDepth += (g.penetration * dt) / 3600;
      g.metersShift += (g.penetration * dt) / 3600;
      g.pulldown = Math.round(250 * b.hardness + n(12));
      g.torque = Math.round(9 * b.hardness + n(0.6));
      g.air = Math.round((24 + n(0.8)) * 10) / 10;
      if (g.holeDepth >= HOLE_DEPTH_M) {
        g.holeDepth = 0;
        g.holesShift++;
        // Отклонение устья от проекта (GNSS) и заклинивание става — по стилю машиниста.
        const op = g.operator;
        g.holeOffset = Math.round(op.offsetM * (0.5 + this.opRng.next()) * 100) / 100;
        g.opStats.offsetSum += g.holeOffset;
        g.opStats.holes++;
        const jam = this.opRng.next() < (1 - op.care) * 0.12;
        if (jam) {
          g.opStats.jams++;
          sim.addLog(`Буровой ${g.name} (${op.name}): заклинивание бурового става, освобождение ~8 мин`, 'warn');
        }
        const extra = jam ? 480 : 0;
        b.holesDone = Math.min(b.holesTotal, b.holesDone + 1);
        if (b.holesDone >= b.holesTotal) {
          sim.addLog(`Блок у ${sim.excavators[b.exId].name} обурен (${b.holesTotal} скважин) — готов к взрыву`, 'info');
          this.assign(g);
        } else {
          const p = this.holePos(b, Math.min(b.holesTotal - 1, b.holesDone + g.id));
          g.x = p.x;
          g.y = p.y;
          g.reposition = REPOSITION_SEC + extra;
        }
      }
    }
  }

  /** Назначить станку следующий блок и проложить переезд по дорогам. */
  private assign(g: DrillRig): void {
    const sim = this.sim;
    const t = this.pickBlock(g);
    if (t === null) {
      g.state = 'idle';
      g.target = null;
      return;
    }
    const b = this.blocks[t];
    const dest = this.holePos(b, Math.min(b.holesTotal - 1, b.holesDone + g.id));
    if (g.target === t && Math.hypot(g.x - dest.x, g.y - dest.y) < 60) {
      g.state = 'drilling';
      g.x = dest.x;
      g.y = dest.y;
      return;
    }
    // Маршрут: ближайший узел дороги → заезд к забою по графу → блок.
    const gr = sim.layout.graph;
    let near = 0;
    let best = Infinity;
    for (const nd of gr.nodes) {
      const d = Math.hypot(nd.x - g.x, nd.y - g.y);
      if (d < best) {
        best = d;
        near = nd.id;
      }
    }
    const route = sim.router.route(near, sim.excavators[t].accessNode) ?? [];
    g.path = [{ x: g.x, y: g.y }, ...route.map((id) => ({ x: gr.nodes[id].x, y: gr.nodes[id].y })), dest];
    g.pathPos = 0;
    g.target = t;
    g.state = 'moving';
    sim.addLog(`Буровой станок ${g.name} переезжает на блок у ${sim.excavators[t].name}`, 'info');
  }
}

// ───────────────────────────── рейтинг машинистов ─────────────────────────────

export interface DrillerRating {
  rigId: number;
  name: string;
  years: number;
  /** Средняя скорость проходки, м/ч (MWD); темп относительно нормы для той же породы; отклонение устьев, м (GNSS); заклиниваний на 100 м. */
  paceMh: number | null;
  paceIndex: number | null;
  offsetM: number | null;
  jams100: number | null;
  holesPerHour: number;
  scores: { pace: number; precision: number; care: number };
  total: number;
  advice: string;
  enough: boolean;
}

/** Оценка 0–100 по нормативу: 50 — норматив, края — заметно лучше / хуже. */
const normScore = (v: number, norm: number, span: number, higherIsBetter: boolean) => {
  const z = (v - norm) / span;
  return Math.round(Math.max(0, Math.min(100, 50 + (higherIsBetter ? z : -z) * 50)));
};

/**
 * Машинистов всего двое, поэтому их сравнивают не друг с другом, а с нормативами: темп проходки
 * относительно нормы для той же породы (норма — 32 м/ч на средней крепости), отклонение устья ≤ 0,3 м, не больше 1 заклинивания на 100 м.
 */
export function rateDrillers(ops: DrillOps, shiftSec: number): DrillerRating[] {
  return ops.rigs.map((g) => {
    const st = g.opStats;
    const meters = g.metersShift;
    const paceMh = st.drillSec > 600 ? (meters / st.drillSec) * 3600 : null;
    // Скорость сама по себе зависит от крепости породы — сравниваем с нормой для пройденной породы.
    const paceIndex = st.expectedM > 5 ? meters / st.expectedM : null;
    const offsetM = st.holes > 0 ? st.offsetSum / st.holes : null;
    const jams100 = meters > 20 ? (st.jams / meters) * 100 : null;
    const scores = {
      pace: paceIndex !== null ? normScore(paceIndex, 1, 0.06, true) : 50,
      precision: offsetM !== null ? normScore(offsetM, 0.3, 0.2, false) : 50,
      care: jams100 !== null ? normScore(jams100, 1, 1.2, false) : 50,
    };
    const total = Math.round(0.4 * scores.pace + 0.35 * scores.precision + 0.25 * scores.care);
    let advice: string;
    if (scores.precision < 35) advice = 'Инструктаж по наведению на точку: отклонения портят сетку и дробление';
    else if (scores.care < 35) advice = 'Беречь став: часто заклинивает, теряется время';
    else if (scores.pace >= 60 && scores.precision >= 50) advice = 'Ставить на блоки под ближайший плановый взрыв';
    else if (scores.pace < 40) advice = 'Блоки без спешки — не под ближайший плановый взрыв';
    else advice = 'Любой блок';
    return {
      rigId: g.id,
      name: g.operator.name,
      years: g.operator.years,
      paceMh,
      paceIndex,
      offsetM,
      jams100,
      holesPerHour: shiftSec > 0 ? g.holesShift / (shiftSec / 3600) : 0,
      scores,
      total,
      advice,
      enough: st.holes >= 3,
    };
  });
}
