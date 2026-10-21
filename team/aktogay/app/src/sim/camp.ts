/**
 * Вахтовый посёлок: общежития, столовая, котельная, водовод и резервная дизельная станция.
 *
 * Работники живут в посёлке и ездят на смену вахтовыми автобусами: пока одна половина на карьере и
 * фабриках, другая отдыхает в посёлке. Отсюда суточный ритм — пересменка в начале и середине суток
 * (автобусы в пути), пики в столовой, расход воды утром и вечером. Электричество идёт от подстанции
 * ОФ-2; при отключении энергии посёлок переходит на дизель-генератор, пока хватает топлива.
 *
 * Численность, нормы воды и мощности — оценки по открытым нормам для вахтовых посёлков, не данные
 * комбината. Случайностей нет, на добычу и бенчмарк модуль не влияет.
 */
import type { Simulation } from './engine';
import { SHIFT_START_HOUR } from './weather';

/** Проживает на вахте, чел. (оценка: персонал комбината, разбитый на две смены). */
export const CAMP_RESIDENTS = 2400;
/** Коек в посёлке и число общежитий. */
export const CAMP_BEDS = 2700;
export const CAMP_DORMS = 6;
/** Часы пересменки (смены по 12 ч) и ширина окна, когда автобусы в пути, ч. */
export const CHANGEOVER_HOURS = [SHIFT_START_HOUR, SHIFT_START_HOUR + 12];
const TRAVEL_WINDOW_H = 0.75;
/** Центры приёмов пищи: завтрак первой смены, обед и ужин, ночная выдача, ч. */
const MEAL_HOURS = [6.75, 14.75, 18.75, 2.5];
/** Расход воды на человека в посёлке, м³/ч (≈160 л в сутки), и на одну порцию, м³. */
const WATER_PER_PERSON_M3H = 0.16 / 24;
const WATER_PER_MEAL_M3 = 0.003;
/** Резервная электростанция: мощность, кВт·ч/ч топлива на МВт и бак. */
export const GEN_MW = 3.0;
export const FUEL_TANK_L = 9000;
const FUEL_L_PER_MWH = 270;
const FUEL_REFILL_L_H = 600;
/** Тепловая нагрузка на градус ниже +18 °C, МВт (посёлок ~70 тыс. м²). */
const HEAT_MW_PER_K = 0.055;

const gauss = (x: number, c: number, w: number): number => {
  const d = Math.min(Math.abs(x - c), 24 - Math.abs(x - c));
  return Math.exp(-((d / w) ** 2));
};

/** Люди и загрузка столовой на заданный час суток — суточный ритм посёлка (для графика и для модели). */
export function campAt(hour: number): { inCamp: number; inTransit: number; onShift: number; mealLoad: number } {
  const toChange = Math.min(...CHANGEOVER_HOURS.map((c) => Math.min(Math.abs(hour - c), 24 - Math.abs(hour - c))));
  const travel = Math.max(0, 1 - toChange / TRAVEL_WINDOW_H);
  const half = CAMP_RESIDENTS / 2;
  const inTransit = Math.round(half * travel);
  const inCamp = Math.round(half * (1 - 0.5 * travel) + 0.06 * CAMP_RESIDENTS);
  return { inCamp, inTransit, onShift: Math.max(0, CAMP_RESIDENTS - inCamp - inTransit), mealLoad: Math.max(...MEAL_HOURS.map((c) => gauss(hour, c, 0.7))) };
}

export class Camp {
  /** В посёлке, в пути на автобусах и на смене, чел. */
  inCamp = 0;
  inTransit = 0;
  onShift = 0;
  /** Загрузка столовой (0…1), порций выдано с начала смены. */
  mealLoad = 0;
  mealsServed = 0;
  /** Расход воды сейчас, м³/ч, и с начала смены, м³. */
  waterM3h = 0;
  waterTotalM3 = 0;
  /** Тепловая нагрузка котельной, МВт. */
  heatMw = 0;
  /** Электрическая нагрузка посёлка, МВт (от генератора или сети), и сколько из неё берётся из сети рудника. */
  loadMw = 0;
  gridMw = 0;
  /** Генератор запущен, топливо в баке, л. */
  genOn = false;
  fuelL = FUEL_TANK_L;
  /** Свет в посёлке есть (сеть или генератор). */
  powered = true;
  /** Автобусов в пути сейчас (по 45 мест). */
  buses = 0;

  update(sim: Simulation, dt: number): void {
    const hour = (SHIFT_START_HOUR + sim.now / 3600) % 24;
    const w = sim.weather;
    const at = campAt(hour);
    this.inTransit = at.inTransit;
    this.inCamp = at.inCamp;
    this.onShift = at.onShift;
    this.buses = Math.ceil(this.inTransit / 45);

    this.mealLoad = at.mealLoad;
    const mealsPerSec = (this.mealLoad * this.inCamp) / 1.24 / 3600;
    this.mealsServed += mealsPerSec * dt;

    const showerK = Math.max(gauss(hour, 6.5, 1.2), gauss(hour, 20.5, 1.5));
    this.waterM3h = this.inCamp * WATER_PER_PERSON_M3H * (0.6 + 0.8 * showerK) + mealsPerSec * 3600 * WATER_PER_MEAL_M3;
    this.waterTotalM3 += (this.waterM3h * dt) / 3600;

    this.heatMw = Math.max(0, 18 - w.tempC) * HEAT_MW_PER_K;
    const dark = sim.weather.visibilityM < 5000 || hour < 7 || hour > 18;
    this.loadMw = 0.7 + this.inCamp * 0.0004 + 0.4 * this.mealLoad + (dark ? 0.3 : 0.1) + 0.05 * this.heatMw + 0.25 * this.heatMw;

    // Генератор: при потере сети запускается, пока есть топливо; без топлива в посёлке темно.
    const cut = sim.powerCutLeft > 0;
    const wasOn = this.genOn;
    this.genOn = cut && this.fuelL > 0;
    if (this.genOn) {
      const loadMw = Math.min(GEN_MW, this.loadMw);
      this.fuelL = Math.max(0, this.fuelL - loadMw * FUEL_L_PER_MWH * (dt / 3600));
    } else if (!cut) {
      this.fuelL = Math.min(FUEL_TANK_L, this.fuelL + FUEL_REFILL_L_H * (dt / 3600));
    }
    if (this.genOn && !wasOn) sim.addLog('Посёлок: сеть потеряна, запущен дизель-генератор', 'warn');
    else if (wasOn && !this.genOn) sim.addLog(cut ? 'Посёлок: топливо в баке кончилось — без света' : 'Посёлок: питание от сети восстановлено', cut ? 'alarm' : 'info');
    this.powered = !cut || this.genOn;
    this.gridMw = cut ? 0 : this.loadMw;
  }

  /** Заполнение общежитий, %. */
  get occupancyPct(): number {
    return (this.inCamp / CAMP_BEDS) * 100;
  }

  /** Часов работы генератора на остатке топлива при текущей нагрузке. */
  get fuelHours(): number {
    const mw = Math.min(GEN_MW, this.loadMw) || 1;
    return this.fuelL / (mw * FUEL_L_PER_MWH);
  }
}
