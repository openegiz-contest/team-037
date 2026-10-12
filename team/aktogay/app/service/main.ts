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
import { CONTROL_ID, SITE_NS, serializeAll, siteDefinitions, thingDefinitions, VARIANTS, type Features, type ThingBody } from '../src/platform/twins';

const env = (k: string, d: string) => process.env[k] ?? d;
const DITTO_URL = env('DITTO_URL', 'http://localhost:8080').replace(/\/$/, '');
const DITTO_USER = env('DITTO_USER', 'ditto');
const DITTO_PASSWORD = env('DITTO_PASSWORD', '');
const MQTT_URL = `mqtt://${env('MQTT_HOST', 'localhost')}:${env('MQTT_PORT', '1883')}`;
/** Секунд модельного времени за секунду реального (x1 в интерфейсе = 10). */
let speed = Number(env('SIM_SPEEDUP', '20'));
let seed = Number(env('SIM_SEED', '42'));
let truckCount = Number(env('SIM_TRUCKS', '20'));
/** Как часто публиковать состояние двойников, мс реального времени. */
const PUBLISH_MS = Number(env('PUBLISH_MS', '1000'));

const AUTH = 'Basic ' + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString('base64');
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

let sims: Record<StrategyName, Simulation> = makeSims();
let running = true;
let commandSeq = -1;
let lastScenario = 'нет';

function makeSims(): Record<StrategyName, Simulation> {
  return {
    fixed: new Simulation({ seed, truckCount, strategy: 'fixed' }),
    smart: new Simulation({ seed, truckCount, strategy: 'smart' }),
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

/** Самосвалы, которых больше нет после уменьшения парка, удаляются из Ditto. */
async function setupTwins(prevTrucks = 0): Promise<void> {
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
    for (let i = truckCount; i < prevTrucks; i++) await deleteThing(`${SITE_NS}.${v}:truck-${101 + i}`);
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

function publishStatus(): void {
  const active: string[] = [];
  const s = sims.smart;
  s.excavators.forEach((ex) => ex.state === 'broken' && active.push(`поломка ${ex.name}`));
  s.closures.forEach((c) => active.push(`закрыт: ${c.label}`));
  s.blasts.filter((b) => b.phase === 'warning' || b.phase === 'active').forEach((b) => active.push(`взрыв #${b.id} у ${b.label.replace('Взрывные работы у ', '')} (${b.phase === 'active' ? 'оцепление' : 'объявлен'})`));
  // Статус пишем в признак status двойника управления (без перезаписи признака command).
  const msg = {
    topic: `${SITE_NS}/control/things/twin/commands/modify`,
    path: '/features/status',
    value: {
      properties: {
        value: running ? 'running' : 'paused',
        speed,
        seed,
        trucks: truckCount,
        sim_time: Math.round(s.now),
        finished: s.finished,
        active_scenarios: active,
        last_scenario: lastScenario,
      },
    },
  };
  client.publish(`telemetry/control.${SITE_NS}`, JSON.stringify(msg), { qos: 0 });
}

// ───────────────────────────── сценарии «что если» ─────────────────────────────

interface Command {
  value: string;
  arg?: number;
  seq?: number;
  seed?: number;
  trucks?: number;
}

async function applyCommand(c: Command): Promise<void> {
  const both = (fn: (s: Simulation) => unknown) => VARIANTS.map((v) => fn(sims[v]));
  const a = Number(c.arg ?? 0);
  switch (c.value) {
    case 'breakdown': // поломка экскаватора a на 50 мин; отмена — 'repair'
      both((s) => s.injectExcavatorBreakdown(a, 50 * 60));
      lastScenario = `поломка экскаватора Э-${a + 1}`;
      break;
    case 'repair':
      both((s) => s.repairExcavator(a));
      lastScenario = `отмена поломки Э-${a + 1}`;
      break;
    case 'close_road': // закрыть участок съезда a на 40 мин; отмена — 'open_road'
      both((s) => s.injectRoadClosure(a, 40 * 60));
      lastScenario = `закрыт участок #${a}`;
      break;
    case 'open_road':
      both((s) => s.openRoad(a));
      lastScenario = `открыт участок #${a}`;
      break;
    case 'blast': // взрыв у экскаватора a через 15 мин; отмена — 'cancel_blast' (id из двойника blasting)
      both((s) => s.scheduleBlast(a, s.cfg.blasting.warnMin * 60));
      lastScenario = `объявлен взрыв у Э-${a + 1}`;
      break;
    case 'cancel_blast':
      both((s) => s.cancelBlast(a));
      lastScenario = `отменён взрыв #${a}`;
      break;
    case 'cancel_all': // отменить все активные сценарии
      both((s) => {
        s.excavators.forEach((ex) => s.repairExcavator(ex.id));
        s.layout.closureGroups.forEach((_, g) => s.openRoad(g));
        s.blasts.filter((b) => b.phase === 'warning' || b.phase === 'active').forEach((b) => s.cancelBlast(b.id));
      });
      lastScenario = 'все сценарии отменены';
      break;
    case 'pause':
      running = false;
      break;
    case 'resume':
      running = true;
      break;
    case 'speed':
      speed = Math.max(1, Math.min(2000, a || 20));
      break;
    case 'reset': {
      const prev = truckCount;
      if (c.seed !== undefined) seed = Number(c.seed);
      if (c.trucks !== undefined) truckCount = Math.max(5, Math.min(30, Number(c.trucks)));
      sims = makeSims();
      lastScenario = `новая смена (seed ${seed}, ${truckCount} самосвалов)`;
      await setupTwins(prev);
      break;
    }
    default:
      return;
  }
  log(`команда: ${c.value} ${c.arg ?? ''} → ${lastScenario}`);
  publishAll();
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

async function main(): Promise<void> {
  log(`Ditto: ${DITTO_URL}, MQTT: ${MQTT_URL}, скорость x${speed / 10} (${speed} с модели/с), seed ${seed}, самосвалов ${truckCount}`);
  await setupTwins();
  let last = Date.now();
  let lastPublish = 0;
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
  }, 100);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
