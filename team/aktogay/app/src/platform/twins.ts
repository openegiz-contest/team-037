/**
 * Контракт двойников рудника «Актогай» в OpenEgiz (Eclipse Ditto).
 *
 * Симулятор (service/) сериализует состояние модели в признаки (features) двойников и публикует
 * их по MQTT командами Ditto `modify`; интерфейс читает двойников из Ditto и восстанавливает по ним
 * картину рудника. Один и тот же модуль используется с обеих сторон, поэтому формат согласован.
 *
 * Пространства имён:
 *   org.aktogay           — площадка и двойник управления (команды «что если»)
 *   org.aktogay.smart     — реальная работа рудника (умная диспетчеризация)
 *   org.aktogay.fixed     — теневой расчёт той же смены без системы (фиксированное закрепление)
 */
import type { Kpis } from '../sim/kpi';
import type { Simulation } from '../sim/engine';
import { MATERIALS, TRUCK_STATES, type Blast, type Destination, type FailureType, type Material, type StrategyName, type TruckState } from '../sim/types';
import { gradeAt } from '../sim/ore';
import { CHAIN2_FEED_TPH } from '../sim/chain2';
import { EW_CELL_VOLTS } from '../sim/energy';
import { costBreakdown, GROUP_RU, type CostGroup } from '../sim/cost';
import { BLAST_WIND_MS, LEACH_FROST_C, MONTH_RU, SEASON_RU, SKY, type Sky } from '../sim/weather';
import { CAPACITY_MT, CREST_ABOVE_BEACH_M, CREST_FINAL_M, FREEBOARD_MIN_M, POND_AREA_M2, RECYCLE_PCT, SOLIDS_PCT } from '../sim/tailings';
import { CELL_CAP_T, EW_CELLS, IRRIGATION_GROUPS, IRRIGATION_WINDOW_H, LEACH_DAYS, OXIDE_GRADE_PCT, REC_MAX, SX_EFFICIENCY, type CellStage } from '../sim/leach';
import { KPP_LANES, WEIGH_AUTO_SEC, WEIGH_MANUAL_SEC } from '../sim/checkpoint';
import { CAMP_BEDS, CAMP_DORMS, CAMP_RESIDENTS, FUEL_TANK_L, GEN_MW } from '../sim/camp';
import { CONC_GRADE, TRAIN_WAGONS, WAGON_LOAD_SEC, WAGON_T } from '../sim/concentrate';
import { BENCH_M, BLOCK_M, blockSummary, buildOreModel, CUTOFF, DENSITY, holeAssays, pitResources, type OreModel } from '../geo/orebody';
import { PIT_DEPTH } from '../geo/relief';
import { UNIT_DEFS, type UnitState } from '../sim/equipment';
import { checkpointSensorAttributes, campSensorAttributes, substationSensorAttributes, energySensorAttributes, weatherSensorAttributes, tailingsSensorAttributes, sxewSensorAttributes, concentrateSensorAttributes, drillSensorAttributes, geologySensorAttributes, stockpileSensorAttributes, crusherSensorAttributes, excavatorSensorAttributes, garageSensorAttributes, leachSensorAttributes, plantSensorAttributes, truckSensorAttributes, wasteSensorAttributes } from './sensors';

export const SITE_NS = 'org.aktogay';
export const SITE_ID = `${SITE_NS}:aktogay`;
export const CONTROL_ID = `${SITE_NS}:control`;
export const VARIANTS: StrategyName[] = ['fixed', 'smart'];
export const variantNs = (v: StrategyName) => `${SITE_NS}.${v}`;

export const thingIds = (v: StrategyName) => {
  const ns = variantNs(v);
  return {
    mine: `${ns}:mine`,
    excavator: (i: number) => `${ns}:excavator-${i + 1}`,
    truck: (i: number) => `${ns}:truck-${101 + i}`,
    crusher: `${ns}:crusher`,
    plant: `${ns}:plant`,
    leach: `${ns}:heap-leach`,
    waste: `${ns}:waste-dump`,
    garage: `${ns}:garage`,
    roads: `${ns}:roads`,
    blasting: `${ns}:blasting`,
    shift: `${ns}:shift`,
    stockpile: `${ns}:stockpile`,
    geology: `${ns}:geology`,
    concentrate: `${ns}:concentrate`,
    sxew: `${ns}:sxew`,
    tailings: `${ns}:tailings`,
    weather: `${ns}:weather`,
    energy: `${ns}:energy`,
    cost: `${ns}:cost`,
    crusher2: `${ns}:crusher-2`,
    stockpile2: `${ns}:stockpile-2`,
    plant2: `${ns}:plant-2`,
    sub: `${ns}:substation-1`,
    sub2: `${ns}:substation-2`,
    camp: `${ns}:camp`,
    kpp: `${ns}:checkpoint`,
    unit2: (key: string) => `${ns}:${key}-2`,
    unit: (key: string) => `${ns}:${key}`,
    drill: (i: number) => `${ns}:drill-${i + 1}`,
  };
};

/** Признак Ditto: { properties: { value, unit? } }. */
export type Feature = { properties: { value: number | string; unit?: string } };
export type Features = Record<string, Feature>;

const f = (value: number | string | boolean, unit?: string): Feature => ({
  properties: unit ? { value: typeof value === 'boolean' ? Number(value) : value, unit } : { value: typeof value === 'boolean' ? Number(value) : value },
});
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ───────────────────────────── определения двойников (создание) ─────────────────────────────

export interface ThingBody {
  policyId: string;
  attributes: Record<string, unknown>;
  features: Features;
}

const POLICY = 'default:basic_policy';

/** Все двойники одного варианта рудника с атрибутами (статические характеристики) и связями. */
export function thingDefinitions(sim: Simulation, v: StrategyName): Record<string, ThingBody> {
  const id = thingIds(v);
  const cfg = sim.cfg;
  const parent = id.mine;
  const out: Record<string, ThingBody> = {};
  out[id.mine] = {
    policyId: POLICY,
    attributes: {
      name: v === 'smart' ? 'Карьер Актогай — реальная работа' : 'Теневой расчёт — без системы диспетчеризации',
      kind: 'open-pit',
      _isType: false,
      _parents: SITE_ID,
      strategy: v,
      depth_m: PIT_DEPTH,
      plan_t: cfg.planT,
    },
    features: serializeMine(sim, null),
  };
  sim.excavators.forEach((ex, i) => {
    out[id.excavator(i)] = {
      policyId: POLICY,
      attributes: { name: `Экскаватор ${ex.name}`, kind: 'excavator', _isType: false, _parents: parent, material: ex.material, rate_tpm: ex.rateTpm, ring: cfg.excavators[i].ring, angle_deg: cfg.excavators[i].angleDeg, sensors: excavatorSensorAttributes(), feeds: ex.material === 'sulfide' ? id.crusher : ex.material === 'oxide' ? id.leach : id.waste },
      features: serializeExcavator(sim, i),
    };
  });
  sim.trucks.forEach((t, i) => {
    out[id.truck(i)] = {
      policyId: POLICY,
      attributes: { name: `Самосвал ${t.name}`, kind: 'haul-truck', _isType: false, _parents: parent, capacity_t: cfg.truck.payloadT, model_class: '220 t (БелАЗ-75306 class)', driver: t.driver.name, driver_years: t.driver.years, sensors: truckSensorAttributes() },
      features: serializeTruck(sim, i),
    };
  });
  out[id.crusher] = {
    policyId: POLICY,
    attributes: { name: 'Первичная дробилка ККД', kind: 'crusher', _isType: false, _parents: parent, bin_capacity_t: cfg.dumps.crusher.binCapT, crusher_tpm: cfg.dumps.crusher.crusherTpm, feeds: id.stockpile, sensors: crusherSensorAttributes() },
    features: serializeCrusher(sim),
  };
  out[id.plant] = {
    policyId: POLICY,
    attributes: { name: 'Обогатительная фабрика', kind: 'concentrator', _isType: false, _parents: parent, feed_tpm: cfg.dumps.crusher.plantFeedTpm, target_grade_pct: cfg.grade.targetPct, sensors: plantSensorAttributes() },
    features: serializePlant(sim),
  };
  out[id.stockpile] = {
    policyId: POLICY,
    attributes: {
      name: 'Склад дроблёной руды',
      kind: 'stockpile',
      _isType: false,
      _parents: parent,
      live_capacity_t: cfg.dumps.crusher.stockpileCapT,
      feeds: id.plant,
      sensors: stockpileSensorAttributes(),
    },
    features: serializeStockpile(sim),
  };
  {
    const m = oreModel(sim);
    const r = pitResources(sim, m);
    out[id.geology] = {
      policyId: POLICY,
      attributes: {
        name: 'Геология: рудное тело и рудный контроль',
        kind: 'orebody',
        _isType: false,
        _parents: parent,
        deposit_type: 'медно-порфировое (модель условная, подогнана к забоям)',
        cutoff_pct: CUTOFF,
        block_size_m: [BLOCK_M, BLOCK_M, BENCH_M],
        density_t_m3: DENSITY,
        oxide_zone_m: 110,
        resources_below_pit: {
          to_depth_m: 480,
          sulfide_t: Math.round(r.sulfideT),
          sulfide_cu_pct: r3(r.sulfideCu),
          oxide_t: Math.round(r.oxideT),
          oxide_cu_pct: r3(r.oxideCu),
          waste_t: Math.round(r.wasteT),
          contained_cu_t: Math.round(r.cuT),
          strip_ratio: r1(r.strip),
        },
        sensors: geologySensorAttributes(),
      },
      features: serializeGeology(sim),
    };
  }
  out[id.concentrate] = {
    policyId: POLICY,
    attributes: {
      name: 'Склад концентрата и ж/д отгрузка',
      kind: 'concentrate-store',
      _isType: false,
      _parents: parent,
      conc_grade_pct: CONC_GRADE * 100,
      wagon_t: WAGON_T,
      train_wagons: TRAIN_WAGONS,
      note: 'состав масштабирован под моделируемый сегмент парка',
      sensors: concentrateSensorAttributes(),
    },
    features: serializeConcentrate(sim),
  };
  out[id.leach] = {
    policyId: POLICY,
    attributes: {
      name: 'Площадка кучного выщелачивания',
      kind: 'heap-leach',
      _isType: false,
      _parents: parent,
      cell_cap_t: CELL_CAP_T,
      cell_count: sim.leach.cells.length,
      irrigation_groups: IRRIGATION_GROUPS,
      irrigation_window_h: IRRIGATION_WINDOW_H,
      oxide_grade_pct: OXIDE_GRADE_PCT,
      rec_max_pct: REC_MAX * 100,
      leach_days: LEACH_DAYS,
      note: 'cells: карта = стадия:руда т:медь т:сутки орошения:извлечено меди т, через «;»',
      sensors: leachSensorAttributes(),
    },
    features: serializeLeach(sim),
  };
  // Вторая цепочка комбината: ККД-2 → склад ОФ-2 → ОФ-2. Подвоз руды условный (остальной парк).
  const c2 = sim.chain2;
  const c2note = 'вторая цепочка комбината; подвоз руды условный — его везёт остальной парк, которого в модели нет';
  out[id.crusher2] = {
    policyId: POLICY,
    attributes: { name: 'Первичная дробилка ККД-2', kind: 'crusher-2', _isType: false, _parents: parent, bin_capacity_t: cfg.dumps.crusher.binCapT, crusher_tpm: cfg.dumps.crusher.crusherTpm, supply_tph: CHAIN2_FEED_TPH, feeds: id.stockpile2, note: c2note, sensors: crusherSensorAttributes() },
    features: serializeCrusher2(sim),
  };
  out[id.stockpile2] = {
    policyId: POLICY,
    attributes: { name: 'Склад дроблёной руды ОФ-2', kind: 'stockpile-2', _isType: false, _parents: parent, live_capacity_t: cfg.dumps.crusher.stockpileCapT, feeds: id.plant2, note: c2note, sensors: stockpileSensorAttributes() },
    features: serializeStockpile(c2.view),
  };
  out[id.plant2] = {
    policyId: POLICY,
    attributes: { name: 'Обогатительная фабрика №2', kind: 'concentrator-2', _isType: false, _parents: parent, feed_tpm: cfg.dumps.crusher.plantFeedTpm, target_grade_pct: cfg.grade.targetPct, note: c2note, sensors: plantSensorAttributes() },
    features: serializePlant(c2.view),
  };
  for (const u of c2.equipment.units) {
    out[id.unit2(u.def.key)] = {
      policyId: POLICY,
      attributes: {
        name: `${u.def.name} (${u.def.building === 'crusher' ? 'ККД-2' : 'ОФ-2'})`,
        kind: 'unit',
        _isType: false,
        _parents: u.def.building === 'crusher' ? id.crusher2 : id.plant2,
        building: u.def.building === 'crusher' ? 'crusher2' : 'plant2',
        key_features: u.def.keyFeatures,
        sensors: u.def.sensors,
        ...(u.def.bearingC ? { bearing_alarm_c: u.def.alarmC } : {}),
      },
      features: serializeUnit(c2.view, u.def.key),
    };
  }
  const subDefs: [string, string, string][] = [
    [id.sub, 'Подстанция ОФ-1', 'питает ОФ-1, первую дробилку, завод SX-EW, насосные и карьер'],
    [id.sub2, 'Подстанция ОФ-2', 'питает ОФ-2 и ККД-2'],
  ];
  subDefs.forEach(([sid, name, feeds], i) => {
    out[sid] = {
      policyId: POLICY,
      attributes: { name, kind: 'substation', _isType: false, _parents: parent, voltage_kv: 110, feeder_kv: 35, rated_mw: i === 0 ? 90 : 75, feeds, note: 'место и схема питания условные; нагрузка — из энергоучёта', sensors: substationSensorAttributes() },
      features: serializeSubstation(sim, i === 0 ? 'sub' : 'sub2'),
    };
  });
  out[id.camp] = {
    policyId: POLICY,
    attributes: {
      name: 'Вахтовый посёлок',
      kind: 'camp',
      _isType: false,
      _parents: parent,
      residents: CAMP_RESIDENTS,
      beds: CAMP_BEDS,
      dorms: CAMP_DORMS,
      generator_mw: GEN_MW,
      fuel_tank_l: FUEL_TANK_L,
      note: 'численность, нормы воды и мощности — оценки по открытым нормам для вахтовых посёлков',
      sensors: campSensorAttributes(),
    },
    features: serializeCamp(sim),
  };
  out[id.kpp] = {
    policyId: POLICY,
    attributes: {
      name: 'КПП и автовесы',
      kind: 'checkpoint',
      _isType: false,
      _parents: parent,
      lanes: KPP_LANES,
      weigh_auto_s: WEIGH_AUTO_SEC,
      weigh_manual_s: WEIGH_MANUAL_SEC,
      note: 'поток грузовиков и время взвешивания — оценки порядка величины; место — на главной дороге по OpenStreetMap',
      sensors: checkpointSensorAttributes(),
    },
    features: serializeCheckpoint(sim),
  };
  out[id.cost] = {
    policyId: POLICY,
    attributes: {
      name: 'Себестоимость тонны меди',
      kind: 'cost-model',
      _isType: false,
      _parents: parent,
      standard: 'C1 cash cost: прямые затраты без амортизации, процентов и налогов',
      kzt_per_usd: sim.cfg.economics.kztPerUsd,
      payable_cu_pct: sim.cfg.economics.payableCuPct,
      note: 'часть статей считает модель, часть — ставки-оценки по открытым данным; доля посчитанного в modelled_pct',
    },
    features: serializeCost(sim),
  };
  out[id.energy] = {
    policyId: POLICY,
    attributes: {
      name: 'Электроснабжение и энергоучёт',
      kind: 'power-meter',
      _isType: false,
      _parents: parent,
      tariff_kzt_kwh: sim.cfg.economics.energyKztPerKwh,
      ew_cell_volts: EW_CELL_VOLTS,
      note: 'мощности агрегатов — оценки; самосвалы и экскаваторы дизельные и в баланс не входят; areas_kwh: участок:кВт·ч через «;»',
      sensors: energySensorAttributes(),
    },
    features: serializeEnergy(sim),
  };
  out[id.weather] = {
    policyId: POLICY,
    attributes: {
      name: 'Погода и сезон',
      kind: 'weather-station',
      _isType: false,
      _parents: parent,
      month: sim.weather.month,
      month_name: MONTH_RU[sim.weather.month - 1],
      season: SEASON_RU[sim.weather.season],
      blast_wind_limit_ms: BLAST_WIND_MS,
      leach_frost_c: LEACH_FROST_C,
      note: 'климатические нормы — оценки по открытым данным востока Казахстана, не метеостанция рудника',
      sensors: weatherSensorAttributes(),
    },
    features: serializeWeather(sim),
  };
  out[id.tailings] = {
    policyId: POLICY,
    attributes: {
      name: 'Хвостохранилище',
      kind: 'tailings-dam',
      _isType: false,
      _parents: parent,
      capacity_mt: CAPACITY_MT,
      crest_final_m: CREST_FINAL_M,
      crest_above_beach_m: CREST_ABOVE_BEACH_M,
      freeboard_min_m: FREEBOARD_MIN_M,
      solids_pct: SOLIDS_PCT,
      recycle_pct: RECYCLE_PCT,
      fed_from: id.plant,
      note: 'ёмкость и отметки — оценки по контуру чаши со снимка; фильтрационный расчёт не ведётся',
      sensors: tailingsSensorAttributes(),
    },
    features: serializeTailings(sim),
  };
  out[id.sxew] = {
    policyId: POLICY,
    attributes: {
      name: 'Завод SX-EW (катодная медь)',
      kind: 'sxew-plant',
      _isType: false,
      _parents: parent,
      sx_efficiency_pct: SX_EFFICIENCY * 100,
      ew_cells: EW_CELLS,
      feeds_from: id.leach,
      sensors: sxewSensorAttributes(),
    },
    features: serializeSxew(sim),
  };
  out[id.waste] = {
    policyId: POLICY,
    attributes: { name: 'Отвалы вскрыши', kind: 'waste-dump', _isType: false, _parents: parent, sensors: wasteSensorAttributes(), dumps: sim.dumps.filter((d) => d.material === 'waste').map((d) => d.name) },
    features: serializeWaste(sim),
  };
  out[id.garage] = { policyId: POLICY, attributes: { name: 'Гараж, АЗС и стоянка', kind: 'garage', _isType: false, _parents: parent, slots: sim.parking.slots.length, sensors: garageSensorAttributes() }, features: serializeGarage(sim) };
  out[id.roads] = { policyId: POLICY, attributes: { name: 'Дорожная сеть карьера', kind: 'road-network', _isType: false, _parents: parent, edges: sim.layout.graph.edges.length }, features: serializeRoads(sim) };
  out[id.blasting] = { policyId: POLICY, attributes: { name: 'Буровзрывные работы', kind: 'blasting', _isType: false, _parents: parent }, features: serializeBlasting(sim) };
  // Буровые станки — бурят блоки у забоев под взрыв.
  sim.drill.rigs.forEach((g, i) => {
    out[id.drill(i)] = {
      policyId: POLICY,
      attributes: {
        name: `Буровой станок ${g.name}`,
        kind: 'drill-rig',
        _isType: false,
        _parents: parent,
        model_class: 'гусеничный станок шарошечного бурения, скважины Ø 250 мм',
        hole_depth_m: 16,
        operator: g.operator.name,
        operator_years: g.operator.years,
        sensors: drillSensorAttributes(),
      },
      features: serializeDrill(sim, i),
    };
  });
  // Агрегаты внутри зданий — дочерние двойники дробилки, фабрики и гаража.
  const parentOf = { crusher: id.crusher, plant: id.plant, garage: id.garage };
  for (const u of sim.equipment.units) {
    out[id.unit(u.def.key)] = {
      policyId: POLICY,
      attributes: {
        name: u.def.name,
        kind: 'unit',
        _isType: false,
        _parents: parentOf[u.def.building],
        building: u.def.building,
        key_features: u.def.keyFeatures,
        sensors: u.def.sensors,
        ...(u.def.bearingC ? { bearing_alarm_c: u.def.alarmC } : {}),
      },
      features: serializeUnit(sim, u.def.key),
    };
  }
  out[id.shift] = {
    policyId: POLICY,
    attributes: {
      name: 'Хронология смены',
      kind: 'shift-log',
      _isType: false,
      _parents: parent,
      encoding: 'символ на минуту; самосвал: i ожидание, e порожний, q очередь, l погрузка, L гружёный, d разгрузка, f заправка, s ППР, b поломка; экскаватор: w работа, i ждёт, b поломка, x взрыв; бункер: 0–9 уровень, s пусто',
    },
    features: serializeShift(sim),
  };
  return out;
}

export function siteDefinitions(): Record<string, ThingBody> {
  return {
    [SITE_ID]: {
      policyId: POLICY,
      attributes: { name: 'Медный рудник Актогай (модель по открытым данным)', kind: 'site', _isType: false, region: 'Восточный Казахстан' },
      features: {},
    },
    [CONTROL_ID]: {
      policyId: POLICY,
      attributes: { name: 'Управление сценариями «что если»', kind: 'control', _isType: false, _parents: SITE_ID },
      features: { command: f('none'), status: f('starting') },
    },
  };
}

// ───────────────────────────── сериализация (симулятор → двойники) ─────────────────────────────

export function serializeMine(sim: Simulation, k: Kpis | null): Features {
  const out: Features = {
    sim_time: f(Math.round(sim.now), 's'),
    finished: f(sim.finished),
    seed: f(sim.seed),
    trucks: f(sim.trucks.length),
    strategy: f(sim.strategyName),
    events: f(JSON.stringify(sim.log.slice(-10).map((l) => [l.t, l.level, l.text]))),
  };
  if (k) {
    out.mined_sulfide = f(Math.round(k.mined.sulfide), 't');
    out.mined_oxide = f(Math.round(k.mined.oxide), 't');
    out.mined_waste = f(Math.round(k.mined.waste), 't');
    out.mined_total = f(Math.round(k.minedTotal), 't');
    out.tph = f(Math.round(k.tph), 't/h');
    out.plan_pct = f(r1(k.planTotalPct), '%');
    out.plan_sulfide_pct = f(r1(k.planPct.sulfide), '%');
    out.plan_oxide_pct = f(r1(k.planPct.oxide), '%');
    out.plan_waste_pct = f(r1(k.planPct.waste), '%');
    out.avg_queue_min = f(r3(k.avgQueueMin), 'min');
    out.utilization_pct = f(r1(k.utilizationPct), '%');
    out.truck_idle_h = f(r3(k.truckIdleH), 'h');
    out.excavator_idle_h = f(r3(k.excavatorIdleH), 'h');
    out.idle_cost = f(Math.round(k.idleCostKzt), 'KZT');
    out.fuel = f(Math.round(k.fuelL), 'l');
    out.fuel_cost = f(Math.round(k.fuelCostKzt), 'KZT');
    out.fuel_per_t = f(r3(k.fuelLPerT), 'l/t');
    out.crusher_idle_min = f(r1(k.crusherIdleMin), 'min');
    out.crusher_idle_cost = f(Math.round(k.crusherIdleCostKzt), 'KZT');
    out.unplanned_failures = f(k.unplannedFailures, 'pcs');
    out.prevented_failures = f(k.preventedFailures, 'pcs');
    out.false_alarms = f(k.falseAlarms, 'pcs');
    out.broken_h = f(r3(k.brokenH), 'h');
    out.service_h = f(r3(k.serviceH), 'h');
    out.repair_cost = f(Math.round(k.repairCostKzt), 'KZT');
    out.feed_grade = f(r3(k.feedGradePct), '% Cu');
    out.grade_in_band_pct = f(r1(k.gradeInBandPct), '%');
    out.recovery_pct = f(r1(k.recoveryPct), '%');
    out.cu_conc = f(r1(k.cuConcT), 't');
    out.blast_stop_h = f(r3(k.blastStopH), 'h');
    out.trips = f(k.trips, 'trips');
    for (const s of TRUCK_STATES) out[`share_${s}`] = f(r3(k.stateShare[s]));
  }
  return out;
}

export function serializeTruck(sim: Simulation, i: number): Features {
  const t = sim.trucks[i];
  const moving = t.seg < t.path.length - 1;
  const from = moving ? t.path[t.seg] : t.node;
  const to = moving ? t.path[t.seg + 1] : t.node;
  const d = t.dest;
  return {
    state: f(t.state),
    x: f(r1(t.x), 'm'),
    y: f(r1(t.y), 'm'),
    edge_from: f(from),
    edge_to: f(to),
    seg_pos: f(r1(t.segPos), 'm'),
    node: f(t.node),
    payload: f(Math.round(t.loadT), 't'),
    material: f(t.material ?? 'none'),
    grade: f(r3(t.gradePct), '% Cu'),
    fuel: f(Math.round(t.fuelL), 'l'),
    engine_hours: f(r1(t.engineH), 'h'),
    service_in: f(r1(t.serviceInH), 'h'),
    trips_total: f(t.trips, 'trips'),
    tonnes_total: f(Math.round(t.tonnes), 't'),
    dest_kind: f(d?.kind ?? 'none'),
    dest_id: f(d && d.kind !== 'garage' ? d.id : d?.kind === 'garage' ? d.slot : -1),
    dest_purpose: f(d?.kind === 'garage' ? d.purpose : 'none'),
    home_excavator: f(t.homeEx),
    fixed_excavator: f(t.fixedEx),
    timer: f(Math.round(t.timer), 's'),
    park_slot: f(t.parkSlot ?? -1),
    engine_temp: f(r1(t.sensors.tempC), 'C'),
    engine_temp_expected: f(r1(t.sensors.expectedTempC), 'C'),
    vibration: f(r1(t.sensors.vibration), 'mm/s'),
    tyre_pressure: f(r3(t.sensors.tyreBar), 'bar'),
    failure_risk: f(t.health.risk, '%'),
    failure_eta: f(t.health.etaMin === null ? -1 : Math.round(t.health.etaMin), 'min'),
    failure_alert: f(t.health.alert),
    failure_sign: f(t.health.sign ?? 'none'),
    health_index: f(r3(t.health.score)),
    service_requested: f(t.serviceRequested),
    // Стиль вождения (GNSS, датчик топлива, акселерометр рамы) — для рейтинга водителей.
    drv_dist: f(Math.round(t.driverStats.distM), 'm'),
    drv_ramp_time: f(Math.round(t.driverStats.rampSec), 's'),
    drv_ramp_dist: f(Math.round(t.driverStats.rampDistM), 'm'),
    drv_fuel: f(r1(t.driverStats.fuelUsedL), 'l'),
    drv_harsh: f(t.driverStats.harsh, 'pcs'),
    drv_fatigue: f(Math.round(t.driverStats.fatigue), '%'),
    drv_fatigue_events: f(t.driverStats.fatigueEvents, 'pcs'),
    cas_alerts: f(t.driverStats.cas, 'pcs'),
  };
}

export function serializeExcavator(sim: Simulation, i: number): Features {
  const ex = sim.excavators[i];
  return {
    state: f(ex.state),
    queue: f(ex.queue.length, 'trucks'),
    queue_ids: f(ex.queue.join(',')),
    loading: f(ex.loading ?? -1),
    load_left: f(Math.round(ex.loadLeft), 's'),
    tonnes_total: f(Math.round(ex.tonnes), 't'),
    loads_total: f(ex.loads, 'loads'),
    busy: f(Math.round(ex.busySec), 's'),
    idle: f(Math.round(ex.idleSec), 's'),
    broken: f(Math.round(ex.brokenSec), 's'),
    repair_left: f(Math.round(Math.max(0, ex.brokenLeft)), 's'),
    blast_left: f(Math.round(ex.blastLeft), 's'),
    blast_time: f(Math.round(ex.blastSec), 's'),
    queue_avg: f(r3(sim.now > 0 ? ex.queueIntegral / sim.now : 0), 'trucks'),
    face_grade: f(r3(gradeAt(ex, sim.now)), '% Cu'),
    // Буровзрывная подготовка: запас взорванной массы и обуренность следующего блока.
    stock: f(Math.round(sim.drill.stockT[i]), 't'),
    stock_shifts: f(Math.round(sim.drill.stockShifts(i) * 10) / 10, 'shifts'),
    block_holes_done: f(sim.drill.blocks[i].holesDone, 'holes'),
    block_holes_total: f(sim.drill.blocks[i].holesTotal, 'holes'),
  };
}

export function serializeCrusher(sim: Simulation): Features {
  const c = sim.crusher;
  return {
    state: f(sim.stockpile.crushing ? 'crushing' : c.active.length > 0 ? 'receiving' : 'waiting'),
    bin: f(Math.round(c.binT), 't'),
    bin_cu: f(r3(c.binCuT), 't'),
    bin_grade: f(r3(sim.binGrade), '% Cu'),
    starved: f(Math.round(c.starvedSec), 's'),
    tonnes_total: f(Math.round(c.tonnes), 't'),
    queue: f(c.queue.length, 'trucks'),
    queue_ids: f(c.queue.join(',')),
    dumping_ids: f(c.active.map((a) => a.truck).join(',')),
  };
}

export function serializePlant(sim: Simulation): Features {
  const st = sim.stats;
  return {
    state: f(sim.stockpile.t <= 0.01 ? 'stopped' : 'running'),
    feed_rate: f(sim.stockpile.t <= 0.01 ? 0 : sim.cfg.dumps.crusher.plantFeedTpm * 60, 't/h'),
    feed_grade: f(r3(sim.feedGrade), '% Cu'),
    feed_total: f(Math.round(st.plantFeedT), 't'),
    cu_feed: f(r1(st.cuFeedT), 't'),
    cu_concentrate: f(r1(st.cuConcT), 't'),
    cu_loss: f(r3(st.cuLossT), 't'),
    feed_time: f(Math.round(st.feedSec), 's'),
    feed_in_band_time: f(Math.round(st.feedInBandSec), 's'),
  };
}

/** Отвалы вскрыши (их несколько): итог и по каждому — dump_<i>_*. */
export function serializeWaste(sim: Simulation): Features {
  const ds = sim.dumps.filter((d) => d.material === 'waste');
  const out: Features = {
    tonnes_total: f(Math.round(ds.reduce((n, d) => n + d.tonnes, 0)), 't'),
    queue: f(ds.reduce((n, d) => n + d.queue.length, 0), 'trucks'),
    queue_ids: f(ds.flatMap((d) => d.queue).join(',')),
    dumping_ids: f(ds.flatMap((d) => d.active.map((a) => a.truck)).join(',')),
  };
  ds.forEach((d, i) => {
    out[`dump_${i + 1}_t`] = f(Math.round(d.tonnes), 't');
    out[`dump_${i + 1}_queue_ids`] = f(d.queue.join(','));
    out[`dump_${i + 1}_dumping_ids`] = f(d.active.map((a) => a.truck).join(','));
  });
  return out;
}

/** Площадка выщелачивания: отсыпка (как у отвала) + карты, график орошения и раствор. */
export function serializeLeach(sim: Simulation): Features {
  const L = sim.leach;
  const r = (x: number, k = 1) => Math.round(x * k) / k;
  return {
    ...serializeDump(sim, 1),
    cells: f(L.cells.map((c) => `${c.stage}:${Math.round(c.oreT)}:${r(c.cuT, 10)}:${r(c.daysLeached, 1000)}:${r(c.cuLeachedT, 100)}`).join(';')),
    irrigation_group: f(L.activeGroup(sim.now) + 1),
    cells_irrigated: f(L.cells.filter((c) => c.irrigated).length, 'cells'),
    irrigation_hold: f(Math.round(L.holdLeft), 's'),
    cells_irrigating: f(L.irrigatingCount, 'cells'),
    placed_total: f(Math.round(L.placedT), 't'),
    pls_flow: f(Math.round(L.plsM3h), 'm3/h'),
    pls_cu: f(r(L.plsGpl, 100), 'g/l'),
    cu_leached_total: f(r(L.cuLeachedT, 10), 't'),
  };
}

/** Себестоимость тонны меди: итог и по группам затрат. */
export function serializeCost(sim: Simulation): Features {
  const r = costBreakdown(sim);
  const out: Features = {
    usd_per_lb: f(Math.round(r.usdPerLb * 1000) / 1000, 'USD/lb'),
    kzt_per_t_cu: f(Math.round(r.kztPerTCu), 'KZT/t'),
    total_kzt: f(Math.round(r.totalKzt), 'KZT'),
    modelled_pct: f(r.totalKzt > 0 ? Math.round((r.modelledKzt / r.totalKzt) * 100) : 0, '%'),
    payable_cu: f(Math.round(r.payableCuT * 10) / 10, 't'),
  };
  for (const g of Object.keys(GROUP_RU) as CostGroup[])
    out[`${g}_kzt`] = f(Math.round(r.lines.filter((l) => l.group === g).reduce((s, l) => s + l.kzt, 0)), 'KZT');
  return out;
}

/** ККД-2: те же признаки, что у первой дробилки, плюс условный подвоз. */
export function serializeCrusher2(sim: Simulation): Features {
  const c2 = sim.chain2;
  return {
    ...serializeCrusher(c2.view),
    supply_tph: f(Math.round(c2.inflowTph), 't/h'),
    backed_up: f(Math.round(c2.backedUpSec), 's'),
  };
}

/** Подстанция: нагрузка, температура трансформатора, выключатель. */
export function serializeSubstation(sim: Simulation, which: 'sub' | 'sub2'): Features {
  const e = sim.energy;
  const load = e.substationMw[which];
  const kwh = which === 'sub' ? e.segmentKwh : e.areas.filter((a) => a.outside).reduce((s, a) => s + a.kwh, 0);
  const cut = sim.powerCutLeft > 0;
  return {
    state: f(cut ? 'no_power' : 'ok'),
    load_mw: f(Math.round(load * 10) / 10, 'MW'),
    share_pct: f(Math.round((load / Math.max(1e-6, e.totalMw)) * 100), '%'),
    energy_kwh: f(Math.round(kwh), 'kWh'),
    voltage_kv: f(cut ? 0 : 110, 'kV'),
    // Масло греется от нагрузки и от погоды; при обесточивании остывает до окружающей.
    trafo_temp: f(Math.round(e.trafoTempC(sim, which) * 10) / 10, 'C'),
    breaker: f(cut ? 'open' : 'closed'),
  };
}

/** Энергоучёт по участкам. */
export function serializeEnergy(sim: Simulation): Features {
  const e = sim.energy;
  const by = (id: string) => Math.round((e.areas.find((a) => a.id === id)?.mw ?? 0) * 10) / 10;
  return {
    total_mw: f(Math.round(e.totalMw * 10) / 10, 'MW'),
    peak_mw: f(Math.round(e.peakMw * 10) / 10, 'MW'),
    kwh_shift: f(Math.round(e.totalKwh), 'kWh'),
    kwh_per_t_ore: f(Math.round(e.perTonneOre(sim) * 10) / 10, 'kWh/t'),
    kwh_per_t_cu: f(Math.round(e.perTonneCu(sim)), 'kWh/t'),
    idle_kwh: f(Math.round(e.idleKwh), 'kWh'),
    cost_kzt: f(Math.round(e.costKzt(sim)), 'KZT'),
    power_cut: f(Math.round(sim.powerCutLeft), 's'),
    areas_kwh: f(e.areas.map((a) => `${a.id}:${Math.round(a.kwh)}`).join(';')),
    segment_mw: f(Math.round(e.segmentMw * 10) / 10, 'MW'),
    segment_kwh: f(Math.round(e.segmentKwh), 'kWh'),
    plant2_mw: f(by('plant2'), 'MW'),
    camp_mw: f(by('camp'), 'MW'),
    crusher2_mw: f(by('crusher2'), 'MW'),
    plant_mw: f(by('plant'), 'MW'),
    crusher_mw: f(by('crusher'), 'MW'),
    sxew_mw: f(by('sxew'), 'MW'),
    tailings_mw: f(by('tailings'), 'MW'),
    leach_mw: f(by('leach'), 'MW'),
    pit_mw: f(by('pit'), 'MW'),
    aux_mw: f(by('aux'), 'MW'),
  };
}

/** Погода и сезон: что сейчас за бортом и как это влияет на работу. */
export function serializeWeather(sim: Simulation): Features {
  const w = sim.weather;
  return {
    sky: f(w.ru),
    temp: f(Math.round(w.tempC * 10) / 10, 'C'),
    wind: f(Math.round(w.windMs * 10) / 10, 'm/s'),
    visibility: f(w.visibilityM, 'm'),
    season: f(SEASON_RU[w.season]),
    month: f(MONTH_RU[w.month - 1]),
    speed_factor: f(Math.round(w.speedFactor * 100), '%'),
    crusher_factor: f(Math.round(w.crusherFactor * 100), '%'),
    leach_factor: f(Math.round(w.leachFactor * 100), '%'),
    blast_ok: f(w.blastOk ? 'да' : 'нет'),
  };
}

/** Хвостохранилище: пульпа, чаша, пруд оборотной воды и контроль дамбы. */
export function serializeTailings(sim: Simulation): Features {
  const t = sim.tailings;
  const r = (x: number, k = 1) => Math.round(x * k) / k;
  return {
    stored_t: f(Math.round(t.storedT), 't'),
    fill_pct: f(r(t.fillPct, 10), '%'),
    tails_shift: f(Math.round(t.tailsT), 't'),
    pulp_flow: f(Math.round(t.pulpM3h), 'm3/h'),
    solids_tph: f(Math.round(t.solidsTph), 't/h'),
    beach: f(r(t.beachM, 10), 'm'),
    pond_level: f(r(t.pondM, 100), 'm'),
    freeboard: f(r(t.freeboardM, 10), 'm'),
    seepage: f(Math.round(t.seepageLpm), 'l/min'),
    piezo: f(Math.round(t.piezoPct), '%'),
    reclaim_flow: f(Math.round(t.reclaimM3h), 'm3/h'),
    reclaim_total: f(Math.round(t.reclaimM3), 'm3'),
    makeup_water: f(Math.round(t.makeupM3), 'm3'),
    water_in: f(Math.round(t.waterInM3), 'm3'),
    melt_total: f(Math.round(t.meltM3), 'm3'),
    storm_inflow: f(Math.round(t.stormM3h), 'm3/h'),
    emergency_total: f(Math.round(t.emergencyM3), 'm3'),
    status: f(t.status),
  };
}

/** Завод SX-EW. */
export function serializeSxew(sim: Simulation): Features {
  const L = sim.leach;
  return {
    ew_current: f(Math.round(L.ewKA * 10) / 10, 'kA'),
    cathode_total: f(Math.round(L.cathodeT * 10) / 10, 't'),
    cathode_tpd: f(Math.round(L.cathodeTpd), 't/day'),
    acid_total: f(Math.round(L.acidT), 't'),
  };
}

export function serializeDump(sim: Simulation, k: number): Features {
  const d = sim.dumps[k];
  return {
    tonnes_total: f(Math.round(d.tonnes), 't'),
    queue: f(d.queue.length, 'trucks'),
    queue_ids: f(d.queue.join(',')),
    dumping_ids: f(d.active.map((a) => a.truck).join(',')),
  };
}

export function serializeGarage(sim: Simulation): Features {
  const occ = sim.slotOccupant;
  return {
    occupied: f(occ.filter((o) => o !== null).length, 'slots'),
    slots: f(occ.map((o) => (o === null ? -1 : o)).join(',')),
    in_service: f(sim.trucks.filter((t) => t.state === 'service').length, 'trucks'),
    refueling: f(sim.trucks.filter((t) => t.state === 'refuel').length, 'trucks'),
  };
}

export function serializeRoads(sim: Simulation): Features {
  const groups = sim.layout.closureGroups;
  const closures = sim.closures.map((c) => ({ g: groups.findIndex((x) => x.label === c.label), label: c.label, until: c.until, edges: c.edges }));
  return {
    closed_count: f(closures.length, 'sections'),
    closures: f(JSON.stringify(closures)),
  };
}

export function serializeBlasting(sim: Simulation): Features {
  const live = sim.blasts.filter((b) => b.phase !== 'done');
  return {
    active: f(live.filter((b) => b.phase === 'active').length),
    announced: f(live.filter((b) => b.phase === 'warning').length),
    blasts: f(JSON.stringify(sim.blasts.map((b) => ({ id: b.id, t: b.t, dur: b.dur, x: Math.round(b.x), y: Math.round(b.y), r: b.radius, ex: b.exIds, ph: b.phase, m: b.manual, label: b.label, tg: b.target })))),
  };
}

const oreModels = new WeakMap<Simulation, OreModel>();
/** Модель рудного тела строится один раз на экземпляр модели (зависит от расстановки экскаваторов). */
function oreModel(sim: Simulation): OreModel {
  let m = oreModels.get(sim);
  if (!m) oreModels.set(sim, (m = buildOreModel(sim)));
  return m;
}

/** Признаки двойника геологии: пробы XRF шлама скважин и решение по каждому буровому блоку. */
export function serializeGeology(sim: Simulation): Features {
  const m = oreModel(sim);
  const holes = holeAssays(sim, m);
  const last = holes[holes.length - 1];
  const out: Features = {
    assays_total: f(holes.length, 'pcs'),
    assays_ore: f(holes.filter((h) => h.cu >= CUTOFF).length, 'pcs'),
    last_assay_cu: f(last ? r3(last.cu) : 0, '% Cu'),
    last_assay_block: f(last ? sim.excavators[sim.drill.blocks[last.block].exId].name : '—'),
  };
  for (const b of blockSummary(sim, holes)) {
    const k = b.exId + 1;
    out[`block_${k}_holes`] = f(b.n, 'pcs');
    out[`block_${k}_cu`] = f(b.avg === null ? 0 : r3(b.avg), '% Cu');
    out[`block_${k}_dest`] = f(b.dest === 'unknown' ? 'pending' : `to_${b.dest}`);
  }
  for (const e of sim.excavators) {
    const z = m.surface(e.x, e.y);
    out[`face_${e.id + 1}_zone`] = f(m.zone(e.x, e.y, z));
  }
  return out;
}

/** Признаки склада концентрата и ж/д отгрузки. */
export function serializeConcentrate(sim: Simulation): Features {
  const c = sim.concentrate;
  return {
    stock: f(Math.round(c.stockT), 't'),
    produced_total: f(Math.round(c.producedT), 't'),
    wagons_loaded: f(c.wagons, 'pcs'),
    wagon_progress: f(Math.round(c.loadingProgress * 100), '%'),
    trains_shift: f(c.trains, 'pcs'),
    shipped_total: f(Math.round(c.shippedT), 't'),
    cu_shipped: f(Math.round(c.cuShippedT * 10) / 10, 't'),
  };
}

/** Признаки КПП и автовесов. */
export function serializeCheckpoint(sim: Simulation): Features {
  const k = sim.checkpoint;
  return {
    state: f(k.mode === 'manual' ? 'manual' : k.queue > 8 ? 'queue' : 'auto'),
    mode: f(k.mode),
    lanes_open: f(k.lanesOpen, 'pcs'),
    arrivals_ph: f(Math.round(k.arrivalsPh), 'pcs/h'),
    capacity_ph: f(Math.round(k.capacityPh), 'pcs/h'),
    queue: f(Math.round(k.queue), 'pcs'),
    peak_queue: f(Math.round(k.peakQueue), 'pcs'),
    wait_min: f(r1(k.waitMin), 'min'),
    weighings: f(Math.round(k.weighings), 'pcs'),
    bus_passes: f(Math.round(k.busPasses), 'pcs'),
    cargo_vehicles: f(Math.round(k.cargoVehicles), 'pcs'),
    cargo_t: f(Math.round(k.cargoT), 't'),
  };
}

/** Признаки вахтового посёлка. */
export function serializeCamp(sim: Simulation): Features {
  const c = sim.camp;
  return {
    state: f(!c.powered ? 'no_power' : c.genOn ? 'generator' : 'grid'),
    in_camp: f(c.inCamp, 'pcs'),
    in_transit: f(c.inTransit, 'pcs'),
    on_shift: f(c.onShift, 'pcs'),
    occupancy: f(r1(c.occupancyPct), '%'),
    buses: f(c.buses, 'pcs'),
    canteen_load: f(Math.round(c.mealLoad * 100), '%'),
    meals_served: f(Math.round(c.mealsServed), 'pcs'),
    water_m3h: f(r1(c.waterM3h), 'm3/h'),
    water_total: f(Math.round(c.waterTotalM3), 'm3'),
    heat_mw: f(r1(c.heatMw), 'MW'),
    load_mw: f(r1(c.loadMw), 'MW'),
    generator: f(c.genOn ? 1 : 0),
    fuel_l: f(Math.round(c.fuelL), 'l'),
    fuel_hours: f(r1(c.fuelHours), 'h'),
  };
}

/** Признаки склада дроблёной руды. */
export function serializeStockpile(sim: Simulation): Features {
  const s = sim.stockpile;
  const feedTph = sim.cfg.dumps.crusher.plantFeedTpm * 60;
  const out = s.t > 0.01 ? feedTph : 0;
  const inflow = Math.round(s.lastIn * 3600);
  // Пыль: при отсыпке с высоты — выше, особенно когда штабель низкий (большая высота падения).
  const dust = s.crushing ? 2.5 + 6 * (1 - s.t / s.capT) : 0.4;
  return {
    state: f(s.t <= 0.01 ? 'depleted' : s.t >= s.capT - 1 ? 'full' : s.crushing ? 'filling' : 'draining'),
    level: f(Math.round(s.t), 't'),
    fill: f(r1((s.t / s.capT) * 100), '%'),
    hours_left: f(r1(s.t / feedTph), 'h'),
    pile_grade: f(r3(sim.feedGrade), '% Cu'),
    cu: f(r3(s.cuT), 't'),
    inflow: f(inflow, 't/h'),
    outflow: f(out, 't/h'),
    inflow_total: f(Math.round(s.inflowT), 't'),
    dust: f(r1(dust), 'mg/m3'),
  };
}

/** Признаки бурового станка. */
export function serializeDrill(sim: Simulation, i: number): Features {
  const g = sim.drill.rigs[i];
  const b = g.target !== null ? sim.drill.blocks[g.target] : null;
  return {
    state: f(g.state),
    x: f(r1(g.x), 'm'),
    y: f(r1(g.y), 'm'),
    target_ex: f(g.target ?? -1),
    block: f(g.target !== null ? sim.excavators[g.target].name : '—'),
    holes_done: f(b ? b.holesDone : 0, 'holes'),
    holes_total: f(b ? b.holesTotal : 0, 'holes'),
    hole_depth: f(r1(g.holeDepth), 'm'),
    penetration: f(g.state === 'drilling' && g.reposition <= 0 ? r1(g.penetration) : 0, 'm/h'),
    pulldown: f(g.pulldown, 'kN'),
    torque: f(g.torque, 'kN*m'),
    air_pressure: f(g.air, 'bar'),
    meters_shift: f(Math.round(g.metersShift), 'm'),
    holes_shift: f(g.holesShift, 'holes'),
    repair_left: f(Math.round(g.brokenLeft), 's'),
    // Стиль машиниста по датчикам станка: MWD (время и скорость бурения), GNSS (отклонение устья), момент (заклинивания).
    hole_offset: f(g.holeOffset, 'm'),
    op_drill_time: f(Math.round(g.opStats.drillSec), 's'),
    op_offset_avg: f(g.opStats.holes ? Math.round((g.opStats.offsetSum / g.opStats.holes) * 100) / 100 : 0, 'm'),
    op_holes: f(g.opStats.holes, 'holes'),
    op_jams: f(g.opStats.jams, 'pcs'),
    op_expected_m: f(r1(g.opStats.expectedM), 'm'),
  };
}

const UNIT_UNITS: Record<string, string> = {
  power: '', motor_current: 'A', hydraulic_pressure: 'bar', bearing_temp: 'C', vibration: 'mm/s', belt_speed: 'm/s', load: 't/h', mill_load: '%',
  speed: 'rpm', pulp_density: '%', water: 'm3/h', pressure: 'kPa', p80: 'um', froth_level: 'mm', air_flow: 'm3/min', reagent_dose: 'g/t',
  conc_grade: '% Cu', underflow_density: '%', rake_torque: '%', flow: 'l/min', dispensed: 'l', remaining: 'min',
};

/** Признаки агрегата (мощность дробилки — кВт, мельниц — МВт). */
export function serializeUnit(sim: Simulation, key: string): Features {
  const u = sim.equipment.get(key);
  const out: Features = {};
  if (!u) return out;
  for (const [k, val] of Object.entries(u.v)) {
    if (k === 'bearing_extra') continue;
    const unit = k === 'power' ? (key === 'crusher-drive' ? 'kW' : 'MW') : UNIT_UNITS[k];
    out[k] = f(val, unit || undefined);
  }
  return out;
}

/** Хронология смены (публикуется реже остальных — раз в 15 с). */
export function serializeShift(sim: Simulation): Features {
  const tl = sim.timeline;
  return {
    minutes: f(tl.minutes, 'min'),
    trucks: f(tl.trucks.join('|')),
    excavators: f(tl.excavators.join('|')),
    crusher: f(tl.crusher),
    closures: f(tl.closures),
  };
}

/** Признаки всех двойников варианта: thingId → features. */
export function serializeAll(sim: Simulation, v: StrategyName, k: Kpis): Record<string, Features> {
  const id = thingIds(v);
  const out: Record<string, Features> = {};
  out[id.mine] = serializeMine(sim, k);
  sim.excavators.forEach((_, i) => (out[id.excavator(i)] = serializeExcavator(sim, i)));
  sim.trucks.forEach((_, i) => (out[id.truck(i)] = serializeTruck(sim, i)));
  out[id.crusher] = serializeCrusher(sim);
  out[id.plant] = serializePlant(sim);
  out[id.leach] = serializeLeach(sim);
  out[id.sxew] = serializeSxew(sim);
  out[id.tailings] = serializeTailings(sim);
  out[id.weather] = serializeWeather(sim);
  out[id.energy] = serializeEnergy(sim);
  out[id.cost] = serializeCost(sim);
  out[id.crusher2] = serializeCrusher2(sim);
  out[id.stockpile2] = serializeStockpile(sim.chain2.view);
  out[id.plant2] = serializePlant(sim.chain2.view);
  for (const u of sim.chain2.equipment.units) out[id.unit2(u.def.key)] = serializeUnit(sim.chain2.view, u.def.key);
  out[id.sub] = serializeSubstation(sim, 'sub');
  out[id.sub2] = serializeSubstation(sim, 'sub2');
  out[id.camp] = serializeCamp(sim);
  out[id.kpp] = serializeCheckpoint(sim);
  out[id.waste] = serializeWaste(sim);
  out[id.garage] = serializeGarage(sim);
  out[id.roads] = serializeRoads(sim);
  out[id.blasting] = serializeBlasting(sim);
  for (const d of UNIT_DEFS) out[id.unit(d.key)] = serializeUnit(sim, d.key);
  out[id.stockpile] = serializeStockpile(sim);
  out[id.geology] = serializeGeology(sim);
  out[id.concentrate] = serializeConcentrate(sim);
  sim.drill.rigs.forEach((_, i) => (out[id.drill(i)] = serializeDrill(sim, i)));
  return out;
}

// ───────────────────────────── восстановление (двойники → интерфейс) ─────────────────────────────

type Props = Record<string, unknown>;
const val = (fs: Props | undefined, key: string): unknown => (fs?.[key] as { properties?: { value?: unknown } } | undefined)?.properties?.value;
const num = (fs: Props | undefined, key: string, d = 0): number => {
  const x = val(fs, key);
  return typeof x === 'number' ? x : typeof x === 'string' && x !== '' && !Number.isNaN(Number(x)) ? Number(x) : d;
};
const str = (fs: Props | undefined, key: string, d = ''): string => {
  const x = val(fs, key);
  return typeof x === 'string' ? x : x === undefined || x === null ? d : String(x);
};
const ids = (s: string): number[] => (s ? s.split(',').map(Number).filter((n) => Number.isFinite(n)) : []);

/** KPI, опубликованные симулятором в двойнике рудника. */
export function kpisFromMine(fs: Props | undefined): Kpis | null {
  if (!fs || val(fs, 'mined_total') === undefined) return null;
  const share = Object.fromEntries(TRUCK_STATES.map((s) => [s, num(fs, `share_${s}`)])) as Record<TruckState, number>;
  return {
    elapsedH: num(fs, 'sim_time') / 3600,
    mined: { sulfide: num(fs, 'mined_sulfide'), oxide: num(fs, 'mined_oxide'), waste: num(fs, 'mined_waste') },
    minedTotal: num(fs, 'mined_total'),
    tph: num(fs, 'tph'),
    avgQueueMin: num(fs, 'avg_queue_min'),
    utilizationPct: num(fs, 'utilization_pct'),
    truckIdleH: num(fs, 'truck_idle_h'),
    excavatorIdleH: num(fs, 'excavator_idle_h'),
    idleCostKzt: num(fs, 'idle_cost'),
    fuelL: num(fs, 'fuel'),  // ниже кладём и в stats: по ним считается себестоимость
    fuelCostKzt: num(fs, 'fuel_cost'),
    fuelLPerT: num(fs, 'fuel_per_t'),
    planPct: { sulfide: num(fs, 'plan_sulfide_pct'), oxide: num(fs, 'plan_oxide_pct'), waste: num(fs, 'plan_waste_pct') },
    planTotalPct: num(fs, 'plan_pct'),
    crusherIdleMin: num(fs, 'crusher_idle_min'),
    crusherIdleCostKzt: num(fs, 'crusher_idle_cost'),
    stateShare: share,
    trips: num(fs, 'trips'),
    unplannedFailures: num(fs, 'unplanned_failures'),
    preventedFailures: num(fs, 'prevented_failures'),
    falseAlarms: num(fs, 'false_alarms'),
    brokenH: num(fs, 'broken_h'),
    serviceH: num(fs, 'service_h'),
    repairCostKzt: num(fs, 'repair_cost'),
    feedGradePct: num(fs, 'feed_grade'),
    gradeInBandPct: num(fs, 'grade_in_band_pct'),
    recoveryPct: num(fs, 'recovery_pct'),
    cuConcT: num(fs, 'cu_conc'),
    blastStopH: num(fs, 'blast_stop_h'),
  };
}

/**
 * Перенести состояние двойников в локальный экземпляр Simulation (он не «тикает», а служит
 * контейнером состояния для 2D/3D-отрисовки, карточек и графиков).
 */
export function hydrate(sim: Simulation, v: StrategyName, things: Map<string, Props>): Kpis | null {
  const id = thingIds(v);
  const g = sim.layout.graph;
  const mine = things.get(id.mine);
  if (mine) {
    sim.now = num(mine, 'sim_time', sim.now);
    sim.finished = num(mine, 'finished') === 1;
    // Журнал событий: добавляем новые записи (по времени).
    try {
      const ev = JSON.parse(str(mine, 'events', '[]')) as [number, 'info' | 'warn' | 'alarm', string][];
      const last = sim.log.length ? sim.log[sim.log.length - 1] : null;
      for (const [t, level, text] of ev) {
        if (last && (t < last.t || (t === last.t && sim.log.some((l) => l.t === t && l.text === text)))) continue;
        sim.log.push({ t, level, text });
      }
      while (sim.log.length > 60) sim.log.shift();
    } catch {
      /* пустой журнал */
    }
  }
  const k = kpisFromMine(mine);
  if (k) {
    sim.stats.mined = { ...k.mined };
    sim.stats.fuelL = k.fuelL;
    sim.stats.unplannedFailures = k.unplannedFailures;
    sim.stats.preventedFailures = k.preventedFailures;
    sim.stats.falseAlarms = k.falseAlarms;
  }

  // Дороги: закрытия — до самосвалов, чтобы маршруты считались по актуальной сети.
  const roads = things.get(id.roads);
  if (roads) {
    try {
      const cl = JSON.parse(str(roads, 'closures', '[]')) as { label: string; until: number; edges: number[] }[];
      const key = cl.map((c) => c.label).join('|');
      if (key !== sim.closures.map((c) => c.label).join('|')) {
        sim.closures = cl.map((c) => ({ label: c.label, until: c.until, edges: c.edges }));
        sim.router.setClosed(sim.closures.flatMap((c) => c.edges));
      }
    } catch {
      /* нет данных */
    }
  }

  const blasting = things.get(id.blasting);
  if (blasting) {
    try {
      const bl = JSON.parse(str(blasting, 'blasts', '[]')) as { id: number; t: number; dur: number; x: number; y: number; r: number; ex: number[]; ph: Blast['phase']; m: boolean; label: string; tg?: number }[];
      sim.blasts.splice(0, sim.blasts.length, ...bl.map((b) => ({ id: b.id, t: b.t, dur: b.dur, x: b.x, y: b.y, radius: b.r, exIds: b.ex, edges: [], label: b.label, manual: b.m, phase: b.ph, target: b.tg ?? b.ex[0] ?? 0 })));
    } catch {
      /* нет данных */
    }
  }

  sim.excavators.forEach((ex, i) => {
    const fs = things.get(id.excavator(i));
    if (!fs) return;
    ex.state = str(fs, 'state', ex.state) as typeof ex.state;
    ex.queue = ids(str(fs, 'queue_ids'));
    const ld = num(fs, 'loading', -1);
    ex.loading = ld >= 0 ? ld : null;
    ex.loadLeft = num(fs, 'load_left');
    ex.tonnes = num(fs, 'tonnes_total');
    ex.loads = num(fs, 'loads_total');
    ex.busySec = num(fs, 'busy');
    ex.idleSec = num(fs, 'idle');
    ex.brokenSec = num(fs, 'broken');
    ex.brokenLeft = num(fs, 'repair_left');
    ex.blastLeft = num(fs, 'blast_left');
    ex.blastSec = num(fs, 'blast_time');
    ex.queueIntegral = num(fs, 'queue_avg') * sim.now;
    sim.drill.stockT[i] = num(fs, 'stock', sim.drill.stockT[i]);
    sim.drill.blocks[i].holesDone = num(fs, 'block_holes_done', sim.drill.blocks[i].holesDone);
  });
  sim.drill.rigs.forEach((g, i) => {
    const fs = things.get(id.drill(i));
    if (!fs) return;
    g.state = str(fs, 'state', g.state) as typeof g.state;
    g.x = num(fs, 'x', g.x);
    g.y = num(fs, 'y', g.y);
    const t = num(fs, 'target_ex', -1);
    g.target = t >= 0 ? t : null;
    g.holeDepth = num(fs, 'hole_depth');
    g.penetration = num(fs, 'penetration');
    g.reposition = g.penetration > 0 ? 0 : 1;
    g.pulldown = num(fs, 'pulldown');
    g.torque = num(fs, 'torque');
    g.air = num(fs, 'air_pressure');
    g.metersShift = num(fs, 'meters_shift');
    g.holesShift = num(fs, 'holes_shift');
    g.brokenLeft = num(fs, 'repair_left');
    g.holeOffset = num(fs, 'hole_offset');
    g.opStats.drillSec = num(fs, 'op_drill_time');
    g.opStats.holes = num(fs, 'op_holes');
    g.opStats.offsetSum = num(fs, 'op_offset_avg') * g.opStats.holes;
    g.opStats.jams = num(fs, 'op_jams');
    g.opStats.expectedM = num(fs, 'op_expected_m');
  });

  // КПП и автовесы.
  const kf = things.get(id.kpp);
  if (kf) {
    const k = sim.checkpoint;
    k.queue = num(kf, 'queue', k.queue);
    k.peakQueue = num(kf, 'peak_queue', k.peakQueue);
    k.weighings = num(kf, 'weighings', k.weighings);
    k.busPasses = num(kf, 'bus_passes', k.busPasses);
    k.cargoVehicles = num(kf, 'cargo_vehicles', k.cargoVehicles);
    k.cargoT = num(kf, 'cargo_t', k.cargoT);
    k.arrivalsPh = num(kf, 'arrivals_ph', k.arrivalsPh);
    k.waitMin = num(kf, 'wait_min', k.waitMin);
    k.lanesOpen = num(kf, 'lanes_open', k.lanesOpen);
    k.mode = str(kf, 'mode') === 'manual' ? 'manual' : 'auto';
  }

  // Вахтовый посёлок.
  const cmf = things.get(id.camp);
  if (cmf) {
    const c = sim.camp;
    c.inCamp = num(cmf, 'in_camp', c.inCamp);
    c.inTransit = num(cmf, 'in_transit', c.inTransit);
    c.onShift = num(cmf, 'on_shift', c.onShift);
    c.buses = num(cmf, 'buses', c.buses);
    c.mealLoad = num(cmf, 'canteen_load') / 100;
    c.mealsServed = num(cmf, 'meals_served', c.mealsServed);
    c.waterM3h = num(cmf, 'water_m3h', c.waterM3h);
    c.waterTotalM3 = num(cmf, 'water_total', c.waterTotalM3);
    c.heatMw = num(cmf, 'heat_mw', c.heatMw);
    c.loadMw = num(cmf, 'load_mw', c.loadMw);
    c.genOn = num(cmf, 'generator') === 1;
    c.fuelL = num(cmf, 'fuel_l', c.fuelL);
    c.powered = str(cmf, 'state') !== 'no_power';
    c.gridMw = c.genOn || !c.powered ? 0 : c.loadMw;
  }

  // Склад концентрата.
  const cf2 = things.get(id.concentrate);
  if (cf2) {
    const c = sim.concentrate;
    c.stockT = num(cf2, 'stock', c.stockT);
    c.producedT = num(cf2, 'produced_total', c.producedT);
    c.wagons = num(cf2, 'wagons_loaded', c.wagons);
    const prog = num(cf2, 'wagon_progress') / 100;
    c.loadLeft = prog > 0 ? (1 - prog) * WAGON_LOAD_SEC : 0;
    c.trains = num(cf2, 'trains_shift', c.trains);
    c.shippedT = num(cf2, 'shipped_total', c.shippedT);
    c.cuShippedT = num(cf2, 'cu_shipped', c.cuShippedT);
  }

  // Склад дроблёной руды.
  const spf = things.get(id.stockpile);
  if (spf) {
    const s = sim.stockpile;
    s.t = num(spf, 'level', s.t);
    s.cuT = num(spf, 'cu', s.cuT);
    s.inflowT = num(spf, 'inflow_total', s.inflowT);
    s.lastIn = num(spf, 'inflow') / 3600;
    s.crushing = s.lastIn > 0;
  }

  // Агрегаты внутри зданий.
  for (const u of sim.equipment.units) {
    const fs = things.get(id.unit(u.def.key));
    if (!fs) continue;
    for (const k of Object.keys(fs)) {
      const raw = (fs[k] as { properties?: { value?: unknown } } | undefined)?.properties?.value;
      if (typeof raw === 'number' || typeof raw === 'string') u.v[k] = raw;
    }
    u.state = String(u.v.state ?? u.state) as UnitState;
    u.alarm = Number(u.v.alarm ?? 0) === 1;
  }

  // Хронология смены.
  const sh = things.get(id.shift);
  if (sh) {
    const tl = sim.timeline;
    const tr = str(sh, 'trucks').split('|');
    const ex = str(sh, 'excavators').split('|');
    tl.trucks = sim.trucks.map((_, i) => tr[i] ?? '');
    tl.excavators = sim.excavators.map((_, i) => ex[i] ?? '');
    tl.crusher = str(sh, 'crusher');
    tl.closures = str(sh, 'closures');
    tl.minutes = num(sh, 'minutes');
  }

  const c = sim.crusher;
  const cf = things.get(id.crusher);
  if (cf) {
    c.binT = num(cf, 'bin');
    c.binCuT = num(cf, 'bin_cu');
    c.starvedSec = num(cf, 'starved');
    c.tonnes = num(cf, 'tonnes_total');
    c.queue = ids(str(cf, 'queue_ids'));
    c.active = ids(str(cf, 'dumping_ids')).map((t) => ({ truck: t, left: 0 }));
  }
  {
    const fs = things.get(id.leach);
    if (fs) {
      const d = sim.dumps[1];
      d.tonnes = num(fs, 'tonnes_total');
      d.queue = ids(str(fs, 'queue_ids'));
      d.active = ids(str(fs, 'dumping_ids')).map((t) => ({ truck: t, left: 0 }));
      // Карты и раствор.
      const L = sim.leach;
      const cs = str(fs, 'cells').split(';').filter(Boolean);
      cs.forEach((row, i) => {
        const c = L.cells[i];
        const [stage, ore, cu, days, done] = row.split(':');
        if (!c || !['loading', 'rest', 'irrigating', 'spent'].includes(stage)) return;
        c.stage = stage as CellStage;
        c.oreT = Number(ore) || 0;
        c.cuT = Number(cu) || 0;
        c.daysLeached = Number(days) || 0;
        c.cuLeachedT = Number(done) || 0;
      });
      L.holdLeft = num(fs, 'irrigation_hold', L.holdLeft);
      const g = L.activeGroup(sim.now);
      const wet = L.holdLeft === 0 && sim.weather.irrigationOn;
      L.cells.forEach((c) => (c.irrigated = wet && c.stage === 'irrigating' && L.groupOf(c) === g));
      L.placedT = num(fs, 'placed_total', L.placedT);
      L.plsM3h = num(fs, 'pls_flow', L.plsM3h);
      L.plsGpl = num(fs, 'pls_cu', L.plsGpl);
      L.cuLeachedT = num(fs, 'cu_leached_total', L.cuLeachedT);
      L.syncedOxideT = d.tonnes;
    }
    const ef = things.get(id.energy);
    if (ef) {
      const en = sim.energy;
      en.totalKwh = num(ef, 'kwh_shift', en.totalKwh);
      en.segmentKwh = num(ef, 'segment_kwh', en.segmentKwh);
      // Мгновенные мощности по участкам: без них схема подстанции и панели на стенде показывали бы нули.
      const mwKey: Record<string, string> = { plant: 'plant_mw', crusher: 'crusher_mw', sxew: 'sxew_mw', tailings: 'tailings_mw', leach: 'leach_mw', pit: 'pit_mw', aux: 'aux_mw', plant2: 'plant2_mw', crusher2: 'crusher2_mw', camp: 'camp_mw' };
      for (const area of en.areas) area.mw = num(ef, mwKey[area.id], area.mw);
      en.peakMw = num(ef, 'peak_mw', en.peakMw);
      en.idleKwh = num(ef, 'idle_kwh', en.idleKwh);
      sim.powerCutLeft = num(ef, 'power_cut', sim.powerCutLeft);
      for (const part of str(ef, 'areas_kwh').split(';')) {
        const [aid, kwh] = part.split(':');
        const area = en.areas.find((a) => a.id === aid);
        if (area) area.kwh = Number(kwh) || 0;
      }
    }
    // Вторая цепочка: бункер, склад, статистика фабрики и агрегаты.
    {
      const c2 = sim.chain2;
      const cf = things.get(id.crusher2);
      if (cf) {
        c2.dump.binT = num(cf, 'bin', c2.dump.binT);
        c2.dump.binCuT = num(cf, 'bin_cu', c2.dump.binCuT);
        c2.dump.starvedSec = num(cf, 'starved', c2.dump.starvedSec);
        c2.dump.tonnes = num(cf, 'tonnes_total', c2.dump.tonnes);
        c2.inflowTph = num(cf, 'supply_tph', c2.inflowTph);
        c2.backedUpSec = num(cf, 'backed_up', c2.backedUpSec);
      }
      const sf = things.get(id.stockpile2);
      if (sf) {
        c2.stockpile.t = num(sf, 'level', c2.stockpile.t);
        c2.stockpile.cuT = num(sf, 'cu', c2.stockpile.cuT);
        c2.stockpile.inflowT = num(sf, 'inflow_total', c2.stockpile.inflowT);
        c2.stockpile.lastIn = num(sf, 'inflow') / 3600;
        c2.stockpile.crushing = c2.stockpile.lastIn > 0;
      }
      const pf2 = things.get(id.plant2);
      if (pf2) {
        c2.stats.plantFeedT = num(pf2, 'feed_total');
        c2.stats.cuFeedT = num(pf2, 'cu_feed');
        c2.stats.cuConcT = num(pf2, 'cu_concentrate');
        c2.stats.cuLossT = num(pf2, 'cu_loss');
        c2.stats.feedSec = num(pf2, 'feed_time');
        c2.stats.feedInBandSec = num(pf2, 'feed_in_band_time');
      }
      for (const u of c2.equipment.units) {
        const fs = things.get(id.unit2(u.def.key));
        if (!fs) continue;
        for (const k of Object.keys(fs)) {
          const raw = (fs[k] as { properties?: { value?: unknown } } | undefined)?.properties?.value;
          if (typeof raw === 'number' || typeof raw === 'string') u.v[k] = raw;
        }
        u.state = String(u.v.state ?? u.state) as UnitState;
        u.alarm = Number(u.v.alarm ?? 0) === 1;
      }
    }
    const wf = things.get(id.weather);
    if (wf) {
      const w = sim.weather;
      const ru = str(wf, 'sky');
      const sky = (Object.keys(SKY) as Sky[]).find((k) => SKY[k].ru === ru);
      if (sky) w.sky = sky;
      w.tempC = num(wf, 'temp', w.tempC);
      w.windMs = num(wf, 'wind', w.windMs);
    }
    const tl = things.get(id.tailings);
    if (tl) {
      const t = sim.tailings;
      t.storedT = num(tl, 'stored_t', t.storedT);
      t.tailsT = num(tl, 'tails_shift', t.tailsT);
      t.pulpM3h = num(tl, 'pulp_flow', t.pulpM3h);
      t.solidsTph = num(tl, 'solids_tph', t.solidsTph);
      t.pondV = num(tl, 'pond_level', t.pondM) * POND_AREA_M2;
      t.reclaimM3h = num(tl, 'reclaim_flow', t.reclaimM3h);
      t.reclaimM3 = num(tl, 'reclaim_total', t.reclaimM3);
      t.makeupM3 = num(tl, 'makeup_water', t.makeupM3);
      t.waterInM3 = num(tl, 'water_in', t.waterInM3);
      t.stormM3h = num(tl, 'storm_inflow', t.stormM3h);
      t.emergencyM3 = num(tl, 'emergency_total', t.emergencyM3);
    }
    const sx = things.get(id.sxew);
    if (sx) {
      const L = sim.leach;
      L.ewKA = num(sx, 'ew_current', L.ewKA);
      L.cathodeT = num(sx, 'cathode_total', L.cathodeT);
      L.acidT = num(sx, 'acid_total', L.acidT);
    }
  }
  {
    const fs = things.get(id.waste);
    if (fs) {
      sim.dumps
        .filter((d) => d.material === 'waste')
        .forEach((d, i) => {
          d.tonnes = num(fs, `dump_${i + 1}_t`, i === 0 ? num(fs, 'tonnes_total') : 0);
          d.queue = ids(str(fs, `dump_${i + 1}_queue_ids`, i === 0 ? str(fs, 'queue_ids') : ''));
          d.active = ids(str(fs, `dump_${i + 1}_dumping_ids`, i === 0 ? str(fs, 'dumping_ids') : '')).map((t) => ({ truck: t, left: 0 }));
        });
    }
  }
  const pf = things.get(id.plant);
  if (pf) {
    sim.stats.plantFeedT = num(pf, 'feed_total');
    sim.stats.cuFeedT = num(pf, 'cu_feed');
    sim.stats.cuConcT = num(pf, 'cu_concentrate');
    sim.stats.cuLossT = num(pf, 'cu_loss');
    sim.stats.feedSec = num(pf, 'feed_time');
    sim.stats.feedInBandSec = num(pf, 'feed_in_band_time');
  }
  const gf = things.get(id.garage);
  if (gf) {
    const occ = str(gf, 'slots').split(',').map(Number);
    occ.forEach((o, k2) => (sim.slotOccupant[k2] = o >= 0 ? o : null));
  }

  sim.trucks.forEach((t, i) => {
    const fs = things.get(id.truck(i));
    if (!fs) return;
    t.px = t.x;
    t.py = t.y;
    t.x = num(fs, 'x', t.x);
    t.y = num(fs, 'y', t.y);
    t.state = str(fs, 'state', t.state) as TruckState;
    t.node = num(fs, 'node', t.node);
    t.loadT = num(fs, 'payload');
    const m = str(fs, 'material', 'none');
    t.material = (MATERIALS as readonly string[]).includes(m) ? (m as Material) : null;
    t.gradePct = num(fs, 'grade');
    t.fuelL = num(fs, 'fuel', t.fuelL);
    t.engineH = num(fs, 'engine_hours', t.engineH);
    t.serviceInH = num(fs, 'service_in', t.serviceInH);
    t.trips = num(fs, 'trips_total');
    t.tonnes = num(fs, 'tonnes_total');
    t.homeEx = num(fs, 'home_excavator', t.homeEx);
    t.fixedEx = num(fs, 'fixed_excavator', t.fixedEx);
    t.timer = num(fs, 'timer');
    const slot = num(fs, 'park_slot', -1);
    t.parkSlot = slot >= 0 ? slot : null;
    const dk = str(fs, 'dest_kind', 'none');
    const did = num(fs, 'dest_id', -1);
    let dest: Destination | null = null;
    if (dk === 'excavator') dest = { kind: 'excavator', id: did };
    else if (dk === 'dump') dest = { kind: 'dump', id: did };
    else if (dk === 'garage') dest = { kind: 'garage', purpose: str(fs, 'dest_purpose') === 'service' ? 'service' : 'refuel', slot: Math.max(0, did) };
    t.dest = dest;
    t.destNode = dest ? sim.destinationNode(dest) : t.node;
    // Текущее ребро + маршрут до цели (для ленты маршрута и движения задним ходом со стоянки).
    const from = num(fs, 'edge_from', t.node);
    const to = num(fs, 'edge_to', t.node);
    t.segPos = num(fs, 'seg_pos');
    t.seg = 0;
    if (from !== to && g.edgeBetween(from, to) !== undefined) {
      const rest = dest ? sim.router.route(to, t.destNode) : null;
      t.path = rest ? [from, ...rest] : [from, to];
    } else t.path = [t.node];
    t.sensors.tempC = num(fs, 'engine_temp', t.sensors.tempC);
    t.sensors.expectedTempC = num(fs, 'engine_temp_expected', t.sensors.expectedTempC);
    t.sensors.vibration = num(fs, 'vibration', t.sensors.vibration);
    t.sensors.tyreBar = num(fs, 'tyre_pressure', t.sensors.tyreBar);
    const minute = Math.floor(sim.now / 60);
    const lastLog = (t.sensors as { _m?: number })._m;
    if (lastLog !== minute) {
      (t.sensors as { _m?: number })._m = minute;
      t.sensors.log.push([t.sensors.tempC, t.sensors.expectedTempC, t.sensors.vibration]);
      if (t.sensors.log.length > 60) t.sensors.log.shift();
    }
    t.health.risk = num(fs, 'failure_risk');
    const eta = num(fs, 'failure_eta', -1);
    t.health.etaMin = eta >= 0 ? eta : null;
    t.health.alert = num(fs, 'failure_alert') === 1;
    const sign = str(fs, 'failure_sign', 'none');
    t.health.sign = sign === 'none' ? null : (sign as FailureType);
    t.health.score = num(fs, 'health_index');
    t.serviceRequested = num(fs, 'service_requested') === 1;
    const ds = t.driverStats;
    ds.distM = num(fs, 'drv_dist');
    ds.rampSec = num(fs, 'drv_ramp_time');
    ds.rampDistM = num(fs, 'drv_ramp_dist');
    ds.fuelUsedL = num(fs, 'drv_fuel');
    ds.harsh = num(fs, 'drv_harsh');
    ds.fatigue = num(fs, 'drv_fatigue', ds.fatigue);
    ds.fatigueEvents = num(fs, 'drv_fatigue_events');
    ds.cas = num(fs, 'cas_alerts');
  });

  // История для графиков — точка каждые historyEverySec модельного времени.
  if (k) {
    const every = sim.cfg.shift.historyEverySec;
    const lastH = sim.history[sim.history.length - 1];
    if (!lastH || sim.now - lastH.tMin * 60 >= every || sim.now < lastH.tMin * 60) {
      if (lastH && sim.now < lastH.tMin * 60) sim.history.splice(0, sim.history.length);
      const perHour = 3600 / every;
      const ref = sim.history.length >= perHour ? sim.history[sim.history.length - perHour] : null;
      sim.history.push({
        tMin: sim.now / 60,
        tph: ref ? k.minedTotal - ref.minedTotal : k.tph,
        minedTotal: k.minedTotal,
        mined: { ...k.mined },
        binT: c.binT,
        stockT: sim.stockpile.t,
        queues: sim.excavators.map((e) => e.queue.length),
        feedGrade: sim.stockpile.t > 1 ? sim.feedGrade : null,
      });
    }
  }
  return k;
}
