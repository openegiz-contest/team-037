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
};

export const FEATURE_LABEL: Record<string, string> = {
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
  crusher_idle_min: 'Простой дробилки',
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
};

export const VALUE_LABEL: Record<string, string> = {
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
      return 'bad';
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
      return 'ok';
    case 'empty':
      return 'busy';
    default:
      return 'idle';
  }
}

export const TONE_COLOR = { ok: '#22c55e', busy: '#38bdf8', warn: '#f59e0b', bad: '#ef4444', idle: '#6f7782' } as const;
