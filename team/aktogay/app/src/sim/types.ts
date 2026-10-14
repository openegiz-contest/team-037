import type { DriverStats, DriverTraits } from './drivers';
/** Базовые типы движка симуляции. Модуль не зависит от React. */

export type Material = 'sulfide' | 'oxide' | 'waste';
export const MATERIALS: readonly Material[] = ['sulfide', 'oxide', 'waste'];

export const MATERIAL_LABEL: Record<Material, string> = {
  sulfide: 'Сульфидная руда',
  oxide: 'Оксидная руда',
  waste: 'Вскрыша',
};

export const MATERIAL_SHORT: Record<Material, string> = {
  sulfide: 'Сульфид',
  oxide: 'Оксид',
  waste: 'Вскрыша',
};

export type StrategyName = 'fixed' | 'smart';

export const STRATEGY_LABEL: Record<StrategyName, string> = {
  fixed: 'Без системы',
  smart: 'С системой',
};

/**
 * Состояния самосвала:
 * idle — простой (ожидание выезда / назначения), empty — порожний рейс,
 * queue — в очереди (у экскаватора или пункта разгрузки), loading — погрузка,
 * loaded — гружёный рейс, dumping — разгрузка, refuel — заправка,
 * service — плановый предупредительный ремонт (ППР) по прогнозу отказа, broken — аварийная поломка.
 */
export type TruckState = 'idle' | 'empty' | 'queue' | 'loading' | 'loaded' | 'dumping' | 'refuel' | 'service' | 'broken';

export const TRUCK_STATES: readonly TruckState[] = [
  'loading',
  'loaded',
  'dumping',
  'empty',
  'queue',
  'idle',
  'refuel',
  'service',
  'broken',
];

export const TRUCK_STATE_LABEL: Record<TruckState, string> = {
  idle: 'Простой',
  empty: 'Порожний рейс',
  queue: 'В очереди',
  loading: 'Погрузка',
  loaded: 'Гружёный рейс',
  dumping: 'Разгрузка',
  refuel: 'Заправка',
  service: 'ППР (по прогнозу)',
  broken: 'Поломка',
};

/** Продуктивные состояния — для коэффициента использования. */
export const PRODUCTIVE_STATES: readonly TruckState[] = ['loading', 'loaded', 'dumping', 'empty'];

export type DumpKind = 'crusher' | 'leach' | 'waste';

export type Destination =
  | { kind: 'excavator'; id: number }
  | { kind: 'dump'; id: number }
  | { kind: 'garage'; purpose: 'refuel' | 'service'; slot: number };

/** Тип неисправности определяет, какой датчик «дрейфует» перед отказом. */
export type FailureType = 'engine' | 'hydraulic' | 'tyre';

export const FAILURE_LABEL: Record<FailureType, string> = {
  engine: 'перегрев двигателя',
  hydraulic: 'износ гидравлики / подвески',
  tyre: 'утечка давления в шине',
};

/** Заранее сгенерированная (из seed) неисправность самосвала. */
export interface PlannedFailure {
  /** Время отказа, с от начала смены. */
  t: number;
  /** Длительность аварийного ремонта, с. */
  dur: number;
  /** За сколько секунд до отказа начинается деградация (0 — внезапный отказ без признаков). */
  precursor: number;
  type: FailureType;
}

export interface Sensors {
  /** Измеренная температура двигателя, °C. */
  tempC: number;
  /** Ожидаемая температура по тепловой модели двойника для текущего режима, °C. */
  expectedTempC: number;
  /** Истинная температура (внутреннее состояние модели). */
  coreC: number;
  /** Вибрация рамы, мм/с. */
  vibration: number;
  /** Давление в шинах (среднее), бар. */
  tyreBar: number;
  /** Последний час, раз в минуту: [измерено °C, ожидается °C, вибрация мм/с]. */
  log: [number, number, number][];
}

export interface Health {
  /** Индекс деградации 0…1 (1 — отказ), сглаженный. */
  score: number;
  /** Вероятность отказа в ближайший час, %. */
  risk: number;
  /** Прогноз времени до отказа, мин (null — нет тренда). */
  etaMin: number | null;
  alert: boolean;
  alertAt: number | null;
  /** Доминирующий признак. */
  sign: FailureType | null;
  /** История индекса (раз в минуту) для тренда. */
  history: number[];
}

export type ExcavatorState = 'working' | 'waiting' | 'broken' | 'blast' | 'nostock';

export interface Truck {
  id: number;
  name: string;
  state: TruckState;
  /** Маршрут — список узлов графа; движемся по ребру path[seg] → path[seg+1]. */
  path: number[];
  seg: number;
  segPos: number;
  /** Последний пройденный узел. */
  node: number;
  x: number;
  y: number;
  /** Позиция на предыдущем тике — для плавной интерполяции на экране. */
  px: number;
  py: number;
  dest: Destination | null;
  destNode: number;
  loadT: number;
  material: Material | null;
  /** Содержание меди в кузове, %. */
  gradePct: number;
  fuelL: number;
  engineH: number;
  serviceInH: number;
  trips: number;
  tonnes: number;
  /** Закреплённый экскаватор (для фиксированной стратегии). */
  fixedEx: number;
  /** Текущая «петля» самосвала в умной стратегии (может меняться в течение смены). */
  homeEx: number;
  /** Индивидуальный коэффициент скорости (техсостояние, водитель). */
  speedFactor: number;
  stateSec: Record<TruckState, number>;
  /** Оставшееся время заправки/ремонта, с. */
  timer: number;
  resumeState: TruckState | null;
  /** Неисправности, которые случатся, если их не предупредить. */
  breakdowns: PlannedFailure[];
  sensors: Sensors;
  health: Health;
  /** Безобидная аномалия (жара, грязный радиатор) — источник ложных тревог. */
  benign: { start: number; dur: number; ampC: number } | null;
  /** Умная система запросила ППР — после разгрузки ехать в гараж. */
  serviceRequested: boolean;
  /** Занятое (или забронированное) место на стоянке. */
  parkSlot: number | null;
  departAt: number;
  queuedSince: number;
  rerouteFlag: boolean;
  /** Водитель смены и его телеметрия (см. drivers.ts). */
  driver: DriverTraits;
  driverStats: DriverStats;
}

export interface Excavator {
  id: number;
  name: string;
  material: Material;
  rateTpm: number;
  node: number;
  /** Узел дороги, к которому примыкает забой (для раскладки очереди). */
  accessNode: number;
  x: number;
  y: number;
  state: ExcavatorState;
  queue: number[];
  loading: number | null;
  loadLeft: number;
  brokenLeft: number;
  tonnes: number;
  loads: number;
  busySec: number;
  idleSec: number;
  brokenSec: number;
  /** Остаток остановки на время взрывных работ, с. */
  blastLeft: number;
  blastSec: number;
  /** Содержание Cu в забое: база, амплитуда и период волны (неоднородность рудного тела). */
  gradeBase: number;
  gradeAmp: number;
  gradePeriodSec: number;
  gradePhase: number;
  /** Интеграл длины очереди по времени (самосвало-секунды). */
  queueIntegral: number;
}

export interface DumpSite {
  id: number;
  kind: DumpKind;
  name: string;
  material: Material;
  node: number;
  accessNode: number;
  x: number;
  y: number;
  bays: number;
  dumpTimeSec: number;
  queue: number[];
  active: { truck: number; left: number }[];
  tonnes: number;
  /** Только для дробилки: бункер перед фабрикой. */
  binT: number;
  binCapT: number;
  /** Только для дробилки: время, когда фабрика стоит без руды, с. */
  starvedSec: number;
  /** Только для дробилки: тонн меди в бункере (для среднего содержания). */
  binCuT: number;
}

export interface HistoryPoint {
  tMin: number;
  tph: number;
  minedTotal: number;
  mined: Record<Material, number>;
  binT: number;
  /** Руда на складе, т. */
  stockT: number;
  queues: number[];
  /** Содержание Cu в питании фабрики, % (null — фабрика стоит). */
  feedGrade: number | null;
}

export interface SimStats {
  mined: Record<Material, number>;
  /** Аварийные (внеплановые) отказы самосвалов. */
  unplannedFailures: number;
  /** Отказы, предотвращённые плановым ремонтом по прогнозу. */
  preventedFailures: number;
  /** Тревоги прогноза (включая ещё не подтверждённые). */
  alerts: number;
  /** ППР по тревоге, при осмотре неисправность не найдена. */
  falseAlarms: number;
  /** Питание фабрики: тонн руды, тонн меди в ней, меди в концентрате, потери меди из-за качества. */
  plantFeedT: number;
  cuFeedT: number;
  cuConcT: number;
  cuLossT: number;
  /** Время работы фабрики и из него — с качеством питания в целевом коридоре, с. */
  feedSec: number;
  feedInBandSec: number;
  fuelL: number;
  exQueueSec: number;
  exLoadsStarted: number;
  dumpQueueSec: number;
}

/** Взрывные работы: блок у забоя взрывают по графику, зону оцепляют. */
export interface Blast {
  id: number;
  /** Время взрыва, с от начала смены. Объявляется заранее (предупреждение — за warnMin). */
  t: number;
  /** Длительность оцепления (зона закрыта, экскаваторы стоят), с. */
  dur: number;
  x: number;
  y: number;
  radius: number;
  exIds: number[];
  edges: number[];
  label: string;
  manual: boolean;
  /** Экскаватор, у забоя которого взрывают блок. */
  target: number;
  phase: 'planned' | 'warning' | 'active' | 'done';
}

export interface RoadClosure {
  edges: number[];
  until: number;
  label: string;
}

export type SimEvent =
  | { t: number; kind: 'excavatorDown'; ex: number; dur: number }
  | { t: number; kind: 'roadClose'; group: number; dur: number };

export interface LogEntry {
  t: number;
  text: string;
  level: 'info' | 'warn' | 'alarm';
}
