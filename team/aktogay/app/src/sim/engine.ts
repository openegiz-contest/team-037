/**
 * Тиковый движок симуляции карьера. Шаг фиксированный (config.shift.tickSec), все случайные
 * события генерируются заранее из seed — поэтому два прогона с одним seed, но разными
 * стратегиями, получают одинаковые поломки и закрытия дорог (честное сравнение).
 */
import { DEFAULT_CONFIG, type SimConfig } from './config';
import { createStrategy, type DispatchStrategy } from './dispatch';
import { initialHealth, initialSensors, resetHealth, runDetector, updateSensors } from './health';
import { gradeAt, inBand, recovery } from './ore';
import { Router } from './graph';
import { buildMine, type MineLayout } from './mine';
import { hash01, Rng, subSeed } from './rng';
import { emptyDriverStats, FATIGUE_ALERT, makeDriver } from './drivers';
import { PlantEquipment } from './equipment';
import { ConcentrateYard } from './concentrate';
import { HeapLeach } from './leach';
import { FREEBOARD_MIN_M, TailingsDam } from './tailings';
import { SecondChain } from './chain2';
import { EnergyMeter } from './energy';
import { Weather } from './weather';
import { DrillOps } from './drilling';
import {
  MATERIALS,
  MATERIAL_SHORT,
  TRUCK_STATES,
  type Blast,
  type Destination,
  type DumpSite,
  type Excavator,
  type FailureType,
  type HistoryPoint,
  type PlannedFailure,
  type LogEntry,
  type Material,
  type RoadClosure,
  type SimEvent,
  type SimStats,
  type StrategyName,
  type Truck,
  type TruckState,
} from './types';

/** Хронология смены: строки по минутам (см. TRUCK_CODE, EX_CODE). */
export interface ShiftTimeline {
  minutes: number;
  trucks: string[];
  excavators: string[];
  /** Бункер дробилки: '0'…'9' — уровень десятками процентов, 's' — пусто (фабрика стоит). */
  crusher: string;
  /** Число перекрытых участков съездов (без оцеплений взрывов). */
  closures: string;
}

/** Приказ диспетчера самосвалу. */
export type ManualOrder = { kind: 'excavator'; id: number } | { kind: 'hold' };

export const TRUCK_CODE: Record<TruckState, string> = { idle: 'i', empty: 'e', queue: 'q', loading: 'l', loaded: 'L', dumping: 'd', refuel: 'f', service: 's', broken: 'b' };
export const EX_CODE: Record<Excavator['state'], string> = { working: 'w', waiting: 'i', broken: 'b', blast: 'x', nostock: 'n' };

export interface SimOptions {
  seed: number;
  truckCount: number;
  strategy: StrategyName;
  config?: SimConfig;
  /** Месяц года для погоды и сезона (1…12); по умолчанию — из конфига. */
  month?: number;
}

export class Simulation {
  readonly cfg: SimConfig;
  readonly seed: number;
  readonly strategyName: StrategyName;
  readonly layout: MineLayout;
  readonly router: Router;
  readonly trucks: Truck[] = [];
  readonly excavators: Excavator[] = [];
  /** 0 — дробилка (сульфид), 1 — кучное выщелачивание (оксид), 2 — отвал (вскрыша). */
  readonly dumps: DumpSite[] = [];
  readonly garageNode: number;
  readonly stats: SimStats;
  /**
   * Склад дроблёной руды между дробилкой и фабрикой: дробилка перегружает руду из приёмного
   * бункера на склад, фабрика забирает со склада. Простой фабрики — когда склад пуст.
   */
  readonly stockpile = { t: 0, cuT: 0, capT: 0, inflowT: 0, crushing: false, lastIn: 0 };
  readonly history: HistoryPoint[] = [];
  readonly log: LogEntry[] = [];
  /**
   * Ручные приказы диспетчера (только на стенде, по командам из раздела «Диспетчер»):
   * самосвал → экскаватор (держится, пока не вернут «авто») или «стоять на стоянке».
   * Пустая карта — модель считает как обычно (бенчмарк не меняется).
   */
  readonly manual = new Map<number, ManualOrder>();
  closures: RoadClosure[] = [];
  /** График взрывных работ на смену (известен заранее) + ручные взрывы. */
  readonly blasts: Blast[] = [];

  now = 0;
  finished = false;
  /** Накопитель дробного времени (для интерполяции отрисовки). */
  private acc = 0;
  private readonly events: SimEvent[];
  private evIdx = 0;
  private readonly strategy: DispatchStrategy;
  /** Полное время текущей погрузки по экскаваторам (для расчёта доли загрузки). */
  readonly loadTotal: number[] = [];
  /** Целевая доля тоннажа каждого экскаватора по плану смены. */
  readonly targetShare: number[];
  /** Оборудование внутри зданий (агрегаты дробилки, фабрики, гаража). */
  equipment!: PlantEquipment;
  /** Буровые станки, блоки у забоев, запас взорванной массы. */
  drill!: DrillOps;
  /** Склад концентрата и ж/д отгрузка. */
  readonly concentrate = new ConcentrateYard();
  /** Кучное выщелачивание и завод SX-EW. */
  readonly leach = new HeapLeach();
  /** Хвостохранилище: пульпа с фабрики, пруд оборотной воды, контроль дамбы. */
  readonly tailings = new TailingsDam();
  /** Погода и сезон: влияют на возку, дробилку, выщелачивание, пруд и взрывы. */
  readonly weather: Weather;
  /** Учёт электроэнергии по участкам. */
  readonly energy = new EnergyMeter();
  /** Вторая цепочка комбината (ККД-2 → склад → ОФ-2): подвоз условный, дальше всё считается. */
  chain2!: SecondChain;
  private readonly windWarned = new Set<number>();
  /** Сценарий «отключение энергии»: сколько ещё стоит фабрика, дробилка и электролиз, с. */
  powerCutLeft = 0;
  /** Фабрика остановлена из-за запаса до гребня дамбы (её нельзя грузить хвостами). */
  private damStopped = false;
  /** ГПСЧ событий вождения (резкие торможения) — по потоку на самосвал. */
  private readonly driverRng: Rng[] = [];
  /** Отдельный поток для усталости водителей: модуль диагностический и не сдвигает остальную модель. */
  private readonly fatigueRng: Rng[] = [];
  /**
   * Хронология смены по минутам — для диаграммы Ганта и цепочек последствий.
   * Один символ на минуту: состояние самосвала / экскаватора, уровень бункера, число перекрытий.
   */
  readonly timeline: ShiftTimeline = { minutes: 0, trucks: [], excavators: [], crusher: '', closures: '' };

  readonly speedLoaded: number;
  readonly speedEmpty: number;

  constructor(opts: SimOptions) {
    this.cfg = opts.config ?? DEFAULT_CONFIG;
    this.seed = opts.seed;
    this.strategyName = opts.strategy;
    this.layout = buildMine(this.cfg);
    this.router = new Router(this.layout.graph);
    this.strategy = createStrategy(opts.strategy);
    this.garageNode = this.layout.garage.node;
    this.weather = new Weather(this.seed, opts.month ?? this.cfg.weather.month);
    this.speedLoaded = this.cfg.truck.speedLoadedKmh / 3.6;
    this.speedEmpty = this.cfg.truck.speedEmptyKmh / 3.6;
    this.stats = {
      mined: { sulfide: 0, oxide: 0, waste: 0 },
      unplannedFailures: 0,
      preventedFailures: 0,
      alerts: 0,
      falseAlarms: 0,
      plantFeedT: 0,
      cuFeedT: 0,
      cuConcT: 0,
      cuLossT: 0,
      feedSec: 0,
      feedInBandSec: 0,
      fuelL: 0,
      exQueueSec: 0,
      exLoadsStarted: 0,
      dumpQueueSec: 0,
    };

    const g = this.layout.graph;
    this.cfg.excavators.forEach((spec, i) => {
      const { node, access } = this.layout.excavators[i];
      const gr = new Rng(subSeed(this.seed, 300 + i));
      const gc = this.cfg.grade;
      this.excavators.push({
        id: i,
        name: spec.name,
        material: spec.material,
        rateTpm: spec.rateTpm,
        node,
        accessNode: access,
        x: g.nodes[node].x,
        y: g.nodes[node].y,
        state: 'waiting',
        queue: [],
        loading: null,
        loadLeft: 0,
        brokenLeft: 0,
        tonnes: 0,
        loads: 0,
        busySec: 0,
        idleSec: 0,
        brokenSec: 0,
        blastLeft: 0,
        blastSec: 0,
        gradeBase: spec.gradePct,
        gradeAmp: gc.faceAmpPct * gr.range(0.6, 1),
        gradePeriodSec: gr.range(gc.facePeriodH[0], gc.facePeriodH[1]) * 3600,
        gradePhase: gr.range(0, Math.PI * 2),
        queueIntegral: 0,
      });
      this.loadTotal.push(1);
    });

    const d = this.cfg.dumps;
    const mkDump = (
      kind: DumpSite['kind'],
      name: string,
      material: Material,
      site: { node: number; access: number },
      bays: number,
      dumpMin: number,
    ): DumpSite => ({
      id: this.dumps.length,
      kind,
      name,
      material,
      node: site.node,
      accessNode: site.access,
      x: g.nodes[site.node].x,
      y: g.nodes[site.node].y,
      bays,
      dumpTimeSec: dumpMin * 60,
      queue: [],
      active: [],
      tonnes: 0,
      binT: kind === 'crusher' ? d.crusher.binInitialT : 0,
      binCapT: kind === 'crusher' ? d.crusher.binCapT : 0,
      starvedSec: 0,
      binCuT: kind === 'crusher' ? (d.crusher.binInitialT * this.cfg.grade.targetPct) / 100 : 0,
    });
    this.dumps.push(mkDump('crusher', 'Дробилка ККД', 'sulfide', this.layout.crusher, d.crusher.bays, d.crusher.dumpMin));
    this.dumps.push(mkDump('leach', 'Кучное выщелачивание', 'oxide', this.layout.leach, d.leach.bays, d.leach.dumpMin));
    this.dumps.push(mkDump('waste', 'Отвал северо-западный', 'waste', this.layout.waste, d.waste.bays, d.waste.dumpMin));
    this.cfg.sites.wasteExtra.forEach((w, i) => this.dumps.push(mkDump('waste', w.name, 'waste', this.layout.wasteExtra[i], d.waste.bays, d.waste.dumpMin)));
    this.stockpile.capT = d.crusher.stockpileCapT;
    this.stockpile.t = d.crusher.stockpileInitialT;
    this.stockpile.cuT = (d.crusher.stockpileInitialT * this.cfg.grade.targetPct) / 100;

    const perMaterial: Record<Material, number> = { sulfide: 0, oxide: 0, waste: 0 };
    for (const e of this.excavators) perMaterial[e.material]++;
    const planTotal = MATERIALS.reduce((s, m) => s + this.cfg.planT[m], 0);
    this.targetShare = this.excavators.map((e) => this.cfg.planT[e.material] / perMaterial[e.material] / planTotal);

    this.createTrucks(opts.truckCount);
    this.timeline.trucks = this.trucks.map(() => '');
    this.timeline.excavators = this.excavators.map(() => '');
    this.events = this.generateEvents();
    this.generateBlasts();
    this.drill = new DrillOps(this);
    this.recordHistory();
    this.equipment = new PlantEquipment(this);
    this.chain2 = new SecondChain(this);
  }

  // ───────────────────────────── инициализация ─────────────────────────────

  private createTrucks(count: number): void {
    const tc = this.cfg.truck;
    const T = this.cfg.shift.durationSec;
    const g = this.layout.graph;
    const P = this.layout.parking;
    for (let k = 0; k < P.slots.length; k++) this.slotOccupant.push(null);
    const allocation = this.planAllocation(count);
    for (let i = 0; i < count; i++) {
      // Поток случайных чисел привязан к номеру машины — не зависит ни от стратегии, ни от размера парка.
      const rng = new Rng(subSeed(this.seed, 1000 + i));
      const fuelL = rng.range(0.2, 1.0) * tc.fuelTankL;
      const serviceInH = rng.range(tc.serviceIntervalH[0], tc.serviceIntervalH[1]);
      const engineH = Math.round(rng.range(2000, 38000));
      const breakdowns: PlannedFailure[] = [];
      if (rng.next() < tc.breakdownProbPerShift) {
        breakdowns.push({
          t: Math.floor(rng.range(0.05, 0.9) * T),
          dur: Math.round(rng.range(tc.repairMin[0], tc.repairMin[1]) * 60),
          precursor: 0,
          type: 'engine',
        });
      }
      const speedFactor = rng.range(tc.speedFactorRange[0], tc.speedFactorRange[1]);
      // Признаки деградации (берутся после остальных величин, чтобы не сдвигать их поток).
      const hc = this.cfg.health;
      for (const f of breakdowns) {
        const predictable = rng.next() < hc.predictableShare;
        const precursor = Math.round(rng.range(hc.precursorMin[0], hc.precursorMin[1]) * 60);
        f.precursor = predictable ? Math.min(precursor, f.t) : 0;
        f.type = (['engine', 'hydraulic', 'tyre'] as FailureType[])[Math.floor(rng.next() * 3)];
      }
      const brng = new Rng(subSeed(this.seed, 5000 + i));
      const benign =
        brng.next() < hc.benignProbPerShift
          ? { start: Math.floor(brng.range(0.05, 0.85) * T), dur: Math.round(brng.range(25, 50) * 60), ampC: brng.range(3, 9) }
          : null;
      const stateSec = Object.fromEntries(TRUCK_STATES.map((s) => [s, 0])) as Record<TruckState, number>;
      // Водитель — отдельный поток ГПСЧ, не сдвигает остальные события смены.
      const drng = new Rng(subSeed(this.seed, 7000 + i));
      const slot = i % P.slots.length;
      const home = g.nodes[P.slots[slot]];
      this.slotOccupant[slot] = i;
      this.trucks.push({
        id: i,
        name: `№${101 + i}`,
        state: 'idle',
        path: [home.id],
        seg: 0,
        segPos: 0,
        node: home.id,
        x: home.x,
        y: home.y,
        px: home.x,
        py: home.y,
        dest: null,
        destNode: home.id,
        loadT: 0,
        material: null,
        gradePct: 0,
        fuelL,
        engineH,
        serviceInH,
        trips: 0,
        tonnes: 0,
        fixedEx: allocation[i],
        homeEx: allocation[i],
        speedFactor,
        stateSec,
        timer: 0,
        resumeState: null,
        breakdowns,
        sensors: initialSensors(),
        health: initialHealth(),
        serviceRequested: false,
        parkSlot: slot,
        benign,
        departAt: i * tc.departIntervalSec,
        queuedSince: 0,
        rerouteFlag: false,
        driver: makeDriver(i, () => drng.next()),
        driverStats: emptyDriverStats(),
      });
      this.driverRng.push(new Rng(subSeed(this.seed, 7100 + i)));
      const fr = new Rng(subSeed(this.seed, 7300 + i));
      this.fatigueRng.push(fr);
      const ds = this.trucks[this.trucks.length - 1].driverStats;
      ds.fatigue = 5 + fr.next() * 15; // кто-то пришёл на смену бодрее
      ds.fatigueRate = 4.5 + fr.next() * 3.5; // 4,5…8 %/ч за рулём
    }
  }

  /** Ближайший к забою пункт разгрузки для его материала (по дорогам). */
  nearestDump(ex: Excavator): DumpSite {
    let best = this.dumps.find((d) => d.material === ex.material)!;
    let bd = Infinity;
    for (const d of this.dumps) {
      if (d.material !== ex.material) continue;
      const dist = this.router.distance(ex.node, d.node);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /**
   * Куда везти груз: руда — на дробилку или выщелачивание, вскрыша — на один из отвалов.
   * Умная стратегия выбирает отвал по времени рейса и очереди; иначе — ближайший к забою.
   */
  dumpFor(t: Truck, ex: Excavator): number {
    const cands = this.dumps.filter((d) => d.material === ex.material);
    if (cands.length === 1) return cands[0].id;
    return this.strategy.chooseDump?.(this, t, ex, cands) ?? this.nearestDump(ex).id;
  }

  /** Расчётный цикл самосвала на экскаваторе (без очередей), с. */
  estimatedCycleSec(ex: Excavator): number {
    const dump = this.nearestDump(ex);
    const haul = this.router.distance(ex.node, dump.node);
    const back = this.router.distance(dump.node, ex.node);
    return haul / this.speedLoaded + back / this.speedEmpty + this.expectedLoadTime(ex) + dump.dumpTimeSec;
  }

  /**
   * Статическое закрепление для фиксированной стратегии — как делает плановик в начале смены:
   * число самосвалов на экскаватор ∝ (план по его материалу) × (расчётный цикл), не больше,
   * чем экскаватор способен загрузить. Распределение методом наибольших остатков.
   */
  planAllocation(count: number): number[] {
    const exs = this.excavators;
    const perMaterial: Record<Material, number> = { sulfide: 0, oxide: 0, waste: 0 };
    for (const e of exs) perMaterial[e.material]++;
    const need = exs.map((e) => {
      const tonnes = this.cfg.planT[e.material] / perMaterial[e.material];
      const loads = tonnes / this.cfg.truck.payloadT;
      return (loads * this.estimatedCycleSec(e)) / this.cfg.shift.durationSec;
    });
    const sum = need.reduce((a, b) => a + b, 0);
    const exact = need.map((n) => (n / sum) * count);
    const alloc = exact.map((x) => Math.max(1, Math.floor(x)));
    let left = count - alloc.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) alloc[order[k][1]]++;
    for (let k = order.length - 1; left < 0; k = (k - 1 + order.length) % order.length) {
      const i = order[k][1];
      if (alloc[i] > 1) {
        alloc[i]--;
        left++;
      }
    }
    // Чередуем, чтобы на выезде из гаража экскаваторы получали машины равномерно.
    const result: number[] = [];
    const rest = [...alloc];
    while (result.length < count) {
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] > 0) {
          result.push(i);
          rest[i]--;
        }
      }
    }
    return result;
  }

  private generateEvents(): SimEvent[] {
    const T = this.cfg.shift.durationSec;
    const events: SimEvent[] = [];
    const exRng = new Rng(subSeed(this.seed, 1));
    const nEx = exRng.poisson(this.cfg.excavator.breakdownsPerShift);
    for (let k = 0; k < nEx; k++) {
      events.push({
        t: Math.floor(exRng.range(0.08, 0.85) * T),
        kind: 'excavatorDown',
        ex: exRng.int(0, this.excavators.length - 1),
        dur: Math.round(exRng.range(this.cfg.excavator.repairMin[0], this.cfg.excavator.repairMin[1]) * 60),
      });
    }
    const roadRng = new Rng(subSeed(this.seed, 2));
    const nRoad = roadRng.poisson(this.cfg.roads.closuresPerShift);
    for (let k = 0; k < nRoad; k++) {
      events.push({
        t: Math.floor(roadRng.range(0.05, 0.9) * T),
        kind: 'roadClose',
        group: roadRng.int(0, this.layout.closureGroups.length - 1),
        dur: Math.round(roadRng.range(this.cfg.roads.closureMin[0], this.cfg.roads.closureMin[1]) * 60),
      });
    }
    return events.sort((a, b) => a.t - b.t);
  }

  // ───────────────────────────── взрывные работы ─────────────────────────────

  /** Плановые взрывы по графику смены (в обед, ± jitterMin), у случайного забоя. Поток ГПСЧ — свой. */
  private generateBlasts(): void {
    const bc = this.cfg.blasting;
    const T = this.cfg.shift.durationSec;
    const rng = new Rng(subSeed(this.seed, 4));
    for (const h of bc.timesH) {
      const t = Math.min(T - 60, Math.round((h * 3600 + rng.range(-bc.jitterMin, bc.jitterMin) * 60) / 60) * 60);
      const exId = rng.int(0, this.excavators.length - 1);
      this.blasts.push(this.makeBlast(exId, t, bc.durationMin * 60, false));
    }
    this.blasts.sort((a, b) => a.t - b.t);
  }

  /** Опасная зона вокруг блока у забоя: экскаваторы и дороги внутри радиуса. */
  private makeBlast(exId: number, t: number, dur: number, manual: boolean): Blast {
    const g = this.layout.graph;
    const ex = this.excavators[exId];
    const pit = this.cfg.pits[this.layout.excavatorPit[exId] ?? 0];
    const l = Math.hypot(ex.x - pit.cx, ex.y - pit.cy) || 1;
    const x = ex.x - ((ex.x - pit.cx) / l) * 90; // взрываемый блок — у забоя, ближе к центру своей выработки
    const y = ex.y - ((ex.y - pit.cy) / l) * 90;
    const radius = this.cfg.blasting.radiusM;
    const inside = (n: number) => Math.hypot(g.nodes[n].x - x, g.nodes[n].y - y) <= radius;
    const exIds = this.excavators.filter((e) => Math.hypot(e.x - x, e.y - y) <= radius).map((e) => e.id);
    if (!exIds.includes(exId)) exIds.push(exId);
    let edges = g.edges.filter((e) => inside(e.a) && inside(e.b)).map((e) => e.id);
    // Остальные объекты должны остаться достижимыми — иначе закрываем только заезды к забоям.
    const others = this.keyNodes().filter((n) => !exIds.some((id) => this.excavators[id].node === n));
    if (!g.allReachable(this.garageNode, others, new Set(edges))) {
      edges = exIds.map((id) => g.edgeBetween(this.excavators[id].accessNode, this.excavators[id].node)!);
    }
    return {
      id: this.blasts.length,
      t,
      dur,
      x,
      y,
      radius,
      exIds,
      edges,
      label: `Взрывные работы у ${ex.name}`,
      manual,
      target: exId,
      phase: 'planned',
    };
  }

  /** Ручной взрыв для демо: объявляется сейчас, взрыв — через inSec. */
  /** Сценарий: отключение электроснабжения на заданное время. */
  injectPowerCut(sec: number): void {
    this.powerCutLeft = Math.max(this.powerCutLeft, sec);
    this.addLog(`✖ Отключение электроснабжения на ~${Math.round(sec / 60)} мин: фабрика, дробилка и электролиз встали`, 'alarm');
    this.strategy.onDisruption?.(this);
  }

  /** Сценарий: ливень или снеготаяние — приток воды в пруд хвостохранилища. */
  injectStormWater(m3PerH: number, sec: number): void {
    this.tailings.stormM3h = m3PerH;
    this.tailings.stormLeft = sec;
    this.addLog(`☔ Приток воды в хвостохранилище ${Math.round(m3PerH)} м³/ч на ~${Math.round(sec / 60)} мин: пруд поднимается`, 'warn');
  }

  /** Сценарий: остановка орошения карт выщелачивания. */
  injectLeachStop(sec: number): void {
    this.leach.holdLeft = Math.max(this.leach.holdLeft, sec);
    this.addLog(`✖ Орошение карт остановлено на ~${Math.round(sec / 60)} мин: раствор на завод не идёт`, 'warn');
  }

  scheduleBlast(exId: number, inSec: number): Blast {
    const b = this.makeBlast(exId, this.now + inSec, this.cfg.blasting.durationMin * 60, true);
    b.id = this.blasts.length;
    this.blasts.push(b);
    this.blasts.sort((a, c) => a.t - c.t);
    return b;
  }

  /** Окно, когда экскаватор будет стоять из-за взрыва (известно по графику), или null. */
  blastWindow(exId: number, from: number): [number, number] | null {
    const ex = this.excavators[exId];
    if (ex.blastLeft > 0) return [this.now, this.now + ex.blastLeft];
    for (const b of this.blasts) {
      if (b.phase === 'done' || b.phase === 'active') continue;
      if (b.exIds.includes(exId) && b.t + b.dur > from) return [b.t, b.t + b.dur];
    }
    return null;
  }

  private processBlasts(): void {
    const warn = this.cfg.blasting.warnMin * 60;
    for (const b of this.blasts) {
      if (b.phase === 'planned' && this.now >= b.t - warn) {
        b.phase = 'warning';
        const names = b.exIds.map((id) => this.excavators[id].name).join(', ');
        this.addLog(`⚠ Объявлены взрывные работы через ${Math.round((b.t - this.now) / 60)} мин: зона у ${names}`, 'warn');
        this.strategy.onDisruption?.(this);
      }
      if (b.phase === 'warning' && this.now >= b.t) {
        // Плановый взрыв — только обуренного блока: иначе переносится на 30 мин (до конца смены).
        if (!b.manual && this.drill.drilled(b.target) < 1) {
          const T = this.cfg.shift.durationSec;
          const done = this.drill.blocks[b.target];
          if (b.t + 1800 > T - 60) {
            b.phase = 'done';
            this.addLog(`Взрыв у ${this.excavators[b.target].name} отменён: блок не обурен (${done.holesDone}/${done.holesTotal} скважин)`, 'alarm');
            this.strategy.onDisruption?.(this);
          } else {
            b.t += 1800;
            // В журнал — только первый перенос, дальше взрыв ждёт добуривания молча.
            if (!this.drill.postponed.has(b.id)) {
              this.drill.postponed.add(b.id);
              this.addLog(`Взрыв у ${this.excavators[b.target].name} перенесён: блок не обурен (${done.holesDone}/${done.holesTotal} скважин) — ждём бурения`, 'warn');
            }
          }
          continue;
        }
        // При сильном ветре и в метель взрывать нельзя: пылегазовое облако сносит.
        if (!this.weather.blastOk) {
          b.t += 1800;
          if (!this.windWarned.has(b.id)) {
            this.windWarned.add(b.id);
            this.addLog(`Взрыв у ${this.excavators[b.target].name} перенесён: ${this.weather.ru}, ветер ${this.weather.windMs.toFixed(0)} м/с`, 'warn');
          }
          continue;
        }
        this.startBlast(b);
      }
      if (b.phase === 'active' && this.now >= b.t + b.dur) b.phase = 'done';
    }
  }

  private startBlast(b: Blast): void {
    b.phase = 'active';
    for (const id of b.exIds) {
      const ex = this.excavators[id];
      // Техника выводится из зоны: самосвал под погрузкой уезжает (с тем, что успел набрать).
      if (ex.loading !== null) {
        const fraction = 1 - ex.loadLeft / Math.max(1, this.loadTotal[ex.id]);
        if (fraction >= 0.3) this.finishLoading(ex, fraction);
        else {
          const t = this.trucks[ex.loading];
          ex.loading = null;
          this.dispatchEmpty(t);
        }
      }
      ex.blastLeft = b.dur;
      if (ex.state !== 'broken') ex.state = 'blast';
      this.strategy.onExcavatorDown?.(this, ex);
    }
    this.closures.push({ edges: b.edges, until: b.t + b.dur, label: b.label });
    this.applyClosures();
    const add = this.drill.blastBlock(b.target);
    if (add > 0) this.addLog(`Взорван блок у ${this.excavators[b.target].name}: +${Math.round(add / 1000)} тыс. т горной массы`, 'info');
    this.addLog(`✸ Взрыв: ${b.label.toLowerCase()}, оцепление ~${Math.round(b.dur / 60)} мин`, 'alarm');
  }

  // ───────────────────────────── публичное API ─────────────────────────────

  /** Если задано — доля интерполяции между кадрами задаётся извне (интерфейс, читающий двойников). */
  alphaOverride: number | null = null;

  get alpha(): number {
    return this.alphaOverride ?? this.acc / this.cfg.shift.tickSec;
  }

  get scheduledEvents(): readonly SimEvent[] {
    return this.events;
  }

  /** Продвинуть модель на simSeconds (дробный остаток копится). Возвращает число выполненных тиков. */
  advance(simSeconds: number, maxTicks = Infinity): number {
    if (this.finished) return 0;
    this.acc += simSeconds;
    const dt = this.cfg.shift.tickSec;
    let n = 0;
    while (this.acc >= dt && !this.finished && n < maxTicks) {
      this.tick();
      this.acc -= dt;
      n++;
    }
    if (n >= maxTicks) this.acc = Math.min(this.acc, dt);
    if (this.finished) this.acc = 0;
    return n;
  }

  /** Прогнать до конца смены (для тестов и бенчмарков). */
  runToEnd(): void {
    while (!this.finished) this.tick();
  }

  /** Работает ли прогноз отказов (только в умной стратегии). */
  get predictive(): boolean {
    return this.strategyName === 'smart' && this.cfg.health.enabledInSmart;
  }

  /** Записать минуту хронологии: состояния машин, бункер, перекрытия дорог. */
  private recordMinute(): void {
    const tl = this.timeline;
    this.trucks.forEach((t, i) => (tl.trucks[i] += TRUCK_CODE[t.state]));
    this.excavators.forEach((e, i) => (tl.excavators[i] += EX_CODE[e.state]));
    const sp = this.stockpile;
    tl.crusher += sp.t <= 0.01 ? 's' : String(Math.min(9, Math.floor((sp.t / sp.capT) * 10)));
    const groups = this.layout.closureGroups;
    tl.closures += String(Math.min(9, this.closures.filter((x) => groups.some((g) => g.label === x.label)).length));
    tl.minutes++;
  }

  /** Отправить самосвал на ППР: сразу, если он порожний, иначе — после разгрузки. */
  requestService(t: Truck): void {
    t.serviceRequested = true;
    if (t.state === 'empty' && t.dest?.kind === 'excavator') this.sendToGarage(t, 'service');
  }

  /** Ручная поломка экскаватора (кнопка «Вызвать поломку»). */
  injectExcavatorBreakdown(exId: number, durSec: number): void {
    this.breakExcavator(this.excavators[exId], durSec, true);
  }

  // ───────────────────────────── отмена сценариев «что если» ─────────────────────────────

  /** Отмена поломки: экскаватор сразу возвращается в работу. */
  repairExcavator(exId: number): boolean {
    const ex = this.excavators[exId];
    if (!ex || ex.state !== 'broken') return false;
    ex.brokenLeft = 0;
    ex.state = ex.blastLeft > 0 ? 'blast' : ex.loading !== null ? 'working' : 'waiting';
    this.addLog(`Отмена сценария: экскаватор ${ex.name} снова в работе`, 'info');
    this.strategy.onDisruption?.(this);
    return true;
  }

  /** Отмена закрытия: участок открывается сразу. */
  openRoad(group: number): boolean {
    const label = this.layout.closureGroups[group]?.label;
    const before = this.closures.length;
    this.closures = this.closures.filter((c) => c.label !== label);
    if (this.closures.length === before) return false;
    this.applyClosures();
    this.addLog(`Отмена сценария: открыт участок ${label}`, 'info');
    return true;
  }

  /** Отмена взрыва: если ещё не взорвали — снимаем с графика, если идёт оцепление — снимаем его. */
  cancelBlast(id: number): boolean {
    const b = this.blasts.find((x) => x.id === id);
    if (!b || b.phase === 'done') return false;
    if (b.phase === 'active') {
      this.closures = this.closures.filter((c) => c.label !== b.label);
      this.applyClosures();
      for (const exId of b.exIds) {
        const ex = this.excavators[exId];
        ex.blastLeft = 0;
        if (ex.state === 'blast') ex.state = 'waiting';
      }
    }
    b.phase = 'done';
    this.addLog(`Отмена сценария: ${b.label.toLowerCase()} отменены`, 'info');
    this.strategy.onDisruption?.(this);
    return true;
  }

  /** Ручное закрытие участка съезда. Возвращает false, если закрытие разорвало бы сеть. */
  injectRoadClosure(group: number, durSec: number): boolean {
    return this.closeRoad(group, durSec, true);
  }

  // ───────────────────────────── основной тик ─────────────────────────────

  tick(): void {
    const dt = this.cfg.shift.tickSec;
    this.now += dt;
    if (Math.floor(this.now / 60) > this.timeline.minutes) this.recordMinute();
    this.equipment.tick();
    this.drill.tick(dt);
    for (const t of this.trucks) {
      t.px = t.x;
      t.py = t.y;
    }

    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.now) {
      const ev = this.events[this.evIdx++];
      if (ev.kind === 'excavatorDown') this.breakExcavator(this.excavators[ev.ex], ev.dur, false);
      else this.closeRoad(ev.group, ev.dur, false);
    }
    this.expireClosures();
    this.processBlasts();

    // Датчики и прогноз отказов.
    const hc = this.cfg.health;
    if (this.now % hc.sensorEverySec === 0) for (const t of this.trucks) updateSensors(this.cfg, this.seed, t, this.now);
    if (this.predictive && this.now % 60 === 0) {
      for (const t of this.trucks) {
        if (runDetector(this.cfg, t, this.now)) {
          this.stats.alerts++;
          const eta = t.health.etaMin;
          this.addLog(`⚡ Прогноз: самосвал ${t.name} — риск отказа ${t.health.risk}%${eta ? `, ~${Math.round(eta)} мин` : ''}. Назначен ППР`, 'warn');
          this.requestService(t);
        }
      }
    }

    this.weather.update(this, dt);
    if (this.powerCutLeft > 0) {
      this.powerCutLeft = Math.max(0, this.powerCutLeft - dt);
      if (this.powerCutLeft === 0) this.addLog('Электроснабжение восстановлено: фабрика, дробилка и электролиз запускаются', 'info');
    }
    this.crush(dt);
    this.feedPlant(dt);
    this.concentrate.update(this, dt);
    this.leach.update(this, dt);
    this.tailings.update(this, dt);
    this.chain2.update(this, dt);
    this.energy.update(this, dt);
    this.buildLaneOccupancy();
    for (const t of this.trucks) this.updateTruck(t, dt);
    for (const ex of this.excavators) this.updateExcavator(ex, dt);
    for (const d of this.dumps) this.updateDump(d, dt);
    this.layoutQueues();

    if (this.now % this.cfg.shift.historyEverySec === 0) this.recordHistory();
    if (this.now >= this.cfg.shift.durationSec) {
      this.finished = true;
      this.addLog('Смена завершена', 'info');
    }
  }

  // ───────────────────────────── самосвалы ─────────────────────────────

  /** Состояние для учёта времени: погрузка у сломанного экскаватора считается ожиданием. */
  private accountingState(t: Truck): TruckState {
    if (t.state === 'loading' && t.dest?.kind === 'excavator' && this.excavators[t.dest.id].state !== 'working') return 'queue';
    return t.state;
  }

  private fuelRate(s: TruckState): number {
    const tc = this.cfg.truck;
    switch (s) {
      case 'loaded':
        return tc.fuelLoadedLph;
      case 'empty':
        return tc.fuelEmptyLph;
      case 'queue':
      case 'loading':
      case 'dumping':
      case 'idle':
        return tc.fuelIdleLph;
      default:
        return 0;
    }
  }

  private updateTruck(t: Truck, dt: number): void {
    if (t.state === 'idle' && this.now < t.departAt) return; // ещё в гараже, двигатель заглушен

    const acc = this.accountingState(t);
    t.stateSec[acc] += dt;
    this.fatigueTick(t, dt);
    const rate = this.fuelRate(t.state);
    if (rate > 0) {
      // Стиль водителя: в движении расход зависит от плавности езды.
      const moving = t.state === 'empty' || t.state === 'loaded';
      const used = ((rate * dt) / 3600) * (moving ? t.driver.fuelFactor : 1);
      if (moving) t.driverStats.fuelUsedL += used;
      t.fuelL = Math.max(0, t.fuelL - used);
      this.stats.fuelL += used;
      t.engineH += dt / 3600;
      t.serviceInH -= dt / 3600;
    }

    switch (t.state) {
      case 'idle':
        this.dispatchEmpty(t);
        break;
      case 'empty':
      case 'loaded': {
        if (t.breakdowns.length > 0 && this.now >= t.breakdowns[0].t) {
          const { dur } = t.breakdowns.shift()!;
          t.resumeState = t.state;
          t.state = 'broken';
          t.timer = dur;
          this.stats.unplannedFailures++;
          resetHealth(t);
          this.addLog(`Поломка самосвала ${t.name} (ремонт ~${Math.round(dur / 60)} мин)`, 'alarm');
          break;
        }
        const g = this.layout.graph;
        const ei = t.seg < t.path.length - 1 ? g.edgeBetween(t.path[t.seg], t.path[t.seg + 1]) : undefined;
        const onRamp = ei !== undefined && g.edges[ei].kind === 'ramp';
        const want = (t.state === 'loaded' ? this.speedLoaded : this.speedEmpty) * t.speedFactor * this.weather.speedFactor * (onRamp ? t.driver.rampSkill : 1) * dt;
        const free = this.freeDistance(t);
        const step = Math.min(want, free);
        this.move(t, step);
        this.driveStats(t, step, dt, onRamp, free < want * 0.5);
        break;
      }
      case 'broken':
        t.timer -= dt;
        if (t.timer <= 0) {
          t.state = t.resumeState ?? 'empty';
          t.resumeState = null;
          this.addLog(`Самосвал ${t.name} отремонтирован`, 'info');
        }
        break;
      case 'refuel':
      case 'service':
        t.timer -= dt;
        if (t.timer <= 0) {
          t.fuelL = this.cfg.truck.fuelTankL;
          if (t.state === 'service') {
            resetHealth(t);
            this.addLog(`Самосвал ${t.name}: ППР завершён, отказ предотвращён`, 'info');
          }
          this.dispatchEmpty(t);
        }
        break;
      default:
        break; // queue / loading / dumping обслуживаются экскаваторами и пунктами разгрузки
    }
  }

  /** Назначить порожний самосвал (после разгрузки, заправки или выезда). */
  dispatchEmpty(t: Truck): void {
    t.loadT = 0;
    t.material = null;
    const order = this.manual.get(t.id);
    if (order?.kind === 'hold') {
      // Приказ «стоять»: доезжает до своего места на стоянке и глушит двигатель до отмены приказа.
      if (t.dest?.kind === 'garage' && t.node === this.destinationNode(t.dest)) {
        t.state = 'idle';
        t.departAt = Infinity;
        return;
      }
      this.sendToGarage(t, 'refuel');
      t.state = 'empty';
      return;
    }
    this.releaseSlot(t); // выезжает со стоянки — место свободно
    if (t.serviceRequested) {
      this.sendToGarage(t, 'service');
      t.state = 'empty';
      return;
    }
    if (t.fuelL < this.cfg.truck.refuelThreshold * this.cfg.truck.fuelTankL) {
      this.sendToGarage(t, 'refuel');
      t.state = 'empty';
      return;
    }
    const manualEx = order?.kind === 'excavator' && this.excavators[order.id] && this.excavators[order.id].state !== 'broken' ? order.id : null;
    const exId = manualEx ?? this.strategy.choose(this, t);
    this.setDestination(t, { kind: 'excavator', id: exId });
    t.state = 'empty';
  }

  /**
   * Приказ диспетчера самосвалу. order = null — вернуть под управление системы.
   * Порожний в пути перенаправляется сразу; гружёный выполнит приказ после разгрузки.
   */
  applyManual(truckId: number, order: ManualOrder | 'refuel' | null): string {
    const t = this.trucks[truckId];
    if (!t) return '';
    if (order === 'refuel') {
      if (t.state === 'empty' || t.state === 'idle') {
        if (t.state === 'idle') t.departAt = this.now;
        this.releaseSlot(t);
        this.sendToGarage(t, 'refuel');
        t.state = 'empty';
      } else t.fuelL = Math.min(t.fuelL, this.cfg.truck.refuelThreshold * this.cfg.truck.fuelTankL - 1); // заедет после разгрузки
      this.addLog(`Диспетчер: самосвал ${t.name} — на заправку`, 'info');
      return `${t.name} → заправка`;
    }
    const wasHold = this.manual.get(truckId)?.kind === 'hold';
    if (order) this.manual.set(truckId, order);
    else this.manual.delete(truckId);
    if (wasHold && order?.kind !== 'hold' && t.state === 'idle') t.departAt = this.now; // выезжает со стоянки
    if (order?.kind === 'excavator' && t.state === 'empty' && t.dest?.kind === 'excavator' && t.dest.id !== order.id) {
      t.homeEx = order.id;
      this.setDestination(t, { kind: 'excavator', id: order.id });
    }
    if (order?.kind === 'hold' && t.state === 'empty' && t.dest?.kind === 'excavator') {
      this.sendToGarage(t, 'refuel');
    }
    const what = !order ? 'под управление системы' : order.kind === 'hold' ? 'стоять на стоянке' : `к ${this.excavators[order.id].name}`;
    this.addLog(`Диспетчер: самосвал ${t.name} — ${what}`, 'info');
    return `${t.name} → ${what}`;
  }

  destinationNode(dest: Destination): number {
    switch (dest.kind) {
      case 'excavator':
        return this.excavators[dest.id].node;
      case 'dump':
        return this.dumps[dest.id].node;
      case 'garage':
        return this.layout.parking.slots[dest.slot];
    }
  }

  /** Узел, от которого считать маршрут, и сколько осталось доехать до него. */
  routeOrigin(t: Truck): { node: number; extra: number } {
    if (t.seg < t.path.length - 1) {
      const e = this.layout.graph.edgeBetween(t.path[t.seg], t.path[t.seg + 1])!;
      return { node: t.path[t.seg + 1], extra: this.layout.graph.edges[e].len - t.segPos };
    }
    return { node: t.node, extra: 0 };
  }

  remainingDistance(t: Truck): number {
    const g = this.layout.graph;
    let d = -t.segPos;
    for (let i = t.seg; i + 1 < t.path.length; i++) d += g.edges[g.edgeBetween(t.path[i], t.path[i + 1])!].len;
    return Math.max(0, d);
  }

  setDestination(t: Truck, dest: Destination): void {
    t.dest = dest;
    t.destNode = this.destinationNode(dest);
    t.rerouteFlag = false;
    if (t.seg < t.path.length - 1) {
      // Едем по ребру — дорулим до его конца и дальше по новому маршруту.
      const a = t.path[t.seg];
      const b = t.path[t.seg + 1];
      const r = this.router.route(b, t.destNode);
      t.path = r ? [a, ...r] : [a, b];
      t.seg = 0;
      if (!r) t.rerouteFlag = true;
    } else {
      const r = this.router.route(t.node, t.destNode);
      t.path = r ?? [t.node];
      t.seg = 0;
      t.segPos = 0;
      if (!r) t.rerouteFlag = true;
    }
  }

  private tryReroute(t: Truck): boolean {
    const r = this.router.route(t.node, t.destNode);
    t.seg = 0;
    t.segPos = 0;
    if (r) {
      t.path = r;
      t.rerouteFlag = false;
      return true;
    }
    t.path = [t.node];
    t.rerouteFlag = true;
    return false;
  }

  // ───────────────────────────── дистанция между самосвалами ─────────────────────────────

  /** Кто едет по каждой полосе (направленному ребру) и где — снимок на начало тика. */
  private readonly lanes = new Map<number, { id: number; pos: number }[]>();

  private laneKey(a: number, b: number): number {
    return a * 1_000_003 + b;
  }

  private buildLaneOccupancy(): void {
    this.lanes.clear();
    for (const t of this.trucks) {
      // Сломанный самосвал съезжает на обочину и движение не перекрывает.
      if ((t.state !== 'empty' && t.state !== 'loaded') || t.seg >= t.path.length - 1) continue;
      const key = this.laneKey(t.path[t.seg], t.path[t.seg + 1]);
      let list = this.lanes.get(key);
      if (!list) this.lanes.set(key, (list = []));
      list.push({ id: t.id, pos: t.segPos });
    }
  }

  /** Сколько можно проехать, не приблизившись к впереди идущему ближе minGapM (смотрим вперёд ~400 м). */
  private freeDistance(t: Truck): number {
    const g = this.layout.graph;
    const gap = this.cfg.truck.minGapM;
    let best = Infinity;
    let d0 = -t.segPos;
    for (let i = t.seg; i < t.path.length - 1 && d0 < 400; i++) {
      const a = t.path[i];
      const b = t.path[i + 1];
      const list = this.lanes.get(this.laneKey(a, b));
      if (list) {
        for (const o of list) {
          if (o.id === t.id) continue;
          // На своём ребре учитываем только тех, кто впереди (при равенстве — по номеру).
          if (i === t.seg && (o.pos < t.segPos || (o.pos === t.segPos && o.id > t.id))) continue;
          best = Math.min(best, d0 + o.pos);
        }
      }
      if (best < Infinity) break;
      d0 += g.edges[g.edgeBetween(a, b)!].len;
    }
    return best === Infinity ? Infinity : Math.max(0, best - gap);
  }

  /**
   * Усталость водителя по камере в кабине (диагностика, как на Актогае — «система контроля усталости
   * водителей»): растёт за рулём, снижается на заправке, ремонте и стоянке. При высокой усталости камера
   * фиксирует эпизоды закрытых глаз; двойник пишет в журнал рекомендацию паузы. На движение не влияет.
   */
  private fatigueTick(t: Truck, dt: number): void {
    const s = t.driverStats;
    const rng = this.fatigueRng[t.id];
    if (!rng) return;
    const driving = t.state === 'empty' || t.state === 'loaded' || t.state === 'loading' || t.state === 'dumping';
    const rest = t.state === 'refuel' || t.state === 'service' || t.state === 'broken' || t.state === 'idle';
    if (driving) s.fatigue = Math.min(100, s.fatigue + (s.fatigueRate * dt) / 3600);
    else if (rest) s.fatigue = Math.max(0, s.fatigue - (25 * dt) / 3600);
    else s.fatigue = Math.max(0, s.fatigue - (3 * dt) / 3600); // очередь: сидит в кабине, почти не отдыхает
    s.fatigueCooldown = Math.max(0, s.fatigueCooldown - dt);
    const moving = t.state === 'empty' || t.state === 'loaded';
    if (moving && s.fatigue > 55 && s.fatigueCooldown <= 0 && rng.next() < 0.00005 * (s.fatigue - 55) * dt) {
      s.fatigueEvents++;
      s.fatigueCooldown = 120;
    }
    const alert = s.fatigue >= FATIGUE_ALERT || (s.fatigueEvents > 0 && s.fatigueCooldown > 118);
    if (alert && this.now - s.fatigueLoggedAt > 3 * 3600) {
      s.fatigueLoggedAt = this.now;
      this.addLog(`Водитель ${t.driver.name} (${t.name}): признаки усталости по камере (${Math.round(s.fatigue)} %${s.fatigueEvents ? `, эпизодов ${s.fatigueEvents}` : ''}) — рекомендована пауза 15 мин`, 'warn');
    }
  }

  /** Телеметрия водителя: пробег, съезды, резкие торможения (акселерометр рамы), предупреждения CAS. */
  private driveStats(t: Truck, step: number, dt: number, onRamp: boolean, forcedSlow: boolean): void {
    const s = t.driverStats;
    s.distM += step;
    // CAS: машина впереди ближе безопасной дистанции — предупреждение в кабину (не чаще раза в 30 с).
    s.casCooldown = Math.max(0, s.casCooldown - dt);
    if (forcedSlow && s.casCooldown <= 0) {
      s.cas++;
      s.casCooldown = 30;
    }
    if (onRamp) {
      s.rampSec += dt;
      s.rampDistM += step;
    }
    s.harshCooldown = Math.max(0, s.harshCooldown - dt);
    if (s.harshCooldown > 0) return;
    const rng = this.driverRng[t.id];
    const lack = 1 - t.driver.safety; // 0.02…0.45
    // Резко тормозит, догнав впереди идущего, или на спуске с грузом.
    const p = (forcedSlow ? 0.25 * lack : 0) + (onRamp && t.state === 'loaded' ? 0.004 * lack * dt : 0) + 0.0004 * lack * dt;
    if (rng.next() < p) {
      s.harsh++;
      s.harshCooldown = 45;
    }
  }

  private move(t: Truck, dist: number): void {
    const g = this.layout.graph;
    let guard = 0;
    while (guard++ < 200) {
      if (t.seg >= t.path.length - 1) {
        if (t.node === t.destNode) {
          this.arrive(t);
          return;
        }
        if (!this.tryReroute(t)) break; // путь закрыт — ждём открытия
        continue;
      }
      if (dist <= 0) break;
      const e = g.edges[g.edgeBetween(t.path[t.seg], t.path[t.seg + 1])!];
      const rem = e.len - t.segPos;
      if (dist < rem) {
        t.segPos += dist;
        dist = 0;
      } else {
        dist -= rem;
        t.seg++;
        t.segPos = 0;
        t.node = t.path[t.seg];
        if (t.seg < t.path.length - 1) {
          const next = g.edgeBetween(t.path[t.seg], t.path[t.seg + 1])!;
          if (t.rerouteFlag || this.router.closed.has(next)) this.tryReroute(t);
        }
      }
    }
    this.placeOnPath(t);
  }

  private placeOnPath(t: Truck): void {
    const g = this.layout.graph;
    if (t.seg < t.path.length - 1) {
      const a = g.nodes[t.path[t.seg]];
      const b = g.nodes[t.path[t.seg + 1]];
      const len = g.edges[g.edgeBetween(a.id, b.id)!].len;
      const f = len > 0 ? t.segPos / len : 0;
      t.x = a.x + (b.x - a.x) * f;
      t.y = a.y + (b.y - a.y) * f;
    } else {
      t.x = g.nodes[t.node].x;
      t.y = g.nodes[t.node].y;
    }
  }

  private arrive(t: Truck): void {
    const dest = t.dest!;
    t.path = [t.node];
    t.seg = 0;
    t.segPos = 0;
    t.queuedSince = this.now;
    if (dest.kind === 'excavator') {
      this.excavators[dest.id].queue.push(t.id);
      t.state = 'queue';
    } else if (dest.kind === 'dump') {
      this.dumps[dest.id].queue.push(t.id);
      t.state = 'queue';
    } else if (dest.purpose === 'service' && t.breakdowns.length > 0) {
      // Плановый ремонт по прогнозу: короче аварийного, неисправность устранена до отказа.
      const f = t.breakdowns.shift()!;
      const hc = this.cfg.health;
      t.state = 'service';
      t.timer = Math.max(hc.plannedRepairMinMin * 60, f.dur * hc.plannedRepairShare);
      t.serviceRequested = false;
      this.stats.preventedFailures++;
    } else {
      // Заправка (или ППР по ложной тревоге — тогда только осмотр на время заправки).
      if (dest.purpose === 'service') {
        this.stats.falseAlarms++;
        this.addLog(`Самосвал ${t.name}: осмотр по тревоге — неисправность не найдена (ложная тревога)`, 'info');
      }
      t.state = dest.purpose === 'service' ? 'service' : 'refuel';
      t.timer = this.cfg.truck.refuelMin * 60;
      t.serviceRequested = false;
    }
  }

  // ───────────────────────────── экскаваторы ─────────────────────────────

  expectedLoadTime(ex: Excavator): number {
    return this.cfg.excavator.spotMin * 60 + (this.cfg.truck.payloadT / ex.rateTpm) * 60;
  }

  private loadTime(ex: Excavator, t: Truck): number {
    const noise = 1 + this.cfg.excavator.loadNoise * (2 * hash01(this.seed, t.id, t.trips, ex.id) - 1);
    return Math.round(this.expectedLoadTime(ex) * noise);
  }

  private updateExcavator(ex: Excavator, dt: number): void {
    ex.queueIntegral += ex.queue.length * dt;
    if (ex.blastLeft > 0) {
      ex.blastSec += dt;
      ex.blastLeft -= dt;
      if (ex.blastLeft <= 0) {
        ex.blastLeft = 0;
        if (ex.state === 'blast') ex.state = 'waiting';
        this.addLog(`Оцепление снято: экскаватор ${ex.name} снова в работе`, 'info');
        this.strategy.onDisruption?.(this);
      }
    }
    if (ex.state === 'broken') {
      ex.brokenSec += dt;
      ex.brokenLeft -= dt;
      if (ex.brokenLeft <= 0) {
        ex.state = ex.blastLeft > 0 ? 'blast' : ex.loading !== null ? 'working' : 'waiting';
        this.addLog(`Экскаватор ${ex.name} снова в работе`, 'info');
        this.strategy.onDisruption?.(this);
      }
      return;
    }
    if (ex.blastLeft > 0) {
      ex.state = 'blast';
      return;
    }
    if (ex.loading !== null) {
      ex.busySec += dt;
      ex.loadLeft -= dt;
      if (ex.loadLeft <= 0) this.finishLoading(ex, 1);
    }
    // Нечего грузить: запас взорванной горной массы у забоя кончился — ждём взрыва блока.
    if (ex.loading === null && this.drill.stockT[ex.id] <= 0) {
      ex.idleSec += dt;
      if (ex.state !== 'nostock') {
        ex.state = 'nostock';
        this.addLog(`Экскаватор ${ex.name}: кончилась взорванная горная масса — ждёт взрыва обуренного блока`, 'alarm');
        this.strategy.onExcavatorDown?.(this, ex);
      }
      return;
    }
    if (ex.state === 'nostock') {
      this.addLog(`Экскаватор ${ex.name}: есть взорванная масса, погрузка возобновлена`, 'info');
      this.strategy.onDisruption?.(this);
    }
    if (ex.loading === null && ex.queue.length > 0) {
      const t = this.trucks[ex.queue.shift()!];
      this.stats.exQueueSec += this.now - t.queuedSince;
      this.stats.exLoadsStarted++;
      ex.loading = t.id;
      ex.loadLeft = this.loadTime(ex, t);
      this.loadTotal[ex.id] = ex.loadLeft;
      t.state = 'loading';
    }
    if (ex.loading === null) ex.idleSec += dt;
    ex.state = ex.loading !== null ? 'working' : 'waiting';
  }

  /** Завершить погрузку (fraction < 1 — досрочная отправка недогруженного самосвала). */
  finishLoading(ex: Excavator, fraction: number): void {
    if (ex.loading === null) return;
    const t = this.trucks[ex.loading];
    ex.loading = null;
    ex.loadLeft = 0;
    const load = Math.round(this.cfg.truck.payloadT * fraction);
    t.loadT = load;
    t.material = ex.material;
    const noise = this.cfg.grade.loadNoisePct * (2 * hash01(this.seed, t.id, t.trips, ex.id, 77) - 1);
    t.gradePct = ex.gradeBase > 0 ? Math.max(0.05, gradeAt(ex, this.now) + noise) : 0;
    ex.tonnes += load;
    ex.loads++;
    this.drill.consume(ex.id, load);
    this.setDestination(t, { kind: 'dump', id: this.dumpFor(t, ex) });
    t.state = 'loaded';
  }

  private breakExcavator(ex: Excavator, durSec: number, manual: boolean): void {
    if (ex.state === 'broken') {
      ex.brokenLeft = Math.max(ex.brokenLeft, durSec);
      return;
    }
    ex.state = 'broken';
    ex.brokenLeft = durSec;
    this.addLog(
      `${manual ? 'Вызвана поломка' : 'Поломка'}: экскаватор ${ex.name} (${MATERIAL_SHORT[ex.material]}), ремонт ~${Math.round(durSec / 60)} мин`,
      'alarm',
    );
    this.strategy.onExcavatorDown?.(this, ex);
  }

  /** Убрать самосвал из очереди экскаватора (используется умной стратегией). */
  removeFromExcavatorQueue(ex: Excavator): number[] {
    return ex.queue.splice(0);
  }

  // ───────────────────────────── пункты разгрузки ─────────────────────────────

  get crusher(): DumpSite {
    return this.dumps[0];
  }

  /** Среднее содержание меди в бункере дробилки, % (идеальное перемешивание). */
  get binGrade(): number {
    const c = this.crusher;
    return c.binT > 1e-6 ? (c.binCuT / c.binT) * 100 : this.cfg.grade.targetPct;
  }

  /** Содержание меди в руде, которую фабрика забирает со склада, %. */
  get feedGrade(): number {
    const s = this.stockpile;
    return s.t > 1e-6 ? (s.cuT / s.t) * 100 : this.cfg.grade.targetPct;
  }

  /** Руда, доступная фабрике: приёмный бункер + склад, т. */
  get oreBufferT(): number {
    return this.crusher.binT + this.stockpile.t;
  }

  /** Дробилка: перегрузка из приёмного бункера на склад (пока склад не полон). */
  private crush(dt: number): void {
    const c = this.crusher;
    const s = this.stockpile;
    // Без электричества дробилка стоит: самосвалы продолжают разгружаться, бункер наполняется.
    if (this.powerCutLeft > 0) {
      s.crushing = false;
      s.lastIn = 0;
      return;
    }
    // В мороз сырая и подмёрзшая руда зависает в приёмном бункере — дробилка выдаёт меньше.
    const move = Math.min(c.binT, ((this.cfg.dumps.crusher.crusherTpm * this.weather.crusherFactor) / 60) * dt, Math.max(0, s.capT - s.t));
    s.crushing = move > 1e-6;
    s.lastIn = move / dt;
    if (move <= 0) return;
    const cu = c.binT > 1e-6 ? (c.binCuT * move) / c.binT : 0;
    c.binT -= move;
    c.binCuT = Math.max(0, c.binCuT - cu);
    if (c.binT <= 1e-6) c.binCuT = 0;
    s.t += move;
    s.cuT += cu;
    s.inflowT += move;
  }

  private feedPlant(dt: number): void {
    const c = this.crusher;
    const s = this.stockpile;
    if (this.powerCutLeft > 0) return; // фабрика обесточена
    // Нельзя сбрасывать хвосты — нельзя и перерабатывать: запас до гребня дамбы ниже нормы.
    // Гистерезис: останавливаем ниже нормы, запускаем только когда откачали с запасом.
    const free = this.tailings.freeboardM;
    if (!this.damStopped && free < FREEBOARD_MIN_M) {
      this.damStopped = true;
      this.addLog(`Фабрика остановлена: запас до гребня дамбы ${free.toFixed(2)} м — намыв хвостов приостановлен`, 'alarm');
    } else if (this.damStopped && free > FREEBOARD_MIN_M + 0.2) {
      this.damStopped = false;
      this.addLog(`Запас до гребня восстановлен откачкой (${free.toFixed(2)} м) — фабрика запускается`, 'info');
    }
    if (this.damStopped) return;
    const need = (this.cfg.dumps.crusher.plantFeedTpm / 60) * dt;
    const grade = this.feedGrade;
    const fed = Math.min(s.t, need);
    if (s.t >= need) s.t -= need;
    else {
      // Склад пуст — фабрика стоит (учитывается как простой дробильно-обогатительного передела).
      c.starvedSec += dt * (1 - s.t / need);
      s.t = 0;
    }
    if (fed > 0) {
      const cu = (fed * grade) / 100;
      const r = recovery(this.cfg, grade);
      s.cuT = Math.max(0, s.cuT - cu);
      const st = this.stats;
      st.plantFeedT += fed;
      st.cuFeedT += cu;
      st.cuConcT += cu * r;
      st.cuLossT += cu * (this.cfg.grade.recoveryMax - r);
      st.feedSec += dt * (fed / need);
      if (inBand(this.cfg, grade)) st.feedInBandSec += dt * (fed / need);
    }
    if (s.t <= 1e-6) s.cuT = 0;
  }

  private updateDump(d: DumpSite, dt: number): void {
    for (let i = d.active.length - 1; i >= 0; i--) {
      const a = d.active[i];
      a.left -= dt;
      if (a.left <= 0) {
        d.active.splice(i, 1);
        const t = this.trucks[a.truck];
        d.tonnes += t.loadT;
        this.stats.mined[d.material] += t.loadT;
        if (d.kind === 'crusher') {
          d.binT += t.loadT;
          d.binCuT += (t.loadT * t.gradePct) / 100;
        }
        t.tonnes += t.loadT;
        t.trips++;
        this.dispatchEmpty(t);
      }
    }
    while (d.active.length < d.bays && d.queue.length > 0) {
      const t = this.trucks[d.queue[0]];
      if (d.kind === 'crusher') {
        const pending = d.active.reduce((s, a) => s + this.trucks[a.truck].loadT, 0);
        if (d.binT + pending + t.loadT > d.binCapT) break; // бункер полон — ждём
      }
      d.queue.shift();
      d.active.push({ truck: t.id, left: d.dumpTimeSec });
      t.state = 'dumping';
      this.stats.dumpQueueSec += this.now - t.queuedSince;
    }
  }

  // ───────────────────────────── дороги ─────────────────────────────

  private keyNodes(): number[] {
    return [...this.excavators.map((e) => e.node), ...this.dumps.map((d) => d.node), this.garageNode];
  }

  private closeRoad(group: number, durSec: number, manual: boolean): boolean {
    const g = this.layout.closureGroups[group];
    if (this.closures.some((c) => c.label === g.label)) return false;
    const closed = new Set(this.router.closed);
    for (const e of g.edges) closed.add(e);
    if (!this.layout.graph.allReachable(this.garageNode, this.keyNodes(), closed)) return false;
    this.closures.push({ edges: g.edges, until: this.now + durSec, label: g.label });
    this.applyClosures();
    this.addLog(`${manual ? 'Перекрыт' : 'Закрыт участок'}: ${g.label} (~${Math.round(durSec / 60)} мин)`, 'warn');
    return true;
  }

  private expireClosures(): void {
    const before = this.closures.length;
    const open = this.closures.filter((c) => c.until <= this.now);
    if (open.length === 0) return;
    this.closures = this.closures.filter((c) => c.until > this.now);
    for (const c of open) this.addLog(`Открыт участок: ${c.label}`, 'info');
    if (this.closures.length !== before) this.applyClosures();
  }

  private applyClosures(): void {
    this.router.setClosed(this.closures.flatMap((c) => c.edges));
    for (const t of this.trucks) if (t.state === 'empty' || t.state === 'loaded' || t.state === 'broken') t.rerouteFlag = true;
    this.strategy.onDisruption?.(this);
  }

  // ───────────────────────────── визуальная раскладка очередей ─────────────────────────────

  private layoutQueues(): void {
    const g = this.layout.graph;
    const place = (ids: number[], from: { x: number; y: number }, toward: number, start: number, step: number) => {
      const a = g.nodes[toward];
      const dx = a.x - from.x;
      const dy = a.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      ids.forEach((id, k) => {
        const t = this.trucks[id];
        t.x = from.x + (dx / len) * (start + k * step);
        t.y = from.y + (dy / len) * (start + k * step);
      });
    };
    for (const ex of this.excavators) {
      if (ex.loading !== null) place([ex.loading], ex, ex.accessNode, 14, 0);
      place(ex.queue, ex, ex.accessNode, 42, 26);
    }
    for (const d of this.dumps) {
      const a = g.nodes[d.accessNode];
      const dx = a.x - d.x;
      const dy = a.y - d.y;
      const len = Math.hypot(dx, dy) || 1;
      d.active.forEach((act, k) => {
        const t = this.trucks[act.truck];
        const off = (k - (d.bays - 1) / 2) * 30;
        t.x = d.x + (-dy / len) * off + (dx / len) * 20;
        t.y = d.y + (dx / len) * off + (dy / len) * 20;
      });
      place(d.queue, d, d.accessNode, 60, 26);
    }
  }

  // ───────────────────────────── стоянка ─────────────────────────────

  get parking() {
    return this.layout.parking;
  }

  parkingFrame() {
    return this.layout.parking.frame;
  }

  parkingSlot(k: number): { x: number; y: number } {
    const n = this.layout.graph.nodes[this.layout.parking.slots[k % this.layout.parking.slots.length]];
    return { x: n.x, y: n.y };
  }

  /** Кто стоит (или едет) на каждом месте стоянки. */
  readonly slotOccupant: (number | null)[] = [];

  private releaseSlot(t: Truck): void {
    if (t.parkSlot !== null) {
      if (this.slotOccupant[t.parkSlot] === t.id) this.slotOccupant[t.parkSlot] = null;
      t.parkSlot = null;
    }
  }

  /** Отправить в гараж: бронируем свободное место на стоянке и едем на него. */
  sendToGarage(t: Truck, purpose: 'refuel' | 'service'): void {
    if (t.parkSlot === null) {
      let slot = this.slotOccupant.findIndex((o) => o === null);
      if (slot < 0) slot = t.id % this.layout.parking.slots.length;
      this.slotOccupant[slot] = t.id;
      t.parkSlot = slot;
    }
    this.setDestination(t, { kind: 'garage', purpose, slot: t.parkSlot });
  }

  // ───────────────────────────── история и журнал ─────────────────────────────

  get minedTotal(): number {
    return MATERIALS.reduce((s, m) => s + this.stats.mined[m], 0);
  }

  private recordHistory(): void {
    const total = this.minedTotal;
    const tMin = this.now / 60;
    const pointsPerHour = 3600 / this.cfg.shift.historyEverySec;
    const ref = this.history.length >= pointsPerHour ? this.history[this.history.length - pointsPerHour] : null;
    const tph = ref ? total - ref.minedTotal : this.now > 0 ? (total / this.now) * 3600 : 0;
    this.history.push({
      tMin,
      tph,
      minedTotal: total,
      mined: { ...this.stats.mined },
      binT: this.crusher.binT,
      stockT: this.stockpile.t,
      queues: this.excavators.map((e) => e.queue.length),
      feedGrade: this.stockpile.t > 1 ? this.feedGrade : null,
    });
  }

  addLog(text: string, level: LogEntry['level']): void {
    this.log.push({ t: this.now, text, level });
    if (this.log.length > 100) this.log.shift();
  }
}
