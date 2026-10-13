/**
 * Паспорт датчиков самосвала: какое оборудование стоит на машине, что оно измеряет и какие
 * признаки (features) двойника заполняет. Записывается в attributes.sensors каждого двойника
 * самосвала и показывается в интерфейсе (карточка самосвала, раздел «Двойники»).
 *
 * Типы оборудования — типовые для карьерных самосвалов 220 т; в модели показания синтетические.
 */
export interface SensorSpec {
  id: string;
  /** Название датчика. */
  name: string;
  /** Тип оборудования и интерфейс. */
  hardware: string;
  /** Где установлен. */
  location: string;
  /** Что измеряет. */
  measures: string;
  /** Признаки двойника, которые заполняет датчик. Первый — главный. */
  features: string[];
  /** Период опроса, с. */
  periodS: number;
  /** Зачем он двойнику. */
  purpose: string;
}

export const TRUCK_SENSORS: SensorSpec[] = [
  {
    id: 'gnss',
    name: 'GNSS-приёмник ГЛОНАСС/GPS',
    hardware: 'высокоточный приёмник с RTK-поправками, антенна на крыше кабины',
    location: 'кабина',
    measures: 'координаты, скорость, курс',
    features: ['x', 'y', 'edge_from', 'edge_to', 'seg_pos'],
    periodS: 1,
    purpose: 'положение на карте и на графе дорог, ETA для диспетчера',
  },
  {
    id: 'payload',
    name: 'Бортовая система взвешивания',
    hardware: 'датчики давления в цилиндрах подвески + контроллер',
    location: 'подвеска, 4 точки',
    measures: 'масса груза в кузове',
    features: ['payload'],
    periodS: 1,
    purpose: 'учёт тонн по рейсам, недогруз и перегруз',
  },
  {
    id: 'fuel',
    name: 'Датчик уровня топлива',
    hardware: 'ёмкостный погружной датчик',
    location: 'топливный бак 3400 л',
    measures: 'объём топлива',
    features: ['fuel'],
    periodS: 10,
    purpose: 'вовремя отправить на заправку, расход л/т',
  },
  {
    id: 'engine_temp',
    name: 'Датчик температуры охлаждающей жидкости',
    hardware: 'термистор NTC, данные через ЭБУ двигателя по шине CAN (SAE J1939)',
    location: 'блок двигателя',
    measures: 'температура двигателя, °C',
    features: ['engine_temp', 'engine_temp_expected'],
    periodS: 10,
    purpose: 'перегрев против тепловой модели двойника → прогноз отказа двигателя',
  },
  {
    id: 'vibration',
    name: 'Вибродатчик рамы',
    hardware: 'MEMS-акселерометр, 3 оси, СКЗ виброскорости',
    location: 'рама у подвески',
    measures: 'вибрация, мм/с',
    features: ['vibration'],
    periodS: 10,
    purpose: 'износ гидравлики и подвески → прогноз отказа',
  },
  {
    id: 'tpms',
    name: 'Система контроля давления шин (TPMS)',
    hardware: '6 радиодатчиков внутри колёс + приёмник в кабине',
    location: 'колёса',
    measures: 'давление, бар (минимальное по колёсам)',
    features: ['tyre_pressure'],
    periodS: 10,
    purpose: 'утечка или прокол до разрыва шины → прогноз отказа',
  },
  {
    id: 'ecu',
    name: 'Бортовой контроллер / ЭБУ двигателя',
    hardware: 'телематический терминал, шина CAN (SAE J1939)',
    location: 'кабина',
    measures: 'моточасы, режим работы',
    features: ['engine_hours', 'service_in', 'state'],
    periodS: 1,
    purpose: 'моточасы до ТО, состояние машины для диспетчера',
  },
];

/** Компактная запись для attributes.sensors двойника в Ditto. */
export const truckSensorAttributes = () =>
  TRUCK_SENSORS.map((s) => ({ id: s.id, name: s.name, hardware: s.hardware, location: s.location, features: s.features, period_s: s.periodS }));
