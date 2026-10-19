/**
 * Отгрузка концентрата: склад концентрата у фабрики и ж/д погрузка.
 *
 * Фабрика выпускает медный концентрат (~25 % меди — открытые источники); он копится на складе,
 * грузится в вагоны по одному, и полный состав уходит на станцию. Состав масштабирован под
 * моделируемый сегмент парка (на реальном комбинате — десятки вагонов). Случайностей нет —
 * на остальную модель не влияет.
 */
import type { Simulation } from './engine';

/** Доля меди в концентрате. */
export const CONC_GRADE = 0.25;
/** Грузоподъёмность вагона, т (оценка: вагон-хоппер). */
export const WAGON_T = 69;
/** Вагонов в составе (масштаб сегмента). */
export const TRAIN_WAGONS = 6;
/** Погрузка одного вагона, с. */
export const WAGON_LOAD_SEC = 20 * 60;
/** Запас на складе к началу смены, т. */
export const CONC_INITIAL_T = 260;

export class ConcentrateYard {
  /** На складе, т. */
  stockT = CONC_INITIAL_T;
  /** Выпущено фабрикой за смену, т. */
  producedT = 0;
  /** Вагонов загружено в текущий состав и идёт ли погрузка очередного (остаток, с). */
  wagons = 0;
  loadLeft = 0;
  /** Отправлено составов, т концентрата и меди в нём за смену. */
  trains = 0;
  shippedT = 0;
  cuShippedT = 0;
  /** Время отправки последнего состава, с модели (−1 — ещё не было). */
  lastTrainAt = -1;
  private lastCu = 0;

  update(sim: Simulation, dt: number): void {
    const cu = sim.stats.cuConcT;
    const made = Math.max(0, cu - this.lastCu) / CONC_GRADE;
    this.lastCu = cu;
    this.producedT += made;
    this.stockT += made;
    if (this.loadLeft > 0) {
      this.loadLeft -= dt;
      if (this.loadLeft <= 0) {
        this.loadLeft = 0;
        this.wagons++;
        if (this.wagons >= TRAIN_WAGONS) this.dispatch(sim);
      }
    } else if (this.stockT >= WAGON_T) {
      this.stockT -= WAGON_T;
      this.loadLeft = WAGON_LOAD_SEC;
    }
  }

  private dispatch(sim: Simulation): void {
    const t = this.wagons * WAGON_T;
    this.trains++;
    this.shippedT += t;
    this.cuShippedT += t * CONC_GRADE;
    this.wagons = 0;
    this.lastTrainAt = sim.now;
    sim.addLog(`Отправлен состав: ${TRAIN_WAGONS} вагонов, ${Math.round(t)} т концентрата (~${Math.round(t * CONC_GRADE)} т меди)`, 'info');
  }

  /** Сколько вагонов уже стоит в составе с учётом текущего (доля погрузки 0…1). */
  get loadingProgress(): number {
    return this.loadLeft > 0 ? 1 - this.loadLeft / WAGON_LOAD_SEC : 0;
  }
}
