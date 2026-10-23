import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Charts } from './components/Charts';
import { InfoCard } from './components/InfoCard';
import { BuildingView } from './components/BuildingView';
import type { BuildingKind } from './render3d/MineScene';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { KpiPanel } from './components/KpiPanel';
import { CostPanel } from './components/CostPanel';
import { WeatherChip } from './components/WeatherChip';
import { Mine3D } from './components/Mine3D';
import { MineCanvas } from './components/MineCanvas';
import { Sidebar, routeFromHash, ROUTE_HASH, type Route } from './components/Sidebar';
import { TwinsPage } from './pages/TwinsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { FleetPage } from './pages/FleetPage';
import { TimelinePage } from './pages/TimelinePage';
import { ReportPage } from './pages/ReportPage';
import { DriversPage } from './pages/DriversPage';
import { GeologyPage } from './pages/GeologyPage';
import { SiteMapPage } from './pages/SiteMapPage';
import { DispatchPage } from './pages/DispatchPage';
import { TerminalPage } from './pages/TerminalPage';
import { LoginPage } from './pages/LoginPage';
import { loadSession, saveSession, type Session } from './platform/accounts';
import { applyDispatch, emptyDispatch, type DispatchCommand } from './platform/dispatch';
import { defaultFleet, fleetConfig, type Fleet } from './platform/fleet';
import { PlatformBridge } from './platform/bridge';
import { activeDeviations, applyScenario, type Command } from './platform/scenarios';
import { applyTheme, loadTheme, saveTheme, type ThemeMode } from './ui/themeMode';
import { glRenderer, loadQualityMode, resolveQuality, saveQualityMode, softwareGL, webglAvailable, type QualityMode } from './render3d/quality';
import type { Selection } from './render/drawMine';
import { computeEffect, computeKpis, deltaPct, MATERIAL_SHORT, Simulation, type StrategyName } from './sim';
import { SKY } from './sim/weather';
import { fmtClock, fmtDelta, fmtInt, fmtKzt } from './ui/format';
import { MATERIAL_COLOR, STATE_GROUPS, STRATEGY_COLOR } from './ui/theme';

type View = '3d' | '2d';
type Speed = 1 | 5 | 20 | 50 | 'max';

/** Секунд смены за 1 секунду реального времени при скорости x1. */
const BASE_RATE = 10;
const SPEEDS: Speed[] = [1, 5, 20, 50, 'max'];

export default function App() {
  /** ?embed=1 — компактный вид для панели Grafana. */
  const embed = useMemo(() => new URLSearchParams(window.location.search).get('embed') === '1', []);
  // Без WebGL сразу показываем 2D-схему.
  const [view, setView] = useState<View>(() => (webglAvailable() ? '3d' : '2d'));
  const [qualityMode, setQualityMode] = useState<QualityMode>(loadQualityMode);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [slow3d, setSlow3d] = useState(false);
  const quality = resolveQuality(qualityMode, slow3d);
  const [seed, setSeed] = useState(42);
  /** Парк техники в автономном режиме (на стенде — из статуса двойника управления). */
  const [fleet, setFleet] = useState<Fleet>(() => defaultFleet(20));
  const [speed, setSpeed] = useState<Speed>(1);
  // Рудник работает непрерывно: смена стартует сама, по окончании начинается следующая.
  const [running, setRunning] = useState(true);
  const [selection, setSelection] = useState<{ v: StrategyName; sel: Selection } | null>(null);
  /** Открытый «внутренний двойник» здания (мнемосхема). */
  const [building, setBuilding] = useState<{ v: StrategyName; kind: BuildingKind } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [, setFrame] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  /** Раздел из адреса: #/ — карьер, #/twins/<thingId> — двойники, #/scenarios — сценарии. */
  const [hash, setHash] = useState(() => window.location.hash);
  /** Демо-вход в разделы «Диспетчер» и «Терминал водителя». */
  const [session, setSession] = useState<Session | null>(() => loadSession());
  /** Диспетчерская без стенда — в браузере, на локальной модели. */
  const localDispatch = useRef(emptyDispatch());
  const route: Route = routeFromHash(hash);
  const twinId = hash.startsWith('#/twins/') ? decodeURIComponent(hash.slice('#/twins/'.length)) : null;
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('aktogay.nav') === 'collapsed';
    } catch {
      return false;
    }
  });
  /** История сценариев в автономном режиме (на стенде её ведёт симулятор в двойнике управления). */
  const [localHistory, setLocalHistory] = useState<[number, string][]>([]);

  const simsRef = useRef<Simulation[]>([]);
  const weatherIdx = useRef(0);
  /** Подключение к OpenEgiz: если интерфейс открыт со Стенда, данные берутся из двойников Ditto. */
  const [bridge, setBridge] = useState<PlatformBridge | null>(null);
  const bridgeRef = useRef<PlatformBridge | null>(null);
  const runningRef = useRef(running);
  const restartAt = useRef(0);
  const nextShift = useRef<() => void>(() => undefined);
  const speedRef = useRef(speed);
  const breakIdx = useRef(0);
  const closeIdx = useRef(0);
  const blastIdx = useRef(1);
  runningRef.current = running;
  speedRef.current = speed;

  const createSims = useCallback(() => {
    // Всегда два варианта: реальная работа (умная диспетчеризация) и теневой расчёт без системы.
    const strategies: StrategyName[] = ['fixed', 'smart'];
    const config = fleetConfig(fleet);
    simsRef.current = strategies.map((s) => new Simulation({ seed, truckCount: fleet.trucks, strategy: s, config }));
    breakIdx.current = 0;
    restartAt.current = 0;
    closeIdx.current = 0;
    setSelection(null);
    setEpoch((e) => e + 1);
  }, [seed, fleet]);

  useEffect(createSims, [createSims]);

  // Встроенная в Grafana сцена висит открытой часами: раз в минуту проверяем, не пересобран ли
  // интерфейс (ETag index.html), и перезагружаем панель, чтобы она показывала новую версию.
  useEffect(() => {
    if (!embed) return;
    let etag: string | null = null;
    const check = async () => {
      try {
        const r = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
        const e = r.headers.get('etag') ?? r.headers.get('last-modified');
        if (etag && e && e !== etag) window.location.reload();
        etag = e ?? etag;
      } catch {
        /* нет связи — проверим позже */
      }
    };
    void check();
    const id = window.setInterval(check, 60000);
    return () => window.clearInterval(id);
  }, [embed]);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toggleTheme = () =>
    setTheme((t) => {
      const next: ThemeMode = t === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      saveTheme(next);
      return next;
    });

  const toggleNav = () =>
    setNavCollapsed((c) => {
      try {
        localStorage.setItem('aktogay.nav', c ? 'open' : 'collapsed');
      } catch {
        /* без сохранения */
      }
      return !c;
    });

  useEffect(() => {
    let alive = true;
    void PlatformBridge.detect().then((b) => {
      if (!alive || !b) return;
      b.onReset = () => {
        setSelection(null);
        setEpoch((e) => e + 1);
      };
      bridgeRef.current = b;
      setBridge(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Главный цикл: продвигаем все симуляции синхронно на одно и то же модельное время.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const b = bridgeRef.current;
      if (b) {
        // Режим платформы: модель считает сервис-симулятор, здесь только применяем данные двойников.
        b.pump(now);
        if (b.sims) for (const s of Object.values(b.sims)) s.alphaOverride = b.alpha(now);
      }
      const sims = simsRef.current;
      if (!b && runningRef.current && sims.length > 0) {
        const sp = speedRef.current;
        if (sp === 'max') {
          const deadline = performance.now() + 14;
          while (performance.now() < deadline && !sims.every((s) => s.finished)) for (const s of sims) s.advance(120);
        } else {
          const simSec = dt * BASE_RATE * sp;
          for (const s of sims) s.advance(simSec);
        }
        if (sims.every((s) => s.finished) && !restartAt.current) restartAt.current = now + 8000;
      }
      // Новая смена через 8 с после окончания (успеваем показать итог смены).
      if (!b && restartAt.current && now >= restartAt.current) {
        restartAt.current = 0;
        nextShift.current();
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500);
  };

  const triggerBreakdown = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const n = b.sims.smart.excavators.length;
      const exId = selection?.sel?.kind === 'excavator' ? selection.sel.id : breakIdx.current++ % n;
      void b.send('breakdown', exId);
      flash(`⚠ Сценарий отправлен в OpenEgiz: поломка ${b.sims.smart.excavators[exId].name}`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const n = sims[0].excavators.length;
    let exId: number;
    if (selection?.sel?.kind === 'excavator') exId = selection.sel.id;
    else {
      exId = breakIdx.current % n;
      breakIdx.current++;
    }
    for (const s of sims) s.injectExcavatorBreakdown(exId, 50 * 60);
    const ex = sims[0].excavators[exId];
    flash(`⚠ Поломка экскаватора ${ex.name} (${MATERIAL_SHORT[ex.material]}) на 50 мин`);
    if (!runningRef.current) setRunning(true);
  }, [selection]);

  /** Сценарий «что если»: вызвать непогоду — метель, пыльную бурю или туман по очереди. */
  const triggerWeather = useCallback(() => {
    const kinds = ['blizzard', 'dust', 'fog'] as const;
    const sky = kinds[weatherIdx.current++ % kinds.length];
    const ru = SKY[sky].ru;
    const b = bridgeRef.current;
    if (b?.sims) {
      void b.send('weather', sky);
      flash(`❄ Сценарий отправлен в OpenEgiz: ${ru}`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    for (const s of sims) s.weather.force(s, sky, 60 * 60);
    flash(`❄ ${ru[0].toUpperCase()}${ru.slice(1)} на 60 мин — скорость возки ${Math.round(SKY[sky].speed * 100)} % от нормы`);
    if (!runningRef.current) setRunning(true);
  }, []);

  const triggerBlast = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const n = b.sims.smart.excavators.length;
      const exId = selection?.sel?.kind === 'excavator' ? selection.sel.id : blastIdx.current++ % n;
      void b.send('blast', exId);
      flash(`✸ Сценарий отправлен в OpenEgiz: взрыв у ${b.sims.smart.excavators[exId].name} через ${b.sims.smart.cfg.blasting.warnMin} мин`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const n = sims[0].excavators.length;
    let exId: number;
    if (selection?.sel?.kind === 'excavator') exId = selection.sel.id;
    else {
      exId = blastIdx.current % n;
      blastIdx.current++;
    }
    const warn = sims[0].cfg.blasting.warnMin;
    for (const s of sims) s.scheduleBlast(exId, warn * 60);
    flash(`✸ Взрывные работы у ${sims[0].excavators[exId].name} через ${warn} мин — вывод техники`);
    if (!runningRef.current) setRunning(true);
  }, [selection]);

  const triggerClosure = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const groups = b.sims.smart.layout.closureGroups;
      const g = closeIdx.current++ % groups.length;
      void b.send('close_road', g);
      flash(`⊘ Сценарий отправлен в OpenEgiz: перекрыт ${groups[g].label}`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const groups = sims[0].layout.closureGroups;
    for (let k = 0; k < groups.length; k++) {
      const g = (closeIdx.current + k) % groups.length;
      if (sims.every((s) => s.injectRoadClosure(g, 40 * 60))) {
        closeIdx.current = g + 1;
        flash(`⊘ Перекрыт участок: ${groups[g].label} на 40 мин`);
        return;
      }
    }
    flash('Нельзя перекрыть: сеть дорог разорвётся');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'KeyW') triggerWeather();
      if (e.code === 'KeyB') triggerBreakdown();
      else if (e.code === 'KeyC') triggerClosure();
      else if (e.code === 'KeyE') triggerBlast();
      else if (e.code === 'KeyR') createSims();
    };
    // Пробел на сфокусированной кнопке иначе «нажмёт» её при отпускании клавиши.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [triggerBreakdown, triggerClosure, triggerBlast, triggerWeather, createSims]);

  const platformSims = bridge?.sims ?? null;
  /** Оба варианта: [теневой без системы, реальный]. */
  const allSims = platformSims ? [platformSims.fixed, platformSims.smart] : simsRef.current;
  const kpisAll = allSims.map((s) => bridge?.kpis[s.strategyName] ?? computeKpis(s));
  /** «Карьер» показывает только реальный карьер, «Эффект» — оба варианта рядом. */
  const isEffect = route === 'effect' && !embed;
  const sims = isEffect ? allSims : allSims.filter((s) => s.strategyName === 'smart');
  const kpis = isEffect ? kpisAll : kpisAll.filter((_, i) => allSims[i].strategyName === 'smart');
  const pStatus = bridge?.status ?? null;
  /** Парк, который работает сейчас: на стенде — из двойника управления. */
  const currentFleet = bridge ? bridge.fleet : fleet;
  const isRunning = true;
  /** Паузы нет: рудник работает непрерывно. Оставлено для совместимости разделов. */
  const toggleRun = () => undefined;
  nextShift.current = createSims;
  /** На стенде скорость задаёт сервис — кнопка показывает то, что реально идёт. */
  const shownSpeed: Speed = bridge && pStatus?.speed ? (pStatus.speed >= 2000 ? 'max' : ((pStatus.speed / BASE_RATE) as Speed)) : speed;
  const chooseSpeed = (s: Speed) => {
    setSpeed(s);
    if (bridge) void bridge.send('speed', s === 'max' ? 2000 : BASE_RATE * s);
  };
  const doReset = () => {
    if (bridge) {
      void bridge.send('reset', 0, { seed });
      flash(`↺ Новая смена в OpenEgiz: seed ${seed}`);
    } else createSims();
  };
  /** Выполнить команду «что если»: на стенде — через двойник управления, иначе — в локальной модели. */
  const act = (c: Command) => {
    const { value, arg, ...extra } = c;
    if (bridge) {
      void bridge.send(value, arg, extra as Record<string, unknown>);
      flash(`→ OpenEgiz: ${COMMAND_LABEL[value] ?? value}`);
      return;
    }
    if (value === 'pause' || value === 'resume') return; // паузы нет
    if (value === 'reset') {
      const ns = c.seed ?? seed;
      const nf = (c.fleet as Fleet | undefined) ?? fleet;
      if (ns === seed && nf === fleet) createSims();
      setSeed(ns);
      setFleet(nf);
      setLocalHistory([[0, `новая смена (seed ${ns}, ${nf.trucks} самосвалов, ${nf.excavators.length} экскаваторов)`]]);
      flash(`↺ Новая смена: seed ${ns}, ${nf.trucks} самосвалов, ${nf.excavators.length} экскаваторов`);
      return;
    }
    const text = applyScenario(simsRef.current, c);
    if (!text) return;
    setLocalHistory((h) => [...h.slice(-29), [Math.round(simsRef.current[0]?.now ?? 0), text]]);
    flash(text);
    if (!runningRef.current && value !== 'cancel_all') setRunning(true);
  };

  /** Перейти к объекту на карте из раздела «Двойники»: реальный — в «Карьер», теневой — в «Эффект». */
  /** Открыть «внутренний двойник» здания из раздела «Двойники». */
  const openInside = (variant: StrategyName, kind: BuildingKind) => {
    setSelection(null);
    setBuilding({ v: variant, kind });
    window.location.hash = variant === 'smart' ? ROUTE_HASH.mine : ROUTE_HASH.effect;
  };

  const locate = (variant: StrategyName, sel: Selection) => {
    setSelection({ v: variant, sel });
    window.location.hash = variant === 'smart' ? ROUTE_HASH.mine : ROUTE_HASH.effect;
  };

  // Эффект показываем после первого часа: раньше экстраполяция на смену слишком шумная.
  const effect = allSims.length === 2 && allSims[1].now >= 3600 ? computeEffect(kpisAll[0], kpisAll[1], allSims[1]) : null;
  const main = allSims[allSims.length - 1];
  const finished = allSims.length > 0 && allSims.every((s) => s.finished);
  const progress = main ? main.now / main.cfg.shift.durationSec : 0;
  const log = useMemo(() => (main ? [...main.log].reverse().slice(0, 7) : []), [main, main?.log.length, epoch]);

  if (!main) return null;

  const onSlow3d = () => {
    if (qualityMode !== 'auto' || slow3d) return;
    setSlow3d(true);
    flash('3D тормозит — включена лёгкая графика (без теней и свечения)');
  };
  const chooseQuality = (m: QualityMode) => {
    setQualityMode(m);
    saveQualityMode(m);
    if (m !== 'auto') setSlow3d(false);
  };

  /** Сетка карт (3D/2D) — общая для полного интерфейса и для встраивания в Grafana. */
  const mapsGrid = (
          <div className={`grid min-h-0 flex-1 ${embed ? 'gap-1.5' : 'gap-3'} ${sims.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {sims.map((s, i) => (
              <div key={`${epoch}-${i}-${view}`} className="scene-ui panel relative min-h-0 overflow-hidden" style={{ borderColor: `${STRATEGY_COLOR[s.strategyName]}66` }}>
                {(() => {
                  const overlay = (
                    <>
                  <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
                    <span className="whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-bold uppercase tracking-wider text-white" style={{ background: STRATEGY_COLOR[s.strategyName] }}>
                      {s.strategyName === 'smart' ? (sims.length === 2 ? 'С системой' : 'Реальная работа · умная диспетчеризация') : 'Без системы · расчёт'}
                    </span>
                    <span className="num whitespace-nowrap rounded-md bg-black/60 px-2 py-1 text-[13px] text-ink">
                      {fmtInt(kpis[i].minedTotal)} т · {fmtInt(kpis[i].tph)} т/ч
                    </span>
                  </div>
                  {i === sims.length - 1 && <Legend />}
                  {selection?.v === s.strategyName && <InfoCard sim={s} selection={selection.sel} onClose={() => setSelection(null)} />}
                  {building?.v === s.strategyName && (
                    <BuildingView
                      sim={s}
                      kind={building.kind}
                      light={quality === 'light'}
                      onClose={() => setBuilding(null)}
                      onTruck={(id) => {
                        setBuilding(null);
                        setSelection({ v: s.strategyName, sel: { kind: 'truck', id } });
                      }}
                    />
                  )}
                    </>
                  );
                  const props = {
                    sim: s,
                    selection: selection?.v === s.strategyName ? selection.sel : null,
                    onSelect: (sel: Selection) => setSelection(sel ? { v: s.strategyName, sel } : null),
                  };
                  return view === '3d' ? (
                    <Mine3D
                      {...props}
                      light={quality === 'light'}
                      onSlow={onSlow3d}
                      showControls={i === sims.length - 1}
                      onBuilding={(kind) => {
                        setSelection(null);
                        setBuilding({ v: s.strategyName, kind });
                      }}
                    >
                      {overlay}
                    </Mine3D>
                  ) : (
                    <MineCanvas {...props}>{overlay}</MineCanvas>
                  );
                })()}
              </div>
            ))}
          </div>
  );

  // Компактный режим для панели Grafana: только карьер, время и кнопки сценариев «что если».
  if (embed) {
    const ebtn = 'rounded px-2 py-1 font-semibold';
    return (
      <div className="flex h-full flex-col gap-1.5 p-1.5 text-[12px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-[15px] font-bold text-amber-400">{fmtClock(main.now)}</span>
          <span className={`rounded px-1.5 py-0.5 font-semibold ${bridge?.connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel-2 text-ink-3'}`}>
            {bridge ? '● OpenEgiz · Ditto' : '○ автономный режим'}
          </span>
          {pStatus && pStatus.active_scenarios.length > 0 && (
            <span className="truncate text-red-300" title={pStatus.active_scenarios.join('\n')}>
              Активно: {pStatus.active_scenarios.join(' · ')}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-1">
            <button onClick={triggerBreakdown} className={`${ebtn} bg-red-600/90 text-white`}>⚠ Поломка</button>
            <button onClick={triggerBlast} className={`${ebtn} bg-orange-600/90 text-white`}>✸ Взрыв</button>
            <button onClick={triggerClosure} className={`${ebtn} bg-panel-2 text-red-300`}>⊘ Съезд</button>
            {bridge && (
              <button onClick={() => void bridge.send('cancel_all')} className={`${ebtn} bg-panel-2 text-emerald-300`}>
                ↶ Отменить
              </button>
            )}
            <a href="./" target="_blank" rel="noreferrer" className={`${ebtn} bg-panel-2 text-ink-2`} title="Открыть полный интерфейс с KPI и графиками">
              ⤢ Полный экран
            </a>
          </div>
        </div>
        {mapsGrid}
        {toast && <div className="fixed left-1/2 top-10 z-40 -translate-x-1/2 rounded-md bg-black/80 px-3 py-1.5 font-semibold text-red-200">{toast}</div>}
      </div>
    );
  }

  const dashboard = (
    <div className={`scanlines flex ${isEffect ? 'min-h-full' : 'h-full'} flex-col gap-2 p-3`}>
      {/* Заголовок */}
      <header className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">{isEffect ? 'Эффект системы диспетчеризации' : 'Цифровой двойник карьера Актогай'}</h1>
            <div className="text-[12px] text-ink-3">
              {isEffect
                ? 'Реальная работа с системой против теневого расчёта той же смены без неё: одинаковые поломки, дороги и взрывы'
                : 'Реальная работа карьера в реальном времени · умная диспетчеризация самосвалов · медь · Восточный Казахстан'}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Время смены</div>
            <div className="num whitespace-nowrap text-[26px] font-bold leading-none text-amber-400">
              {fmtClock(main.now)}
              <span className="text-[16px] text-ink-3"> / 12:00</span>
            </div>
          </div>
          <div className="hidden h-2.5 w-40 overflow-hidden rounded-full bg-panel-2 2xl:block">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['3d', '2d'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[13px] font-semibold ${view === v ? 'bg-sky-500 text-black' : 'bg-panel text-ink-2 hover:bg-panel-2'}`}
              >
                {v === '3d' ? '3D' : '2D'}
              </button>
            ))}
          </div>
          {view === '3d' && (
            <label
              className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] text-ink-2"
              title={`Лёгкая графика: без теней, свечения и сглаживания — для компьютеров без видеокарты.
WebGL: ${glRenderer() || 'нет'}${softwareGL() ? ' (программный)' : ''}`}
            >
              <span className="text-ink-3">Графика:</span>
              <select
                value={qualityMode}
                onChange={(e) => chooseQuality(e.target.value as QualityMode)}
                className="cursor-pointer bg-transparent font-semibold text-ink outline-none"
              >
                <option value="auto">Авто ({quality === 'light' ? 'лёгкая' : 'полная'})</option>
                <option value="high">Полная</option>
                <option value="light">Лёгкая</option>
              </select>
            </label>
          )}
        </div>
      </header>

      {/* Панель управления */}
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-[13px]">
        <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[12.5px] font-semibold text-emerald-300" title="Рудник работает непрерывно: смена за сменой">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />в работе
        </span>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-ink-3">Скорость</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => chooseSpeed(s)}
              title={s === 'max' ? 'Максимально быстро — промотать смену' : `1 с = ${BASE_RATE * s} с смены`}
              className={`num rounded px-2 py-1 font-semibold ${shownSpeed === s ? 'bg-amber-500 text-black' : 'bg-panel-2 text-ink-2 hover:text-ink'}`}
            >
              {s === 'max' ? '» МАКС' : `x${s}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-ink-3">Seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="num w-20 rounded border border-line bg-panel-2 px-2 py-1 text-ink outline-none focus:border-amber-500"
          />
          <button onClick={() => setSeed(Math.floor(Math.random() * 10000))} className="rounded bg-panel-2 px-2 py-1 text-ink-2 hover:text-ink" title="Случайный seed">
            ⚄
          </button>
        </label>
        {allSims[0] && <WeatherChip sim={allSims[0]} />}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={triggerWeather} className="rounded-md bg-sky-700/80 px-3 py-1.5 font-bold text-white hover:bg-sky-600" title="Клавиша W. Вызвать непогоду: метель, пыльная буря или туман — по очереди.">
            ❄ Непогода
          </button>
          <button onClick={triggerBreakdown} className="rounded-md bg-red-600/90 px-3 py-1.5 font-bold text-white hover:bg-red-500" title="Клавиша B. Если выбран экскаватор — ломается он.">
            ⚠ Вызвать поломку
          </button>
          <button onClick={triggerBlast} className="rounded-md bg-orange-600/90 px-3 py-1.5 font-bold text-white hover:bg-orange-500" title="Клавиша E. Если выбран экскаватор — взрыв у него.">
            ✸ Взрыв
          </button>
          <button onClick={triggerClosure} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/10" title="Клавиша C">
            ⊘ Перекрыть съезд
          </button>
          {bridge && (
            <button
              onClick={() => {
                void bridge.send('cancel_all');
                flash('↶ Все сценарии «что если» отменены');
              }}
              className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10"
              title="Отменить все активные сценарии (поломки, закрытия, взрывы)"
            >
              ↶ Отменить сценарии
            </button>
          )}
          <button onClick={doReset} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-ink-2 hover:text-ink" title="Клавиша R">
            ↺ Сброс
          </button>
        </div>
      </div>

      {/* Основная область */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_370px] gap-3 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-h-0 flex-col gap-3">
          {mapsGrid}
          <div className="h-[190px] shrink-0 2xl:h-[250px]">
            <Charts sims={sims} />
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <KpiPanel labels={sims.map((s) => s.strategyName)} kpis={kpis} effect={isEffect ? effect : null} pending={isEffect && !effect} />
          </div>
          {main.predictive && (
            <DiagnosticsPanel sim={main} onPick={(id) => setSelection({ v: main.strategyName, sel: { kind: 'truck', id } })} />
          )}
          <div className="panel h-[130px] shrink-0 overflow-hidden px-3 py-2 2xl:h-[168px]">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-2">Журнал событий</div>
            {log.length === 0 && <div className="text-[13px] text-ink-3">Событий пока нет.</div>}
            {log.map((l, k) => (
              <div key={`${l.t}-${k}`} className="flex gap-2 py-0.5 text-[12.5px]">
                <span className="num text-ink-3">{fmtClock(l.t)}</span>
                <span className={l.level === 'alarm' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-ink-2'}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isEffect && (
        <CostPanel
          sims={sims}
          kpis={kpis}
          labels={sims.map((s) => (s.strategyName === 'smart' ? 'Реальная работа' : 'Без системы (расчёт)'))}
        />
      )}

      <footer className="flex items-center justify-between text-[11px] text-ink-3">
        <span>Модель построена по открытым данным. Операционные данные смоделированы. Проект не связан с KAZ Minerals.</span>
        <span>
          seed {seed} · {currentFleet.trucks} самосвалов, {currentFleet.excavators.length} экскаваторов · рудник работает непрерывно · B — поломка, E — взрыв, C — перекрыть съезд, W — непогода, R — сброс
        </span>
      </footer>


      {finished && isEffect && effect && (
        <div className="fixed left-1/2 top-1/3 z-40 w-[560px] -translate-x-1/2 rounded-xl border border-amber-500/50 bg-popover/95 p-5 text-center shadow-2xl">
          <div className="text-[13px] uppercase tracking-widest text-ink-3">Смена завершена · seed {seed} · следующая начнётся автоматически</div>
          <div className="mt-2 text-[20px] font-semibold">Реальная работа с системой против расчёта без неё</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Summary label="Добыча" value={fmtDelta(deltaPct(kpis[0].minedTotal, kpis[1].minedTotal))} good={kpis[1].minedTotal >= kpis[0].minedTotal} />
            <Summary
              label="Простой фабрики"
              value={fmtDelta(deltaPct(kpis[0].crusherIdleMin, kpis[1].crusherIdleMin))}
              good={kpis[1].crusherIdleMin <= kpis[0].crusherIdleMin}
            />
            <Summary label="Очереди" value={fmtDelta(deltaPct(kpis[0].avgQueueMin, kpis[1].avgQueueMin))} good={kpis[1].avgQueueMin <= kpis[0].avgQueueMin} />
          </div>
          <div className="num mt-4 text-[34px] font-extrabold text-amber-300">{fmtKzt(effect.perYearKzt)} / год</div>
          <div className="mt-3 flex justify-center gap-2">
            <button onClick={createSims} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-ink-2 hover:text-ink">
              ↺ Новая смена
            </button>
            <button
              onClick={() => setSeed((s) => s + 1)}
              className="rounded-md bg-amber-500 px-3 py-1.5 font-bold text-black hover:bg-amber-400"
            >
              Следующий seed →
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const platformTwinCount = bridge ? bridge.attrs.size : 0;
  const activeCount = activeDeviations(main).length;
  const pageNow = main.now;
  const dispatchState = bridge ? bridge.readDispatch() : localDispatch.current;
  /** Приказ или ответ: на стенде — команда двойнику управления, без стенда — сразу в локальную модель. */
  const sendDispatch = (c: DispatchCommand) => {
    if (bridge) void bridge.send(c.value, 0, { ...c });
    else {
      applyDispatch(localDispatch.current, main, c);
      setEpoch((e) => e + 1);
    }
  };
  const doLogin = (s: Session) => {
    saveSession(s);
    setSession(s);
    window.location.hash = s.role === 'dispatcher' ? ROUTE_HASH.dispatch : ROUTE_HASH.terminal;
  };
  const doLogout = () => {
    saveSession(null);
    setSession(null);
    window.location.hash = ROUTE_HASH.login;
  };
  // Раздел «Сценарии» на стенде всегда сравнивает оба варианта.
  const scSims = allSims;
  return (
    <div className="flex h-full">
      <Sidebar
        route={route}
        collapsed={navCollapsed}
        onToggle={toggleNav}
        platform={!!bridge}
        connected={!!bridge?.connected}
        twinCount={bridge ? platformTwinCount : 0}
        activeCount={activeCount}
        theme={theme}
        onToggleTheme={toggleTheme}
        session={session}
      />
      <main className={`h-full min-w-0 flex-1 ${route === 'effect' ? 'overflow-y-auto' : ''}`}>
        {(route === 'mine' || route === 'effect') && dashboard}
        {route === 'twins' && (
          <TwinsPage
            bridge={bridge}
            localSims={simsRef.current}
            version={bridge ? bridge.lastHydrate : Math.floor(main.now / 5)}
            now={pageNow}
            running={isRunning}
            onToggleRun={toggleRun}
            selectedId={twinId}
            onSelect={(id) => (window.location.hash = `#/twins/${encodeURIComponent(id)}`)}
            onLocate={locate}
            onOpenInside={openInside}
          />
        )}
        {route === 'drivers' && <DriversPage sim={main} now={pageNow} running={isRunning} onToggleRun={toggleRun} onLocate={(sel) => locate('smart', sel)} />}
        {route === 'geology' && <GeologyPage sim={main} now={pageNow} />}
        {route === 'sitemap' && <SiteMapPage sim={main} now={pageNow} onOpenInside={(k) => openInside('smart', k)} />}
        {route === 'login' && <LoginPage truckCount={main.trucks.length} onLogin={doLogin} />}
        {route === 'dispatch' &&
          (session?.role === 'dispatcher' ? (
            <DispatchPage sim={main} state={dispatchState} send={sendDispatch} session={session} now={pageNow} onLocate={(sel) => locate('smart', sel)} onLogout={doLogout} />
          ) : (
            <LoginPage truckCount={main.trucks.length} want="dispatcher" onLogin={doLogin} />
          ))}
        {route === 'terminal' &&
          (session?.role === 'driver' ? (
            <TerminalPage sim={main} state={dispatchState} send={sendDispatch} session={session} onLogout={doLogout} />
          ) : (
            <LoginPage truckCount={main.trucks.length} want="driver" onLogin={doLogin} />
          ))}
        {route === 'timeline' && <TimelinePage sims={allSims} now={pageNow} running={isRunning} onToggleRun={toggleRun} onLocate={locate} />}
        {route === 'report' && <ReportPage sims={allSims} kpis={kpisAll} now={pageNow} running={isRunning} onToggleRun={toggleRun} />}
        {route === 'fleet' && (
          <FleetPage
            fleet={currentFleet}
            sim={main}
            platform={!!bridge}
            now={pageNow}
            running={isRunning}
            onToggleRun={toggleRun}
            onApply={(f) => act({ value: 'reset', seed: pStatus?.seed ?? seed, fleet: f })}
            onLocate={(sel) => locate('smart', sel)}
          />
        )}
        {route === 'scenarios' && (
          <ScenariosPage
            sims={scSims}
            kpis={kpisAll}
            platform={!!bridge}
            now={pageNow}
            running={isRunning}
            onToggleRun={toggleRun}
            seed={pStatus?.seed ?? seed}
            fleet={currentFleet}
            history={bridge ? (pStatus?.history ?? []) : localHistory}
            act={act}
          />
        )}
      </main>
      {toast && (
        <div className="fixed left-1/2 top-6 z-40 -translate-x-1/2 rounded-lg border border-amber-500/50 bg-popover/95 px-4 py-2 text-[15px] font-semibold text-amber-100 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

const COMMAND_LABEL: Record<string, string> = {
  breakdown: 'поломка экскаватора',
  repair: 'отмена поломки',
  close_road: 'перекрытие съезда',
  open_road: 'открытие съезда',
  blast: 'внеплановый взрыв',
  cancel_blast: 'отмена взрыва',
  cancel_all: 'отмена всех сценариев',
  pause: 'пауза',
  resume: 'пуск',
  speed: 'скорость',
  reset: 'новая смена',
  drill_down: 'поломка бурового станка',
  drill_repair: 'отмена поломки станка',
};

function Summary({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2 py-2">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`num text-[24px] font-bold ${good ? 'text-green-400' : 'text-red-400'}`}>{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 rounded-md bg-black/65 px-2.5 py-1 text-[11.5px] text-ink-2">
      {STATE_GROUPS.map((g) => (
        <span key={g.key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
          {g.label}
        </span>
      ))}
      <span className="h-3 border-l border-line" />
      {(['sulfide', 'oxide', 'waste'] as const).map((m) => (
        <span key={m} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MATERIAL_COLOR[m] }} />
          {MATERIAL_SHORT[m]}
        </span>
      ))}
    </div>
  );
}
