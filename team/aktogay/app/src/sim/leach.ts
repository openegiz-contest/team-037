/**
 * Кучное выщелачивание как процесс: карты площадки, график орошения, продуктивный раствор (PLS)
 * и катодная медь на заводе SX-EW.
 *
 * Площадка разбита на карты, каждая — ~2 недели отсыпки оксидной руды. Карта проходит стадии:
 * отсыпка (сюда разгружаются самосвалы) → выдержка (разводка капельной сети) → орошение (месяцами)
 * → отработана. Медь выходит по кривой извлечения: быстро в первые недели, потом медленнее
 * (до ~70 % за полгода). Орошают по графику: группы карт поливаются по очереди, остальные «отдыхают».
 * Медь из раствора на заводе SX-EW экстрагируется и осаждается в катоды 99,99 %.
 *
 * Масштаб — моделируемый сегмент парка (~11 млн т оксида в год, порядок реальной отсыпки Актогая).
 * Параметры — оценки. Случайностей нет: на остальную модель не влияет.
 */
import type { Simulation } from './engine';

export type CellStage = 'loading' | 'rest' | 'irrigating' | 'spent';

export interface LeachCell {
  id: number;
  name: string;
  stage: CellStage;
  /** Руда на карте, т, и медь в ней (исходно), т. */
  oreT: number;
  cuT: number;
  /** Сколько суток карта под орошением (эффективных, с учётом графика). */
  daysLeached: number;
  /** Извлечено меди с карты, т. */
  cuLeachedT: number;
  /** Сейчас поливается (по графику). */
  irrigated: boolean;
}

/** Ёмкость карты, т (≈ 2 недели отсыпки сегмента). */
export const CELL_CAP_T = 450_000;
/** Предельное извлечение меди и постоянная времени, сут. */
export const REC_MAX = 0.7;
export const TAU_DAYS = 60;
/** Сколько суток карта под орошением, прежде чем её отработанной выводят из цикла. */
export const LEACH_DAYS = 180;
/** Среднее содержание меди в оксидной руде, %. */
export const OXIDE_GRADE_PCT = 0.3;
/** Плотность орошения, л/(ч·м²), и площадь карты, м² (штабель ~8 м, насыпная плотность ~1,8 т/м³). */
export const IRRIGATION_LH_M2 = 10;
export const CELL_AREA_M2 = CELL_CAP_T / (1.8 * 8);
/** Групп орошения и длительность «окна» полива одной группы, ч. */
export const IRRIGATION_GROUPS = 3;
export const IRRIGATION_WINDOW_H = 4;
/** Извлечение меди из раствора на SX и выход по току на EW. */
export const SX_EFFICIENCY = 0.92;
/** Электролизных ванн в серии (оценка). */
export const EW_CELLS = 64;
/** Расход кислоты: на тонну уложенной руды, кг, и на тонну меди в катодах, т. */
export const ACID_KG_PER_T_ORE = 8;
export const ACID_T_PER_T_CU = 2.2;

/** Начальное состояние карт на начало смены (возраст в сутках под орошением). Оценка. */
const INITIAL: { stage: CellStage; days: number; fill?: number }[] = [
  { stage: 'loading', days: 0, fill: 0.35 },
  { stage: 'rest', days: 0 },
  { stage: 'irrigating', days: 6 },
  { stage: 'irrigating', days: 21 },
  { stage: 'irrigating', days: 37 },
  { stage: 'irrigating', days: 52 },
  { stage: 'irrigating', days: 68 },
  { stage: 'irrigating', days: 84 },
  { stage: 'irrigating', days: 101 },
  { stage: 'irrigating', days: 118 },
  { stage: 'irrigating', days: 137 },
  { stage: 'irrigating', days: 158 },
  { stage: 'spent', days: LEACH_DAYS },
];

const recovered = (days: number) => REC_MAX * (1 - Math.exp(-days / TAU_DAYS));

export class HeapLeach {
  readonly cells: LeachCell[];
  /** За смену: уложено руды, извлечено меди в раствор, катодов, кислоты; в ваннах EW. */
  placedT = 0;
  cuLeachedT = 0;
  cathodeT = 0;
  acidT = 0;
  /** Текущие потоки: расход PLS, м³/ч; медь в PLS, г/л; ток серии электролиза, кА. */
  plsM3h = 0;
  plsGpl = 0;
  ewKA = 0;
  /** Тоннаж площадки, уже разнесённый по картам (для приращения отсыпки). */
  syncedOxideT = 0;

  constructor() {
    this.cells = INITIAL.map((c, i) => {
      const oreT = c.stage === 'loading' ? CELL_CAP_T * (c.fill ?? 0) : CELL_CAP_T;
      const cuT = (oreT * OXIDE_GRADE_PCT) / 100;
      const cell: LeachCell = {
        id: i,
        name: `Карта ${i + 1}`,
        stage: c.stage,
        oreT,
        cuT,
        daysLeached: c.days,
        cuLeachedT: cuT * recovered(c.days),
        irrigated: false,
      };
      return cell;
    });
  }

  /** Группа орошения карты (по кругу) и поливается ли она в момент t, с. */
  groupOf(cell: LeachCell): number {
    return cell.id % IRRIGATION_GROUPS;
  }

  activeGroup(t: number): number {
    return Math.floor(t / (IRRIGATION_WINDOW_H * 3600)) % IRRIGATION_GROUPS;
  }

  update(sim: Simulation, dt: number): void {
    // Отсыпка: всё, что самосвалы разгрузили на площадке, — на текущую карту отсыпки.
    const oxide = sim.dumps[1]?.tonnes ?? 0;
    const placed = Math.max(0, oxide - this.syncedOxideT);
    this.syncedOxideT = oxide;
    if (placed > 0) {
      this.placedT += placed;
      this.acidT += (placed * ACID_KG_PER_T_ORE) / 1000;
      let loading = this.cells.find((c) => c.stage === 'loading');
      if (!loading) loading = this.cells.find((c) => c.stage === 'spent');
      if (loading) {
        if (loading.stage === 'spent') this.recycle(loading, sim);
        loading.oreT += placed;
        loading.cuT += (placed * OXIDE_GRADE_PCT) / 100;
        if (loading.oreT >= CELL_CAP_T) this.advance(sim, loading);
      }
    }

    // Орошение по графику и выход меди в раствор.
    const g = this.activeGroup(sim.now);
    // Холод резко тормозит химию, в мороз орошение останавливают: раствор в капельницах замерзает.
    const w = sim.weather;
    let cuRate = 0; // т/ч
    let wet = 0;
    for (const c of this.cells) {
      c.irrigated = w.irrigationOn && c.stage === 'irrigating' && this.groupOf(c) === g;
      if (!c.irrigated) continue;
      wet++;
      // Под поливом время выщелачивания идёт втрое быстрее «среднего», чтобы за полный круг групп
      // карта получала столько же орошения, сколько при непрерывном поливе.
      const dDays = (dt / 86400) * IRRIGATION_GROUPS * w.leachFactor;
      const before = c.daysLeached;
      c.daysLeached += dDays;
      const dCu = c.cuT * (recovered(c.daysLeached) - recovered(before));
      c.cuLeachedT += dCu;
      this.cuLeachedT += dCu;
      cuRate += (dCu / dt) * 3600;
      if (c.daysLeached >= LEACH_DAYS) {
        c.stage = 'spent';
        sim.addLog(`${c.name} отработана: извлечено ${Math.round((c.cuLeachedT / Math.max(1e-9, c.cuT)) * 100)} % меди, выведена из орошения`, 'info');
      }
    }
    this.plsM3h = (wet * IRRIGATION_LH_M2 * CELL_AREA_M2) / 1000;
    this.plsGpl = this.plsM3h > 0 ? (cuRate * 1e6) / (this.plsM3h * 1000) : 0;
    // SX-EW: медь из раствора → катоды; ток серии ванн — по закону Фарадея (Cu²⁺, ~1,186 г/(А·ч)),
    // выход по току ~90 %, ванн в серии EW_CELLS.
    const cathRate = cuRate * SX_EFFICIENCY; // т/ч
    this.cathodeT += (cathRate * dt) / 3600;
    this.acidT += ((cathRate * dt) / 3600) * ACID_T_PER_T_CU;
    this.ewKA = (cathRate * 1e6) / 1.186 / 0.9 / EW_CELLS / 1000;
  }

  /** Карта отсыпана — в выдержку; выдержанная — под орошение. */
  private advance(sim: Simulation, filled: LeachCell): void {
    filled.stage = 'rest';
    sim.addLog(`${filled.name} отсыпана (${Math.round(filled.oreT / 1000)} тыс. т) — разводка капельной сети, затем орошение`, 'info');
    const rest = this.cells.find((c) => c.stage === 'rest' && c !== filled);
    if (rest) {
      rest.stage = 'irrigating';
      rest.daysLeached = 0;
      sim.addLog(`${rest.name}: начато орошение`, 'info');
    }
    const next = this.cells.find((c) => c.stage === 'spent');
    if (next) this.recycle(next, sim);
  }

  /** Отработанную карту перекрывают новым ярусом и снова отсыпают. */
  private recycle(c: LeachCell, sim: Simulation): void {
    c.stage = 'loading';
    c.oreT = 0;
    c.cuT = 0;
    c.cuLeachedT = 0;
    c.daysLeached = 0;
    sim.addLog(`${c.name}: новый ярус — началась отсыпка`, 'info');
  }

  /** Катоды, т/сут при текущем темпе. */
  get cathodeTpd(): number {
    return ((this.ewKA * 1000 * EW_CELLS * 0.9 * 1.186) / 1e6) * 24;
  }

  get irrigatingCount(): number {
    return this.cells.filter((c) => c.stage === 'irrigating').length;
  }
}
