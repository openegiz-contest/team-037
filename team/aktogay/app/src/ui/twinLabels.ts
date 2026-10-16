/** Подписи признаков двойников, единиц и значений на русском — для раздела «Двойники». */

export const KIND_LABEL: Record<string, string> = {
  site: 'Площадка',
  control: 'Управление',
  'open-pit': 'Карьер',
  excavator: 'Экскаватор',
  'haul-truck': 'Самосвал',
  crusher: 'Дробилка',
  concentrator: 'Обогатительная фабрика',
  'heap-leach': 'Кучное выщелачивание',
  'waste-dump': 'Отвал',
  garage: 'Гараж',
  'road-network': 'Дороги',
  blasting: 'Взрывные работы',
  'shift-log': 'Хронология смены',
  unit: 'Агрегат',
  'drill-rig': 'Буровой станок',
  stockpile: 'Склад дроблёной руды',
  orebody: 'Геология',
};

export const FEATURE_LABEL: Record<string, string> = {
  // геология
  assays_total: 'Проб XRF за смену',
  assays_ore: 'Проб с рудой (≥ 0,2 % Cu)',
  last_assay_cu: 'Последняя проба',
  last_assay_block: 'Последняя проба: блок у',
  // карьер
  sim_time: 'Время смены',
  finished: 'Смена завершена',
  seed: 'Сценарий событий (seed)',
  trucks: 'Самосвалов',
  strategy: 'Стратегия',
  events: 'Журнал событий',
  mined_total: 'Добыто всего',
  mined_sulfide: 'Сульфидная руда',
  mined_oxide: 'Оксидная руда',
  mined_waste: 'Вскрыша',
  tph: 'Производительность',
  plan_pct: 'Выполнение плана',
  plan_sulfide_pct: 'План по сульфиду',
  plan_oxide_pct: 'План по оксиду',
  plan_waste_pct: 'План по вскрыше',
  avg_queue_min: 'Средняя очередь',
  utilization_pct: 'Использование самосвалов',
  truck_idle_h: 'Простои самосвалов',
  excavator_idle_h: 'Простои экскаваторов',
  idle_cost: 'Стоимость простоев',
  fuel: 'Топливо',
  fuel_cost: 'Стоимость топлива',
  fuel_per_t: 'Топливо на тонну',
  crusher_idle_min: 'Простой фабрики',
  crusher_idle_cost: 'Стоимость простоя дробилки',
  unplanned_failures: 'Аварийные отказы',
  prevented_failures: 'Отказов предотвращено',
  false_alarms: 'Ложные тревоги',
  broken_h: 'В аварийном ремонте',
  service_h: 'В плановом ремонте',
  repair_cost: 'Стоимость ремонтов',
  feed_grade: 'Cu в питании фабрики',
  grade_in_band_pct: 'Качество руды в норме',
  recovery_pct: 'Извлечение меди',
  cu_conc: 'Медь в концентрате',
  blast_stop_h: 'Стоянка из-за взрывов',
  trips: 'Рейсов',
  // самосвал
  state: 'Состояние',
  x: 'Координата X',
  y: 'Координата Y',
  edge_from: 'Участок: от узла',
  edge_to: 'Участок: до узла',
  seg_pos: 'Пройдено по участку',
  node: 'Узел дороги',
  payload: 'Груз',
  material: 'Материал',
  grade: 'Содержание Cu в кузове',
  engine_hours: 'Моточасы',
  service_in: 'До ТО',
  trips_total: 'Рейсов',
  tonnes_total: 'Перевезено / обработано',
  dest_kind: 'Цель',
  dest_id: 'Номер цели',
  dest_purpose: 'Зачем в гараж',
  home_excavator: 'Своя петля (экскаватор)',
  fixed_excavator: 'Закреплён за экскаватором',
  timer: 'Таймер операции',
  park_slot: 'Место на стоянке',
  engine_temp: 'Температура двигателя',
  engine_temp_expected: 'Температура по модели',
  vibration: 'Вибрация рамы',
  tyre_pressure: 'Давление в шинах',
  failure_risk: 'Риск отказа',
  failure_eta: 'Прогноз до отказа',
  failure_alert: 'Тревога прогноза',
  failure_sign: 'Признак неисправности',
  health_index: 'Индекс деградации',
  service_requested: 'Назначен ППР',
  drv_dist: 'Пробег за смену',
  drv_ramp_time: 'Время на съездах',
  drv_ramp_dist: 'Пройдено по съездам',
  drv_fuel: 'Топливо в движении',
  drv_harsh: 'Резкие торможения',
  drv_fatigue: 'Усталость водителя (камера)',
  drv_fatigue_events: 'Эпизоды «микросна»',
  cas_alerts: 'Предупреждения CAS',
  // экскаватор
  queue: 'Очередь',
  queue_ids: 'В очереди (номера)',
  loading: 'Грузится самосвал',
  load_left: 'До конца погрузки',
  loads_total: 'Погрузок',
  busy: 'В работе',
  idle: 'В простое',
  broken: 'В поломке',
  repair_left: 'До конца ремонта',
  blast_left: 'До конца оцепления',
  blast_time: 'Стоял из-за взрывов',
  queue_avg: 'Средняя очередь',
  face_grade: 'Содержание Cu в забое',
  // дробилка, фабрика, отвалы
  bin: 'Руда в бункере',
  bin_cu: 'Медь в бункере',
  bin_grade: 'Содержание Cu в бункере',
  starved: 'Простой без руды',
  dumping_ids: 'Разгружаются (номера)',
  feed_rate: 'Питание фабрики',
  feed_total: 'Подано на фабрику',
  cu_feed: 'Медь в питании',
  cu_concentrate: 'Медь в концентрате',
  cu_loss: 'Потери меди',
  feed_time: 'Время работы',
  feed_in_band_time: 'Время в коридоре качества',
  // гараж, дороги, взрывы
  occupied: 'Занято мест',
  slots: 'Места (номера самосвалов)',
  in_service: 'В ремонте',
  refueling: 'На заправке',
  closed_count: 'Закрыто участков',
  closures: 'Закрытия',
  active: 'Идёт оцепление',
  announced: 'Объявлено',
  blasts: 'Взрывы смены',
  // склад дроблёной руды
  level: 'Руда на складе',
  fill: 'Заполнение склада',
  hours_left: 'Запас для фабрики',
  pile_grade: 'Cu в штабеле',
  cu: 'Медь в штабеле',
  inflow: 'Отсыпка с дробилки',
  outflow: 'Выдача на фабрику',
  inflow_total: 'Отсыпано за смену',
  dust: 'Запылённость',
  crusher_tpm: 'Производительность дробилки',
  // буровые станки и подготовка блоков
  target_ex: 'Блок у экскаватора (номер)',
  block: 'Бурит блок у',
  holes_done: 'Пробурено скважин на блоке',
  holes_total: 'Скважин на блоке',
  hole_depth: 'Глубина текущей скважины',
  penetration: 'Скорость проходки',
  pulldown: 'Усилие подачи',
  torque: 'Крутящий момент',
  air_pressure: 'Давление воздуха',
  meters_shift: 'Пробурено за смену',
  holes_shift: 'Скважин за смену',
  stock: 'Запас взорванной массы',
  hole_offset: 'Отклонение устья скважины',
  op_drill_time: 'Время бурения за смену',
  op_offset_avg: 'Среднее отклонение устьев',
  op_holes: 'Скважин у машиниста',
  op_jams: 'Заклинивания става',
  op_expected_m: 'Норма метров для той же породы',
  stock_shifts: 'Запаса хватит на',
  block_holes_done: 'Следующий блок: пробурено',
  block_holes_total: 'Следующий блок: скважин',
  // агрегаты внутри зданий
  power: 'Мощность привода',
  motor_current: 'Ток двигателя',
  hydraulic_pressure: 'Давление гидросистемы',
  bearing_temp: 'Температура подшипника',
  alarm: 'Тревога',
  belt_speed: 'Скорость ленты',
  load: 'Нагрузка',
  belt_misalign: 'Сход ленты',
  mill_load: 'Загрузка мельницы',
  speed: 'Обороты',
  pulp_density: 'Плотность пульпы',
  water: 'Расход воды',
  pressure: 'Давление на входе',
  p80: 'Крупность слива P80',
  cyclones_on: 'Циклонов в работе',
  froth_level: 'Уровень пены',
  air_flow: 'Расход воздуха',
  reagent_dose: 'Дозировка реагентов',
  conc_grade: 'Cu в концентрате',
  cells_running: 'Камер в работе',
  underflow_density: 'Плотность разгрузки',
  rake_torque: 'Момент на граблях',
  truck: 'Самосвал',
  flow: 'Подача',
  dispensed: 'Выдано за смену',
  refuels: 'Заправок',
  remaining: 'До конца ремонта',
  component: 'Узел',
  repairs: 'Ремонтов',
  // хронология смены
  minutes: 'Записано минут',
  excavators: 'Экскаваторы по минутам',
  crusher: 'Бункер по минутам',
  // управление
  command: 'Последняя команда',
  status: 'Статус симулятора',
};

export const UNIT_LABEL: Record<string, string> = {
  s: 'с',
  m: 'м',
  t: 'т',
  'trucks': 'самосв.',
  't/h': 'т/ч',
  min: 'мин',
  h: 'ч',
  l: 'л',
  'l/t': 'л/т',
  KZT: '₸',
  pcs: 'шт',
  trips: 'рейс.',
  loads: 'погр.',
  slots: 'мест',
  sections: 'уч.',
  C: '°C',
  'mm/s': 'мм/с',
  bar: 'бар',
  '%': '%',
  '% Cu': '% Cu',
  kW: 'кВт',
  MW: 'МВт',
  A: 'А',
  rpm: 'об/мин',
  'm/s': 'м/с',
  'm3/h': 'м³/ч',
  'm3/min': 'м³/мин',
  kPa: 'кПа',
  um: 'мкм',
  'g/t': 'г/т',
  'l/min': 'л/мин',
  'm/h': 'м/ч',
  kN: 'кН',
  'kN*m': 'кН·м',
  holes: 'скв.',
  'mg/m3': 'мг/м³',
  shifts: 'смен',
};

export const VALUE_LABEL: Record<string, string> = {
  to_plant: 'на фабрику',
  to_leach: 'на выщелачивание',
  to_dump: 'в отвал',
  pending: 'ждёт проб',
  // склад
  filling: 'идёт отсыпка',
  draining: 'расходуется',
  depleted: 'пуст',
  full: 'полон',
  // буровые станки, экскаватор без запаса
  drilling: 'бурит',
  moving: 'переезд',
  nostock: 'нет взорванной массы',
  // агрегаты
  run: 'работает',
  idling: 'холостой ход',
  stop: 'стоит',
  busy: 'занят',
  free: 'свободен',
  // самосвал
  idle: 'ожидает',
  empty: 'порожний рейс',
  queue: 'в очереди',
  loading: 'погрузка',
  loaded: 'гружёный рейс',
  dumping: 'разгрузка',
  refuel: 'заправка',
  service: 'плановый ремонт',
  broken: 'поломка',
  // экскаватор
  working: 'работает',
  waiting: 'ждёт самосвал',
  blast: 'стоит: взрыв',
  // дробилка, фабрика
  receiving: 'принимает руду',
  crushing: 'дробит',
  starved: 'нет руды',
  running: 'работает',
  stopped: 'простой',
  // прочее
  sulfide: 'сульфид',
  oxide: 'оксид',
  waste: 'вскрыша',
  none: '—',
  excavator: 'экскаватор',
  crusher: 'дробилка',
  dump: 'разгрузка',
  garage: 'гараж',
  smart: 'умная (реальная работа)',
  fixed: 'фиксированная (теневой расчёт)',
  engine: 'двигатель',
  hydraulic: 'гидравлика',
  tyre: 'шины',
};

/** Состояние объекта → тон индикатора. */
export function stateTone(state: string | undefined): 'ok' | 'busy' | 'warn' | 'bad' | 'idle' {
  switch (state) {
    case 'broken':
    case 'starved':
    case 'stopped':
    case 'stop':
    case 'nostock':
    case 'depleted':
      return 'bad';
    case 'full':
      return 'warn';
    case 'filling':
      return 'ok';
    case 'draining':
      return 'busy';
    case 'queue':
    case 'waiting':
    case 'blast':
    case 'service':
    case 'refuel':
      return 'warn';
    case 'loading':
    case 'loaded':
    case 'dumping':
    case 'working':
    case 'receiving':
    case 'crushing':
    case 'running':
    case 'run':
    case 'drilling':
      return 'ok';
    case 'moving':
      return 'busy';
    case 'busy':
      return 'warn';
    case 'idling':
      return 'busy';
    case 'empty':
      return 'busy';
    default:
      return 'idle';
  }
}

export const TONE_COLOR = { ok: '#22c55e', busy: '#38bdf8', warn: '#f59e0b', bad: '#ef4444', idle: '#6f7782' } as const;
