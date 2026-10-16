/**
 * ЕДИНЫЙ КОНФИГ цифрового двойника карьера Актогай.
 *
 * Модель построена по мотивам открытых данных о медном месторождении Актогай (Восточный Казахстан).
 * ВСЕ числовые значения ниже — ОЦЕНКА, сверить с открытыми источниками (годовые отчёты KAZ Minerals).
 * Операционные данные (поломки, очереди, расход) смоделированы и не являются данными предприятия.
 *
 * Моделируется не весь карьер, а «сегмент» парка: 10–30 самосвалов и 5 экскаваторов,
 * поэтому план смены и производительность фабрики масштабированы под этот сегмент.
 */
import type { Material } from './types';

export interface ExcavatorSpec {
  name: string;
  material: Material;
  /** Производительность погрузки, т/мин. */
  rateTpm: number;
  /** Среднее содержание меди в забое, % (0 — вскрыша). Оценка. */
  gradePct: number;
  /** Индекс кольцевой дороги-бермы (1 — верхняя, 3 — дно карьера). */
  ring: number;
  /** Угол расположения забоя на берме, градусы (0 — восток, 90 — юг на экране). */
  angleDeg: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SimConfig {
  shift: {
    /** Длительность смены, с (12 ч). */
    durationSec: number;
    /** Шаг симуляции, с. Фиксированный — для детерминизма. */
    tickSec: number;
    /** Интервал записи истории для графиков, с. */
    historyEverySec: number;
  };
  pit: {
    /** Полуоси карьера по бровке, м. Оценка: карьер вытянутой формы ~3 × 1.6 км. */
    semiMajorM: number;
    semiMinorM: number;
    /** Число уступов (для отрисовки). */
    benchCount: number;
    /** Масштаб дна относительно бровки. */
    bottomScale: number;
    /** Сколько витков делает спиральный съезд от бровки до дна. */
    rampTurns: number;
    /** Число узлов на каждом съезде (шаг 0.05 по глубине). */
    rampNodes: number;
    /** Уровни кольцевых берм в долях глубины (0 — бровка, 1 — дно). Должны попадать в узлы съезда. */
    ringLevels: number[];
    /** Узлов на каждом кольце (чётное число). */
    ringNodes: number;
  };
  /** Поверхностные объекты, м (центр карьера — 0,0). */
  sites: {
    crusher: Point;
    plant: Point;
    leach: Point;
    waste: Point;
    garage: Point;
  };
  truck: {
    /** Грузоподъёмность, т (класс CAT 793, как основной парк Актогая). */
    payloadT: number;
    speedLoadedKmh: number;
    speedEmptyKmh: number;
    /** Разброс скорости между машинами (техсостояние, водитель) — источник «сбивания в пачки». */
    speedFactorRange: [number, number];
    /** Объём бака, л. Оценка. */
    fuelTankL: number;
    /** Расход, л/ч: гружёный / порожний / работа двигателя на холостом ходу. Оценка. */
    fuelLoadedLph: number;
    fuelEmptyLph: number;
    fuelIdleLph: number;
    /** Доля топлива, при которой самосвал после разгрузки едет на заправку. */
    refuelThreshold: number;
    refuelMin: number;
    /** Ресурс до ТО на начало смены (диапазон), моточасы. */
    serviceIntervalH: [number, number];
    /** Вероятность поломки самосвала за смену. Оценка. */
    breakdownProbPerShift: number;
    repairMin: [number, number];
    /** Интервал выезда из гаража в начале смены, с. */
    departIntervalSec: number;
    /** Минимальная дистанция до впереди идущего самосвала на той же полосе, м (безопасность + габарит). */
    minGapM: number;
  };
  /** Взрывные работы. */
  blasting: {
    /** Время плановых взрывов, ч от начала смены (обычно в обед — меньше потерь рабочего времени). */
    timesH: number[];
    /** Разброс времени взрыва, ± мин. */
    jitterMin: number;
    /** Оцепление после взрыва (зона закрыта, экскаваторы стоят), мин. */
    durationMin: number;
    /** Радиус опасной зоны, м. Оценка. */
    radiusM: number;
    /** За сколько минут объявляется взрыв. */
    warnMin: number;
  };
  /** Качество руды и обогащение. */
  grade: {
    /** Целевое содержание меди в питании фабрики, %. Оценка. */
    targetPct: number;
    /** Допустимое отклонение от цели, ± п.п. */
    bandPct: number;
    /** Амплитуда изменения содержания в забое по ходу отработки, ± п.п. */
    faceAmpPct: number;
    /** Период изменения содержания в забое, ч. */
    facePeriodH: [number, number];
    /** Разброс содержания от ковша к ковшу, ± п.п. */
    loadNoisePct: number;
    /** Извлечение меди в концентрат при идеальном питании (доля). Оценка. */
    recoveryMax: number;
    /** Падение извлечения на 1 п.п. отклонения содержания от цели. Оценка. */
    recoveryPenaltyPerPct: number;
  };
  /** Датчики и прогноз отказов самосвалов. */
  health: {
    /** Доля отказов, перед которыми есть признаки деградации (остальные внезапные). */
    predictableShare: number;
    /** Длительность деградации перед отказом, мин. */
    precursorMin: [number, number];
    /** Период опроса датчиков, с. */
    sensorEverySec: number;
    /** Порог индекса деградации для тревоги. */
    alertScore: number;
    /** Плановый ремонт (ППР) короче аварийного: доля от длительности аварийного. */
    plannedRepairShare: number;
    plannedRepairMinMin: number;
    /** Вероятность безобидной температурной аномалии у самосвала за смену (ложные тревоги). */
    benignProbPerShift: number;
    /** Включён ли прогноз отказов в умной стратегии. */
    enabledInSmart: boolean;
  };
  excavators: ExcavatorSpec[];
  excavator: {
    /** Время установки самосвала под погрузку, мин. */
    spotMin: number;
    /** Разброс времени погрузки, ± доля. */
    loadNoise: number;
    /** Ожидаемое число поломок экскаваторов за смену (на весь парк). */
    breakdownsPerShift: number;
    repairMin: [number, number];
  };
  dumps: {
    crusher: {
      bays: number;
      dumpMin: number;
      binCapT: number;
      binInitialT: number;
      plantFeedTpm: number;
      /** Производительность дробилки (бункер → склад), т/мин. */
      crusherTpm: number;
      /** Склад дроблёной руды: активная (забираемая питателями) ёмкость и запас на начало смены, т. */
      stockpileCapT: number;
      stockpileInitialT: number;
    };
    leach: { bays: number; dumpMin: number };
    waste: { bays: number; dumpMin: number };
  };
  /** План смены по материалам, т. Масштабирован под моделируемый сегмент парка. Оценка. */
  planT: Record<Material, number>;
  roads: {
    /** Ожидаемое число временных закрытий участков съездов за смену. */
    closuresPerShift: number;
    closureMin: [number, number];
  };
  smart: {
    /** Горизонт прогноза плана, мин. */
    planHorizonMin: number;
    /** Вес отставания от плана (эквивалент секунд выигрыша). */
    planWeightSec: number;
    /** Вес отставания экскаватора от целевой доли потока, с за 1 недогруженный рейс. */
    shareWeightSec: number;
    /** Мёртвая зона по доле, рейсов: меньшие отклонения не корректируются. */
    shareDeadbandLoads: number;
    /** Вес выравнивания качества руды на фабрике, с. */
    gradeWeightSec: number;
    /** Вес угрозы простоя дробилки, с. */
    crusherWeightSec: number;
    /** Порог «низкого» бункера дробилки, т. */
    binLowT: number;
    /** Горизонт прогноза бункера, мин. */
    binHorizonMin: number;
    /** Порог выигрыша для перезакрепления самосвала на другой экскаватор, с. */
    stickinessSec: number;
    /** Минимальный выигрыш для смены цели в пути, с. */
    switchGainSec: number;
  };
  economics: {
    /** Цена дизельного топлива, ₸/л. Оценка. */
    dieselKztPerL: number;
    /** Стоимость часа простоя самосвала (амортизация, зарплата, накладные), ₸/ч. Оценка. */
    truckIdleKztPerH: number;
    /** Стоимость часа простоя экскаватора, ₸/ч. Оценка. */
    excavatorIdleKztPerH: number;
    /** Стоимость часа простоя дробилки = остановка обогатительной фабрики (упущенная выручка), ₸/ч. Оценка. Самая дорогая потеря. */
    crusherDowntimeKztPerH: number;
    /** Стоимость аварийного ремонта самосвала (эвакуация, запчасти, вторичные повреждения), ₸. Оценка. */
    unplannedRepairKzt: number;
    /** Стоимость планового ремонта по прогнозу, ₸. Оценка. */
    plannedRepairKzt: number;
    /** Цена меди в концентрате (за вычетом переработки), ₸/т. Оценка. */
    copperKztPerT: number;
    /** Число 12-часовых смен в году с учётом плановых остановов. */
    shiftsPerYear: number;
  };
}

export const DEFAULT_CONFIG: SimConfig = {
  shift: {
    durationSec: 12 * 3600,
    tickSec: 1,
    historyEverySec: 300,
  },
  pit: {
    semiMajorM: 1500, // оценка, сверить с открытыми источниками (годовые отчёты KAZ Minerals)
    semiMinorM: 800, // оценка
    benchCount: 16, // уступы по 15 м при глубине ~240 м (визуально)
    bottomScale: 0.2,
    rampTurns: 0.8,
    rampNodes: 21,
    ringLevels: [0, 0.35, 0.7, 1.0],
    ringNodes: 36,
  },
  sites: {
    crusher: { x: 1850, y: -300 }, // первичная дробилка у восточного борта
    plant: { x: 2200, y: -760 }, // обогатительная фабрика (только визуально)
    leach: { x: -250, y: -1150 }, // площадка кучного выщелачивания (север)
    waste: { x: -1900, y: 330 }, // отвал вскрыши (запад)
    garage: { x: 650, y: 1060 }, // гараж / АЗС (юг)
  },
  truck: {
    payloadT: 220, // класс CAT 793 (на Актогае 17 × CAT 793 и 18 × CAT 785 — открытые источники)
    speedLoadedKmh: 20,
    speedEmptyKmh: 35,
    speedFactorRange: [0.85, 1.08],
    fuelTankL: 3400, // оценка
    fuelLoadedLph: 230, // оценка
    fuelEmptyLph: 130, // оценка
    fuelIdleLph: 45, // оценка
    refuelThreshold: 0.15,
    refuelMin: 12,
    serviceIntervalH: [40, 480],
    breakdownProbPerShift: 0.2, // оценка
    repairMin: [25, 70],
    departIntervalSec: 30,
    minGapM: 70,
  },
  blasting: {
    timesH: [6], // один плановый взрыв в обеденный перерыв (6-й час 12-часовой смены)
    jitterMin: 10,
    durationMin: 30,
    radiusM: 240,
    warnMin: 15,
  },
  grade: {
    targetPct: 0.35, // оценка, сверить с открытыми источниками (годовые отчёты KAZ Minerals)
    bandPct: 0.03,
    faceAmpPct: 0.05,
    facePeriodH: [3, 6],
    loadNoisePct: 0.02,
    recoveryMax: 0.88, // оценка
    recoveryPenaltyPerPct: 0.8, // оценка: отклонение на 0,05 п.п. Cu → извлечение ниже на 4 п.п.
  },
  health: {
    predictableShare: 0.75, // оценка: часть отказов внезапные
    precursorMin: [60, 120],
    sensorEverySec: 10,
    alertScore: 0.22,
    plannedRepairShare: 0.35,
    plannedRepairMinMin: 15,
    benignProbPerShift: 0.12, // оценка
    enabledInSmart: true,
  },
  excavators: [
    // Сульфидная руда — в глубоких горизонтах, основной поток на дробилку → ОФ.
    // Глубокий забой богаче, верхний беднее — их нужно смешивать (шихтовать). Оценка.
    { name: 'Э-1', material: 'sulfide', rateTpm: 44, gradePct: 0.42, ring: 3, angleDeg: 20 },
    { name: 'Э-2', material: 'sulfide', rateTpm: 44, gradePct: 0.29, ring: 2, angleDeg: 215 },
    // Оксидная руда — верхние горизонты (зона окисления) → кучное выщелачивание
    { name: 'Э-3', material: 'oxide', rateTpm: 38, gradePct: 0.3, ring: 1, angleDeg: 140 },
    // Вскрыша → отвал
    { name: 'Э-4', material: 'waste', rateTpm: 50, gradePct: 0, ring: 1, angleDeg: 300 },
    { name: 'Э-5', material: 'waste', rateTpm: 50, gradePct: 0, ring: 2, angleDeg: 70 },
  ],
  excavator: {
    spotMin: 0.6,
    loadNoise: 0.2,
    breakdownsPerShift: 2.0, // оценка
    repairMin: [40, 120],
  },
  dumps: {
    // оценка: склад ~1,5 ч работы фабрики (масштабирован под сегмент парка), дробилка быстрее фабрики в 1,6 раза
    crusher: { bays: 1, dumpMin: 1.2, binCapT: 1000, binInitialT: 1000, plantFeedTpm: 50, crusherTpm: 80, stockpileCapT: 4500, stockpileInitialT: 2700 },
    leach: { bays: 2, dumpMin: 1.0 },
    waste: { bays: 3, dumpMin: 0.8 },
  },
  planT: {
    sulfide: 36000, // оценка: = потребность фабрики за смену (50 т/мин × 12 ч), масштабировано под сегмент парка
    oxide: 18000,
    waste: 56000,
  },
  roads: {
    closuresPerShift: 1.5,
    closureMin: [30, 70],
  },
  smart: {
    planHorizonMin: 30,
    planWeightSec: 240,
    shareWeightSec: 150,
    shareDeadbandLoads: 2,
    crusherWeightSec: 900,
    gradeWeightSec: 240,
    binLowT: 700,
    binHorizonMin: 35,
    stickinessSec: 120,
    switchGainSec: 90,
  },
  economics: {
    dieselKztPerL: 310, // оценка, ₸/л
    truckIdleKztPerH: 45_000, // оценка
    excavatorIdleKztPerH: 120_000, // оценка
    crusherDowntimeKztPerH: 15_000_000, // оценка: упущенная выручка при остановке ОФ
    unplannedRepairKzt: 3_500_000, // оценка
    plannedRepairKzt: 1_000_000, // оценка
    copperKztPerT: 3_500_000, // оценка: ~$9 000/т Cu × курс, минус затраты на переработку
    shiftsPerYear: 670, // 2 смены × 365 дней × ~92% готовности
  },
};

/** Глубокая копия конфига с частичным переопределением верхнего уровня. */
export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  const base: SimConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return { ...base, ...overrides };
}
