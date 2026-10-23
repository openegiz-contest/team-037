import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../sim';
import type { Selection } from '../render/drawMine';
import { MineScene, type BuildingKind, type CameraPreset, type FocusTarget } from '../render3d/MineScene';
import { EquipmentSearch } from './EquipmentSearch';
import { TOUR, TOUR_STOP_SEC } from './Tour';

interface Props {
  sim: Simulation;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Показывать кнопки камеры (в режиме сравнения — только на одной из карт). */
  showControls?: boolean;
  /** Лёгкая графика (без теней и свечения) — для машин без видеокарты. */
  light?: boolean;
  /** Сцена тормозит в полном качестве. */
  onSlow?: () => void;
  /** Клик по зданию — открыть его «внутренний двойник». */
  onBuilding?: (kind: BuildingKind) => void;
  children?: React.ReactNode;
}

const PRESETS: { key: CameraPreset; label: string }[] = [
  { key: 'overview', label: 'Общий вид' },
  { key: 'crusher', label: 'Дробилка' },
  { key: 'bottom', label: 'Дно карьера' },
  { key: 'side', label: 'Смотровая' },
];

/** 3D-вид карьера (Three.js). Камера: ЛКМ — вращение, ПКМ — сдвиг, колесо — масштаб. */
export function Mine3D({ sim, selection, onSelect, showControls = true, light = false, onSlow, onBuilding, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MineScene | null>(null);
  const [orbit, setOrbit] = useState(false);
  /** Подписи на сцене: все сразу или только у объекта под курсором. */
  const [labelsAll, setLabelsAll] = useState(true);
  const [weatherOn, setWeatherOn] = useState(true);
  const [follow, setFollow] = useState(false);
  const [full, setFull] = useState(false);
  /** Экскурсия: номер остановки или null; секунды на текущей остановке. */
  const [tour, setTour] = useState<number | null>(null);
  const [tourSec, setTourSec] = useState(0);
  /** Перейти к остановке экскурсии (null — закончить): номер и таймер меняются вместе, иначе остановки проскакивают. */
  const goTour = (i: number | null) => {
    setTourSec(0);
    setTour(i);
    if (i === null) setFull(false);
  };

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const onSlowRef = useRef(onSlow);
  onSlowRef.current = onSlow;

  useEffect(() => {
    const scene = new MineScene(hostRef.current!, sim, { light, onSlow: () => onSlowRef.current?.() });
    sceneRef.current = scene;
    const el = scene.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    // Клик по зданию открывает его «внутренний двойник» с небольшой задержкой: двойной клик вместо этого подлетает к нему.
    let buildingTimer = 0;
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const sel = scene.pick(e.clientX, e.clientY);
        const b = sel ? null : scene.pickBuilding(e.clientX, e.clientY);
        if (b && onBuildingRef.current) {
          window.clearTimeout(buildingTimer);
          buildingTimer = window.setTimeout(() => onBuildingRef.current?.(b), 280);
        } else onSelectRef.current(sel);
      }
      down = null;
    };
    const onDbl = (e: MouseEvent) => {
      window.clearTimeout(buildingTimer);
      const t = scene.pickFocus(e.clientX, e.clientY);
      if (t) focusRef.current(t);
    };
    el.addEventListener('dblclick', onDbl);
    // Над зданием — курсор «рука»: его можно открыть.
    let lastMove = 0;
    const onLeave = () => sceneRef.current?.setHover(null);
    const onMove = (e: PointerEvent) => {
      if (e.buttons || performance.now() - lastMove < 80) return;
      lastMove = performance.now();
      el.style.cursor = onBuildingRef.current && scene.pickBuilding(e.clientX, e.clientY) ? 'pointer' : '';
      scene.setHover(e.clientX, e.clientY);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDbl);
      window.clearTimeout(buildingTimer);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [sim, light]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onBuildingRef = useRef(onBuilding);
  onBuildingRef.current = onBuilding;

  /** Найти объект: выделить (техника) и подлететь камерой. */
  const focus = (t: FocusTarget) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setOrbit(false);
    onSelectRef.current(t.kind === 'truck' || t.kind === 'excavator' ? { kind: t.kind, id: t.id } : null);
    // Выделение применится в эффекте — подлетаем на следующем кадре, чтобы «Следовать» сработало.
    requestAnimationFrame(() => {
      scene.focusOn(t);
      setFollow(t.kind === 'truck');
    });
  };
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    sceneRef.current?.setSelection(selection);
    if (selection?.kind !== 'truck') setFollow(false);
  }, [selection]);

  // Во время экскурсии подписи только по наведению — объект в кадре не загорожен панелями.
  useEffect(() => sceneRef.current?.setLabelMode(labelsAll && tour === null ? 'all' : 'hover'), [labelsAll, tour]);
  // Экскурсия идёт без осадков и дымки — объект в кадре должно быть хорошо видно.
  useEffect(() => sceneRef.current?.setWeatherVisible(weatherOn && tour === null), [weatherOn, tour]);
  useEffect(() => sceneRef.current?.setAutoRotate(orbit), [orbit]);
  useEffect(() => sceneRef.current?.setFollow(follow), [follow]);

  // Экскурсия: подлёт к остановке, медленный облёт вокруг неё, через TOUR_STOP_SEC — следующая.
  useEffect(() => {
    const sc = sceneRef.current;
    if (tour === null || !sc) return;
    const stop = TOUR[tour];
    if ('preset' in stop.view) sc.applyPreset(stop.view.preset);
    else sc.focusOn(stop.view.focus);
    const spin = window.setTimeout(() => sc.setAutoRotate(true), 1600);
    return () => {
      window.clearTimeout(spin);
      sc.setAutoRotate(false);
    };
  }, [tour]);
  useEffect(() => {
    if (tour === null) return;
    const id = window.setInterval(() => setTourSec((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [tour]);
  useEffect(() => {
    if (tour === null || tourSec < TOUR_STOP_SEC) return;
    goTour(tour + 1 < TOUR.length ? tour + 1 : null);
  }, [tourSec, tour]);
  useEffect(() => {
    if (tour === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goTour(null);
      if (e.key === 'ArrowRight') goTour(Math.min(TOUR.length - 1, tour + 1));
      if (e.key === 'ArrowLeft') goTour(Math.max(0, tour - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour]);

  const btn = 'rounded px-2 py-1 text-[12px] font-semibold backdrop-blur transition';
  return (
    <div className={full ? 'fixed inset-0 z-50 bg-bg' : 'relative h-full w-full overflow-hidden rounded-[10px]'}>
      <div ref={hostRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      {showControls && (
        <div className="absolute left-3 top-12 z-10 flex flex-wrap gap-1 pr-3">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => sceneRef.current?.applyPreset(p.key)} className={`${btn} bg-black/55 text-ink-2 hover:bg-black/75 hover:text-ink`}>
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setLabelsAll((v) => !v)}
            className={`${btn} ${labelsAll ? 'bg-black/55 text-ink-2 hover:text-ink' : 'bg-amber-500 text-black'}`}
            title={labelsAll ? 'Скрыть подписи — показывать только у объекта под курсором' : 'Показать все подписи'}
          >
            {labelsAll ? '◌ Скрыть подписи' : '◉ Подписи по наведению'}
          </button>
          <button
            onClick={() => setWeatherOn((v) => !v)}
            className={`${btn} ${weatherOn ? 'bg-black/55 text-ink-2 hover:text-ink' : 'bg-amber-500 text-black'}`}
            title={weatherOn ? 'Убрать с картинки осадки и дымку, чтобы лучше видеть. Погода в модели остаётся' : 'Показать осадки и дымку'}
          >
            {weatherOn ? '☁ Скрыть погоду' : '☀ Погода скрыта'}
          </button>
          <button onClick={() => setOrbit((o) => !o)} className={`${btn} ${orbit ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
            ⟳ Облёт
          </button>
          <button
            onClick={() => {
              // Экскурсия идёт во весь экран — так её удобно показывать на защите.
              setFull(tour === null);
              goTour(tour === null ? 0 : null);
            }}
            className={`${btn} ${tour !== null ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}
            title="Камера сама облетает объекты комбината с подписями (← → — листать, Esc — выход)"
          >
            {tour !== null ? '■ Остановить экскурсию' : '▶ Экскурсия'}
          </button>
          <button onClick={() => setFull((f) => !f)} className={`${btn} bg-black/55 text-ink-2 hover:text-ink`} title="Во весь экран (Esc — выход)">
            {full ? '✕ Свернуть' : '⤢ Во весь экран'}
          </button>
          {selection?.kind === 'truck' && (
            <button onClick={() => setFollow((f) => !f)} className={`${btn} ${follow ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
              ◎ Следовать
            </button>
          )}
        </div>
      )}
      {showControls && <EquipmentSearch sim={sim} onPick={focus} />}
      {tour !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-[640px] rounded-xl border border-amber-500/40 bg-black/80 px-5 py-4 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              <span>Экскурсия</span>
              <span className="num text-ink-3">
                {tour + 1} / {TOUR.length}
              </span>
              <span className="ml-auto flex gap-1">
                <button onClick={() => goTour(Math.max(0, tour - 1))} className="rounded bg-panel-2 px-2 py-0.5 text-ink-2 hover:text-ink" aria-label="Назад">
                  ◀
                </button>
                <button onClick={() => goTour(tour + 1 < TOUR.length ? tour + 1 : null)} className="rounded bg-panel-2 px-2 py-0.5 text-ink-2 hover:text-ink" aria-label="Дальше">
                  ▶
                </button>
                <button
                  onClick={() => goTour(null)}
                  className="rounded bg-panel-2 px-2 py-0.5 text-ink-2 hover:text-ink"
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="mt-1.5 text-[19px] font-bold text-ink">{TOUR[tour].title}</div>
            <div className="mt-1 text-[13.5px] leading-snug text-ink-2">{TOUR[tour].text}</div>
            <div className="num mt-2 text-[14px] font-semibold text-amber-200">{TOUR[tour].live(sim)}</div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-400 transition-all duration-1000 ease-linear" style={{ width: `${Math.min(100, (tourSec / TOUR_STOP_SEC) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
