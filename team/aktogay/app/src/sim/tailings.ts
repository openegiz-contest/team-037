/**
 * Хвостохранилище: пульпа с фабрики, намыв хвостов, пруд оборотной воды и контроль дамбы.
 *
 * После флотации в концентрат уходит малая часть руды, всё остальное — хвосты. Их качают
 * пульпопроводом в чашу за дамбой: твёрдое оседает и намывает пляж, осветлённая вода собирается
 * в пруду и насосами возвращается на фабрику. Чем выше пруд, тем сильнее насыщена дамба — поэтому
 * за ней следят пьезометрами, замеряют фильтрацию и запас до гребня.
 *
 * Масштаб — моделируемый сегмент парка; ёмкость и отметки — оценки по контуру чаши со снимка.
 * Случайностей нет: на добычу и бенчмарк не влияет.
 */
import type { Simulation } from './engine';
import { CONC_GRADE } from './concentrate';

/** Доля твёрдого в пульпе на сливе фабрики, %. */
export const SOLIDS_PCT = 35;
/** Плотность минерала и уложенных хвостов, т/м³. */
export const SOLIDS_SG = 2.7;
export const TAILS_DENSITY = 1.45;
/** Доля воды, возвращаемой с пруда на фабрику, %. */
export const RECYCLE_PCT = 80;
/** Вода, остающаяся в уложенных хвостах, м³ на тонну. */
export const ENTRAINED_M3_PER_T = 0.22;
/** Проектная ёмкость чаши и заполнение на начало смены, млн т (оценки по площади контура). */
export const CAPACITY_MT = 420;
export const INITIAL_MT = 168;
/** Отметка гребня дамбы над дном чаши и минимально допустимый запас до гребня, м. */
export const CREST_M = 32;
export const FREEBOARD_MIN_M = 2.5;
/** Зеркало пруда оборотной воды, м², и уровень на начало смены, м. */
export const POND_AREA_M2 = 900_000;
export const POND_INITIAL_M = 2.6;
/** Испарение с зеркала пруда, мм/сут (степной климат, среднегодовое — оценка). */
export const EVAP_MM_DAY = 4;

export type DamStatus = 'norm' | 'watch' | 'alarm';

export class TailingsDam {
  /** Накоплено хвостов в чаше, т. */
  storedT = INITIAL_MT * 1e6;
  /** Объём пруда оборотной воды, м³. */
  pondV = POND_INITIAL_M * POND_AREA_M2;
  /** За смену: уложено хвостов, воды пришло с пульпой, вернулось на фабрику, забрано свежей. */
  tailsT = 0;
  waterInM3 = 0;
  reclaimM3 = 0;
  makeupM3 = 0;
  /** Текущие расходы: пульпа, м³/ч; твёрдое, т/ч; оборотная вода, м³/ч. */
  pulpM3h = 0;
  solidsTph = 0;
  reclaimM3h = 0;
  private lastFeed = 0;
  private lastConc = 0;

  update(sim: Simulation, dt: number): void {
    const st = sim.stats;
    // Хвосты — всё, что не ушло в концентрат.
    const fed = Math.max(0, st.plantFeedT - this.lastFeed);
    const conc = Math.max(0, (st.cuConcT - this.lastConc) / CONC_GRADE);
    this.lastFeed = st.plantFeedT;
    this.lastConc = st.cuConcT;
    const tails = Math.max(0, fed - conc);

    this.tailsT += tails;
    this.storedT += tails;
    // Вода пульпы: при 35 % твёрдого на тонну хвостов приходится ~1,9 м³ воды.
    const water = (tails * (100 - SOLIDS_PCT)) / SOLIDS_PCT;
    this.waterInM3 += water;
    // Часть воды остаётся в уложенных хвостах, остальное осветляется в пруду.
    const entrained = tails * ENTRAINED_M3_PER_T;
    const toPond = Math.max(0, water - entrained);
    const reclaim = (toPond * RECYCLE_PCT) / 100;
    this.reclaimM3 += reclaim;
    const evap = ((EVAP_MM_DAY / 1000) * POND_AREA_M2 * dt) / 86400;
    this.pondV = Math.max(0, this.pondV + toPond - reclaim - evap);
    // Чего не вернулось с пруда — добирают свежей водой из водовода.
    this.makeupM3 += Math.max(0, water - reclaim);

    this.solidsTph = (tails / dt) * 3600;
    const waterTph = (water / dt) * 3600;
    this.pulpM3h = this.solidsTph / SOLIDS_SG + waterTph;
    this.reclaimM3h = (reclaim / dt) * 3600;
  }

  /** Заполнение чаши, %. */
  get fillPct(): number {
    return (this.storedT / (CAPACITY_MT * 1e6)) * 100;
  }

  /** Отметка намытого пляжа и уровень пруда над ним, м. */
  get beachM(): number {
    return (CREST_M * this.fillPct) / 100;
  }

  get pondM(): number {
    return this.pondV / POND_AREA_M2;
  }

  /** Запас до гребня дамбы, м — главный показатель безопасности. */
  get freeboardM(): number {
    return CREST_M - this.beachM - this.pondM;
  }

  /**
   * Контроль дамбы: насыщение тела дамбы растёт с уровнем пруда, вместе с ним — фильтрация
   * в дренаж. Доли — оценки, модель упрощённая (фильтрационный расчёт не ведётся).
   */
  get seepageLpm(): number {
    return 40 + this.pondM * 52;
  }

  get piezoPct(): number {
    return Math.min(100, 38 + this.pondM * 9);
  }

  get status(): DamStatus {
    if (this.freeboardM < FREEBOARD_MIN_M) return 'alarm';
    if (this.freeboardM < FREEBOARD_MIN_M * 2 || this.piezoPct > 70) return 'watch';
    return 'norm';
  }
}
