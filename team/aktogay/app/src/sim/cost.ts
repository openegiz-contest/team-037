/**
 * Себестоимость тонны меди. Отраслевой стандарт — C1 cash cost: прямые денежные затраты на
 * добычу, переработку, содержание площадки и доставку до покупателя, делённые на оплачиваемую
 * медь. Амортизация, проценты и налоги в него не входят, поэтому C1 можно сравнивать между
 * рудниками с разной историей вложений.
 *
 * Часть статей модель считает сама (топливо по рейсам, электроэнергия по участкам, ремонты,
 * простои, кислота), часть взята оценкой (зарплата, реагенты, шары мельниц, взрывчатка,
 * общезаводские, ж/д и плата за плавку). У каждой строки стоит признак `modelled` — на экране
 * видно, что посчитано, а что принято.
 *
 * Медь идёт двумя потоками и стоит по-разному: катоды SX-EW — готовый металл, а за медь в
 * концентрате плавильный завод берёт плату за переработку, и оплачивается не весь металл.
 */
import type { Simulation } from './engine';
import { CONC_GRADE } from './concentrate';
import { computeKpis, type Kpis } from './kpi';

export type CostGroup = 'mining' | 'processing' | 'oxide' | 'logistics' | 'overhead';

export const GROUP_RU: Record<CostGroup, string> = {
  mining: 'Добыча',
  processing: 'Переработка (сульфид)',
  oxide: 'Оксидная линия',
  logistics: 'Логистика и плавка',
  overhead: 'Содержание площадки',
};

export interface CostLine {
  id: string;
  name: string;
  group: CostGroup;
  kzt: number;
  /** Посчитано моделью (true) или принято оценкой (false). */
  modelled: boolean;
  /** Из чего получилось — показывается подсказкой. */
  basis: string;
}

export interface CostReport {
  lines: CostLine[];
  totalKzt: number;
  modelledKzt: number;
  estimatedKzt: number;
  /** Оплачиваемая медь за смену, т: катоды плюс оплачиваемая доля меди в концентрате. */
  payableCuT: number;
  cathodeT: number;
  concCuT: number;
  kztPerTCu: number;
  usdPerLb: number;
}

const LB_PER_T = 2204.62;

/**
 * Разложить затраты смены по статьям и получить себестоимость тонны меди.
 * KPI можно передать готовыми: в интерфейсе они приходят из Ditto, а не считаются заново.
 */
export function costBreakdown(sim: Simulation, kpis?: Kpis): CostReport {
  const e = sim.cfg.economics;
  const k = kpis ?? computeKpis(sim);
  const moved = sim.stats.mined.sulfide + sim.stats.mined.oxide + sim.stats.mined.waste;
  const ore = sim.stats.plantFeedT;
  const concT = sim.stats.cuConcT / CONC_GRADE;
  const kwh = (ids: string[]) => sim.energy.areas.filter((a) => ids.includes(a.id)).reduce((s, a) => s + a.kwh, 0);
  const power = (ids: string[]) => kwh(ids) * e.energyKztPerKwh;
  const fmt = (n: number, unit: string) => `${Math.round(n).toLocaleString('ru-RU')} ${unit}`;
  // Постоянные расходы смены начисляем пропорционально отработанной части, иначе в начале
  // смены они делятся на ещё не выпущенную медь и себестоимость выглядит дико.
  const part = Math.min(1, sim.now / sim.cfg.shift.durationSec);

  const lines: CostLine[] = [
    // ── добыча ──
    { id: 'fuel', name: 'Дизельное топливо', group: 'mining', kzt: k.fuelCostKzt, modelled: true, basis: `${fmt(k.fuelL, 'л')} по рейсам × ${e.dieselKztPerL} ₸/л` },
    { id: 'repairs', name: 'Ремонты самосвалов', group: 'mining', kzt: k.repairCostKzt, modelled: true, basis: `${k.unplannedFailures} аварийных и ${sim.stats.preventedFailures + sim.stats.falseAlarms} плановых` },
    { id: 'idle', name: 'Простои техники', group: 'mining', kzt: k.idleCostKzt, modelled: true, basis: 'часы простоя самосвалов и экскаваторов × ставка' },
    { id: 'pit_power', name: 'Электроэнергия карьера', group: 'mining', kzt: power(['pit']), modelled: true, basis: `${fmt(kwh(['pit']), 'кВт·ч')}: буровые и освещение` },
    { id: 'blasting', name: 'Взрывчатка и буровой инструмент', group: 'mining', kzt: moved * e.blastingKztPerTMoved, modelled: false, basis: `${fmt(moved, 'т')} горной массы × ${e.blastingKztPerTMoved} ₸/т (оценка)` },
    { id: 'aux', name: 'Содержание дорог и вспомогательная техника', group: 'mining', kzt: moved * e.auxKztPerTMoved, modelled: false, basis: `${fmt(moved, 'т')} × ${e.auxKztPerTMoved} ₸/т (оценка)` },
    // ── переработка сульфидной руды ──
    { id: 'plant_power', name: 'Электроэнергия фабрики и дробилки', group: 'processing', kzt: power(['plant', 'crusher', 'tailings']), modelled: true, basis: `${fmt(kwh(['plant', 'crusher', 'tailings']), 'кВт·ч')} по счётчикам участков` },
    { id: 'reagents', name: 'Реагенты флотации', group: 'processing', kzt: ore * e.reagentsKztPerTOre, modelled: false, basis: `${fmt(ore, 'т')} руды × ${e.reagentsKztPerTOre} ₸/т (оценка)` },
    { id: 'grinding', name: 'Шары и футеровка мельниц', group: 'processing', kzt: ore * e.grindingKztPerTOre, modelled: false, basis: `${fmt(ore, 'т')} руды × ${e.grindingKztPerTOre} ₸/т (оценка)` },
    // ── оксидная линия ──
    { id: 'acid', name: 'Серная кислота', group: 'oxide', kzt: sim.leach.acidT * e.acidKztPerT, modelled: true, basis: `${fmt(sim.leach.acidT, 'т')} по орошению и электролизу × ${fmt(e.acidKztPerT, '₸/т')}` },
    { id: 'oxide_power', name: 'Электроэнергия SX-EW и насосных', group: 'oxide', kzt: power(['sxew', 'leach']), modelled: true, basis: `${fmt(kwh(['sxew', 'leach']), 'кВт·ч')}: электролиз по току серии` },
    // ── логистика и плавка ──
    { id: 'rail', name: 'Ж/д доставка концентрата', group: 'logistics', kzt: concT * e.railKztPerTConc, modelled: false, basis: `${fmt(concT, 'т')} концентрата × ${fmt(e.railKztPerTConc, '₸/т')} (оценка)` },
    { id: 'smelter', name: 'Плата за плавку и рафинирование', group: 'logistics', kzt: sim.stats.cuConcT * e.smelterKztPerTCu, modelled: false, basis: `${sim.stats.cuConcT.toFixed(1)} т меди в концентрате × ${fmt(e.smelterKztPerTCu, '₸/т')} (оценка)` },
    // ── содержание площадки ──
    { id: 'payroll', name: 'Персонал смены', group: 'overhead', kzt: e.payrollKztPerShift * part, modelled: false, basis: 'оценка на моделируемый сегмент за смену, начисляется по ходу смены' },
    { id: 'site', name: 'Общезаводские расходы', group: 'overhead', kzt: e.siteKztPerShift * part, modelled: false, basis: 'оценка: управление, связь, охрана, лаборатория; начисляется по ходу смены' },
    { id: 'site_power', name: 'Электроэнергия промплощадки', group: 'overhead', kzt: power(['aux']), modelled: true, basis: `${fmt(kwh(['aux']), 'кВт·ч')}: гараж, водовод, АБК` },
  ];

  const totalKzt = lines.reduce((s, l) => s + l.kzt, 0);
  const modelledKzt = lines.filter((l) => l.modelled).reduce((s, l) => s + l.kzt, 0);
  const concCuT = (sim.stats.cuConcT * e.payableCuPct) / 100;
  const cathodeT = sim.leach.cathodeT;
  const payableCuT = concCuT + cathodeT;
  const kztPerTCu = payableCuT > 0 ? totalKzt / payableCuT : 0;
  return {
    lines,
    totalKzt,
    modelledKzt,
    estimatedKzt: totalKzt - modelledKzt,
    payableCuT,
    cathodeT,
    concCuT,
    kztPerTCu,
    usdPerLb: kztPerTCu / e.kztPerUsd / LB_PER_T,
  };
}
