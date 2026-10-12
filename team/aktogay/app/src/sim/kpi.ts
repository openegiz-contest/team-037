/** Расчёт KPI и экономического эффекта по состоянию симуляции. */
import type { Simulation } from './engine';
import { MATERIALS, PRODUCTIVE_STATES, TRUCK_STATES, type Material, type TruckState } from './types';

export interface Kpis {
  elapsedH: number;
  mined: Record<Material, number>;
  minedTotal: number;
  /** Средний темп за смену, т/ч. */
  tph: number;
  /** Среднее ожидание в очереди у экскаватора на одну погрузку, мин. */
  avgQueueMin: number;
  /** Коэффициент использования самосвалов, %. */
  utilizationPct: number;
  truckIdleH: number;
  excavatorIdleH: number;
  idleCostKzt: number;
  fuelL: number;
  fuelCostKzt: number;
  fuelLPerT: number;
  planPct: Record<Material, number>;
  planTotalPct: number;
  crusherIdleMin: number;
  crusherIdleCostKzt: number;
  stateShare: Record<TruckState, number>;
  trips: number;
  /** Аварийные отказы самосвалов за смену. */
  unplannedFailures: number;
  /** Отказы, предотвращённые ППР по прогнозу. */
  preventedFailures: number;
  falseAlarms: number;
  /** Самосвало-часы в аварийном ремонте. */
  brokenH: number;
  /** Самосвало-часы на плановом ремонте по прогнозу. */
  serviceH: number;
  repairCostKzt: number;
  /** Среднее содержание меди в питании фабрики, %. */
  feedGradePct: number;
  /** Доля времени работы фабрики, когда содержание в целевом коридоре, %. */
  gradeInBandPct: number;
  /** Извлечение меди в концентрат, %. */
  recoveryPct: number;
  /** Медь в концентрате, т. */
  cuConcT: number;
  /** Экскаваторо-часы в оцеплении из-за взрывов. */
  blastStopH: number;
}

export function computeKpis(sim: Simulation): Kpis {
  const cfg = sim.cfg;
  const elapsedH = sim.now / 3600;
  const mined = { ...sim.stats.mined };
  const minedTotal = MATERIALS.reduce((s, m) => s + mined[m], 0);

  const stateSec = Object.fromEntries(TRUCK_STATES.map((s) => [s, 0])) as Record<TruckState, number>;
  let trips = 0;
  for (const t of sim.trucks) {
    for (const s of TRUCK_STATES) stateSec[s] += t.stateSec[s];
    trips += t.trips;
  }
  const totalSec = TRUCK_STATES.reduce((s, k) => s + stateSec[k], 0) || 1;
  const productive = PRODUCTIVE_STATES.reduce((s, k) => s + stateSec[k], 0);
  const stateShare = Object.fromEntries(TRUCK_STATES.map((s) => [s, stateSec[s] / totalSec])) as Record<TruckState, number>;

  const truckIdleH = (stateSec.queue + stateSec.idle) / 3600;
  const excavatorIdleH = sim.excavators.reduce((s, e) => s + e.idleSec, 0) / 3600;
  const idleCostKzt = truckIdleH * cfg.economics.truckIdleKztPerH + excavatorIdleH * cfg.economics.excavatorIdleKztPerH;

  const fuelL = sim.stats.fuelL;
  const planPct = {} as Record<Material, number>;
  for (const m of MATERIALS) planPct[m] = (mined[m] / cfg.planT[m]) * 100;
  const planTotal = MATERIALS.reduce((s, m) => s + cfg.planT[m], 0);

  const crusherIdleMin = sim.crusher.starvedSec / 60;

  return {
    elapsedH,
    mined,
    minedTotal,
    tph: elapsedH > 0 ? minedTotal / elapsedH : 0,
    avgQueueMin: sim.stats.exLoadsStarted > 0 ? sim.stats.exQueueSec / sim.stats.exLoadsStarted / 60 : 0,
    utilizationPct: (productive / totalSec) * 100,
    truckIdleH,
    excavatorIdleH,
    idleCostKzt,
    fuelL,
    fuelCostKzt: fuelL * cfg.economics.dieselKztPerL,
    fuelLPerT: minedTotal > 0 ? fuelL / minedTotal : 0,
    planPct,
    planTotalPct: (minedTotal / planTotal) * 100,
    crusherIdleMin,
    crusherIdleCostKzt: (crusherIdleMin / 60) * cfg.economics.crusherDowntimeKztPerH,
    stateShare,
    trips,
    unplannedFailures: sim.stats.unplannedFailures,
    preventedFailures: sim.stats.preventedFailures,
    falseAlarms: sim.stats.falseAlarms,
    feedGradePct: sim.stats.plantFeedT > 0 ? (sim.stats.cuFeedT / sim.stats.plantFeedT) * 100 : 0,
    gradeInBandPct: sim.stats.feedSec > 0 ? (sim.stats.feedInBandSec / sim.stats.feedSec) * 100 : 0,
    recoveryPct: sim.stats.cuFeedT > 0 ? (sim.stats.cuConcT / sim.stats.cuFeedT) * 100 : 0,
    cuConcT: sim.stats.cuConcT,
    blastStopH: sim.excavators.reduce((s, e) => s + e.blastSec, 0) / 3600,
    brokenH: stateSec.broken / 3600,
    serviceH: stateSec.service / 3600,
    repairCostKzt:
      sim.stats.unplannedFailures * cfg.economics.unplannedRepairKzt +
      (sim.stats.preventedFailures + sim.stats.falseAlarms) * cfg.economics.plannedRepairKzt,
  };
}

export interface EffectPart {
  label: string;
  perShiftKzt: number;
  formula: string;
}

export interface Effect {
  perShiftKzt: number;
  perYearKzt: number;
  parts: EffectPart[];
  extraTonnesPerShift: number;
  extraSulfidePerShift: number;
  shiftScale: number;
  shiftsPerYear: number;
}

/**
 * Экономический эффект «умной» диспетчеризации относительно «фиксированной».
 * Значения за прошедшую часть смены экстраполируются на полную смену, затем на год:
 *   Эффект/год = [ΔПростои + ΔПростой дробилки + ΔТопливо на тонну × тонны] × смен в году.
 * Дополнительная добыча показывается отдельно и в деньги не переводится (консервативная оценка).
 */
export function computeEffect(base: Kpis, smart: Kpis, sim: Simulation): Effect {
  const cfg = sim.cfg;
  const shiftScale = sim.now > 0 ? cfg.shift.durationSec / sim.now : 0;
  const kzt = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ₸`;
  const idle = (base.idleCostKzt - smart.idleCostKzt) * shiftScale;
  const crusher = (base.crusherIdleCostKzt - smart.crusherIdleCostKzt) * shiftScale;
  const fuel = (base.fuelLPerT - smart.fuelLPerT) * smart.minedTotal * cfg.economics.dieselKztPerL * shiftScale;
  const parts: EffectPart[] = [
    {
      label: 'Простои самосвалов и экскаваторов',
      perShiftKzt: idle,
      formula: `(${kzt(base.idleCostKzt)} − ${kzt(smart.idleCostKzt)}) × ${shiftScale.toFixed(2)}`,
    },
    {
      label: 'Простой дробилки (остановка ОФ)',
      perShiftKzt: crusher,
      formula: `(${base.crusherIdleMin.toFixed(1)} − ${smart.crusherIdleMin.toFixed(1)}) мин × ${kzt(cfg.economics.crusherDowntimeKztPerH)}/ч × ${shiftScale.toFixed(2)}`,
    },
    {
      label: 'Топливо на тонну',
      perShiftKzt: fuel,
      formula: `(${base.fuelLPerT.toFixed(3)} − ${smart.fuelLPerT.toFixed(3)}) л/т × ${Math.round(smart.minedTotal).toLocaleString('ru-RU')} т × ${cfg.economics.dieselKztPerL} ₸/л × ${shiftScale.toFixed(2)}`,
    },
  ];
  const repair = (base.repairCostKzt - smart.repairCostKzt) * shiftScale;
  parts.push({
    label: 'Ремонты: аварийные → плановые по прогнозу',
    perShiftKzt: repair,
    formula: `${base.unplannedFailures}×${kzt(cfg.economics.unplannedRepairKzt)} − (${smart.unplannedFailures}×${kzt(cfg.economics.unplannedRepairKzt)} + ${smart.preventedFailures + smart.falseAlarms}×${kzt(cfg.economics.plannedRepairKzt)})`,
  });
  // Качество руды: сравниваем ДОЛЮ потерь меди (а не тонны), чтобы не засчитать дважды простой фабрики.
  const lossRate = (k: Kpis) => (k.cuConcT > 0 ? 1 - k.recoveryPct / 100 / cfg.grade.recoveryMax : 0);
  const cuFeedSmart = smart.recoveryPct > 0 ? smart.cuConcT / (smart.recoveryPct / 100) : 0;
  const quality = (lossRate(base) - lossRate(smart)) * cuFeedSmart * cfg.grade.recoveryMax * cfg.economics.copperKztPerT * shiftScale;
  parts.push({
    label: 'Стабильное качество руды (извлечение меди)',
    perShiftKzt: quality,
    formula: `(${base.recoveryPct.toFixed(2)}% → ${smart.recoveryPct.toFixed(2)}% извлечения) × ${smart.cuConcT.toFixed(0)} т Cu × ${kzt(cfg.economics.copperKztPerT)}/т`,
  });
  const perShiftKzt = idle + crusher + fuel + repair + quality;
  return {
    perShiftKzt,
    perYearKzt: perShiftKzt * cfg.economics.shiftsPerYear,
    parts,
    extraTonnesPerShift: (smart.minedTotal - base.minedTotal) * shiftScale,
    extraSulfidePerShift: (smart.mined.sulfide - base.mined.sulfide) * shiftScale,
    shiftScale,
    shiftsPerYear: cfg.economics.shiftsPerYear,
  };
}

/** Относительное изменение, %: (b − a) / |a|. */
export function deltaPct(a: number, b: number): number {
  if (Math.abs(a) < 1e-9) return b === 0 ? 0 : 100;
  return ((b - a) / Math.abs(a)) * 100;
}
