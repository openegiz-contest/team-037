/**
 * Цепочки последствий: двойник находит происшествия смены и прослеживает, к чему они привели —
 * очереди, просадка бункера, остановка фабрики, потеря меди и деньги. Для каждого корня ищется
 * то же событие в теневом расчёте без системы, чтобы показать, сколько система сберегла.
 *
 * Работает по минутной хронологии (Simulation.timeline), поэтому одинаково считает и локально,
 * и по данным двойника «Хронология смены» со стенда.
 */
import type { Simulation } from './engine';

export interface ChainStep {
  /** Минута смены. */
  t: number;
  text: string;
  tone: 'root' | 'warn' | 'bad' | 'good' | 'info';
}

export interface ChainImpact {
  /** Минут простоя фабрики (пустой бункер). */
  starvedMin: number;
  /** Лишние машино-минуты в очередях. */
  queueMin: number;
  /** Потеряно меди в концентрате, т. */
  cuT: number;
  /** Ущерб, ₸. */
  kzt: number;
}

export interface Chain {
  id: string;
  kind: 'excavator' | 'closure' | 'blast' | 'truck' | 'prevented' | 'starvation';
  /** Окно на хронологии, минуты (для подсветки на диаграмме Ганта). */
  t0: number;
  t1: number;
  title: string;
  steps: ChainStep[];
  impact: ChainImpact;
  severity: 'low' | 'mid' | 'high' | 'good';
  /** То же событие в теневом расчёте без системы. */
  shadow?: ChainImpact;
  /** Номер строки на диаграмме (самосвал или экскаватор), если корень — машина. */
  row?: { kind: 'truck' | 'excavator'; id: number };
}

interface Run {
  s: number;
  e: number;
}

/** Отрезки подряд идущих минут, где выполняется условие. */
export function runs(str: string, test: (ch: string) => boolean, minLen = 1): Run[] {
  const out: Run[] = [];
  let s = -1;
  for (let i = 0; i <= str.length; i++) {
    const ok = i < str.length && test(str[i]);
    if (ok && s < 0) s = i;
    if (!ok && s >= 0) {
      if (i - s >= minLen) out.push({ s, e: i });
      s = -1;
    }
  }
  return out;
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;

const fmtKzt = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} млрд ₸` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} млн ₸` : `${Math.round(v / 1e3)} тыс ₸`);

interface Ctx {
  sim: Simulation;
  len: number;
  q: number[];
  qBase: number;
  starved: Run[];
}

function context(sim: Simulation): Ctx {
  const tl = sim.timeline;
  const len = tl.minutes;
  const q = Array.from({ length: len }, (_, m) => tl.trucks.reduce((n, s) => n + (s[m] === 'q' ? 1 : 0), 0));
  const qBase = len ? q.reduce((a, b) => a + b, 0) / len : 0;
  return { sim, len, q, qBase, starved: runs(tl.crusher, (c) => c === 's') };
}

/** Последствия в окне [s, e): очереди, бункер, фабрика, деньги. */
function consequences(ctx: Ctx, s: number, e: number, starvedRuns: Run[] | null): { steps: ChainStep[]; impact: ChainImpact } {
  const { sim, q, qBase, len } = ctx;
  const cfg = sim.cfg;
  const steps: ChainStep[] = [];
  const w1 = Math.min(len, e + 20);
  let queueMin = 0;
  let peak = 0;
  let peakAt = s;
  for (let m = s; m < w1; m++) {
    queueMin += Math.max(0, q[m] - qBase);
    if (q[m] > peak) {
      peak = q[m];
      peakAt = m;
    }
  }
  queueMin = Math.round(queueMin);
  if (queueMin >= 5) steps.push({ t: peakAt, text: `очереди выросли до ${peak} самосвалов (+${queueMin} машино-мин ожидания)`, tone: 'warn' });

  let starvedMin = 0;
  if (starvedRuns) {
    const hit = starvedRuns;
    if (hit.length) {
      starvedMin = hit.reduce((n, r) => n + (r.e - r.s), 0);
      steps.push({ t: hit[0].s, text: 'бункер дробилки опустел', tone: 'bad' });
      steps.push({ t: hit[0].s, text: `фабрика стояла без руды ${starvedMin} мин`, tone: 'bad' });
    } else {
      const lv = sim.timeline.crusher.slice(s, Math.min(len, e + 30));
      const stopAt = lv.indexOf('s');
      const minLv = Math.min(...[...lv].filter((c) => c !== 's').map(Number), 9);
      if (stopAt >= 0) steps.push({ t: s + stopAt, text: 'фабрика вставала без руды — простой учтён в цепочке другой причины', tone: 'warn' });
      else if (lv && minLv <= 2) steps.push({ t: s + lv.indexOf(String(minLv)), text: `бункер просел до ${minLv * 10}%, но фабрика не остановилась`, tone: 'warn' });
      else if (lv) steps.push({ t: e, text: 'фабрика работала без остановки', tone: 'good' });
    }
  }
  const cuT = (starvedMin * cfg.dumps.crusher.plantFeedTpm * cfg.grade.targetPct * cfg.grade.recoveryMax) / 100;
  const kzt = (starvedMin / 60) * cfg.economics.crusherDowntimeKztPerH + (queueMin / 60) * cfg.economics.truckIdleKztPerH;
  const lastStop = Math.max(e, ...(starvedRuns ?? []).map((r) => r.e));
  if (starvedMin > 0) steps.push({ t: lastStop, text: `потеряно ≈ ${cuT.toFixed(1)} т меди в концентрате, ${fmtKzt(kzt)}`, tone: 'bad' });
  else if (kzt >= 1e5) steps.push({ t: e, text: `простои техники ≈ ${fmtKzt(kzt)}`, tone: 'info' });
  return { steps: steps.sort((a, b) => a.t - b.t), impact: { starvedMin, queueMin, cuT, kzt } };
}

function severity(i: ChainImpact): Chain['severity'] {
  if (i.starvedMin > 0 || i.kzt >= 1e7) return 'high';
  if (i.queueMin >= 15) return 'mid';
  return 'low';
}

/** Корни и последствия для одной модели (без сравнения). */
function analyzeOne(sim: Simulation): Chain[] {
  const ctx = context(sim);
  const tl = sim.timeline;
  const cfg = sim.cfg;
  const out: Chain[] = [];
  // Корни, которые могут остановить дробилку (сульфидные забои, взрывы у них, перекрытия съездов).
  const roots: { key: string; s: number; e: number }[] = [];
  tl.excavators.forEach((str, i) => {
    if (sim.excavators[i]?.material !== 'sulfide') return;
    for (const r of runs(str, (c) => c === 'b' || c === 'x', 3)) roots.push({ key: `${str[r.s]}-${i}-${r.s}`, s: r.s, e: r.e });
  });
  for (const r of runs(tl.closures, (c) => c !== '0', 3)) roots.push({ key: `cl-${r.s}`, s: r.s, e: r.e });
  const assigned = new Map<string, Run[]>();
  const orphan: Run[] = [];
  for (const st of ctx.starved) {
    // Причина — та, что шла в момент остановки и началась раньше всех; иначе — последняя закончившаяся
    // не более чем за 30 мин до остановки.
    const active = roots.filter((r) => st.s >= r.s && st.s <= r.e).sort((a, b) => a.s - b.s);
    const recent = roots.filter((r) => st.s > r.e && st.s <= r.e + 30).sort((a, b) => b.e - a.e);
    const cand = active[0] ?? recent[0];
    if (cand) assigned.set(cand.key, [...(assigned.get(cand.key) ?? []), st]);
    else orphan.push(st);
  }
  const mine = (key: string) => assigned.get(key) ?? [];

  // 1. Поломки экскаваторов.
  tl.excavators.forEach((str, i) => {
    const ex = sim.excavators[i];
    if (!ex) return;
    for (const r of runs(str, (c) => c === 'b', 3)) {
      const { steps, impact } = consequences(ctx, r.s, r.e, ex.material === 'sulfide' ? mine(`b-${i}-${r.s}`) : null);
      const mat = ex.material === 'sulfide' ? 'сульфид → дробилка' : ex.material === 'oxide' ? 'оксид' : 'вскрыша';
      out.push({
        id: `ex-${i}-${r.s}`,
        kind: 'excavator',
        t0: r.s,
        t1: r.e,
        title: `Поломка экскаватора ${ex.name}`,
        steps: [{ t: r.s, text: `${ex.name} (${mat}) остановлен на ${r.e - r.s} мин`, tone: 'root' }, ...steps, ...(r.e < ctx.len ? [{ t: r.e, text: `${ex.name} снова в работе`, tone: 'info' as const }] : [])],
        impact,
        severity: severity(impact),
        row: { kind: 'excavator', id: i },
      });
    }
  });

  // 2. Взрывы: одновременные оцепления экскаваторов — одно событие.
  const blasts: { s: number; e: number; ex: number[] }[] = [];
  tl.excavators.forEach((str, i) => {
    for (const r of runs(str, (c) => c === 'x', 3)) {
      const same = blasts.find((b) => Math.abs(b.s - r.s) <= 2);
      if (same) {
        same.ex.push(i);
        same.e = Math.max(same.e, r.e);
      } else blasts.push({ s: r.s, e: r.e, ex: [i] });
    }
  });
  for (const b of blasts) {
    const names = b.ex.map((i) => sim.excavators[i]?.name).join(', ');
    const sulf = b.ex.filter((i) => sim.excavators[i]?.material === 'sulfide');
    // Взрыв у нескольких забоев — простои, назначенные оцеплению любого из сульфидных.
    const st = sulf.flatMap((i) => runs(tl.excavators[i], (c) => c === 'x', 3).filter((r) => Math.abs(r.s - b.s) <= 2).flatMap((r) => mine(`x-${i}-${r.s}`)));
    const { steps, impact } = consequences(ctx, b.s, b.e, sulf.length ? st : null);
    out.push({
      id: `bl-${b.s}`,
      kind: 'blast',
      t0: b.s,
      t1: b.e,
      title: 'Взрывные работы',
      steps: [{ t: b.s, text: `оцепление ${b.e - b.s} мин, стоят ${names}`, tone: 'root' }, ...steps],
      impact,
      severity: severity(impact),
    });
  }

  // 3. Перекрытия съездов.
  for (const r of runs(tl.closures, (c) => c !== '0', 3)) {
    const { steps, impact } = consequences(ctx, r.s, r.e, mine(`cl-${r.s}`));
    out.push({
      id: `cl-${r.s}`,
      kind: 'closure',
      t0: r.s,
      t1: r.e,
      title: 'Перекрытие съезда',
      steps: [{ t: r.s, text: `участок съезда закрыт на ${r.e - r.s} мин, маршруты в объезд`, tone: 'root' }, ...steps],
      impact,
      severity: severity(impact),
    });
  }

  // 4. Отказы самосвалов на трассе и 5. плановые ремонты по прогнозу.
  const cycleMin = 25;
  tl.trucks.forEach((str, i) => {
    const t = sim.trucks[i];
    if (!t) return;
    for (const r of runs(str, (c) => c === 'b', 5)) {
      const dur = r.e - r.s;
      const trips = Math.max(1, Math.round(dur / cycleMin));
      const kzt = cfg.economics.unplannedRepairKzt + (dur / 60) * cfg.economics.truckIdleKztPerH;
      const impact = { starvedMin: 0, queueMin: 0, cuT: 0, kzt };
      out.push({
        id: `tr-${i}-${r.s}`,
        kind: 'truck',
        t0: r.s,
        t1: r.e,
        title: `Отказ самосвала ${t.name} на трассе`,
        steps: [
          { t: r.s, text: `${t.name} встал на трассе: аварийный ремонт ${dur} мин`, tone: 'root' },
          { t: r.s, text: `потеряно ≈ ${trips} рейс. (${trips * cfg.truck.payloadT} т)`, tone: 'warn' },
          { t: r.e, text: `эвакуация и ремонт ≈ ${fmtKzt(kzt)}`, tone: 'bad' },
        ],
        impact,
        severity: kzt >= 1e7 ? 'high' : 'mid',
        row: { kind: 'truck', id: i },
      });
    }
    for (const r of runs(str, (c) => c === 's', 3)) {
      const save = cfg.economics.unplannedRepairKzt - cfg.economics.plannedRepairKzt;
      out.push({
        id: `pr-${i}-${r.s}`,
        kind: 'prevented',
        t0: r.s,
        t1: r.e,
        title: `Авария ${t.name} предотвращена`,
        steps: [
          { t: Math.max(0, r.s - 5), text: 'датчики: рост невязки к модели, тревога прогноза', tone: 'warn' },
          { t: r.s, text: `${t.name} отправлен на плановый ремонт (${r.e - r.s} мин)`, tone: 'root' },
          { t: r.e, text: `отказ на трассе не случился: сбережено ≈ ${fmtKzt(save)}`, tone: 'good' },
        ],
        impact: { starvedMin: 0, queueMin: 0, cuT: 0, kzt: -save },
        severity: 'good',
        row: { kind: 'truck', id: i },
      });
    }
  });

  // 6. Простой фабрики без видимой причины — не хватило самосвалов на сульфиде.
  for (const r of orphan) {
    const { steps, impact } = consequences(ctx, r.s, r.e, [r]);
    const startup = r.s < 40;
    out.push({
      id: `st-${r.s}`,
      kind: 'starvation',
      t0: r.s,
      t1: r.e,
      title: startup ? 'Запуск смены: фабрика ждёт первую руду' : 'Фабрика без руды',
      steps: [
        { t: r.s, text: startup ? 'бункер сработан, первые самосвалы с рудой ещё в пути' : 'руда на дробилку приходила реже, чем её забирает фабрика', tone: 'root' },
        ...steps.filter((x) => x.tone !== 'warn' || !x.text.startsWith('очереди')),
      ],
      impact,
      severity: 'high',
    });
  }
  return out;
}

/** Цепочки последствий для реального карьера; shadow — теневой расчёт без системы для сравнения. */
export function analyzeShift(sim: Simulation, shadow?: Simulation): Chain[] {
  const real = analyzeOne(sim);
  if (shadow) {
    const sh = analyzeOne(shadow);
    for (const c of real) {
      const twin = sh.find((x) => x.kind === c.kind && Math.abs(x.t0 - c.t0) <= 3 && (x.row?.id ?? -1) === (c.row?.id ?? -1));
      if (twin) c.shadow = twin.impact;
      else if (c.kind !== 'prevented' && c.kind !== 'starvation') c.shadow = { starvedMin: 0, queueMin: 0, cuT: 0, kzt: 0 };
    }
    // Без системы плановых ремонтов нет — авария на трассе случилась бы.
    for (const c of real) if (c.kind === 'prevented') c.shadow = { starvedMin: 0, queueMin: 0, cuT: 0, kzt: shadow.cfg.economics.unplannedRepairKzt };
    // Остановки фабрики, которые были только без системы.
    for (const x of sh) {
      if ((x.kind === 'starvation' || x.impact.starvedMin > 0) && !real.some((c) => c.kind === x.kind && Math.abs(c.t0 - x.t0) <= 3)) {
        real.push({ ...x, id: `sh-${x.id}`, title: `${x.title} — только без системы`, impact: { starvedMin: 0, queueMin: 0, cuT: 0, kzt: 0 }, shadow: x.impact, severity: 'good', steps: [...x.steps, { t: x.t1, text: 'с системой этого не случилось', tone: 'good' }] });
      }
    }
  }
  return real.sort((a, b) => b.t0 - a.t0);
}

/** Итоги по цепочкам: ущерб с системой и без неё. */
export function chainTotals(chains: Chain[]) {
  const sum = (f: (c: Chain) => number) => chains.reduce((n, c) => n + f(c), 0);
  return {
    incidents: chains.filter((c) => c.kind !== 'prevented' && !c.id.startsWith('sh-')).length,
    prevented: chains.filter((c) => c.kind === 'prevented').length,
    starvedMin: sum((c) => c.impact.starvedMin),
    kzt: sum((c) => Math.max(0, c.impact.kzt)),
    shadowKzt: sum((c) => c.shadow?.kzt ?? 0),
  };
}
