/**
 * Оборудование внутри зданий: агрегаты дробилки, обогатительной фабрики и гаража со своими
 * датчиками. Режим агрегата следует за процессом (есть ли разгрузка, есть ли руда в бункере,
 * кто на заправке или в ремонте), значения датчиков — простые физические модели с шумом.
 *
 * Неисправности: у вращающихся агрегатов изредка начинает греться подшипник (температура растёт
 * 60–120 мин). Двойник поднимает тревогу и рекомендует осмотр в пересменку. На добычу в модели
 * это не влияет — показывается как диагностика (отдельный поток ГПСЧ, сравнение стратегий не
 * сдвигается).
 */
import { Rng, subSeed } from './rng';
import type { Simulation } from './engine';

export type UnitBuilding = 'crusher' | 'plant' | 'garage';
export type UnitState = 'run' | 'idling' | 'stop' | 'busy' | 'free';

export interface UnitDef {
  key: string;
  name: string;
  building: UnitBuilding;
  /** Признаки для ключевых показателей карточки. */
  keyFeatures: string[];
  /** Датчики (для паспорта). */
  sensors: string[];
  /** Номинальная температура подшипника под нагрузкой, °C (0 — нет подшипникового узла). */
  bearingC: number;
  /** Порог тревоги по подшипнику, °C. */
  alarmC: number;
}

export const UNIT_DEFS: UnitDef[] = [
  { key: 'crusher-drive', name: 'Конусная дробилка', building: 'crusher', keyFeatures: ['state', 'power', 'bearing_temp', 'vibration'], sensors: ['ток и мощность двигателя', 'давление гидросистемы', 'температура подшипников', 'вибрация'], bearingC: 62, alarmC: 80 },
  { key: 'conveyor-1', name: 'Конвейер дробилка → склад', building: 'crusher', keyFeatures: ['state', 'load', 'motor_current', 'bearing_temp'], sensors: ['конвейерные весы', 'скорость ленты', 'ток привода', 'датчик схода ленты'], bearingC: 48, alarmC: 70 },
  { key: 'conveyor-2', name: 'Конвейер склад → фабрика', building: 'crusher', keyFeatures: ['state', 'load', 'motor_current', 'bearing_temp'], sensors: ['конвейерные весы', 'скорость ленты', 'ток привода', 'датчик схода ленты'], bearingC: 48, alarmC: 70 },
  { key: 'sag-mill', name: 'Мельница ПСИ', building: 'plant', keyFeatures: ['state', 'power', 'mill_load', 'bearing_temp'], sensors: ['мощность привода', 'загрузка (весы опор)', 'обороты', 'температура подшипников', 'плотность пульпы'], bearingC: 58, alarmC: 75 },
  { key: 'ball-mill', name: 'Шаровая мельница', building: 'plant', keyFeatures: ['state', 'power', 'mill_load', 'bearing_temp'], sensors: ['мощность привода', 'загрузка', 'расход воды', 'температура подшипников'], bearingC: 55, alarmC: 72 },
  { key: 'cyclones', name: 'Гидроциклоны', building: 'plant', keyFeatures: ['state', 'pressure', 'p80', 'pulp_density'], sensors: ['давление на входе', 'гранулометр слива (P80)', 'плотномер'], bearingC: 0, alarmC: 0 },
  { key: 'flotation', name: 'Флотомашины (6 камер)', building: 'plant', keyFeatures: ['state', 'froth_level', 'air_flow', 'conc_grade'], sensors: ['уровень пены', 'расход воздуха', 'дозатор реагентов', 'анализатор Cu в пене'], bearingC: 0, alarmC: 0 },
  { key: 'thickener', name: 'Сгуститель концентрата', building: 'plant', keyFeatures: ['state', 'underflow_density', 'rake_torque'], sensors: ['плотность разгрузки', 'момент на граблях'], bearingC: 0, alarmC: 0 },
  { key: 'fuel-1', name: 'Колонка АЗС 1', building: 'garage', keyFeatures: ['state', 'truck', 'flow', 'dispensed'], sensors: ['массовый расходомер', 'RFID самосвала'], bearingC: 0, alarmC: 0 },
  { key: 'fuel-2', name: 'Колонка АЗС 2', building: 'garage', keyFeatures: ['state', 'truck', 'flow', 'dispensed'], sensors: ['массовый расходомер', 'RFID самосвала'], bearingC: 0, alarmC: 0 },
  { key: 'bay-1', name: 'Ремонтный бокс 1', building: 'garage', keyFeatures: ['state', 'truck', 'remaining', 'repairs'], sensors: ['RFID на воротах', 'терминал механика'], bearingC: 0, alarmC: 0 },
  { key: 'bay-2', name: 'Ремонтный бокс 2', building: 'garage', keyFeatures: ['state', 'truck', 'remaining', 'repairs'], sensors: ['RFID на воротах', 'терминал механика'], bearingC: 0, alarmC: 0 },
  { key: 'bay-3', name: 'Ремонтный бокс 3', building: 'garage', keyFeatures: ['state', 'truck', 'remaining', 'repairs'], sensors: ['RFID на воротах', 'терминал механика'], bearingC: 0, alarmC: 0 },
];

/** Текущие показания агрегата: признак → значение. */
export type UnitValues = Record<string, number | string>;

export interface UnitRuntime {
  def: UnitDef;
  state: UnitState;
  v: UnitValues;
  /** Неисправность подшипника: начало и длительность нагрева, с. */
  fault: { start: number; dur: number; riseC: number } | null;
  alarm: boolean;
}

const UPDATE_SEC = 5;
const r1 = (x: number) => Math.round(x * 10) / 10;

export class PlantEquipment {
  readonly units: UnitRuntime[];
  private readonly rng: Rng;
  private next = 0;
  /** Учёт для колонок и боксов. */
  private readonly lastOnPost: (number | null)[] = [null, null];
  private readonly lastInBay: (number | null)[] = [null, null, null];

  /**
   * defs и salt нужны второй цепочке: свой набор агрегатов и свои потоки случайных чисел, чтобы
   * поведение первой цепочки и её бенчмарк не менялись.
   */
  constructor(private readonly sim: Simulation, opts: { defs?: UnitDef[]; salt?: number } = {}) {
    const salt = opts.salt ?? 0;
    const defs = opts.defs ?? UNIT_DEFS;
    this.rng = new Rng(subSeed(sim.seed, 9000 + salt));
    const T = sim.cfg.shift.durationSec;
    // Обычно за смену начинает греться подшипник одного из вращающихся агрегатов (85% смен).
    const fr = new Rng(subSeed(sim.seed, 9100 + salt));
    const rotating = defs.filter((d) => d.bearingC > 0).map((d) => d.key);
    const faulty = fr.next() < 0.85 ? rotating[Math.floor(fr.next() * rotating.length)] : null;
    this.units = defs.map((def) => {
      const fault = def.key === faulty ? { start: Math.floor(fr.range(0.15, 0.7) * T), dur: Math.round(fr.range(60, 120) * 60), riseC: fr.range(24, 34) } : null;
      const v: UnitValues = def.bearingC > 0 ? { bearing_temp: 30 } : {};
      return { def, state: 'idling' as UnitState, v, fault, alarm: false };
    });
    this.update(true);
  }

  get(key: string): UnitRuntime | undefined {
    return this.units.find((u) => u.def.key === key);
  }

  /** Вызывается каждый тик; пересчёт раз в UPDATE_SEC модельного времени. */
  tick(): void {
    if (this.sim.now < this.next) return;
    this.update(false);
  }

  private update(init: boolean): void {
    const sim = this.sim;
    const cfg = sim.cfg;
    this.next = sim.now + UPDATE_SEC;
    const crushing = sim.stockpile.crushing;
    const feedOn = sim.stockpile.t > 0.01;
    const n = (sd: number) => (this.rng.next() * 2 - 1) * sd;
    const g = sim.feedGrade || cfg.grade.targetPct;
    const dt = init ? 0 : UPDATE_SEC;

    const bearing = (u: UnitRuntime, load: number) => {
      // Тепловая модель подшипника: приближение к (окр. 25 °C + доля нагрузки) с постоянной 15 мин + нагрев при неисправности.
      const target = 25 + (u.def.bearingC - 25) * load;
      let extra = 0;
      if (u.fault && sim.now >= u.fault.start) extra = u.fault.riseC * Math.min(1, (sim.now - u.fault.start) / u.fault.dur);
      const prev = Number(u.v.bearing_temp ?? 25) - Number(u.v.bearing_extra ?? 0);
      const base = init ? target : prev + (target - prev) * (1 - Math.exp(-dt / 900));
      u.v.bearing_extra = r1(extra);
      u.v.bearing_temp = r1(base + extra + n(0.3));
      const wasAlarm = u.alarm;
      // Гистерезис 4 °C: тревога не «мигает» около порога.
      const tC = Number(u.v.bearing_temp);
      u.alarm = wasAlarm ? tC >= u.def.alarmC - 4 : tC >= u.def.alarmC;
      u.v.alarm = u.alarm ? 1 : 0;
      if (u.alarm && !wasAlarm && !init) sim.addLog(`${u.def.name}: перегрев подшипника ${u.v.bearing_temp} °C — запланировать осмотр в пересменку`, 'warn');
      return extra;
    };
    const vib = (base: number, extra: number) => r1(base + extra * 0.12 + n(0.15));
    const amps = (kw: number, kv: number) => Math.round((kw * 1000) / (1.732 * kv * 1000 * 0.86));

    for (const u of this.units) {
      const v = u.v;
      switch (u.def.key) {
        case 'crusher-drive': {
          u.state = crushing ? 'run' : 'idling';
          const kw = crushing ? 420 + n(25) : 95 + n(5);
          v.power = Math.round(kw);
          v.motor_current = amps(kw, 6);
          v.hydraulic_pressure = r1(crushing ? 38 + n(2) : 30 + n(0.5));
          const ex = bearing(u, crushing ? 1 : 0.55);
          v.vibration = vib(crushing ? 3.4 : 1.6, ex);
          break;
        }
        case 'conveyor-1': {
          u.state = crushing ? 'run' : 'idling';
          v.belt_speed = crushing ? 2.5 : 0;
          v.load = crushing ? Math.round((cfg.truck.payloadT / (cfg.dumps.crusher.dumpMin * 60)) * 3600 + n(300)) : 0;
          v.motor_current = crushing ? Math.round(160 + n(10)) : 0;
          bearing(u, crushing ? 1 : 0.2);
          v.belt_misalign = 0;
          break;
        }
        case 'conveyor-2': {
          u.state = feedOn ? 'run' : 'stop';
          v.belt_speed = feedOn ? 2.5 : 0;
          v.load = feedOn ? Math.round(cfg.dumps.crusher.plantFeedTpm * 60 + n(60)) : 0;
          v.motor_current = feedOn ? Math.round(120 + n(6)) : 0;
          bearing(u, feedOn ? 1 : 0.2);
          v.belt_misalign = 0;
          break;
        }
        case 'sag-mill': {
          u.state = feedOn ? 'run' : 'stop';
          // Мощность ПСИ растёт с загрузкой; при пустом бункере мельница «вырабатывается» и стоит.
          const loadPct = feedOn ? 29 + 3 * Math.sin(sim.now / 1800) + n(0.4) : 0;
          v.mill_load = r1(loadPct);
          v.power = feedOn ? r1(11.5 + (loadPct - 26) * 0.35 + n(0.15)) : 0;
          v.speed = feedOn ? 9.8 : 0;
          v.pulp_density = feedOn ? r1(70 + n(0.8)) : 0;
          const ex = bearing(u, feedOn ? 1 : 0.3);
          v.vibration = vib(feedOn ? 2.2 : 0.3, ex);
          break;
        }
        case 'ball-mill': {
          u.state = feedOn ? 'run' : 'stop';
          v.mill_load = feedOn ? r1(36 + n(0.5)) : 0;
          v.power = feedOn ? r1(8.6 + n(0.12)) : 0;
          v.water = feedOn ? Math.round(1150 + n(30)) : 0;
          const ex = bearing(u, feedOn ? 1 : 0.3);
          v.vibration = vib(feedOn ? 1.9 : 0.3, ex);
          break;
        }
        case 'cyclones': {
          u.state = feedOn ? 'run' : 'stop';
          v.pressure = feedOn ? Math.round(98 + n(4)) : 0;
          v.p80 = feedOn ? Math.round(155 + (Number(this.get('sag-mill')?.v.mill_load ?? 29) - 29) * 4 + n(4)) : 0;
          v.pulp_density = feedOn ? r1(38 + n(0.6)) : 0;
          v.cyclones_on = feedOn ? 4 : 0;
          break;
        }
        case 'flotation': {
          u.state = feedOn ? 'run' : 'stop';
          // Содержание Cu в концентрате растёт с содержанием в питании.
          v.froth_level = feedOn ? Math.round(240 + n(12)) : 0;
          v.air_flow = feedOn ? r1(16 + n(0.6)) : 0;
          v.reagent_dose = feedOn ? r1(28 + n(0.8)) : 0;
          v.conc_grade = feedOn ? r1(22 + (g - cfg.grade.targetPct) * 60 + n(0.4)) : 0;
          v.cells_running = feedOn ? 6 : 0;
          break;
        }
        case 'thickener': {
          // Сгуститель с запасом: продолжает работать и при коротком простое фабрики.
          u.state = feedOn ? 'run' : 'idling';
          v.underflow_density = r1(feedOn ? 64 + n(0.6) : 66 + n(0.3));
          v.rake_torque = Math.round(feedOn ? 42 + n(2) : 30 + n(1));
          break;
        }
        default: {
          const fuelIdx = u.def.key === 'fuel-1' ? 0 : u.def.key === 'fuel-2' ? 1 : -1;
          if (fuelIdx >= 0) {
            const t = sim.trucks.filter((x) => x.state === 'refuel')[fuelIdx];
            u.state = t ? 'busy' : 'free';
            const flow = t ? Math.round((cfg.truck.fuelTankL * 0.85) / cfg.truck.refuelMin) : 0; // л/мин
            v.truck = t ? t.name : '—';
            v.flow = flow;
            v.dispensed = Math.round(Number(v.dispensed ?? 0) + (flow * dt) / 60);
            if (t && this.lastOnPost[fuelIdx] !== t.id) v.refuels = Number(v.refuels ?? 0) + 1;
            this.lastOnPost[fuelIdx] = t ? t.id : null;
          } else {
            const bayIdx = Number(u.def.key.split('-')[1]) - 1;
            const t = sim.trucks.filter((x) => x.state === 'service')[bayIdx];
            u.state = t ? 'busy' : 'free';
            v.truck = t ? t.name : '—';
            v.remaining = t ? Math.ceil(t.timer / 60) : 0;
            v.component = t ? (t.health.sign === 'engine' ? 'двигатель' : t.health.sign === 'tyre' ? 'шины' : t.health.sign === 'hydraulic' ? 'гидравлика' : 'осмотр') : '—';
            if (t && this.lastInBay[bayIdx] !== t.id) v.repairs = Number(v.repairs ?? 0) + 1;
            this.lastInBay[bayIdx] = t ? t.id : null;
          }
        }
      }
      v.state = u.state;
    }
  }

  /** Тревоги агрегатов (перегрев подшипников). */
  get alarms(): UnitRuntime[] {
    return this.units.filter((u) => u.alarm);
  }
}

export const UNIT_STATE_RU: Record<UnitState, string> = { run: 'работает', idling: 'холостой ход', stop: 'стоит', busy: 'занят', free: 'свободен' };
