/**
 * Учёт электроэнергии по участкам. Главный потребитель на медном руднике — обогатительная
 * фабрика (мельницы и флотация), дальше — электролиз на SX-EW и насосные: пульпа на
 * хвостохранилище, оборотная вода, раствор на орошение карт.
 *
 * Самосвалы и экскаваторы здесь не учитываются: они дизельные, их расход считается отдельно
 * в литрах. Электрические потребители карьера — буровые станки и мачты освещения.
 *
 * Мощности — оценки по открытым данным (паспортные мощности агрегатов такого класса),
 * кроме электролиза: там мощность считается по току серии из модели SX-EW и напряжению
 * на ванне. Случайностей нет: на добычу и бенчмарк не влияет.
 */
import type { Simulation } from './engine';
import { EW_CELLS } from './leach';

/** Напряжение на одной электролизной ванне, В (типовое для EW меди). */
export const EW_CELL_VOLTS = 2.1;
/** КПД насосных агрегатов и плотность раствора/пульпы для расчёта мощности перекачки. */
const PUMP_EFF = 0.72;
const G = 9.81;

/** Напор насосных, м (оценки по расстояниям и перепадам). */
const HEAD = { pulp: 60, reclaim: 45, pls: 55 };

export interface AreaUse {
  id: string;
  name: string;
  mw: number;
  kwh: number;
}

/** Мощность перекачки, МВт: расход м³/ч, напор м. */
function pumpMw(m3h: number, headM: number): number {
  return (1000 * G * (m3h / 3600) * headM) / PUMP_EFF / 1e6;
}

export class EnergyMeter {
  /** Потребление по участкам: мгновенная мощность, МВт, и накопленная энергия, кВт·ч. */
  readonly areas: AreaUse[] = [
    { id: 'plant', name: 'Обогатительная фабрика', mw: 0, kwh: 0 },
    { id: 'crusher', name: 'Дробилка и конвейеры', mw: 0, kwh: 0 },
    { id: 'sxew', name: 'Завод SX-EW (электролиз)', mw: 0, kwh: 0 },
    { id: 'tailings', name: 'Насосные хвостов и оборотной воды', mw: 0, kwh: 0 },
    { id: 'leach', name: 'Насосные растворов выщелачивания', mw: 0, kwh: 0 },
    { id: 'pit', name: 'Карьер: буровые и освещение', mw: 0, kwh: 0 },
    { id: 'aux', name: 'Промплощадка, гараж, водовод', mw: 0, kwh: 0 },
  ];
  /** Всего за смену, кВт·ч, и наибольшая мощность, МВт. */
  totalKwh = 0;
  peakMw = 0;
  /** Сколько энергии фабрика потратила вхолостую, пока стояла без руды, кВт·ч. */
  idleKwh = 0;

  private area(id: string): AreaUse {
    return this.areas.find((a) => a.id === id)!;
  }

  update(sim: Simulation, dt: number): void {
    const cfg = sim.cfg;
    const starving = sim.stockpile.t <= 0.01;
    const cut = sim.powerCutLeft > 0;
    // Фабрика: мельницы и флотация под нагрузкой; без руды агрегаты крутятся вхолостую.
    const plant = cut ? 1.5 : starving ? 13 : 48;
    this.area('plant').mw = plant;
    if (starving && !cut) this.idleKwh += (plant * 1000 * dt) / 3600;
    // Дробилка и конвейеры: под нагрузкой и на холостом ходу.
    this.area('crusher').mw = cut ? 0.4 : (sim.stockpile.crushing ? 6.2 : 0.6) + 2.4;
    // Электролиз: мощность по закону Джоуля от тока серии, плюс насосы экстракции.
    this.area('sxew').mw = cut ? 0.3 : (sim.leach.ewKA * 1000 * EW_CELL_VOLTS * EW_CELLS) / 1e6 + 1.5;
    // Насосные: мощность по фактическому расходу и напору.
    this.area('tailings').mw = pumpMw(sim.tailings.pulpM3h, HEAD.pulp) + pumpMw(sim.tailings.reclaimM3h, HEAD.reclaim);
    this.area('leach').mw = pumpMw(sim.leach.plsM3h * 2, HEAD.pls); // продуктивный раствор и рафинат обратно
    // Карьер: электрические буровые станки и мачты освещения (в тёмное время и в непогоду).
    const drilling = sim.drill.rigs.filter((r) => r.state === 'drilling').length;
    const dark = sim.weather.visibilityM < 5000;
    this.area('pit').mw = drilling * 0.62 + (dark ? 0.9 : 0.35);
    this.area('aux').mw = 1.6;

    let total = 0;
    for (const a of this.areas) {
      a.kwh += (a.mw * 1000 * dt) / 3600;
      total += a.mw;
    }
    this.totalKwh += (total * 1000 * dt) / 3600;
    this.peakMw = Math.max(this.peakMw, total);
    void cfg;
  }

  get totalMw(): number {
    return this.areas.reduce((s, a) => s + a.mw, 0);
  }

  /** Удельный расход на тонну руды, переработанной фабрикой, кВт·ч/т. */
  perTonneOre(sim: Simulation): number {
    return sim.stats.plantFeedT > 0 ? this.totalKwh / sim.stats.plantFeedT : 0;
  }

  /** Удельный расход на тонну меди (в концентрате и катодах), кВт·ч/т. */
  perTonneCu(sim: Simulation): number {
    const cu = sim.stats.cuConcT + sim.leach.cathodeT;
    return cu > 0 ? this.totalKwh / cu : 0;
  }

  costKzt(sim: Simulation): number {
    return this.totalKwh * sim.cfg.economics.energyKztPerKwh;
  }
}
