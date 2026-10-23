/**
 * Сервис-симулятор рудника «Актогай» для OpenEgiz.
 *
 * - Создаёт двойников в Eclipse Ditto (идемпотентные PUT).
 * - Ведёт две модели одного карьера (фиксированное закрепление и умная диспетчеризация)
 *   на одном seed и публикует их состояние в MQTT `telemetry/<двойник>` командами Ditto `modify` —
 *   так же, как это делал бы полевой шлюз. С Ditto/InfluxDB напрямую данными не обменивается.
 * - Слушает двойник управления (`org.aktogay:control`): изменения его признака `command`
 *   приходят от платформы по MQTT (`opentwins/twin/events/org.aktogay/control`) и запускают
 *   или отменяют сценарии «что если» в обеих моделях.
 */
import mqtt from 'mqtt';
import { computeKpis, Simulation, type StrategyName } from '../src/sim';
import { activeScenarioLabels, applyScenario, type Command } from '../src/platform/scenarios';
import { defaultFleet, fleetConfig, sanitizeFleet, type Fleet } from '../src/platform/fleet';
import { applyDispatch, DISPATCH_COMMANDS, emptyDispatch, type DispatchCommand } from '../src/platform/dispatch';
import { CONTROL_ID, SITE_NS, serializeShift, thingIds, serializeAll, siteDefinitions, thingDefinitions, VARIANTS, type Features, type ThingBody } from '../src/platform/twins';

const env = (k: string, d: string) => process.env[k] ?? d;
const DITTO_URL = env('DITTO_URL', 'http://localhost:8080').replace(/\/$/, '');
const DITTO_USER = env('DITTO_USER', 'ditto');
const DITTO_PASSWORD = env('DITTO_PASSWORD', '');
const MQTT_URL = `mqtt://${env('MQTT_HOST', 'localhost')}:${env('MQTT_PORT', '1883')}`;
/** Секунд модельного времени за секунду реального (x1 в интерфейсе = 10). */
let speed = Number(env('SIM_SPEEDUP', '10'));
let seed = Number(env('SIM_SEED', '42'));
/** Месяц года для погоды и сезона (1…12). */
let month = Number(env('SIM_MONTH', '10'));
/** Парк техники: самосвалы и состав экскаваторов (меняется командой reset { fleet }). */
let fleet: Fleet = defaultFleet(Math.max(5, Math.min(30, Number(env('SIM_TRUCKS', '20')))));
/** Как часто публиковать состояние двойников, мс реального времени. */
const PUBLISH_MS = Number(env('PUBLISH_MS', '1000'));

const AUTH = 'Basic ' + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString('base64');
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

let sims: Record<StrategyName, Simulation> = makeSims();
let running = true;
let commandSeq = -1;
/** Диспетчерская смены: приказы, сообщения водителям, ответы (только реальный карьер). */
let dispatch = emptyDispatch();
let lastScenario = 'нет';
/** Последние выполненные команды для раздела «Сценарии»: [время модели, с; описание]. */
const history: [number, string][] = [];

function makeSims(): Record<StrategyName, Simulation> {
  return {
    fixed: new Simulation({ seed, truckCount: fleet.trucks, strategy: 'fixed', config: fleetConfig(fleet), month }),
    smart: new Simulation({ seed, truckCount: fleet.trucks, strategy: 'smart', config: fleetConfig(fleet), month }),
  };
}

// ───────────────────────────── Ditto: создание двойников ─────────────────────────────

async function putThing(id: string, body: ThingBody): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${DITTO_URL}/api/2/things/${id}`, {
        method: 'PUT',
        headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201 || res.status === 204) return;
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      if (attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function deleteThing(id: string): Promise<void> {
  await fetch(`${DITTO_URL}/api/2/things/${id}`, { method: 'DELETE', headers: { Authorization: AUTH } }).catch(() => undefined);
}

/** Самосвалы и экскаваторы, которых больше нет после изменения парка, удаляются из Ditto. */
async function setupTwins(prevTrucks = 0, prevExcavators = 0): Promise<void> {
  for (const [id, body] of Object.entries(siteDefinitions())) {
    if (id === CONTROL_ID) {
      // Двойник управления создаём, только если его ещё нет, — чтобы не затереть команду.
      const r = await fetch(`${DITTO_URL}/api/2/things/${id}`, { headers: { Authorization: AUTH } }).catch(() => null);
      if (r && r.status === 200) continue;
    }
    await putThing(id, body);
  }
  for (const v of VARIANTS) {
    const defs = thingDefinitions(sims[v], v);
    for (const [id, body] of Object.entries(defs)) await putThing(id, body);
    for (let i = fleet.trucks; i < prevTrucks; i++) await deleteThing(`${SITE_NS}.${v}:truck-${101 + i}`);
    for (let i = fleet.excavators.length; i < prevExcavators; i++) await deleteThing(`${SITE_NS}.${v}:excavator-${i + 1}`);
  }
  log(`двойники готовы: ${Object.keys(thingDefinitions(sims.smart, 'smart')).length * 2 + 2} шт.`);
}

// ───────────────────────────── MQTT ─────────────────────────────

const client = mqtt.connect(MQTT_URL, { clientId: `aktogay-sim-${process.pid}`, reconnectPeriod: 2000 });

function publishTwin(thingId: string, features: Features): void {
  const [ns, name] = thingId.split(':');
  const msg = { topic: `${ns}/${name}/things/twin/commands/modify`, path: '/features', value: features };
  client.publish(`telemetry/${name}.${ns}`, JSON.stringify(msg), { qos: 0 });
}

function publishAll(): void {
  for (const v of VARIANTS) {
    const sim = sims[v];
    const all = serializeAll(sim, v, computeKpis(sim));
    for (const [id, fs] of Object.entries(all)) publishTwin(id, fs);
  }
  publishStatus();
}

/** Хронология смены — строки по минутам, публикуется раз в 15 с (не нагружает Ditto и InfluxDB). */
function publishShift(): void {
  for (const v of VARIANTS) publishTwin(thingIds(v).shift, serializeShift(sims[v]));
}

function publishStatus(): void {
  const s = sims.smart;
  const active = activeScenarioLabels(s);
  // Статус пишем в признак status двойника управления (без перезаписи признака command).
  const msg = {
    topic: `${SITE_NS}/control/things/twin/commands/modify`,
    path: '/features/status',
    value: {
      properties: {
        value: running ? 'running' : 'paused',
        speed,
        seed,
        trucks: fleet.trucks,
        fleet,
        sim_time: Math.round(s.now),
        finished: s.finished,
        active_scenarios: active,
        last_scenario: lastScenario,
        history_log: history.map(([t, text]) => `${t}|${text}`),
      },
    },
  };
  client.publish(`telemetry/control.${SITE_NS}`, JSON.stringify(msg), { qos: 0 });
  publishDispatch();
}

/** Состояние диспетчерской — в признак dispatch двойника управления (его читают разделы «Диспетчер» и «Терминал»). */
function publishDispatch(): void {
  const msg = {
    topic: `${SITE_NS}/control/things/twin/commands/modify`,
    path: '/features/dispatch',
    value: { properties: { ...dispatch, sim_time: Math.round(sims.smart.now) } },
  };
  client.publish(`telemetry/control.${SITE_NS}`, JSON.stringify(msg), { qos: 0 });
}

// ───────────────────────────── сценарии «что если» ─────────────────────────────

async function applyCommand(c: Command): Promise<void> {
  if (DISPATCH_COMMANDS.has(c.value)) {
    // Приказ диспетчера или ответ водителя — только реальному карьеру (теневой расчёт — «как без системы»).
    const done = applyDispatch(dispatch, sims.smart, c as unknown as DispatchCommand);
    log(`диспетчерская: ${c.value} → ${done ?? 'отклонено'}`);
    publishAll();
    return;
  }
  const text = applyScenario(VARIANTS.map((v) => sims[v]), c);
  if (text) lastScenario = text;
  switch (c.value) {
    case 'pause':
      // Рудник работает непрерывно — пауза не поддерживается (команда игнорируется).
      running = true;
      break;
    case 'resume':
      running = true;
      break;
    case 'speed':
      speed = Math.max(1, Math.min(2000, Number(c.arg) || 10));
      break;
    case 'reset': {
      const prevTrucks = fleet.trucks;
      const prevExcavators = fleet.excavators.length;
      if (c.seed !== undefined) seed = Number(c.seed);
      if (c.month !== undefined) month = Math.max(1, Math.min(12, Number(c.month)));
      if (c.fleet !== undefined) fleet = sanitizeFleet(c.fleet, fleet);
      if (c.trucks !== undefined) fleet = sanitizeFleet({ ...fleet, trucks: Number(c.trucks) }, fleet);
      sims = makeSims();
      dispatch = emptyDispatch();
      lastScenario = `новая смена (seed ${seed}, ${fleet.trucks} самосвалов, ${fleet.excavators.length} экскаваторов)`;
      await setupTwins(prevTrucks, prevExcavators);
      break;
    }
    default:
      if (!text) return;
  }
  if (text || c.value === 'reset') {
    history.push([Math.round(sims.smart.now), lastScenario]);
    if (history.length > 30) history.shift();
  }
  log(`команда: ${c.value} ${c.arg ?? ''} → ${lastScenario}`);
  publishAll();
  publishShift();
}

client.on('connect', () => {
  log(`MQTT подключён: ${MQTT_URL}`);
  // Платформа пересылает события двойников в opentwins/<канал>/<критерий>/<namespace>/<имя>.
  client.subscribe(`opentwins/twin/events/${SITE_NS}/control`, { qos: 1 });
});

client.on('message', (_topic, payload) => {
  try {
    const ev = JSON.parse(payload.toString()) as { path?: string; value?: unknown };
    const path = ev.path ?? '';
    let cmd: Command | undefined;
    if (path === '/features/command/properties') cmd = ev.value as Command;
    else if (path === '/features/command') cmd = (ev.value as { properties?: Command })?.properties;
    else if (path === '/features') cmd = (ev.value as { command?: { properties?: Command } })?.command?.properties;
    if (!cmd || !cmd.value || cmd.value === 'none') return;
    const seq = Number(cmd.seq ?? 0);
    if (seq === commandSeq) return; // эта команда уже выполнена
    commandSeq = seq;
    void applyCommand(cmd);
  } catch (e) {
    log('не удалось разобрать событие', e);
  }
});

// ───────────────────────────── главный цикл ─────────────────────────────

/**
 * Парк техники и seed переживают перезапуск симулятора: они записаны в признак status двойника
 * управления, поэтому при старте читаем их из Ditto. На чистом стенде двойника ещё нет — берём
 * значения по умолчанию (SIM_TRUCKS, SIM_SEED).
 */
async function restoreState(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const r = await fetch(`${DITTO_URL}/api/2/things/${CONTROL_ID}/features/status/properties`, { headers: { Authorization: AUTH } });
      if (r.status === 404) return; // двойника или статуса ещё нет — первый запуск
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const st = (await r.json()) as { seed?: number; fleet?: unknown };
      if (Number.isFinite(Number(st.seed))) seed = Number(st.seed);
      if (st.fleet) fleet = sanitizeFleet(st.fleet, fleet);
      sims = makeSims();
      log(`восстановлено из Ditto: seed ${seed}, самосвалов ${fleet.trucks}, экскаваторов ${fleet.excavators.length}`);
      return;
    } catch (e) {
      if (attempt === 29) {
        log('не удалось прочитать прошлый парк из Ditto, беру значения по умолчанию', e);
        return;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function main(): Promise<void> {
  log(`Ditto: ${DITTO_URL}, MQTT: ${MQTT_URL}, скорость x${speed / 10} (${speed} с модели/с), seed ${seed}, самосвалов ${fleet.trucks}, экскаваторов ${fleet.excavators.length}`);
  await restoreState();
  await setupTwins();
  let last = Date.now();
  let lastPublish = 0;
  let lastShift = 0;
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    if (running) {
      for (const v of VARIANTS) sims[v].advance(dt * speed);
      // Смена закончилась — начинаем новую с тем же seed (стенд всегда «живой»).
      if (sims.smart.finished && sims.fixed.finished) {
        sims = makeSims();
        lastScenario = 'новая смена';
      }
    }
    if (now - lastPublish >= PUBLISH_MS && client.connected) {
      lastPublish = now;
      publishAll();
    }
    if (now - lastShift >= 15000 && client.connected) {
      lastShift = now;
      publishShift();
    }
  }, 100);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
