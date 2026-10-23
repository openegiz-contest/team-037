/**
 * Последние объекты площадки: резервуары технической воды, АБК с диспетчерской, химическая
 * лаборатория и склад взрывчатых материалов. Все они читают состояние остальной модели:
 *
 * - резервуары отдают фабрике добавочную воду (то, что не вернулось с хвостохранилища) и воду посёлку,
 *   а насосы водовода подкачивают их по уровню;
 * - диспетчерская видит тревоги по всему руднику — поломки, закрытые участки, взрывы, отключения;
 * - лаборатория анализирует шлам взрывных скважин и пробы фабрики по графику;
 * - склад ВМ отпускает взрывчатку на каждый взрыв по числу заряженных скважин.
 *
 * Ёмкости, нормы и численность — оценки по открытым данным. Случайностей нет, на добычу и бенчмарк
 * модуль не влияет.
 */
import type { Simulation } from './engine';
import { SHIFT_START_HOUR } from './weather';

/** Резервуары технической воды: полезный объём, начальный запас, подача насосов водовода, м³ и м³/ч. */
export const WATER_CAP_M3 = 50_000;
export const WATER_INITIAL_M3 = 36_000;
export const FRESH_PUMP_M3H = 1_200;
const PUMP_ON = 0.8;
const PUMP_OFF = 0.95;

export class WaterTanks {
  stockM3 = WATER_INITIAL_M3;
  /** Подача насосов водовода и отбор, м³/ч; насосы работают. */
  inM3h = 0;
  outM3h = 0;
  pumping = false;
  /** Подано на фабрику и в посёлок за смену, м³. */
  toPlantM3 = 0;
  toCampM3 = 0;
  private lastMakeup = 0;

  update(sim: Simulation, dt: number): void {
    const makeup = Math.max(0, sim.tailings.makeupM3 - this.lastMakeup);
    this.lastMakeup = sim.tailings.makeupM3;
    const camp = (sim.camp.waterM3h * dt) / 3600;
    this.toPlantM3 += makeup;
    this.toCampM3 += camp;
    const level = this.stockM3 / WATER_CAP_M3;
    if (level < PUMP_ON) this.pumping = true;
    if (level > PUMP_OFF) this.pumping = false;
    // Насосы водовода электрические: без энергии стоят.
    const pump = this.pumping && sim.powerCutLeft <= 0 ? (FRESH_PUMP_M3H * dt) / 3600 : 0;
    this.stockM3 = Math.min(WATER_CAP_M3, Math.max(0, this.stockM3 + pump - makeup - camp));
    this.inM3h = (pump / dt) * 3600;
    this.outM3h = this.outM3h * 0.95 + 0.05 * (((makeup + camp) / dt) * 3600);
  }

  get fillPct(): number {
    return (this.stockM3 / WATER_CAP_M3) * 100;
  }
}

/** Диспетчеров в смене и сотрудников АБК днём и ночью. */
export const DISPATCHERS = 4;
const STAFF_DAY = 140;
const STAFF_NIGHT = 22;

export class ControlRoom {
  /** Людей в АБК сейчас. */
  staff = 0;
  /** Открытых тревог на пульте и тревожных событий за последний час. */
  alarms = 0;
  alarmsHour = 0;
  /** Событий в журнале за последний час. */
  eventsHour = 0;
  /** Машин на линии (самосвалы в работе). */
  trucksOnLine = 0;

  update(sim: Simulation): void {
    const hour = (SHIFT_START_HOUR + sim.now / 3600) % 24;
    this.staff = hour >= 8 && hour < 17 ? STAFF_DAY : STAFF_NIGHT;
    this.alarms =
      sim.excavators.filter((e) => e.state === 'broken').length +
      sim.trucks.filter((t) => t.state === 'broken').length +
      sim.drill.rigs.filter((g) => g.state === 'broken').length +
      sim.closures.length +
      sim.blasts.filter((b) => b.phase === 'warning' || b.phase === 'active').length +
      (sim.powerCutLeft > 0 ? 1 : 0) +
      (sim.checkpoint.closedLeft > 0 ? 1 : 0) +
      (sim.fuelDepot.stockM3 <= 0 ? 1 : 0);
    const since = sim.now - 3600;
    const recent = sim.log.filter((e) => e.t >= since);
    this.eventsHour = recent.length;
    this.alarmsHour = recent.filter((e) => e.level === 'alarm').length;
    this.trucksOnLine = sim.trucks.filter((t) => t.state !== 'broken' && t.state !== 'service' && t.state !== 'idle').length;
  }
}

/** Лаборатория: длительность анализа, мин, и пробы фабрики каждые 2 ч (питание, концентрат, хвосты). */
const ANALYSIS_MIN = 25;
const PLANT_SAMPLE_EVERY_SEC = 2 * 3600;
const PLANT_SAMPLES = 3;

export class Laboratory {
  /** Проб шлама скважин и проб фабрики за смену. */
  holeSamples = 0;
  plantSamples = 0;
  /** Проб в работе (поступили за последние ANALYSIS_MIN минут). */
  inWork = 0;
  /** Последние результаты: медь в питании и в концентрате, %. */
  lastFeedCu = 0;
  lastConcCu = 0;
  private holeHistory: { t: number; n: number }[] = [];
  private startHoles = -1;

  update(sim: Simulation): void {
    const holes = sim.drill.blocks.reduce((s, b) => s + b.holesDone, 0);
    if (this.startHoles < 0) this.startHoles = holes;
    const nowHoles = Math.max(0, holes - this.startHoles);
    if (nowHoles !== this.holeSamples) this.holeHistory.push({ t: sim.now, n: nowHoles - this.holeSamples });
    this.holeSamples = nowHoles;
    const plantBatches = Math.floor(sim.now / PLANT_SAMPLE_EVERY_SEC) + 1;
    const newPlant = plantBatches * PLANT_SAMPLES;
    if (newPlant !== this.plantSamples) {
      this.holeHistory.push({ t: sim.now, n: newPlant - this.plantSamples });
      this.plantSamples = newPlant;
      this.lastFeedCu = sim.feedGrade;
      this.lastConcCu = 25;
    }
    const since = sim.now - ANALYSIS_MIN * 60;
    this.holeHistory = this.holeHistory.filter((h) => h.t >= since);
    this.inWork = this.holeHistory.reduce((s, h) => s + h.n, 0);
  }

  get total(): number {
    return this.holeSamples + this.plantSamples;
  }
}

/** Склад ВМ: запас взрывчатки на начало смены, т, и заряд на одну скважину, т (оценка). */
export const EXPLOSIVES_INITIAL_T = 180;
export const CHARGE_PER_HOLE_T = 0.35;

export class ExplosivesMagazine {
  stockT = EXPLOSIVES_INITIAL_T;
  /** Отпущено на взрывы за смену, т, и число взрывов. */
  issuedT = 0;
  blasts = 0;
  private done = new Set<number>();

  update(sim: Simulation): void {
    for (const b of sim.blasts) {
      if (b.phase !== 'active' || this.done.has(b.id)) continue;
      this.done.add(b.id);
      const block = sim.drill.blocks[b.target];
      const holes = block ? Math.max(block.holesDone, 1) : 30;
      const t = Math.min(this.stockT, holes * CHARGE_PER_HOLE_T);
      this.stockT -= t;
      this.issuedT += t;
      this.blasts++;
    }
  }

  /** На сколько взрывов хватит запаса (блок — 30 скважин). */
  get blastsLeft(): number {
    return Math.floor(this.stockT / (30 * CHARGE_PER_HOLE_T));
  }
}
