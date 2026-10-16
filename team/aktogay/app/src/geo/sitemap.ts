/**
 * Схема горно-обогатительного комбината для раздела «Карта ГОК».
 *
 * Объекты карьера и переработки, которые есть в модели (карьер, дробилка, склад, ОФ-1, выщелачивание,
 * отвал, гараж), стоят там же, где в модели и 3D-сцене, и показывают живые данные. Остальные здания
 * комбината — условная схема по открытым данным о Актогае: состав объектов реальный, расположение и
 * размеры — нет. Числа без ссылки на источник — оценки.
 */
import type { BuildingKind } from '../render3d/MineScene';
import type { Simulation } from '../sim';

export type Layer = 'pit' | 'process' | 'waste' | 'infra' | 'utility' | 'transport';

export const LAYERS: { key: Layer; label: string; color: string }[] = [
  { key: 'pit', label: 'Карьер и техника', color: '#d6a35c' },
  { key: 'process', label: 'Переработка', color: '#f59e0b' },
  { key: 'waste', label: 'Отвалы и хвосты', color: '#8b8f98' },
  { key: 'infra', label: 'Инфраструктура', color: '#60a5fa' },
  { key: 'utility', label: 'Энергия и вода', color: '#22d3ee' },
  { key: 'transport', label: 'Дороги и ж/д', color: '#e5e7eb' },
];

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rot?: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'poly'; pts: [number, number][] };

export interface SiteObject {
  id: string;
  name: string;
  layer: Layer;
  shape: Shape;
  fill: string;
  /** Есть в модели и 3D-сцене (живые данные), или только на схеме. */
  live: boolean;
  /** Описание: что это и зачем. */
  about: string;
  /** Характеристики (статические). */
  facts: string[];
  /** Живые показатели из модели. */
  metrics?: (sim: Simulation) => [string, string][];
  /** «Что внутри» — мнемосхема здания. */
  building?: BuildingKind;
  /** Двойник в Ditto (имя без пространства имён). */
  twin?: string;
  /** Подпись (по умолчанию — name). */
  label?: string;
  /** Подпись под фигурой, а не над ней. */
  labelBelow?: boolean;
}

export interface SiteLine {
  id: string;
  name: string;
  layer: Layer;
  kind: 'conveyor' | 'pipe' | 'water' | 'solution' | 'power' | 'rail' | 'road';
  pts: [number, number][];
}

export const LINE_STYLE: Record<SiteLine['kind'], { color: string; width: number; dash?: string; label: string }> = {
  conveyor: { color: '#f59e0b', width: 9, label: 'конвейер' },
  pipe: { color: '#a3a3a3', width: 6, dash: '18 10', label: 'пульпопровод хвостов' },
  water: { color: '#38bdf8', width: 5, dash: '10 8', label: 'водовод' },
  solution: { color: '#2dd4bf', width: 5, dash: '6 6', label: 'растворы выщелачивания' },
  power: { color: '#facc15', width: 3, dash: '30 12 4 12', label: 'ЛЭП' },
  rail: { color: '#e5e7eb', width: 7, dash: '24 12', label: 'железная дорога' },
  road: { color: '#cbb48a', width: 14, label: 'технологическая дорога' },
};

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/** Объекты и линии схемы в координатах модели (м; x — восток, y — юг). */
export function buildSiteMap(sim: Simulation): { objects: SiteObject[]; lines: SiteLine[] } {
  const S = sim.cfg.sites;
  const cr = S.crusher;
  const pl = S.plant;
  // Склад дроблёной руды — там же, где в 3D-сцене: сбоку от линии дробилка → фабрика.
  const dx = pl.x - cr.x, dy = pl.y - cr.y, d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d;
  const mx = cr.x + dx * 0.4, my = cr.y + dy * 0.4;
  if (Math.hypot(mx + nx, my + ny) < Math.hypot(mx - nx, my - ny)) {
    nx = -nx;
    ny = -ny;
  }
  const sp = { x: mx + nx * 210, y: my + ny * 210 };
  const pl2 = { x: pl.x + 480, y: pl.y - 260 };
  const tsf = { x: pl.x + 1200, y: pl.y - 1300 };
  const sx = { x: S.leach.x - 850, y: S.leach.y - 560 };
  const ponds = { x: S.leach.x + 120, y: S.leach.y - 560 };
  const conc = { x: pl.x + 1150, y: pl.y + 420 };
  const sub = { x: pl.x - 900, y: pl.y - 900 };
  const water = { x: pl.x + 380, y: pl.y - 1250 };
  const magazine = { x: S.waste.x - 700, y: S.leach.y - 900 };
  const g = S.garage;
  const rmc = { x: g.x + 560, y: g.y + 120 };
  const abk = { x: g.x + 950, y: g.y - 230 };
  const lab = { x: g.x + 1450, y: g.y - 700 };
  const gsm = { x: g.x - 430, y: g.y + 330 };
  const camp = { x: g.x + 2050, y: g.y + 520 };
  const kpp = { x: g.x + 1500, y: g.y + 230 };
  const lowgrade = { x: S.waste.x + 380, y: S.leach.y + 60 };

  const crusher = sim.crusher;
  const objects: SiteObject[] = [
    // ── карьер ──
    {
      id: 'pit',
      name: 'Карьер Актогай',
      layer: 'pit',
      shape: { kind: 'circle', x: 0, y: 0, r: 0 }, // рисуется контуром уступов отдельно
      fill: '#000',
      live: true,
      about: 'Открытый карьер: уступы, спиральные съезды, забои экскаваторов, буровые блоки. Здесь работают самосвалы, экскаваторы и буровые станки модели.',
      facts: ['≈ 3 × 1,6 км по бровке, глубина до ~240 м (у реального — до ~230 м)', '5 экскаваторов, буровые станки БУ-1 и БУ-2', 'на реальном карьере — более 100 единиц горной техники'],
      metrics: (s) => [
        ['Добыто за смену', `${fmt(s.minedTotal)} т`],
        ['Самосвалов в работе', String(s.trucks.filter((t) => t.state !== 'idle').length)],
        ['Экскаваторов грузит', String(s.excavators.filter((e) => e.loading !== null).length)],
      ],
      twin: 'mine',
    },
    // ── переработка ──
    {
      id: 'crusher',
      name: 'Первичная дробилка ККД',
      layer: 'process',
      shape: { kind: 'rect', x: cr.x, y: cr.y, w: 130, h: 100, rot: 20 },
      fill: '#b45309',
      live: true,
      about: 'Самосвалы разгружают сульфидную руду в приёмный бункер; конусная дробилка дробит её и отсыпает конвейером на склад.',
      facts: ['конусные дробилки — более 4 тыс. т руды в час каждая (открытые источники)', 'приёмный бункер 1000 т (модель)'],
      metrics: () => [
        ['Приёмный бункер', `${fmt(crusher.binT)} т`],
        ['Очередь самосвалов', String(sim.dumps[0]?.queue.length ?? 0)],
      ],
      building: 'crusher',
      twin: 'crusher',
      label: 'Дробилка ККД',
      labelBelow: true,
    },
    {
      id: 'stockpile',
      name: 'Склад дроблёной руды',
      layer: 'process',
      shape: { kind: 'circle', x: sp.x, y: sp.y, r: 130 },
      fill: '#a16207',
      live: true,
      about: 'Конусный штабель — буфер между дробилкой и фабриками: фабрика забирает руду питателями из тоннеля под штабелем.',
      facts: ['активная ёмкость 4500 т — около 1,5 ч работы фабрики (модель)'],
      metrics: (s) => [
        ['На складе', `${fmt(s.stockpile.t)} т`],
        ['Запас для фабрики', `${(s.stockpile.t / (s.cfg.dumps.crusher.plantFeedTpm * 60)).toFixed(1)} ч`],
      ],
      building: 'stockpile',
      twin: 'stockpile',
      label: 'Склад руды',
    },
    {
      id: 'plant1',
      name: 'Обогатительная фабрика №1 (Актогай-1)',
      layer: 'process',
      shape: { kind: 'rect', x: pl.x, y: pl.y, w: 360, h: 210, rot: -30 },
      fill: '#78350f',
      live: true,
      about: 'Измельчение (мельница ПСИ и шаровые мельницы), флотация, сгущение: из руды ~0,35 % Cu получается медный концентрат ~25 % Cu.',
      facts: ['25 млн т руды в год (открытые источники)', 'мельница ПСИ 28 МВт и шаровые мельницы 22 МВт с безредукторным приводом', 'первая отгрузка концентрата — 2017 г.'],
      metrics: (s) => [
        ['Cu в питании', `${s.feedGrade.toFixed(3)} %`],
        ['Медь в концентрате за смену', `${s.stats.cuConcT.toFixed(1)} т`],
        ['Простой без руды', `${(s.crusher.starvedSec / 60).toFixed(1)} мин`],
      ],
      building: 'plant',
      twin: 'plant',
      label: 'ОФ-1',
    },
    {
      id: 'plant2',
      name: 'Обогатительная фабрика №2 (Актогай-2)',
      layer: 'process',
      shape: { kind: 'rect', x: pl2.x, y: pl2.y, w: 360, h: 210, rot: -30 },
      fill: '#5b2a0b',
      live: false,
      about: 'Вторая сульфидная фабрика той же мощности; запуск удвоил переработку сульфидной руды. В модели не участвует: моделируется сегмент парка, питающий одну фабрику.',
      facts: ['25 млн т руды в год, запущена в 2021 г. (открытые источники)', 'вместе с ОФ-1 — 50 млн т в год; рекорд 2025 г. — 62,1 млн т руды', 'попутно — молибденовый передел (молибденовый концентрат)'],
      label: 'ОФ-2',
    },
    {
      id: 'conc',
      name: 'Склад концентрата и ж/д погрузка',
      layer: 'process',
      shape: { kind: 'rect', x: conc.x, y: conc.y, w: 260, h: 110, rot: 0 },
      fill: '#92400e',
      live: false,
      about: 'Медный концентрат после сушки хранится в крытом складе и грузится в вагоны для отправки потребителям.',
      facts: ['концентрат ~25 % Cu (открытые источники)', 'отгрузка по железной дороге'],
      label: 'Склад концентрата',
    },
    {
      id: 'leach',
      name: 'Площадка кучного выщелачивания',
      layer: 'process',
      shape: { kind: 'rect', x: S.leach.x, y: S.leach.y, w: 520, h: 300, rot: 0 },
      fill: '#115e59',
      live: true,
      about: 'Оксидную руду отсыпают штабелями и орошают раствором серной кислоты; медь переходит в раствор (PLS).',
      facts: ['оксидная руда из верхних горизонтов карьера (зона окисления)'],
      metrics: (s) => [['Отсыпано за смену', `${fmt(s.dumps.find((x) => x.material === 'oxide')?.tonnes ?? 0)} т`]],
      building: 'leach',
      twin: 'heap-leach',
      label: 'Кучное выщелачивание',
    },
    {
      id: 'ponds',
      name: 'Пруды растворов (PLS и рафинат)',
      layer: 'process',
      shape: { kind: 'rect', x: ponds.x, y: ponds.y, w: 220, h: 110, rot: 0 },
      fill: '#0e7490',
      live: false,
      about: 'Продуктивный раствор с площадки собирается в пруд и идёт на экстракцию; обеднённый раствор (рафинат) возвращается на орошение.',
      facts: ['замкнутый цикл растворов'],
      label: 'Пруды PLS',
    },
    {
      id: 'sxew',
      name: 'Оксидный завод SX-EW (катодная медь)',
      layer: 'process',
      shape: { kind: 'rect', x: sx.x, y: sx.y, w: 300, h: 150, rot: 0 },
      fill: '#134e4a',
      live: false,
      about: 'Жидкостная экстракция (SX) и электролиз (EW): из раствора осаждается катодная медь.',
      facts: ['катодная медь 99,99 % (открытые источники)', 'мощность порядка 25 тыс. т катодов в год (оценка по открытым данным)'],
      label: 'Завод SX-EW',
    },
    // ── отвалы и хвосты ──
    {
      id: 'waste',
      name: 'Отвал вскрыши',
      layer: 'waste',
      shape: { kind: 'circle', x: S.waste.x, y: S.waste.y, r: 330 },
      fill: '#57534e',
      live: true,
      about: 'Пустая порода из карьера отсыпается ярусами.',
      facts: ['коэффициент вскрыши у Актогая низкий (открытые источники)'],
      metrics: (s) => [['Отсыпано за смену', `${fmt(s.dumps.find((x) => x.material === 'waste')?.tonnes ?? 0)} т`]],
      building: 'waste',
      twin: 'waste-dump',
    },
    {
      id: 'lowgrade',
      name: 'Склад забалансовой руды',
      layer: 'waste',
      shape: { kind: 'circle', x: lowgrade.x, y: lowgrade.y, r: 170 },
      fill: '#6b5b3e',
      live: false,
      about: 'Руда с содержанием ниже бортового, но выше пустой породы: складируется отдельно на будущее (при росте цены меди её переработают).',
      facts: ['типичное решение для медно-порфировых месторождений'],
      label: 'Забалансовая руда',
      labelBelow: true,
    },
    {
      id: 'tsf',
      name: 'Хвостохранилище',
      layer: 'waste',
      shape: {
        kind: 'poly',
        pts: [
          [tsf.x - 760, tsf.y - 420],
          [tsf.x + 520, tsf.y - 560],
          [tsf.x + 820, tsf.y + 120],
          [tsf.x + 420, tsf.y + 620],
          [tsf.x - 640, tsf.y + 520],
        ],
      },
      fill: '#3f4a52',
      live: false,
      about: 'Отходы флотации (хвосты) по пульпопроводу уходят в хвостохранилище; осветлённая вода возвращается на фабрики.',
      facts: ['ограждающая дамба, пруд-отстойник, оборотное водоснабжение'],
      label: 'Хвостохранилище',
    },
    // ── инфраструктура ──
    {
      id: 'garage',
      name: 'Гараж, АЗС и стоянка самосвалов',
      layer: 'infra',
      shape: { kind: 'rect', x: g.x, y: g.y, w: 300, h: 160, rot: 0 },
      fill: '#1e3a8a',
      live: true,
      about: 'Стоянка по местам, колонки АЗС, ремонтные боксы для планового ремонта по прогнозу отказов.',
      facts: ['3 ремонтных бокса и 2 колонки АЗС (модель)'],
      metrics: (s) => [
        ['На заправке', String(s.trucks.filter((t) => t.state === 'refuel').length)],
        ['В ремонте (ППР)', String(s.trucks.filter((t) => t.state === 'service').length)],
      ],
      building: 'garage',
      twin: 'garage',
      label: 'Гараж / АЗС',
    },
    {
      id: 'rmc',
      name: 'Ремонтно-механический цех и склад запчастей',
      layer: 'infra',
      shape: { kind: 'rect', x: rmc.x, y: rmc.y, w: 240, h: 120, rot: 0 },
      fill: '#1e40af',
      live: false,
      about: 'Капитальный ремонт узлов, шиномонтаж карьерных самосвалов, склад запчастей.',
      facts: ['шина карьерного самосвала класса CAT 793 — одна из крупнейших статей расходов'],
      label: 'РМЦ',
    },
    {
      id: 'abk',
      name: 'Административный корпус и диспетчерская',
      layer: 'infra',
      shape: { kind: 'rect', x: abk.x, y: abk.y, w: 200, h: 120, rot: 0 },
      fill: '#1d4ed8',
      live: false,
      about: 'Управление рудником, горная диспетчерская (система диспетчеризации, пульт смены), медпункт для предсменного осмотра.',
      facts: ['на реальном Актогае — диспетчерская система Hexagon (открытые источники)', 'около 3500 сотрудников, более 500 человек в смену (открытые источники)'],
      label: 'АБК и диспетчерская',
    },
    {
      id: 'lab',
      name: 'Химическая лаборатория',
      layer: 'infra',
      shape: { kind: 'rect', x: lab.x, y: lab.y, w: 140, h: 90, rot: 0 },
      fill: '#2563eb',
      live: false,
      about: 'Пробоподготовка и анализ проб: керн разведочных скважин, шлам взрывных скважин, руда и концентрат.',
      facts: ['источник данных для блочной модели и рудного контроля (раздел «Геология»)'],
      label: 'Лаборатория',
      labelBelow: true,
    },
    {
      id: 'gsm',
      name: 'Склад ГСМ',
      layer: 'infra',
      shape: { kind: 'rect', x: gsm.x, y: gsm.y, w: 170, h: 110, rot: 0 },
      fill: '#3730a3',
      live: false,
      about: 'Резервуары дизельного топлива для карьерной техники, наливная эстакада.',
      facts: ['бак самосвала — 3400 л (модель)'],
      label: 'Склад ГСМ',
    },
    {
      id: 'magazine',
      name: 'Склад взрывчатых материалов',
      layer: 'infra',
      shape: { kind: 'rect', x: magazine.x, y: magazine.y, w: 140, h: 90, rot: 0 },
      fill: '#7f1d1d',
      live: false,
      about: 'Хранение ВВ и средств взрывания для буровзрывных работ; вынесен далеко от объектов, вокруг — охранная зона.',
      facts: ['охранная зона на схеме — условная'],
      label: 'Склад ВМ',
    },
    {
      id: 'camp',
      name: 'Вахтовый посёлок',
      layer: 'infra',
      shape: { kind: 'rect', x: camp.x, y: camp.y, w: 380, h: 240, rot: 0 },
      fill: '#334155',
      live: false,
      about: 'Общежития, столовая, спортзал для работников вахты.',
      facts: ['работа круглосуточно, сменами'],
      label: 'Вахтовый посёлок',
    },
    {
      id: 'kpp',
      name: 'КПП и автовесы',
      layer: 'infra',
      shape: { kind: 'rect', x: kpp.x, y: kpp.y, w: 110, h: 60, rot: 0 },
      fill: '#475569',
      live: false,
      about: 'Въезд на территорию комбината, контроль доступа, взвешивание грузового транспорта.',
      facts: [],
      label: 'КПП',
    },
    // ── энергия и вода ──
    {
      id: 'sub',
      name: 'Главная понизительная подстанция',
      layer: 'utility',
      shape: { kind: 'rect', x: sub.x, y: sub.y, w: 160, h: 110, rot: 0 },
      fill: '#854d0e',
      live: false,
      about: 'Питание мельниц, дробилки, конвейеров, электролиза и карьерных сетей.',
      facts: ['основные потребители — мельницы фабрик (десятки МВт)'],
      label: 'Подстанция',
    },
    {
      id: 'water',
      name: 'Резервуары технической воды',
      layer: 'utility',
      shape: { kind: 'circle', x: water.x, y: water.y, r: 90 },
      fill: '#0369a1',
      live: false,
      about: 'Подпитка фабрик свежей водой; основная часть воды — оборотная из хвостохранилища.',
      facts: ['оборотное водоснабжение снижает забор свежей воды'],
      label: 'Вода',
    },
  ];

  const lines: SiteLine[] = [
    { id: 'conv1', name: 'Конвейер дробилка → склад', layer: 'process', kind: 'conveyor', pts: [[cr.x, cr.y], [sp.x, sp.y]] },
    { id: 'conv2', name: 'Конвейер склад → ОФ-1', layer: 'process', kind: 'conveyor', pts: [[sp.x, sp.y], [pl.x, pl.y]] },
    { id: 'conv3', name: 'Конвейер склад → ОФ-2', layer: 'process', kind: 'conveyor', pts: [[sp.x, sp.y], [pl2.x - 120, pl2.y + 60], [pl2.x, pl2.y]] },
    { id: 'tail1', name: 'Хвосты ОФ-1 → хвостохранилище', layer: 'waste', kind: 'pipe', pts: [[pl.x, pl.y], [pl.x + 500, pl.y - 700], [tsf.x - 500, tsf.y - 150]] },
    { id: 'tail2', name: 'Хвосты ОФ-2 → хвостохранилище', layer: 'waste', kind: 'pipe', pts: [[pl2.x, pl2.y], [tsf.x - 300, tsf.y - 300]] },
    { id: 'ret', name: 'Оборотная вода → фабрики', layer: 'utility', kind: 'water', pts: [[tsf.x - 450, tsf.y + 80], [water.x, water.y]] },
    { id: 'w1', name: 'Водовод → ОФ-1', layer: 'utility', kind: 'water', pts: [[water.x, water.y], [pl.x, pl.y]] },
    { id: 'w2', name: 'Водовод → ОФ-2', layer: 'utility', kind: 'water', pts: [[water.x, water.y], [pl2.x, pl2.y]] },
    { id: 'pls', name: 'PLS: площадка → пруды → SX-EW', layer: 'process', kind: 'solution', pts: [[S.leach.x, S.leach.y - 150], [ponds.x, ponds.y], [sx.x, sx.y]] },
    { id: 'raff', name: 'Рафинат → орошение площадки', layer: 'process', kind: 'solution', pts: [[sx.x + 150, sx.y + 40], [S.leach.x - 200, S.leach.y - 150]] },
    { id: 'p1', name: 'ЛЭП → ОФ-1 и ОФ-2', layer: 'utility', kind: 'power', pts: [[sub.x, sub.y], [pl.x, pl.y], [pl2.x, pl2.y]] },
    { id: 'p2', name: 'ЛЭП → дробилка', layer: 'utility', kind: 'power', pts: [[sub.x, sub.y], [cr.x, cr.y]] },
    { id: 'p3', name: 'ЛЭП → завод SX-EW', layer: 'utility', kind: 'power', pts: [[sub.x, sub.y], [sx.x, sx.y]] },
    { id: 'rail', name: 'Ж/д ветка к станции', layer: 'transport', kind: 'rail', pts: [[conc.x - 130, conc.y + 90], [conc.x + 900, conc.y + 90], [conc.x + 1700, conc.y - 300]] },
    { id: 'r1', name: 'Дорога гараж → АБК → вахтовый посёлок', layer: 'transport', kind: 'road', pts: [[g.x + 150, g.y], [abk.x, abk.y], [kpp.x, kpp.y], [camp.x, camp.y]] },
    { id: 'r2', name: 'Дорога к ОФ и складу концентрата', layer: 'transport', kind: 'road', pts: [[abk.x, abk.y], [pl.x - 100, pl.y + 300], [conc.x, conc.y]] },
    { id: 'r3', name: 'Дорога к складу ВМ', layer: 'transport', kind: 'road', pts: [[S.leach.x - 300, S.leach.y], [magazine.x, magazine.y]] },
    { id: 'r4', name: 'Дорога к заводу SX-EW', layer: 'transport', kind: 'road', pts: [[S.leach.x, S.leach.y], [sx.x, sx.y]] },
    { id: 'r5', name: 'Дорога к складу ГСМ', layer: 'transport', kind: 'road', pts: [[g.x, g.y], [gsm.x, gsm.y]] },
    { id: 'r6', name: 'Выезд на трассу', layer: 'transport', kind: 'road', pts: [[kpp.x, kpp.y], [kpp.x + 300, kpp.y + 1100]] },
  ];
  return { objects, lines };
}
