/**
 * Склад ГСМ и ремонтно-механический цех (РМЦ).
 *
 * Склад ГСМ — дизельное топливо для всего парка комбината: резервуары, раздача на АЗС гаража и
 * на резервную станцию посёлка, приём автоцистерн через КПП. Моделируемый сегмент (20 самосвалов) —
 * лишь часть парка, поэтому расход склада — расход сегмента, умноженный на оценку доли остального парка.
 * Автоцистерны приезжают, когда запас падает ниже порога; в непогоду и при ручном взвешивании на КПП
 * они приходят реже.
 *
 * РМЦ — ремонт и обслуживание самосвалов: заявки идут от гаража (плановый ремонт по прогнозу отказов и
 * поломки), расходуются комплекты запчастей и шины, механики заняты по числу заявок. Объёмы и запасы —
 * оценки. Случайностей нет, на добычу и бенчмарк модуль не влияет.
 */
import type { Simulation } from './engine';
import type { TruckState } from './types';

/** Резервуары склада ГСМ: число, объём каждого и запас на начало смены, м³. */
export const FUEL_TANKS = 3;
export const FUEL_TANK_M3 = 1000;
export const FUEL_INITIAL_M3 = 2150;
/** Во сколько раз расход всего парка больше расхода моделируемого сегмента (оценка). */
export const FLEET_SCALE = 5;
/** Автоцистерна, м³, и пороги: когда начинать завоз и когда остановить, доли ёмкости. */
export const TANKER_M3 = 30;
const REORDER_AT = 0.55;
const STOP_AT = 0.85;
/** Интервал между автоцистернами в хорошую погоду, с. */
const TANKER_EVERY_SEC = 14 * 60;

export class FuelDepot {
  stockM3 = FUEL_INITIAL_M3;
  /** Отпущено за смену и принято автоцистернами, м³; рейсов цистерн за смену. */
  dispensedM3 = 0;
  receivedM3 = 0;
  tankers = 0;
  /** Идёт ли завоз и сколько осталось до следующей цистерны, с. */
  refilling = false;
  private nextTanker = TANKER_EVERY_SEC;
  private lastTruckL = 0;
  private lastCampL = Infinity;
  /** Расход сейчас, м³/ч (сглаженный). */
  flowM3h = 0;

  update(sim: Simulation, dt: number): void {
    // Отпуск: всё, что сожгли самосвалы сегмента (в масштабе парка) + заправка бака генератора посёлка.
    const used = Math.max(0, sim.stats.fuelL - this.lastTruckL);
    this.lastTruckL = sim.stats.fuelL;
    const campGain = this.lastCampL === Infinity ? 0 : Math.max(0, sim.camp.fuelL - this.lastCampL);
    this.lastCampL = sim.camp.fuelL;
    const outM3 = ((used * FLEET_SCALE) + campGain) / 1000;
    this.stockM3 = Math.max(0, this.stockM3 - outM3);
    this.dispensedM3 += outM3;
    this.flowM3h = this.flowM3h * 0.98 + 0.02 * ((outM3 / dt) * 3600);

    const cap = FUEL_TANKS * FUEL_TANK_M3;
    if (this.stockM3 < REORDER_AT * cap) this.refilling = true;
    if (this.stockM3 >= STOP_AT * cap) this.refilling = false;
    if (this.refilling) {
      // В непогоду цистерны идут медленнее, у КПП в ручном режиме стоят в очереди.
      const slow = Math.max(0.3, sim.weather.speedFactor) / (1 + sim.checkpoint.waitMin / 12);
      this.nextTanker -= dt * slow;
      if (this.nextTanker <= 0) {
        this.nextTanker += TANKER_EVERY_SEC;
        const room = cap - this.stockM3;
        const m3 = Math.min(TANKER_M3, room);
        this.stockM3 += m3;
        this.receivedM3 += m3;
        this.tankers++;
      }
    }
  }

  /** На сколько часов хватит запаса при текущем расходе. */
  get hoursLeft(): number {
    return this.flowM3h > 0.01 ? this.stockM3 / this.flowM3h : 99;
  }
}

/** Механиков в смене и обслуживающих боксов РМЦ. */
export const MECHANICS = 24;
export const SHOP_BAYS = 4;
/** Комплектов запчастей и крупногабаритных шин на складе РМЦ на начало смены. */
export const PARTS_INITIAL = 40;
export const TYRES_INITIAL = 12;

export class RepairShop {
  /** Самосвалов на плановом ремонте и на ремонте после поломки сейчас. */
  inService = 0;
  broken = 0;
  /** Закрыто заявок за смену: плановых и аварийных. */
  plannedDone = 0;
  breakdownDone = 0;
  /** Запас на складе запчастей: комплектов и шин. */
  parts = PARTS_INITIAL;
  tyres = TYRES_INITIAL;
  /** Занято механиков и боксов. */
  mechanicsBusy = 0;
  baysBusy = 0;
  private prev = new Map<number, TruckState>();
  private consumed = 0;

  update(sim: Simulation): void {
    this.inService = 0;
    this.broken = 0;
    for (const t of sim.trucks) {
      if (t.state === 'service') this.inService++;
      if (t.state === 'broken') this.broken++;
      const was = this.prev.get(t.id);
      if (was === 'service' && t.state !== 'service') this.finish(true);
      else if (was === 'broken' && t.state !== 'broken') this.finish(false);
      this.prev.set(t.id, t.state);
    }
    this.baysBusy = Math.min(SHOP_BAYS, this.inService + (this.broken > 0 ? 1 : 0));
    // Плановое обслуживание — бригада из шести, ремонт после поломки — из четырёх, плюс дежурные.
    this.mechanicsBusy = Math.min(MECHANICS, 6 + this.inService * 6 + this.broken * 4);
  }

  private finish(planned: boolean): void {
    if (planned) this.plannedDone++;
    else this.breakdownDone++;
    this.parts = Math.max(0, this.parts - 1);
    this.consumed++;
    if (this.consumed % 3 === 0) this.tyres = Math.max(0, this.tyres - 1); // шина — каждый третий заказ
  }

  /** Открытых заявок сейчас. */
  get open(): number {
    return this.inService + this.broken;
  }
}
