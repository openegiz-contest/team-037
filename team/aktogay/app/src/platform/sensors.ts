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
  /**
   * Признаки двойника, которые заполняет датчик; первый — главный. `*` обозначает семейство
   * признаков по номеру объекта (`block_*_cu` → `block_1_cu`, `block_2_cu`…). У разовых съёмок
   * (periodS = 0) результат лежит в атрибутах паспорта, а не в живых признаках.
   */
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
  {
    id: 'dss',
    name: 'Система контроля усталости водителя',
    hardware: 'ИК-камера в кабине: анализ век и положения головы, вибросигнал в сиденье и сигнал диспетчеру',
    location: 'кабина, над приборной панелью',
    measures: 'индекс усталости, %, эпизоды закрытых глаз («микросон»)',
    features: ['drv_fatigue', 'drv_fatigue_events'],
    periodS: 1,
    purpose: 'вовремя отправить водителя на паузу — до происшествия',
  },
  {
    id: 'cas',
    name: 'Система предотвращения столкновений (CAS)',
    hardware: 'обмен координатами между машинами (V2V) + радары ближней зоны',
    location: 'кабина и бамперы',
    measures: 'сближения с машиной впереди ближе безопасной дистанции',
    features: ['cas_alerts'],
    periodS: 1,
    purpose: 'предупреждение в кабину и учёт опасных сближений',
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

export const LEACH_SENSORS: SensorSpec[] = [
  ...dumpSensors('руда', 'площадка кучного выщелачивания'),
  {
    id: 'irrigation',
    name: 'Узлы орошения карт',
    hardware: 'электромагнитные расходомеры и задвижки с приводом на коллекторе каждой карты',
    location: 'магистраль раствора на площадке, каждая карта',
    measures: 'какие карты поливаются по графику, расход раствора на орошение, м³/ч',
    features: ['cells', 'irrigation_group', 'cells_irrigated', 'cells_irrigating'],
    periodS: 60,
    purpose: 'соблюдение графика орошения, плотность полива по картам',
  },
  {
    id: 'pls',
    name: 'Анализатор и расходомер продуктивного раствора',
    hardware: 'поточный анализатор меди и pH + расходомер на сбросе в пруд PLS',
    location: 'коллектор PLS, пруд продуктивного раствора',
    measures: 'расход PLS, м³/ч; медь в растворе, г/л',
    features: ['pls_flow', 'pls_cu', 'cu_leached_total'],
    periodS: 60,
    purpose: 'сколько меди переходит в раствор и с каких карт',
  },
];

export const ENERGY_SENSORS: SensorSpec[] = [
  {
    id: 'feeders',
    name: 'Счётчики на ячейках подстанции',
    hardware: 'многофункциональные счётчики на фидерах 35/6 кВ, трансформаторы тока и напряжения',
    location: 'главная понизительная подстанция',
    measures: 'активная мощность и энергия по каждому участку, МВт и кВт·ч',
    features: ['total_mw', 'kwh_shift', 'plant_mw', 'crusher_mw', 'sxew_mw', 'tailings_mw', 'leach_mw', 'pit_mw', 'aux_mw'],
    periodS: 60,
    purpose: 'куда уходит энергия и сколько стоит смена',
  },
  {
    id: 'quality',
    name: 'Анализатор качества электроэнергии',
    hardware: 'анализатор на вводе: пики нагрузки, коэффициент мощности, провалы напряжения',
    location: 'ввод главной подстанции',
    measures: 'пиковая мощность за смену, МВт',
    features: ['peak_mw'],
    periodS: 60,
    purpose: 'пик нагрузки определяет плату за мощность',
  },
  {
    id: 'specific',
    name: 'Расчёт удельного расхода',
    hardware: 'не прибор: расчёт двойника по счётчикам, конвейерным весам и выпуску меди',
    location: 'энергоучёт',
    measures: 'кВт·ч на тонну руды и на тонну меди',
    features: ['kwh_per_t_ore', 'kwh_per_t_cu', 'idle_kwh'],
    periodS: 60,
    purpose: 'главный показатель энергоэффективности и цена простоя фабрики в энергии',
  },
];

export const WEATHER_SENSORS: SensorSpec[] = [
  {
    id: 'ams',
    name: 'Автоматическая метеостанция',
    hardware: 'датчики температуры и влажности, анемометр и флюгер на мачте 10 м, барометр',
    location: 'промплощадка у карьера',
    measures: 'температура воздуха, °C; скорость и направление ветра, м/с',
    features: ['temp', 'wind', 'season', 'month'],
    periodS: 60,
    purpose: 'ветер решает, можно ли взрывать; мороз — работу дробилки и выщелачивания',
  },
  {
    id: 'visibility',
    name: 'Датчик видимости',
    hardware: 'трансмиссометр на выезде из карьера',
    location: 'главный съезд',
    measures: 'метеорологическая дальность видимости, м',
    features: ['visibility', 'sky'],
    periodS: 60,
    purpose: 'по видимости вводят ограничение скорости и останавливают возку',
  },
  {
    id: 'road_state',
    name: 'Контроль состояния дорожного покрытия',
    hardware: 'дорожные датчики температуры покрытия и наличия льда',
    location: 'технологические дороги и съезды',
    measures: 'гололёд, снег и вода на дороге',
    features: ['speed_factor'],
    periodS: 300,
    purpose: 'насколько снижена скорость возки относительно сухой дороги',
  },
];

export const TAILINGS_SENSORS: SensorSpec[] = [
  {
    id: 'pulp_line',
    name: 'Плотномер и расходомер пульпопровода',
    hardware: 'радиоизотопный плотномер + электромагнитный расходомер на напорном пульпопроводе',
    location: 'насосная станция хвостов на фабрике',
    measures: 'расход пульпы, м³/ч, и доля твёрдого в ней',
    features: ['pulp_flow', 'solids_tph', 'tails_shift'],
    periodS: 10,
    purpose: 'сколько хвостов уходит в чашу и с какой плотностью',
  },
  {
    id: 'piezo',
    name: 'Пьезометры в теле дамбы',
    hardware: 'струнные пьезометры в скважинах по створам дамбы',
    location: 'ограждающая дамба, контрольные створы',
    measures: 'поровое давление — насыщение тела дамбы, % от критического',
    features: ['piezo'],
    periodS: 600,
    purpose: 'главный признак устойчивости: чем выше насыщение, тем опаснее',
  },
  {
    id: 'pond_level',
    name: 'Уровнемер пруда оборотной воды',
    hardware: 'радарный уровнемер на водозаборной башне + рейки на откосе',
    location: 'пруд отстоявшейся воды',
    measures: 'уровень пруда и запас до гребня дамбы, м',
    features: ['pond_level', 'freeboard', 'beach'],
    periodS: 60,
    purpose: 'запас до гребня — по нему решают, можно ли продолжать намыв',
  },
  {
    id: 'seepage',
    name: 'Замерный лоток фильтрации',
    hardware: 'водослив с тонкой стенкой и уровнемер в дренажной канаве',
    location: 'низовой откос дамбы, дренажный коллектор',
    measures: 'расход профильтровавшейся воды, л/мин',
    features: ['seepage'],
    periodS: 600,
    purpose: 'рост фильтрации — ранний признак проблем с дамбой',
  },
  {
    id: 'reclaim',
    name: 'Учёт оборотной воды',
    hardware: 'расходомеры на насосной оборотного водоснабжения и на водоводе свежей воды',
    location: 'насосная станция оборотной воды',
    measures: 'сколько воды вернулось на фабрику и сколько добрали свежей, м³',
    features: ['reclaim_flow', 'reclaim_total', 'makeup_water', 'water_in'],
    periodS: 60,
    purpose: 'водный баланс фабрики: оборотная вода вместо свежей',
  },
];

export const SXEW_SENSORS: SensorSpec[] = [
  {
    id: 'rectifier',
    name: 'Выпрямитель серии электролиза',
    hardware: 'датчики тока и напряжения выпрямительного агрегата',
    location: 'цех электролиза (EW)',
    measures: 'ток серии ванн, кА',
    features: ['ew_current'],
    periodS: 10,
    purpose: 'темп осаждения меди по закону Фарадея',
  },
  {
    id: 'cathode_scale',
    name: 'Весы катодной меди',
    hardware: 'весы на линии съёма и упаковки катодов',
    location: 'машина сдирки катодов',
    measures: 'выпуск катодной меди, т',
    features: ['cathode_total', 'cathode_tpd'],
    periodS: 60,
    purpose: 'выпуск катодов за смену и в сутки',
  },
  {
    id: 'acid',
    name: 'Учёт серной кислоты',
    hardware: 'расходомеры на подаче кислоты в раствор орошения и в электролит',
    location: 'кислотное хозяйство',
    measures: 'расход кислоты, т',
    features: ['acid_total'],
    periodS: 60,
    purpose: 'расход реагента на тонну руды и меди',
  },
];
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

export const STOCKPILE_SENSORS: SensorSpec[] = [
  {
    id: 'level',
    name: 'Сканер объёма штабеля',
    hardware: '3D-лидар на галерее конвейера + сверка съёмкой с дрона',
    location: 'галерея над складом',
    measures: 'объём и масса руды в штабеле, т',
    features: ['level', 'fill', 'hours_left'],
    periodS: 10,
    purpose: 'запас руды для фабрики в часах',
  },
  {
    id: 'scale_in',
    name: 'Конвейерные весы отсыпки',
    hardware: 'тензометрические весы на конвейере дробилка → склад',
    location: 'конвейер отсыпки',
    measures: 'поступление руды на склад, т/ч',
    features: ['inflow', 'inflow_total'],
    periodS: 1,
    purpose: 'баланс склада, работа дробилки',
  },
  {
    id: 'scale_out',
    name: 'Весы питателей в тоннеле',
    hardware: 'весы на конвейере под штабелем',
    location: 'тоннель под складом',
    measures: 'выдача на фабрику, т/ч',
    features: ['outflow'],
    periodS: 1,
    purpose: 'сколько руды забирает фабрика',
  },
  {
    id: 'dust',
    name: 'Датчики запылённости',
    hardware: 'оптические пылемеры PM10 у склада + анемометр',
    location: 'вокруг штабеля',
    measures: 'концентрация пыли, мг/м³',
    features: ['dust'],
    periodS: 10,
    purpose: 'включение водяных завес при отсыпке, охрана труда',
  },
];

export const CONCENTRATE_SENSORS: SensorSpec[] = [
  {
    id: 'stock',
    name: 'Учёт склада концентрата',
    hardware: 'конвейерные весы на подаче с фабрики + лазерный сканер штабеля',
    location: 'крытый склад концентрата',
    measures: 'выпуск и остаток концентрата, т',
    features: ['stock', 'produced_total'],
    periodS: 60,
    purpose: 'сколько концентрата готово к отгрузке',
  },
  {
    id: 'wagon_scale',
    name: 'Вагонные весы',
    hardware: 'тензометрические весы под путём погрузки',
    location: 'ж/д погрузка',
    measures: 'масса концентрата в каждом вагоне, т',
    features: ['wagons_loaded', 'wagon_progress'],
    periodS: 10,
    purpose: 'недогруз и перегруз вагонов, учёт отгрузки',
  },
  {
    id: 'rfid',
    name: 'RFID-считыватели вагонов',
    hardware: 'считыватели меток на въезде и выезде с пути погрузки',
    location: 'ж/д пути у склада',
    measures: 'номера вагонов, отправленные составы',
    features: ['trains_shift', 'shipped_total', 'cu_shipped'],
    periodS: 10,
    purpose: 'отгрузка по составам и вагонам',
  },
];

export const GEOLOGY_SENSORS: SensorSpec[] = [
  {
    id: 'core',
    name: 'Разведочное бурение с отбором керна',
    hardware: 'колонковые буровые станки + химическая лаборатория (пробы керна по интервалам)',
    location: 'сеть разведочных скважин по месторождению',
    measures: 'содержание меди по глубине → блочная модель',
    features: ['resources_below_pit'],
    periodS: 0,
    purpose: 'границы рудного тела и запасы — основа плана горных работ',
  },
  {
    id: 'xrf',
    name: 'XRF-анализатор шлама взрывных скважин',
    hardware: 'рентгенофлуоресцентный анализатор (переносной или на буровом станке)',
    location: 'буровые блоки на рабочих уступах',
    measures: 'содержание меди в шламе каждой скважины, %',
    features: ['assays_total', 'assays_ore', 'last_assay_cu', 'last_assay_block', 'block_*_cu', 'block_*_dest'],
    periodS: 60,
    purpose: 'рудный контроль: куда пойдёт блок после взрыва — фабрика, выщелачивание, отвал',
  },
  {
    id: 'hyper',
    name: 'Гиперспектральная камера на дроне',
    hardware: 'беспилотник с гиперспектральной камерой (видимый + ближний ИК диапазон)',
    location: 'облёт бортов карьера',
    measures: 'минералы на открытых бортах: малахит, халькопирит, пустая порода',
    features: ['face_*_zone'],
    periodS: 0,
    purpose: 'сверка вскрытых бортов с моделью, граница зоны окисления',
  },
  {
    id: 'ip',
    name: 'Электроразведка методом вызванной поляризации (ВП)',
    hardware: 'генератор тока + приёмные электроды по профилям',
    location: 'профили через карьер и вокруг',
    measures: 'заряжаемость пород — аномалия сульфидов на глубине',
    features: ['resources_below_pit'],
    periodS: 0,
    purpose: 'руда под дном карьера: планирование углубки и следующих стадий',
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
  stockpile: STOCKPILE_SENSORS,
  orebody: GEOLOGY_SENSORS,
  'concentrate-store': CONCENTRATE_SENSORS,
  'sxew-plant': SXEW_SENSORS,
  'tailings-dam': TAILINGS_SENSORS,
  'weather-station': WEATHER_SENSORS,
  'power-meter': ENERGY_SENSORS,
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
export const stockpileSensorAttributes = () => sensorAttributes(STOCKPILE_SENSORS);
export const geologySensorAttributes = () => sensorAttributes(GEOLOGY_SENSORS);
export const concentrateSensorAttributes = () => sensorAttributes(CONCENTRATE_SENSORS);
export const sxewSensorAttributes = () => sensorAttributes(SXEW_SENSORS);
export const tailingsSensorAttributes = () => sensorAttributes(TAILINGS_SENSORS);
export const weatherSensorAttributes = () => sensorAttributes(WEATHER_SENSORS);
export const energySensorAttributes = () => sensorAttributes(ENERGY_SENSORS);
