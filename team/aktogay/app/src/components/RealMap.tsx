/**
 * Реальная карта местности (Leaflet): спутник, рельеф, OpenStreetMap — с наложением модели:
 * контур карьера, дороги, живые самосвалы, экскаваторы, буровые, объекты модели и (по желанию)
 * условные объекты комбината. Подложке нужен интернет; без него показывается подсказка.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toLatLng } from '../geo/geoRef';
import { LAYERS, LINE_STYLE, type Layer, type SiteLine, type SiteObject } from '../geo/sitemap';
import { pitPoint, type Simulation } from '../sim';
import { isLive, smoothTruck } from '../render/smooth';
import { TRUCK_COLOR } from '../ui/theme';

export type MapMode = 'satellite' | 'hybrid' | 'topo' | 'osm';

const TILES: Record<MapMode, { url: string; attribution: string; maxZoom: number; overlay?: string }> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Снимок © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 18,
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Снимок и подписи © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 18,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Рельеф © OpenTopoMap (CC-BY-SA), данные © участники OpenStreetMap, SRTM',
    maxZoom: 17,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© участники OpenStreetMap',
    maxZoom: 19,
  },
};

interface Props {
  sim: Simulation;
  mode: MapMode;
  objects: SiteObject[];
  lines: SiteLine[];
  layers: Record<Layer, boolean>;
  /** Показывать условные объекты комбината (их реальное расположение другое). */
  showSchematic: boolean;
  selectedId: string | null;
  onPick: (id: string) => void;
}

const layerColor = (l: Layer) => LAYERS.find((x) => x.key === l)?.color ?? '#fff';
const big = (o: SiteObject) => {
  const s = o.shape;
  if (s.kind === 'circle') return s.r * 2 >= 350;
  if (s.kind === 'rect') return Math.max(s.w, s.h) >= 350;
  return true;
};

export function RealMap({ sim, mode, objects, lines, layers, showSchematic, selectedId, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.TileLayer[]>([]);
  const overlay = useRef<L.LayerGroup | null>(null);
  const vehicles = useRef<{ trucks: L.CircleMarker[]; rigs: L.CircleMarker[] } | null>(null);
  const [tileErrors, setTileErrors] = useState(0);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Карта создаётся один раз.
  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView(toLatLng(500, 1700), 13);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Подложка по выбранному виду.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    base.current.forEach((t) => t.remove());
    setTileErrors(0);
    const t = TILES[mode];
    const mk = (url: string) => {
      const layer = L.tileLayer(url, { maxZoom: t.maxZoom, attribution: t.attribution, subdomains: 'abc' });
      layer.on('tileerror', () => setTileErrors((n) => n + 1));
      layer.on('tileload', () => setTileErrors(0));
      return layer.addTo(m);
    };
    base.current = [mk(t.url), ...(t.overlay ? [mk(t.overlay)] : [])];
    base.current.forEach((l) => l.bringToBack());
  }, [mode]);

  // Наложение модели: карьер, дороги, объекты, коммуникации.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    overlay.current?.remove();
    const g = L.layerGroup().addTo(m);
    overlay.current = g;
    const ll = (p: [number, number]) => toLatLng(p[0], p[1]);

    if (layers.pit) {
      // Контур модельного карьера: бровка и несколько уступов — поверх снимка, полупрозрачно.
      const n = sim.cfg.pit.benchCount;
      for (const k of [0, Math.round(n / 3), Math.round((2 * n) / 3), n]) {
        const s = 1 - (k / n) * (1 - sim.cfg.pit.bottomScale);
        const pts: [number, number][] = [];
        for (let i = 0; i <= 96; i++) {
          const p = pitPoint(sim.cfg, s, (i / 96) * Math.PI * 2);
          pts.push(toLatLng(p.x, p.y));
        }
        L.polygon(pts, { color: '#fbbf24', weight: k === 0 ? 3 : 1, opacity: k === 0 ? 0.95 : 0.6, fill: k === 0, fillOpacity: 0.06, interactive: k === 0 })
          .on('click', () => onPickRef.current('pit'))
          .bindTooltip(k === 0 ? 'Карьер модели (контур по бровке)' : `уступ ${k}`, { sticky: true })
          .addTo(g);
      }
    }
    if (layers.transport) {
      const gr = sim.layout.graph;
      for (const e of gr.edges) {
        if (e.kind === 'lot' || e.kind === 'park') continue;
        L.polyline([toLatLng(gr.nodes[e.a].x, gr.nodes[e.a].y), toLatLng(gr.nodes[e.b].x, gr.nodes[e.b].y)], { color: '#fde68a', weight: 2, opacity: 0.55, interactive: false }).addTo(g);
      }
    }
    for (const l of lines) {
      if (!layers[l.layer]) continue;
      const touchesSchematic = !showSchematic && l.kind !== 'conveyor';
      if (touchesSchematic) continue;
      const st = LINE_STYLE[l.kind];
      L.polyline(l.pts.map(ll), { color: st.color, weight: Math.max(2, st.width / 2), opacity: 0.85, dashArray: st.dash ? '8 6' : undefined }).bindTooltip(l.name, { sticky: true }).addTo(g);
    }
    for (const o of objects) {
      if (o.id === 'pit' || !layers[o.layer]) continue;
      if (!o.live && !showSchematic) continue;
      const sel = o.id === selectedId;
      const style = { color: sel ? '#fbbf24' : o.live ? '#fcd34d' : '#e5e7eb', weight: sel ? 3 : 2, fillColor: o.live ? o.fill : layerColor(o.layer), fillOpacity: o.live ? 0.55 : 0.25, dashArray: o.live ? undefined : '6 5' };
      const s = o.shape;
      let shape: L.Path;
      if (s.kind === 'circle') shape = L.polygon(Array.from({ length: 33 }, (_, i) => toLatLng(s.x + Math.cos((i / 32) * 2 * Math.PI) * s.r, s.y + Math.sin((i / 32) * 2 * Math.PI) * s.r)), style);
      else if (s.kind === 'poly') shape = L.polygon(s.pts.map(ll), style);
      else {
        const a = ((s.rot ?? 0) * Math.PI) / 180;
        const corner = (cx: number, cy: number) => toLatLng(s.x + cx * Math.cos(a) - cy * Math.sin(a), s.y + cx * Math.sin(a) + cy * Math.cos(a));
        shape = L.polygon([corner(-s.w / 2, -s.h / 2), corner(s.w / 2, -s.h / 2), corner(s.w / 2, s.h / 2), corner(-s.w / 2, s.h / 2)], style);
      }
      shape
        .on('click', () => onPickRef.current(o.id))
        // Постоянные подписи — у объектов модели и крупных; у мелких — по наведению.
        .bindTooltip(`${o.label ?? o.name}${o.live ? ' ● модель' : ' · условно'}`, { permanent: o.live || big(o), direction: 'top', className: 'site-tip' })
        .addTo(g);
    }
    // Живая техника — отдельные маркеры, двигаются в цикле анимации ниже.
    const trucks = layers.pit
      ? sim.trucks.map((t) =>
          L.circleMarker(toLatLng(t.x, t.y), { radius: 5, color: '#000', weight: 1, fillColor: TRUCK_COLOR[t.state], fillOpacity: 1 })
            .bindTooltip(`Самосвал ${t.name} · ${t.driver.name}`)
            .addTo(g),
        )
      : [];
    const rigs = layers.pit
      ? sim.drill.rigs.map((r) => L.circleMarker(toLatLng(r.x, r.y), { radius: 6, color: '#000', weight: 1, fillColor: '#ef4444', fillOpacity: 1 }).bindTooltip(`Буровой станок ${r.name}`).addTo(g))
      : [];
    if (layers.pit)
      for (const e of sim.excavators)
        L.circleMarker(toLatLng(e.x, e.y), { radius: 8, color: e.material === 'sulfide' ? '#facc15' : e.material === 'oxide' ? '#2dd4bf' : '#a3a3a3', weight: 3, fillColor: '#0f172a', fillOpacity: 1 })
          .bindTooltip(e.name, { permanent: true, direction: 'right', className: 'site-tip' })
          .addTo(g);
    vehicles.current = { trucks, rigs };
  }, [sim, objects, lines, layers, showSchematic, selectedId]);

  // Движение техники.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = vehicles.current;
      if (v) {
        sim.trucks.forEach((t, i) => {
          const mk = v.trucks[i];
          if (!mk) return;
          const p = isLive(sim) ? smoothTruck(sim, i, t.x, t.y) : { x: t.px + (t.x - t.px) * sim.alpha, y: t.py + (t.y - t.py) * sim.alpha };
          mk.setLatLng(toLatLng(p.x, p.y));
          mk.setStyle({ fillColor: TRUCK_COLOR[t.state] });
        });
        sim.drill.rigs.forEach((r, i) => v.rigs[i]?.setLatLng(toLatLng(r.x, r.y)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" style={{ background: '#1a1712' }} />
      {tileErrors > 8 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-md bg-black/80 px-3 py-1.5 text-[12.5px] text-amber-200">
          Подложка не загружается — нет доступа в интернет. Переключитесь на вид «Схема».
        </div>
      )}
    </div>
  );
}
