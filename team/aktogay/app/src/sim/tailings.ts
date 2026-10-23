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
/**
 * Проектная отметка дамбы над дном чаши, м: до неё чашу нарастят к концу отработки.
 * Дамбу наращивают ярусами по мере намыва, поэтому в работе гребень идёт над пляжем
 * с постоянным превышением — отсюда и рабочий запас до гребня.
 */
export const CREST_FINAL_M = 32;
/** Превышение гребня над намытым пляжем в работе и минимально допустимый запас, м. */
export const CREST_ABOVE_BEACH_M = 6;
export const FREEBOARD_MIN_M = 2.5;
/** Зеркало пруда отстоявшейся воды, м², и уровень на начало смены, м. */
export const POND_AREA_M2 = 300_000;
export const POND_INITIAL_M = 2.4;
/** Среднегодовое испарение по ФАО в точке рудника, мм/сут (архив реанализа 2015–2024). */
export const EVAP_MM_DAY = 3.5;
/** Аварийная откачка пруда, когда запас до гребня ниже нормы, м³/ч. Оценка. */
export const EMERGENCY_PUMP_M3H = 60_000;

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
  /** Пришло со снеготаянием за смену, м³. */
  meltM3 = 0;
  /** Сценарий «ливень»: приток в пруд, м³/ч, и сколько он ещё длится, с. */
  stormM3h = 0;
  stormLeft = 0;
  /** Откачано аварийно, когда запас до гребня ушёл ниже нормы, м³ за смену. */
  emergencyM3 = 0;
  /** Чистый приход воды в пруд, м³/ч (приход минус возврат, испарение и откачка) — по нему виден тренд уровня. */
  netM3h = 0;
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
    // Летом зеркало интенсивно испаряется, весной снеготаяние поднимает пруд.
    const evap = ((EVAP_MM_DAY / 1000) * POND_AREA_M2 * dt * sim.weather.evapFactor) / 86400;
    const melt = (sim.weather.meltM3h * dt) / 3600;
    this.meltM3 += melt;
    // Ливень или снеготаяние по сценарию.
    let storm = 0;
    if (this.stormLeft > 0) {
      this.stormLeft = Math.max(0, this.stormLeft - dt);
      storm = (this.stormM3h * dt) / 3600;
      if (this.stormLeft === 0) this.stormM3h = 0;
    }
    // Если запас до гребня ушёл ниже нормы — включают аварийную откачку в пруды-накопители.
    const emergency = this.freeboardM < FREEBOARD_MIN_M ? (EMERGENCY_PUMP_M3H * dt) / 3600 : 0;
    this.emergencyM3 += emergency;
    this.pondV = Math.max(0, this.pondV + toPond + melt + storm - reclaim - evap - emergency);
    // Чего не вернулось с пруда — добирают свежей водой из водовода.
    this.makeupM3 += Math.max(0, water - reclaim);

    this.solidsTph = (tails / dt) * 3600;
    const waterTph = (water / dt) * 3600;
    this.pulpM3h = this.solidsTph / SOLIDS_SG + waterTph;
    this.reclaimM3h = (reclaim / dt) * 3600;
    this.netM3h = ((toPond + melt + storm - reclaim - evap - emergency) / dt) * 3600;
  }

  /** Заполнение чаши, %. */
  get fillPct(): number {
    return (this.storedT / (CAPACITY_MT * 1e6)) * 100;
  }

  /** Отметка намытого пляжа, м: чаша заполняется снизу вверх к проектной отметке. */
  get beachM(): number {
    return (CREST_FINAL_M * this.fillPct) / 100;
  }

  /** Отметка гребня на сегодня: дамбу наращивают над пляжем. */
  get crestM(): number {
    return Math.min(CREST_FINAL_M, this.beachM + CREST_ABOVE_BEACH_M);
  }

  get pondM(): number {
    return this.pondV / POND_AREA_M2;
  }

  /** Запас до гребня дамбы, м — главный показатель безопасности. */
  get freeboardM(): number {
    return this.crestM - this.beachM - this.pondM;
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
    // Ниже нормы — намыв останавливают; близко к норме — под наблюдением.
    if (this.freeboardM < FREEBOARD_MIN_M) return 'alarm';
    if (this.freeboardM < FREEBOARD_MIN_M + 0.7 || this.piezoPct > 72) return 'watch';
    return 'norm';
  }
}
