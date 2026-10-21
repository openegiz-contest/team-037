/**
 * Вторая цепочка комбината: ККД-2 → склад ОФ-2 → ОФ-2.
 *
 * Моделируемый сегмент парка (5 экскаваторов, 20 самосвалов) возит руду на первую цепочку — этого
 * ровно хватает на одну фабрику. Вторую питает остальной парк комбината, которого в модели нет, поэтому
 * подвоз к ККД-2 здесь условный: ровный поток с медленными колебаниями, который зависит только от
 * погоды (в метель «чужие» самосвалы тоже едут медленнее). Всё, что после подвоза, считается честно:
 * бункер, дробилка, склад, фабрика, содержание меди, извлечение, остановка при отключении энергии и
 * на подмёрзшей руде.
 *
 * Случайностей нет, на добычу и бенчмарк модуль не влияет. Хвосты ОФ-2 в модели хвостохранилища не
 * учитываются: оно описано для хвостов сегмента.
 *
 * Чтобы все существующие экраны (мнемосхемы, 3D-цех, двойники) работали на второй цепочке без
 * переписывания, цепочка отдаёт `view` — «вид симуляции» с её собственными бункером, складом,
 * статистикой и агрегатами; остальное (время, погода, конфиг) берётся у настоящей симуляции.
 */
import type { Simulation } from './engine';
import { PlantEquipment, UNIT_DEFS } from './equipment';
import { inBand, recovery } from './ore';
import type { DumpSite } from './types';

/** Условный подвоз руды остальным парком к ККД-2, т/ч: чуть больше потребления фабрики. */
export const CHAIN2_FEED_TPH = 3100;

/** Агрегаты второй цепочки — те же, что у первой (дробилка, конвейеры, мельницы, флотация). */
const CHAIN2_UNITS = UNIT_DEFS.filter((d) => d.building === 'crusher' || d.building === 'plant');

const zero = <T extends object>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' ? 0 : v && typeof v === 'object' ? zero(v as object) : v;
  return out as T;
};

export class SecondChain {
  readonly stockpile = { t: 0, cuT: 0, capT: 0, inflowT: 0, crushing: false, lastIn: 0 };
  readonly dump: DumpSite;
  /** Статистика фабрики: те же поля, что у первой цепочки. */
  readonly stats: Simulation['stats'];
  /** Условный подвоз сейчас, т/ч, и сколько секунд бункер был полон (подвоз ждал). */
  inflowTph = 0;
  backedUpSec = 0;
  /** Содержание меди в подвозимой руде сейчас, %. */
  inflowGrade = 0;
  readonly equipment: PlantEquipment;
  /** «Вид симуляции» с данными второй цепочки — для экранов, которые читают sim.crusher, sim.stockpile и т. п. */
  readonly view: Simulation;

  constructor(sim: Simulation) {
    const d = sim.cfg.dumps.crusher;
    const g0 = sim.cfg.grade.targetPct;
    this.stockpile.capT = d.stockpileCapT;
    this.stockpile.t = d.stockpileInitialT;
    this.stockpile.cuT = (d.stockpileInitialT * g0) / 100;
    this.dump = {
      id: 90,
      kind: 'crusher',
      name: 'Первичная дробилка ККД-2',
      material: 'sulfide',
      node: 0,
      accessNode: 0,
      x: sim.cfg.sites.crusher2.x,
      y: sim.cfg.sites.crusher2.y,
      bays: 1,
      dumpTimeSec: d.dumpMin * 60,
      queue: [],
      active: [],
      tonnes: 0,
      binT: d.binInitialT * 0.6,
      binCapT: d.binCapT,
      starvedSec: 0,
      binCuT: (d.binInitialT * 0.6 * g0) / 100,
    };
    this.stats = zero(sim.stats);
    this.inflowGrade = g0;
    // Вид симуляции: прототип — настоящая симуляция, поверх — собственные бункер, склад, статистика.
    const self = this;
    this.view = Object.create(sim, {
      stockpile: { value: this.stockpile },
      dumps: { value: [this.dump] },
      stats: { value: this.stats },
      trucks: { value: [] },
      equipment: { get: () => self.equipment },
    }) as Simulation;
    // Разные потоки случайных чисел, чтобы неисправности агрегатов не совпадали с первой цепочкой.
    this.equipment = new PlantEquipment(this.view, { defs: CHAIN2_UNITS, salt: 400 });
  }

  update(sim: Simulation, dt: number): void {
    const cfg = sim.cfg;
    const d = cfg.dumps.crusher;
    const w = sim.weather;
    const cut = sim.powerCutLeft > 0;
    const t = sim.now;
    const bin = this.dump;
    const s = this.stockpile;

    // Подвоз от остального парка: ровный поток с медленными волнами; в непогоду едут медленнее.
    const wave = 1 + 0.1 * Math.sin((2 * Math.PI * t) / 5400 + 0.9) + 0.05 * Math.sin((2 * Math.PI * t) / 1700 + 2.1);
    this.inflowTph = CHAIN2_FEED_TPH * wave * w.speedFactor;
    this.inflowGrade = cfg.grade.targetPct + 0.022 * Math.sin((2 * Math.PI * t) / 7800 + 0.7) + 0.008 * Math.sin((2 * Math.PI * t) / 1100 + 1.9);
    const want = (this.inflowTph / 3600) * dt;
    const inflow = Math.min(want, Math.max(0, bin.binCapT - bin.binT));
    if (inflow < want - 1e-9) this.backedUpSec += dt;
    bin.binT += inflow;
    bin.binCuT += (inflow * this.inflowGrade) / 100;
    bin.tonnes += inflow;

    // ККД-2: стоит без электричества; на подмёрзшей руде выдаёт меньше.
    const move = cut ? 0 : Math.min(bin.binT, ((d.crusherTpm * w.crusherFactor) / 60) * dt, Math.max(0, s.capT - s.t));
    s.crushing = move > 1e-6;
    s.lastIn = move / dt;
    if (move > 0) {
      const cu = bin.binT > 1e-6 ? (bin.binCuT * move) / bin.binT : 0;
      bin.binT -= move;
      bin.binCuT = Math.max(0, bin.binCuT - cu);
      if (bin.binT <= 1e-6) bin.binCuT = 0;
      s.t += move;
      s.cuT += cu;
      s.inflowT += move;
    }

    // ОФ-2: берёт руду со склада; без электричества и без руды стоит.
    const need = cut ? 0 : (d.plantFeedTpm / 60) * dt;
    const fed = Math.min(s.t, need);
    if (!cut && fed < need) bin.starvedSec += dt * (1 - fed / need);
    if (fed > 0) {
      const grade = s.t > 1e-6 ? (s.cuT / s.t) * 100 : cfg.grade.targetPct;
      const cu = (fed * grade) / 100;
      const r = recovery(cfg, grade);
      s.t -= fed;
      s.cuT = Math.max(0, s.cuT - cu);
      if (s.t <= 1e-6) s.cuT = 0;
      const st = this.stats;
      st.plantFeedT += fed;
      st.cuFeedT += cu;
      st.cuConcT += cu * r;
      st.cuLossT += cu * (cfg.grade.recoveryMax - r);
      st.feedSec += dt * (fed / need);
      if (inBand(cfg, grade)) st.feedInBandSec += dt * (fed / need);
    }
    // Агрегаты читают состояние бункера, склада и подачи, поэтому обновляются после них.
    this.equipment.tick();
  }

  /** Фабрика работает: на складе есть руда и есть электричество. */
  running(sim: Simulation): boolean {
    return this.stockpile.t > 0.01 && sim.powerCutLeft <= 0;
  }
}
