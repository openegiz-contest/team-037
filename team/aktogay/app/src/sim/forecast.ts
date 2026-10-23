/**
 * Прогноз до конца смены. Двойник отвечает на вопросы, которые диспетчер задаёт в середине смены:
 * выполним ли план, когда кончится дизель на складе ГСМ, хватит ли запаса до гребня дамбы, какой
 * будет себестоимость меди.
 *
 * Метод простой и объяснимый: берём темп за последний час (ряд истории пишется каждые 5 минут) и
 * продолжаем его до конца смены. Разброс — по колебаниям часового темпа внутри этой же смены, то
 * есть «если дальше будет как последний час, то столько ± столько». Это не модель предсказания
 * будущего: взрыв, поломка или метель его изменят, и прогноз сразу пересчитается.
 *
 * Пока смены прошло меньше получаса, темп ещё не устоялся — прогноз помечается как «рано».
 */
import type { Simulation } from './engine';
import { costBreakdown } from './cost';
import { computeKpis, type Kpis } from './kpi';
import { MATERIALS, MATERIAL_SHORT, type Material } from './types';
import { FREEBOARD_MIN_M, POND_AREA_M2 } from './tailings';

/** Раньше этого времени смены темп ещё не устоялся. */
export const FORECAST_AFTER_SEC = 30 * 60;

export interface ForecastRow {
  label: string;
  /** Что уже есть сейчас. */
  now: string;
  /** Чем смена закончится, если дальше будет как в последний час. */
  end: string;
  /** Разброс прогноза (± или «—»). */
  spread?: string;
  /** План или предел, с которым сравниваем. */
  target?: string;
  status: 'ok' | 'risk' | 'miss' | 'none';
  /** На чём основан прогноз — показываем, чтобы цифре можно было верить. */
  basis: string;
}

export interface ShiftForecast {
  /** Прошло и осталось, ч. */
  elapsedH: number;
  leftH: number;
  ready: boolean;
  rows: ForecastRow[];
}

const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU');
const h = (v: number) => `${v.toFixed(1)} ч`;

/** Темп за последний час и его разброс внутри смены, т/ч. */
function rateAndSpread(sim: Simulation): { rate: number; sd: number } {
  const perHour = Math.max(1, Math.round(3600 / sim.cfg.shift.historyEverySec));
  const hist = sim.history;
  const total = MATERIALS.reduce((s, m) => s + sim.stats.mined[m], 0);
  const ref = hist.length > perHour ? hist[hist.length - 1 - perHour] : null;
  const rate = ref && sim.now > 3600 ? ((total - ref.minedTotal) / (sim.now / 60 - ref.tMin)) * 60 : sim.now > 0 ? (total / sim.now) * 3600 : 0;
  // Разброс — по часовым темпам, записанным в истории смены.
  const tphs = hist.filter((p) => p.tMin >= 60).map((p) => p.tph);
  if (tphs.length < 3) return { rate, sd: rate * 0.08 };
  const mean = tphs.reduce((s, v) => s + v, 0) / tphs.length;
  const sd = Math.sqrt(tphs.reduce((s, v) => s + (v - mean) ** 2, 0) / tphs.length);
  return { rate, sd };
}

/** Доля материала в добытом за смену — по ней темп раскладывается на сульфид, оксид и вскрышу. */
function share(sim: Simulation, m: Material): number {
  const total = MATERIALS.reduce((s, x) => s + sim.stats.mined[x], 0);
  return total > 0 ? sim.stats.mined[m] / total : 0;
}

/** Собрать прогноз. KPI можно передать готовыми (на стенде они приходят из двойников). */
export function forecastShift(sim: Simulation, kpis?: Kpis): ShiftForecast {
  const k = kpis ?? computeKpis(sim);
  const elapsedH = sim.now / 3600;
  const leftH = Math.max(0, (sim.cfg.shift.durationSec - sim.now) / 3600);
  const ready = sim.now >= FORECAST_AFTER_SEC;
  const { rate, sd } = rateAndSpread(sim);
  const rows: ForecastRow[] = [];

  // ── план по материалам и всего ──
  const planTotal = MATERIALS.reduce((s, m) => s + sim.cfg.planT[m], 0);
  const minedNow = k.minedTotal;
  const endTotal = minedNow + rate * leftH;
  const plan = (end: number, target: number): ForecastRow['status'] => (end >= target ? 'ok' : end >= target * 0.9 ? 'risk' : 'miss');
  rows.push({
    label: 'Добыча за смену',
    now: `${fmt(minedNow)} т`,
    end: `${fmt(endTotal)} т`,
    spread: `± ${fmt(sd * leftH)} т`,
    target: `план ${fmt(planTotal)} т`,
    status: plan(endTotal, planTotal),
    basis: `темп последнего часа ${fmt(rate)} т/ч × ${h(leftH)}`,
  });
  for (const m of MATERIALS) {
    const end = sim.stats.mined[m] + rate * share(sim, m) * leftH;
    rows.push({
      label: MATERIAL_SHORT[m],
      now: `${fmt(sim.stats.mined[m])} т`,
      end: `${fmt(end)} т`,
      target: `план ${fmt(sim.cfg.planT[m])} т · ${Math.round((end / sim.cfg.planT[m]) * 100)} %`,
      status: plan(end, sim.cfg.planT[m]),
      basis: `доля материала в добыче ${Math.round(share(sim, m) * 100)} %`,
    });
  }

  // ── медь и себестоимость ──
  const cuRate = elapsedH > 0 ? k.cuConcT / elapsedH : 0;
  rows.push({
    label: 'Медь в концентрате',
    now: `${k.cuConcT.toFixed(1)} т`,
    end: `${(k.cuConcT + cuRate * leftH).toFixed(1)} т`,
    status: 'none',
    basis: `${cuRate.toFixed(1)} т/ч за смену`,
  });
  const cost = costBreakdown(sim, k);
  rows.push({
    label: 'Себестоимость меди (C1)',
    now: `$${cost.usdPerLb.toFixed(2)} за фунт`,
    end: `$${cost.usdPerLb.toFixed(2)} за фунт`,
    status: 'none',
    basis: 'постоянные статьи уже разнесены на смену — к концу цифра почти не меняется',
  });

  // ── дизель на складе ГСМ ──
  const fuelH = sim.fuelDepot.hoursLeft;
  rows.push({
    label: 'Дизель на складе ГСМ',
    now: `${fmt(sim.fuelDepot.stockM3)} м³`,
    end: fuelH >= leftH ? 'хватит до конца смены' : `кончится через ${h(fuelH)}`,
    target: `осталось ${h(leftH)}`,
    status: fuelH >= leftH * 1.5 ? 'ok' : fuelH >= leftH ? 'risk' : 'miss',
    basis: `расход ${sim.fuelDepot.flowM3h.toFixed(1)} м³/ч${sim.fuelDepot.refilling ? ', идёт завоз' : ''}`,
  });

  // ── хвостохранилище: запас до гребня дамбы ──
  // Пока дамбу наращивают над пляжем, запас до гребня — это, по сути, уровень пруда: следим за ним.
  const free = sim.tailings.freeboardM;
  const risePerH = sim.tailings.netM3h / POND_AREA_M2;
  const freeEnd = free - risePerH * leftH;
  rows.push({
    label: 'Запас до гребня дамбы',
    now: `${free.toFixed(2)} м`,
    end: `${freeEnd.toFixed(2)} м`,
    target: `норма не ниже ${FREEBOARD_MIN_M.toFixed(2).replace('.', ',')} м`,
    status: freeEnd >= FREEBOARD_MIN_M + 0.5 ? 'ok' : freeEnd >= FREEBOARD_MIN_M ? 'risk' : 'miss',
    basis: `пруд ${risePerH >= 0 ? 'растёт' : 'падает'} на ${Math.abs(risePerH * 100).toFixed(1)} см/ч`,
  });

  // ── риск простоя фабрики ──
  const feedTph = sim.cfg.dumps.crusher.plantFeedTpm * 60;
  const bufferH = sim.oreBufferT / feedTph;
  const sulfideRate = rate * share(sim, 'sulfide');
  rows.push({
    label: 'Запас руды для фабрики',
    now: h(bufferH),
    end: sulfideRate >= feedTph ? 'подвоз покрывает расход' : `просядет: подвоз ${fmt(sulfideRate)} т/ч против ${fmt(feedTph)} т/ч`,
    status: sulfideRate >= feedTph ? 'ok' : bufferH > 1 ? 'risk' : 'miss',
    basis: `буфер ${fmt(sim.oreBufferT)} т при расходе ${fmt(feedTph)} т/ч`,
  });

  return { elapsedH, leftH, ready, rows };
}
