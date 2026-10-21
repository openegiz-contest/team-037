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
  // Склад дроблёной руды — реальный конус в конце конвейера (OSM, снимок), как в 3D-сцене.
  const sp = S.stockpile;
  const via = S.conveyorVia.map((p) => [p.x, p.y] as [number, number]);
  const via2 = S.plantVia.map((p) => [p.x, p.y] as [number, number]);
  // Вторая цепочка комбината (в модели не участвует): ККД-2 у соседней головы конвейера → склад-2 → ОФ-2.
  const cr2 = S.crusher2;
  const sp2 = S.stockpile2;
  // Реальные места объектов (координаты модели; пересчёт со спутникового снимка и OpenStreetMap,
  // см. src/geo/geoRef.ts). Объекты, назначение которых на снимке не подписано, стоят условно.
  const pl2 = S.plant2; // вторая фабрика — корпус западного фабричного комплекса (OSM)
  const tsf = S.tsf; // хвостохранилище к юго-востоку от фабрик (контур — OSM)
  const sx = S.sxew; // корпуса у карт выщелачивания — завод SX-EW
  const ponds = S.ponds;
  const conc = S.conc; // склад концентрата у ж/д путей между фабриками
  const sub = S.sub; // подстанция фабрики №1 (OSM: power=substation)
  const sub2 = S.sub2; // подстанция фабрики №2 (OSM)
  const water = { x: 1345, y: 3025 }; // резервуар (OSM: water=reservoir)
  const magazine = { x: -900, y: -2600 }; // условно: вынесен за отвалы, к северу
  const g = S.garage;
  const rmc = { x: -680, y: 2510 }; // промплощадка (OSM: landuse=industrial)
  const abk = { x: 960, y: 1450 }; // промплощадка у дороги от карьера к фабрикам (OSM)
  const lab = { x: 580, y: 1325 }; // промплощадка (OSM)
  const gsm = { x: -905, y: 2165 }; // промплощадка (OSM)
  const camp = S.camp; // жилой посёлок (OSM: landuse=residential)
  const kpp = S.kpp; // КПП — на главной дороге с юго-запада (OSM)
  const wasteE = S.wasteExtra[0] ?? { x: 450, y: -2050 }; // восточный отвал (снимок, OSM: landuse=landfill)
  const wasteSE = S.wasteExtra[1] ?? { x: 2150, y: -1100 };
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
      shape: { kind: 'rect', x: pl.x, y: pl.y, w: 220, h: 360, rot: -5 },
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
      shape: { kind: 'rect', x: pl2.x, y: pl2.y, w: 220, h: 360, rot: -5 },
      fill: '#5b2a0b',
      live: true,
      metrics: (s) => [
        ['Состояние', s.chain2.running(s) ? 'работает' : 'стоит'],
        ['Cu в питании', `${s.chain2.view.feedGrade.toFixed(3)} %`],
        ['Переработано за смену', `${fmt(s.chain2.stats.plantFeedT)} т`],
        ['Медь в концентрате', `${s.chain2.stats.cuConcT.toFixed(1)} т`],
      ],
      building: 'plant2',
      twin: 'plant2',
      about: 'Вторая сульфидная фабрика той же мощности; запуск удвоил переработку сульфидной руды. В модели не участвует: моделируется сегмент парка, питающий одну фабрику.',
      facts: ['25 млн т руды в год, запущена в 2021 г. (открытые источники)', 'вместе с ОФ-1 — 50 млн т в год; рекорд 2025 г. — 62,1 млн т руды', 'попутно — молибденовый передел (молибденовый концентрат)'],
      label: 'ОФ-2',
    },
    {
      id: 'crusher2',
      name: 'Первичная дробилка ККД-2',
      layer: 'process',
      shape: { kind: 'rect', x: cr2.x, y: cr2.y, w: 130, h: 100, rot: 20 },
      fill: '#7c2d12',
      live: true,
      metrics: (s) => [
        ['Приёмный бункер', `${fmt(s.chain2.dump.binT)} т`],
        ['Подвоз (условный)', `${fmt(s.chain2.inflowTph)} т/ч`],
        ['Дробилка', s.chain2.stockpile.crushing ? 'дробит' : 'ждёт / нет питания'],
      ],
      building: 'crusher2',
      twin: 'crusher2',
      about: 'Вторая дробилка у соседней головы конвейера — питает склад и фабрику №2. В модели не участвует: моделируемый сегмент парка возит руду на первую.',
      facts: ['голова конвейера — по OpenStreetMap и снимку'],
      label: 'ККД-2',
    },
    {
      id: 'stockpile2',
      name: 'Склад дроблёной руды ОФ-2',
      layer: 'process',
      shape: { kind: 'circle', x: sp2.x, y: sp2.y, r: 110 },
      fill: '#713f12',
      live: true,
      metrics: (s) => [
        ['На складе', `${fmt(s.chain2.stockpile.t)} т`],
        ['Запас фабрике', `${(s.chain2.stockpile.t / (s.cfg.dumps.crusher.plantFeedTpm * 60)).toFixed(1)} ч`],
      ],
      building: 'stockpile2',
      twin: 'stockpile2',
      about: 'Конусный склад второй фабрики в конце длинного конвейера от ККД-2.',
      facts: ['место — по OpenStreetMap и снимку'],
      label: 'Склад ОФ-2',
    },
    {
      id: 'conc',
      name: 'Склад концентрата и ж/д погрузка',
      layer: 'process',
      shape: { kind: 'rect', x: conc.x, y: conc.y, w: 260, h: 110, rot: 0 },
      fill: '#92400e',
      live: true,
      about: 'Медный концентрат после сушки хранится в крытом складе и грузится в вагоны; полный состав уходит на станцию. Состав масштабирован под моделируемый сегмент парка.',
      facts: ['концентрат ~25 % Cu (открытые источники)', 'вагон ~69 т, в составе модели 6 вагонов (оценка, масштаб сегмента)'],
      metrics: (s2) => [
        ['На складе', `${fmt(s2.concentrate.stockT)} т`],
        ['Вагонов в составе', `${s2.concentrate.wagons} из 6${s2.concentrate.loadLeft > 0 ? ' · грузится' : ''}`],
        ['Составов за смену', String(s2.concentrate.trains)],
        ['Отгружено', `${fmt(s2.concentrate.shippedT)} т (~${fmt(s2.concentrate.cuShippedT)} т меди)`],
      ],
      building: 'conc',
      twin: 'concentrate',
      label: 'Склад концентрата',
    },
    {
      id: 'leach',
      name: 'Площадка кучного выщелачивания',
      layer: 'process',
      shape: { kind: 'rect', x: 2620, y: 60, w: 760, h: 1880, rot: 0 }, // вся площадка по снимку; самосвалы разгружаются на верхних картах
      fill: '#115e59',
      live: true,
      about: 'Оксидную руду отсыпают на карты и орошают раствором серной кислоты по графику — группы карт поливаются по очереди. Медь переходит в раствор (PLS) по кривой извлечения: быстро в первые недели, до ~70 % за полгода.',
      facts: ['оксидная руда из верхних горизонтов карьера (зона окисления)', `${13} карт по ~450 тыс. т, 3 группы полива по 4 ч (оценка)`],
      metrics: (s) => [
        ['Отсыпано за смену', `${fmt(s.dumps.find((x) => x.material === 'oxide')?.tonnes ?? 0)} т`],
        ['Карта отсыпки', s.leach.cells.find((c) => c.stage === 'loading')?.name ?? '—'],
        ['Под поливом', `${s.leach.cells.filter((c) => c.irrigated).length} из ${s.leach.irrigatingCount} карт (группа ${s.leach.activeGroup(s.now) + 1})`],
        ['Медь в раствор за смену', `${s.leach.cuLeachedT.toFixed(1)} т`],
      ],
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
      live: true,
      about: 'Продуктивный раствор с площадки собирается в пруд и идёт на экстракцию; обеднённый раствор (рафинат) возвращается на орошение.',
      facts: ['замкнутый цикл растворов'],
      metrics: (s) => [
        ['Расход PLS', `${fmt(s.leach.plsM3h)} м³/ч`],
        ['Медь в PLS', `${s.leach.plsGpl.toFixed(2)} г/л`],
      ],
      building: 'sxew',
      twin: 'heap-leach',
      label: 'Пруды PLS',
    },
    {
      id: 'sxew',
      name: 'Оксидный завод SX-EW (катодная медь)',
      layer: 'process',
      shape: { kind: 'rect', x: sx.x, y: sx.y, w: 300, h: 150, rot: 0 },
      fill: '#134e4a',
      live: true,
      about: 'Жидкостная экстракция (SX) и электролиз (EW): из раствора осаждается катодная медь.',
      facts: ['катодная медь 99,99 % (открытые источники)', 'мощность порядка 25 тыс. т катодов в год (оценка по открытым данным)'],
      metrics: (s) => [
        ['Катодов за смену', `${s.leach.cathodeT.toFixed(1)} т`],
        ['Темп', `${fmt(s.leach.cathodeTpd)} т/сут`],
        ['Ток серии', `${s.leach.ewKA.toFixed(1)} кА`],
      ],
      building: 'sxew',
      twin: 'sxew',
      label: 'Завод SX-EW',
    },
    // ── отвалы и хвосты ──
    {
      id: 'waste',
      name: 'Отвал вскрыши северо-западный',
      layer: 'waste',
      shape: { kind: 'circle', x: S.waste.x, y: S.waste.y, r: 330 },
      fill: '#57534e',
      live: true,
      about: 'Пустая порода из карьера отсыпается ярусами.',
      facts: ['коэффициент вскрыши у Актогая низкий (открытые источники)'],
      metrics: (s) => [['Отсыпано за смену', `${fmt(s.dumps.filter((x) => x.material === 'waste')[0]?.tonnes ?? 0)} т`], ['Все отвалы за смену', `${fmt(s.stats.mined.waste)} т`]],
      building: 'waste',
      twin: 'waste-dump',
    },
    {
      id: 'wasteE',
      name: 'Отвал вскрыши восточный',
      layer: 'waste',
      shape: { kind: 'circle', x: wasteE.x, y: wasteE.y, r: 420 },
      fill: '#57534e',
      live: true,
      about: 'Ярусный отвал вскрыши к востоку от главного карьера. Умная диспетчеризация выбирает отвал по времени рейса и очереди; без системы самосвал едет на ближайший к своему забою.',
      facts: ['расположение — по спутниковому снимку и OpenStreetMap'],
      metrics: (s2) => {
        const d = s2.dumps.filter((x) => x.material === 'waste')[1];
        return d ? [['Отсыпано за смену', `${fmt(d.tonnes)} т`], ['Очередь', String(d.queue.length)]] : [];
      },
      building: 'waste',
      twin: 'waste-dump',
      label: 'Отвал восточный',
    },
    {
      id: 'wasteSE',
      name: 'Отвал вскрыши юго-восточный',
      layer: 'waste',
      shape: { kind: 'circle', x: wasteSE.x, y: wasteSE.y, r: 380 },
      fill: '#57534e',
      live: true,
      about: 'Ярусный отвал вскрыши к юго-востоку от главного карьера, рядом с картами выщелачивания.',
      facts: ['расположение — по спутниковому снимку'],
      metrics: (s2) => {
        const d = s2.dumps.filter((x) => x.material === 'waste')[2];
        return d ? [['Отсыпано за смену', `${fmt(d.tonnes)} т`], ['Очередь', String(d.queue.length)]] : [];
      },
      building: 'waste',
      twin: 'waste-dump',
      label: 'Отвал юго-восточный',
    },
    {
      id: 'tsf',
      name: 'Хвостохранилище',
      layer: 'waste',
      shape: { kind: 'poly', pts: S.tsfOutline.map(([x, y]) => [x, y] as [number, number]) },
      fill: '#3f4a52',
      live: true,
      about: 'Отходы флотации (хвосты) по пульпопроводу уходят в чашу за ограждающей дамбой: твёрдое намывает пляж, осветлённая вода собирается в пруду и возвращается на фабрику. За дамбой следят пьезометрами и замеряют фильтрацию.',
      facts: ['контур чаши — по объекту tailings_pond в OpenStreetMap', 'ёмкость и отметки — оценки'],
      metrics: (s2) => [
        ['Пульпа с фабрики', `${fmt(s2.tailings.pulpM3h)} м³/ч`],
        ['Уложено за смену', `${fmt(s2.tailings.tailsT)} т`],
        ['Заполнение чаши', `${s2.tailings.fillPct.toFixed(1)} %`],
        ['Запас до гребня', `${s2.tailings.freeboardM.toFixed(1)} м`],
        ['Оборотная вода', `${fmt(s2.tailings.reclaimM3h)} м³/ч`],
      ],
      building: 'tsf',
      twin: 'tailings',
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
      facts: ['охранная зона и место на схеме — условные'],
      label: 'Склад ВМ',
    },
    {
      id: 'camp',
      name: 'Вахтовый посёлок',
      layer: 'infra',
      shape: { kind: 'rect', x: camp.x, y: camp.y, w: 380, h: 240, rot: 0 },
      fill: '#334155',
      live: true,
      about: 'Общежития, столовая, котельная, водонапорная башня и резервная дизельная станция. Люди живут сменами: половина на производстве, половина отдыхает.',
      facts: ['работа круглосуточно, сменами по 12 ч', 'численность и мощности — оценки, не данные комбината'],
      metrics: (s) => [
        ['В посёлке', `${s.camp.inCamp.toLocaleString('ru-RU')} чел.`],
        ['В пути', `${s.camp.inTransit.toLocaleString('ru-RU')} чел.`],
        ['Питание', !s.camp.powered ? 'нет света' : s.camp.genOn ? 'дизель-генератор' : 'сеть'],
        ['Нагрузка', `${s.camp.loadMw.toFixed(1)} МВт`],
      ],
      building: 'camp',
      twin: 'camp',
      label: 'Вахтовый посёлок',
    },
    {
      id: 'kpp',
      name: 'КПП и автовесы',
      layer: 'infra',
      shape: { kind: 'rect', x: kpp.x, y: kpp.y, w: 110, h: 60, rot: 0 },
      fill: '#475569',
      live: true,
      metrics: (s) => [
        ['Режим автовесов', s.checkpoint.mode === 'manual' ? 'ручной' : 'автоматический'],
        ['Очередь', `${Math.round(s.checkpoint.queue)} маш.`],
        ['Грузовиков принято', String(Math.round(s.checkpoint.cargoVehicles))],
      ],
      building: 'kpp',
      twin: 'kpp',
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
      live: true,
      about: 'Питание мельниц, дробилки, конвейеров, электролиза и карьерных сетей.',
      facts: ['основные потребители — мельницы фабрик (десятки МВт)'],
      label: 'Подстанция',
      metrics: (s2) => [
        ['Нагрузка', `${s2.energy.substationMw.sub.toFixed(1)} МВт`],
        ['Выключатель', s2.powerCutLeft > 0 ? 'отключён' : 'включён'],
        ['Масло трансформатора', `${s2.energy.trafoTempC(s2, 'sub').toFixed(0)} °C`],
        ['Рудник целиком', `${s2.energy.totalMw.toFixed(1)} МВт · пик ${s2.energy.peakMw.toFixed(1)}`],
      ],
      building: 'sub',
      twin: 'sub',
    },
    {
      id: 'sub2',
      name: 'Подстанция фабрики №2',
      layer: 'utility',
      shape: { kind: 'rect', x: sub2.x, y: sub2.y, w: 140, h: 100, rot: 0 },
      fill: '#854d0e',
      live: true,
      metrics: (s) => [
        ['Нагрузка', `${s.energy.substationMw.sub2.toFixed(1)} МВт`],
        ['Выключатель', s.powerCutLeft > 0 ? 'отключён' : 'включён'],
        ['Масло трансформатора', `${s.energy.trafoTempC(s, 'sub2').toFixed(0)} °C`],
      ],
      building: 'sub2',
      twin: 'sub2',
      about: 'Питание второй обогатительной фабрики.',
      facts: ['отмечена в OpenStreetMap'],
      label: 'Подстанция 2',
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
    // Служебные дороги промплощадки и объезд хвостохранилища (OSM) — самосвалы по ним не ездят.
    ...sim.cfg.serviceRoads.map((r, i) => ({ id: `svc${i}`, name: r.name, layer: 'transport' as const, kind: 'road' as const, pts: r.pts.map(([x, y]) => [x, y] as [number, number]) })),
    { id: 'conv1', name: 'Конвейер дробилка → склад', layer: 'process', kind: 'conveyor', pts: [[cr.x, cr.y], ...via, [sp.x, sp.y]] },
    { id: 'conv2', name: 'Конвейер склад → ОФ-1', layer: 'process', kind: 'conveyor', pts: [[sp.x, sp.y], ...via2, [pl.x, pl.y]] },
    { id: 'conv3', name: 'Конвейер ККД-2 → склад ОФ-2', layer: 'process', kind: 'conveyor', pts: [[cr2.x, cr2.y], [sp2.x, sp2.y]] },
    { id: 'conv4', name: 'Конвейер склад → ОФ-2', layer: 'process', kind: 'conveyor', pts: [[sp2.x, sp2.y], ...S.plant2Via.map((q) => [q.x, q.y] as [number, number]), [pl2.x, pl2.y]] },
    { id: 'tail1', name: 'Хвосты ОФ-1 → хвостохранилище (пульпопровод)', layer: 'waste', kind: 'pipe', pts: [[pl.x, pl.y], ...S.pulpVia.map((q) => [q.x, q.y] as [number, number]), [2006, 3377]] },
    { id: 'tail2', name: 'Хвосты ОФ-2 → хвостохранилище', layer: 'waste', kind: 'pipe', pts: [[pl2.x, pl2.y], [tsf.x - 1100, tsf.y - 200]] },
    { id: 'ret', name: 'Оборотная вода → фабрики', layer: 'utility', kind: 'water', pts: [[2006, 3377], ...[...S.pulpVia].reverse().map((q) => [q.x, q.y] as [number, number]), [water.x, water.y]] },
    { id: 'w1', name: 'Водовод → ОФ-1', layer: 'utility', kind: 'water', pts: [[water.x, water.y], [pl.x, pl.y]] },
    { id: 'w2', name: 'Водовод → ОФ-2', layer: 'utility', kind: 'water', pts: [[water.x, water.y], [pl2.x, pl2.y]] },
    { id: 'pls', name: 'PLS: площадка → пруды → SX-EW', layer: 'process', kind: 'solution', pts: [[S.leach.x, S.leach.y + 150], [ponds.x, ponds.y], [sx.x, sx.y]] },
    { id: 'raff', name: 'Рафинат → орошение площадки', layer: 'process', kind: 'solution', pts: [[sx.x + 150, sx.y - 60], [S.leach.x - 150, S.leach.y + 150]] },
    { id: 'p1', name: 'ЛЭП → ОФ-1, дробилка, SX-EW', layer: 'utility', kind: 'power', pts: S.powerLines[0] },
    { id: 'p2', name: 'ЛЭП → ОФ-2', layer: 'utility', kind: 'power', pts: S.powerLines[1] },
    { id: 'rail', name: 'Железная дорога: станция → фабрики → промзона', layer: 'transport', kind: 'rail', pts: S.rail.map(([x, y]) => [x, y] as [number, number]) },
    { id: 'r1', name: 'Дорога карьер → фабрики → гараж', layer: 'transport', kind: 'road', pts: [[cr.x, cr.y], [abk.x, abk.y], [sub.x, sub.y], [g.x, g.y]] },
    { id: 'r2', name: 'Дорога к ОФ-2 и складу концентрата', layer: 'transport', kind: 'road', pts: [[g.x, g.y], [conc.x, conc.y], [pl2.x, pl2.y]] },
    { id: 'r3', name: 'Дорога к складу ВМ (условно)', layer: 'transport', kind: 'road', pts: [[S.waste.x + 300, S.waste.y - 500], [magazine.x, magazine.y]] },
    { id: 'r4', name: 'Дорога к заводу SX-EW', layer: 'transport', kind: 'road', pts: [[S.leach.x, S.leach.y], [sx.x, sx.y], [abk.x, abk.y]] },
    { id: 'r5', name: 'Дорога к складу ГСМ', layer: 'transport', kind: 'road', pts: [[g.x, g.y], [gsm.x, gsm.y]] },
  ];
  return { objects, lines };
}
