/**
 * Экскурсия по рудному полю для показа: камера по очереди подлетает к объектам комбината, у каждого —
 * короткая подпись и одно живое число из двойника. Порядок — по пути руды: карьер → дробилка → склад →
 * фабрика, затем оксидная линия, хвосты, отгрузка, вторая цепочка и инфраструктура.
 */
import type { Simulation } from '../sim';
import type { CameraPreset, FocusTarget } from '../render3d/MineScene';
import { fmtInt } from '../ui/format';

export interface TourStop {
  /** Куда смотреть: предустановка камеры или объект. */
  view: { preset: CameraPreset } | { focus: FocusTarget };
  title: string;
  text: string;
  /** Живое значение из модели (подпись + число). */
  live: (sim: Simulation) => string;
}

/** Сколько секунд камера стоит у одного объекта. */
export const TOUR_STOP_SEC = 9;

const mined = (s: Simulation) => s.stats.mined.sulfide + s.stats.mined.oxide + s.stats.mined.waste;

export const TOUR: TourStop[] = [
  {
    view: { preset: 'overview' },
    title: 'Карьер Актогай',
    text: 'Три выработки, 5 экскаваторов и 20 самосвалов. Каждый рейс назначает умная диспетчеризация.',
    live: (s) => `Добыто за смену: ${fmtInt(mined(s))} т`,
  },
  {
    view: { focus: { kind: 'excavator', id: 0 } },
    title: 'Экскаватор в забое',
    text: 'XRF-анализатор в ковше определяет медь в каждой порции — так решается, куда везти руду.',
    live: (s) => `Очередь самосвалов: ${s.excavators[0]?.queue.length ?? 0}`,
  },
  {
    view: { focus: { kind: 'building', id: 'crusher' } },
    title: 'Первичная дробилка ККД',
    text: 'Самосвалы разгружают сульфидную руду в приёмный бункер. Пустой бункер — главный риск простоя фабрики.',
    live: (s) => `В бункере: ${fmtInt(s.dumps[0]?.binT ?? 0)} т`,
  },
  {
    view: { focus: { kind: 'building', id: 'stockpile' } },
    title: 'Склад дроблёной руды',
    text: 'Буфер между карьером и фабрикой: сглаживает перебои подвоза.',
    live: (s) => `На складе: ${fmtInt(s.stockpile.t)} т`,
  },
  {
    view: { focus: { kind: 'building', id: 'plant' } },
    title: 'Обогатительная фабрика №1',
    text: 'Мельницы и флотация. Диспетчер держит медь в питании в коридоре 0,35 ± 0,03 %.',
    live: (s) => `Медь в питании: ${s.feedGrade.toFixed(3)} %`,
  },
  {
    view: { focus: { kind: 'building', id: 'leach' } },
    title: 'Кучное выщелачивание',
    text: 'Оксидная руда укладывается на карты и орошается раствором кислоты по графику.',
    live: (s) => `Карт под поливом: ${s.leach.cells.filter((c) => c.irrigated).length}`,
  },
  {
    view: { focus: { kind: 'building', id: 'sxew' } },
    title: 'Завод SX-EW',
    text: 'Экстракция и электролиз: медь из раствора осаждается на катодах — готовый металл.',
    live: (s) => `Ток серии: ${s.leach.ewKA.toFixed(1)} кА`,
  },
  {
    view: { focus: { kind: 'building', id: 'tsf' } },
    title: 'Хвостохранилище',
    text: 'Контур чаши — по OpenStreetMap. Двойник следит за запасом до гребня дамбы.',
    live: (s) => `Запас до гребня: ${s.tailings.freeboardM.toFixed(1)} м`,
  },
  {
    view: { focus: { kind: 'building', id: 'conc' } },
    title: 'Склад концентрата и ж/д',
    text: 'Концентрат грузится в вагоны, полный состав уходит на станцию.',
    live: (s) => `На складе: ${fmtInt(s.concentrate.stockT)} т`,
  },
  {
    view: { focus: { kind: 'building', id: 'plant2' } },
    title: 'Вторая цепочка: ОФ-2',
    text: 'ККД-2, склад и ОФ-2 считаются так же, как первая цепочка; подвоз к ним условный.',
    live: (s) => `Руда за смену: ${fmtInt(s.chain2.stats.plantFeedT)} т`,
  },
  {
    view: { focus: { kind: 'building', id: 'sub' } },
    title: 'Подстанция и ЛЭП',
    text: 'Энергоучёт по участкам. При отключении энергии лампа мигает красным.',
    live: (s) => `Нагрузка рудника: ${s.energy.totalMw.toFixed(0)} МВт`,
  },
  {
    view: { focus: { kind: 'building', id: 'camp' } },
    title: 'Вахтовый посёлок',
    text: 'Пересменка и автобусы, столовая, котельная и резервный генератор.',
    live: (s) => `В посёлке: ${fmtInt(s.camp.inCamp)} чел.`,
  },
  {
    view: { focus: { kind: 'building', id: 'kpp' } },
    title: 'КПП и автовесы',
    text: 'Через КПП везут реагенты, кислоту, топливо и запчасти; каждый грузовик взвешивается.',
    live: (s) => `Очередь на весах: ${Math.round(s.checkpoint.queue)}`,
  },
  {
    view: { focus: { kind: 'building', id: 'gsm' } },
    title: 'Склад ГСМ',
    text: 'Дизель для всего парка. Автоцистерны приходят через КПП.',
    live: (s) => `Запас дизеля: ${fmtInt(s.fuelDepot.stockM3)} м³`,
  },
  {
    view: { preset: 'overview' },
    title: 'Весь комбинат — в двойниках Ditto',
    text: '150 двойников, сценарии «что если» и эффект системы в тенге — в разделах слева.',
    live: (s) => `Добыто за смену: ${fmtInt(mined(s))} т`,
  },
];
