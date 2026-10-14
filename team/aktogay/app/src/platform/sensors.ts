/**
 * Паспорт датчиков техники и переработки (самосвалы, экскаваторы, дробилка, фабрика): какое оборудование стоит на машине, что оно измеряет и какие
 * признаки (features) двойника заполняет. Записывается в attributes.sensors двойников
 * техники и показывается в интерфейсе (карточка самосвала, раздел «Двойники»).
 *
 * Типы оборудования — типовые для карьерной техники; в модели показания синтетические.
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

export const EXCAVATOR_SENSORS: SensorSpec[] = [
  {
    id: 'bucket_weigh',
    name: 'Система взвешивания ковша',
    hardware: 'датчики давления в гидроцилиндрах стрелы + контроллер',
    location: 'стрела и рукоять',
    measures: 'масса каждого ковша, т',
    features: ['tonnes_total', 'loads_total', 'load_left'],
    periodS: 1,
    purpose: 'учёт отгрузки по ковшам, точная загрузка самосвала без перегруза',
  },
  {
    id: 'ore_xrf',
    name: 'Анализатор руды в ковше (XRF)',
    hardware: 'рентгенофлуоресцентный датчик на ковше',
    location: 'ковш',
    measures: 'содержание меди в черпаемой руде, % Cu',
    features: ['face_grade'],
    periodS: 30,
    purpose: 'качество руды в забое → шихтовка питания фабрики',
  },
  {
    id: 'bucket_pos',
    name: 'Система позиционирования ковша',
    hardware: 'GNSS с RTK-поправками + инклинометры стрелы и рукояти',
    location: 'кабина, стрела, рукоять',
    measures: 'положение ковша в забое, см',
    features: ['face_grade'],
    periodS: 1,
    purpose: 'привязка ковша к блочной модели: руда или вскрыша, какой блок отрабатывается',
  },
  {
    id: 'truck_detect',
    name: 'Обнаружение самосвалов у забоя',
    hardware: 'радар ближней зоны + обмен с бортовыми терминалами самосвалов',
    location: 'платформа экскаватора',
    measures: 'кто грузится и кто ждёт в очереди',
    features: ['queue', 'queue_ids', 'loading', 'queue_avg'],
    periodS: 1,
    purpose: 'очередь у забоя в реальном времени — главный вход для диспетчера',
  },
  {
    id: 'diag',
    name: 'Диагностика привода',
    hardware: 'датчики температуры масла и вибрации редукторов поворота и хода',
    location: 'гидросистема и редукторы',
    measures: 'температура, вибрация, коды неисправностей',
    features: ['broken', 'repair_left'],
    periodS: 10,
    purpose: 'раннее обнаружение неисправности и учёт времени ремонта',
  },
  {
    id: 'ecu',
    name: 'Бортовой контроллер / ЭБУ',
    hardware: 'телематический терминал, шина CAN (SAE J1939)',
    location: 'кабина',
    measures: 'режим работы: копает, ждёт, стоит',
    features: ['state', 'busy', 'idle'],
    periodS: 1,
    purpose: 'загрузка экскаватора и простои для диспетчера',
  },
];

export const CRUSHER_SENSORS: SensorSpec[] = [
  {
    id: 'bin_level',
    name: 'Радарный уровнемер бункера',
    hardware: 'бесконтактный радар 80 ГГц над бункером',
    location: 'кровля бункера 1000 т',
    measures: 'уровень и масса руды в бункере, т',
    features: ['bin'],
    periodS: 1,
    purpose: 'запас руды до остановки фабрики — главный вход для защиты от простоя',
  },
  {
    id: 'dump_station',
    name: 'Контроль площадки разгрузки',
    hardware: 'RFID-считыватель номеров самосвалов + лидар присутствия',
    location: 'площадка разгрузки',
    measures: 'кто разгружается и кто ждёт',
    features: ['queue', 'queue_ids', 'dumping_ids'],
    periodS: 1,
    purpose: 'очередь у дробилки и учёт рейсов по номерам машин',
  },
  {
    id: 'belt_scale',
    name: 'Конвейерные весы',
    hardware: 'тензометрические весы на ленте под дробилкой',
    location: 'конвейер дробилка → фабрика',
    measures: 'масса раздробленной руды, т',
    features: ['tonnes_total'],
    periodS: 1,
    purpose: 'сколько руды реально ушло на фабрику',
  },
  {
    id: 'drive',
    name: 'Датчики привода дробилки',
    hardware: 'ток двигателя, давление гидросистемы, вибрация и температура подшипников',
    location: 'привод конусной дробилки',
    measures: 'режим: дробит, принимает, работает вхолостую',
    features: ['state', 'starved'],
    periodS: 1,
    purpose: 'простой без руды и защита оборудования',
  },
  {
    id: 'soft_grade',
    name: 'Виртуальный датчик качества в бункере',
    hardware: 'расчёт двойника: смешение порций по данным XRF ковшей и весов',
    location: 'модель двойника',
    measures: 'содержание меди в бункере, % Cu',
    features: ['bin_grade', 'bin_cu'],
    periodS: 1,
    purpose: 'прогноз качества питания фабрики для шихтовки',
  },
];

export const PLANT_SENSORS: SensorSpec[] = [
  {
    id: 'feed_scale',
    name: 'Конвейерные весы питания',
    hardware: 'тензометрические весы на ленте питания',
    location: 'конвейер на входе фабрики',
    measures: 'производительность, т/ч',
    features: ['feed_rate', 'feed_total'],
    periodS: 1,
    purpose: 'сколько руды получает фабрика и когда она стоит',
  },
  {
    id: 'pgnaa',
    name: 'Поточный анализатор руды (PGNAA)',
    hardware: 'нейтронно-активационный анализатор через ленту',
    location: 'конвейер питания',
    measures: 'содержание меди в питании, % Cu',
    features: ['feed_grade', 'cu_feed'],
    periodS: 60,
    purpose: 'держать питание в коридоре 0,35 ± 0,03% Cu',
  },
  {
    id: 'slurry_xrf',
    name: 'Анализатор пульпы (XRF)',
    hardware: 'рентгенофлуоресцентный поточный анализатор, пробоотборники',
    location: 'концентрат и хвосты флотации',
    measures: 'медь в концентрате и в хвостах',
    features: ['cu_concentrate', 'cu_loss'],
    periodS: 300,
    purpose: 'извлечение меди и потери с хвостами',
  },
  {
    id: 'scada',
    name: 'АСУ ТП фабрики (SCADA)',
    hardware: 'контроллеры мельниц и флотации, обмен по OPC UA',
    location: 'операторская фабрики',
    measures: 'режим работы, время в коридоре качества',
    features: ['state', 'feed_time', 'feed_in_band_time'],
    periodS: 1,
    purpose: 'работа или простой фабрики, доля времени с нормальным питанием',
  },
];

/**
 * Пункты разгрузки (кучное выщелачивание, отвал). В модели у них только учёт тонн и очередь,
 * поэтому описаны датчики, которые заполняют эти признаки. Химия раствора (pH, расход) и
 * устойчивость отвала не моделируются — датчиков под них здесь нет.
 */
function dumpSensors(what: 'руда' | 'вскрыша', place: string): SensorSpec[] {
  return [
    {
      id: 'dump_station',
      name: 'Контроль площадки разгрузки',
      hardware: 'RFID-считыватель номеров самосвалов + лидар присутствия',
      location: place,
      measures: 'кто разгружается и кто ждёт',
      features: ['queue', 'queue_ids', 'dumping_ids'],
      periodS: 1,
      purpose: 'очередь на разгрузке и учёт рейсов по номерам машин',
    },
    {
      id: 'stockpile',
      name: what === 'руда' ? 'Учёт уложенной руды' : 'Учёт вскрыши в отвале',
      hardware: 'сумма бортовых весов самосвалов по рейсам + сверка лидарной съёмкой с дрона',
      location: place,
      measures: `масса уложенного материала (${what}), т`,
      features: ['tonnes_total'],
      periodS: 1,
      purpose: what === 'руда' ? 'выполнение плана по оксидной руде' : 'выполнение плана по вскрыше',
    },
  ];
}

export const LEACH_SENSORS: SensorSpec[] = dumpSensors('руда', 'площадка кучного выщелачивания');
export const WASTE_SENSORS: SensorSpec[] = dumpSensors('вскрыша', 'отвал вскрыши');

export const GARAGE_SENSORS: SensorSpec[] = [
  {
    id: 'parking',
    name: 'Датчики занятости стояночных мест',
    hardware: 'индуктивные петли в покрытии + RFID-метка самосвала на въезде',
    location: 'стоянка у гаража, каждое место',
    measures: 'какое место занято и каким самосвалом',
    features: ['occupied', 'slots'],
    periodS: 1,
    purpose: 'свободные места для заезда и где стоит каждая машина',
  },
  {
    id: 'fuel_station',
    name: 'Топливораздаточная колонка с учётом',
    hardware: 'массовый расходомер + RFID-идентификация самосвала у колонки',
    location: 'АЗС',
    measures: 'кто заправляется и сколько литров выдано',
    features: ['refueling'],
    periodS: 1,
    purpose: 'очередь на заправку и учёт топлива по машинам',
  },
  {
    id: 'service_bay',
    name: 'Учёт ремонтных боксов',
    hardware: 'RFID-считыватели на воротах боксов + терминал механика',
    location: 'ремонтные боксы',
    measures: 'какие самосвалы в плановом или аварийном ремонте',
    features: ['in_service'],
    periodS: 1,
    purpose: 'сколько машин выбыло из работы и когда вернутся',
  },
];

export const DRILL_SENSORS: SensorSpec[] = [
  {
    id: 'gnss',
    name: 'GNSS-позиционирование станка',
    hardware: 'два приёмника с RTK-поправками на мачте',
    location: 'мачта и кабина',
    measures: 'координаты и направление станка, наведение на проектную точку скважины',
    features: ['x', 'y'],
    periodS: 1,
    purpose: 'бурение точно по сетке проекта взрыва',
  },
  {
    id: 'depth',
    name: 'Датчик глубины (энкодер подачи)',
    hardware: 'энкодер на механизме подачи бурового става',
    location: 'мачта',
    measures: 'глубина текущей скважины, м',
    features: ['hole_depth', 'holes_done', 'meters_shift'],
    periodS: 1,
    purpose: 'контроль недобура и перебура, учёт пробуренных метров',
  },
  {
    id: 'mwd',
    name: 'Система мониторинга бурения (MWD)',
    hardware: 'контроллер станка: скорость проходки, обороты, удельная энергия',
    location: 'кабина',
    measures: 'скорость проходки, м/ч',
    features: ['penetration'],
    periodS: 1,
    purpose: 'по скорости видно крепость породы — уточнение блочной модели и заряда',
  },
  {
    id: 'pulldown',
    name: 'Датчик усилия подачи',
    hardware: 'датчик давления в гидроцилиндрах подачи',
    location: 'мачта',
    measures: 'усилие на долото, кН',
    features: ['pulldown'],
    periodS: 1,
    purpose: 'режим бурения и износ долота',
  },
  {
    id: 'torque',
    name: 'Датчик крутящего момента вращателя',
    hardware: 'датчик давления гидромотора вращателя',
    location: 'вращатель',
    measures: 'крутящий момент, кН·м',
    features: ['torque'],
    periodS: 1,
    purpose: 'заклинивание става, трещиноватость породы',
  },
  {
    id: 'air',
    name: 'Датчик давления воздуха компрессора',
    hardware: 'преобразователь давления на линии продувки',
    location: 'компрессор',
    measures: 'давление продувки скважины, бар',
    features: ['air_pressure'],
    periodS: 1,
    purpose: 'очистка скважины от шлама, исправность компрессора',
  },
];

/** Паспорт датчиков по типу двойника (attributes.kind). */
export const SENSORS_BY_KIND: Record<string, SensorSpec[]> = {
  'haul-truck': TRUCK_SENSORS,
  excavator: EXCAVATOR_SENSORS,
  crusher: CRUSHER_SENSORS,
  concentrator: PLANT_SENSORS,
  'heap-leach': LEACH_SENSORS,
  'waste-dump': WASTE_SENSORS,
  garage: GARAGE_SENSORS,
  'drill-rig': DRILL_SENSORS,
};

/** Компактная запись для attributes.sensors двойника в Ditto. */
export const sensorAttributes = (list: SensorSpec[]) =>
  list.map((s) => ({ id: s.id, name: s.name, hardware: s.hardware, location: s.location, features: s.features, period_s: s.periodS }));
export const truckSensorAttributes = () => sensorAttributes(TRUCK_SENSORS);
export const excavatorSensorAttributes = () => sensorAttributes(EXCAVATOR_SENSORS);
export const crusherSensorAttributes = () => sensorAttributes(CRUSHER_SENSORS);
export const plantSensorAttributes = () => sensorAttributes(PLANT_SENSORS);
export const leachSensorAttributes = () => sensorAttributes(LEACH_SENSORS);
export const wasteSensorAttributes = () => sensorAttributes(WASTE_SENSORS);
export const garageSensorAttributes = () => sensorAttributes(GARAGE_SENSORS);
export const drillSensorAttributes = () => sensorAttributes(DRILL_SENSORS);
