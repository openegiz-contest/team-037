/** Боковое меню разделов: Карьер · Двойники · Сценарии + ссылки на платформу. */
import type { ReactNode } from 'react';

export type Route = 'mine' | 'effect' | 'twins' | 'scenarios';

export const ROUTE_HASH: Record<Route, string> = { mine: '#/', effect: '#/effect', twins: '#/twins', scenarios: '#/scenarios' };

export function routeFromHash(h: string): Route {
  if (h.startsWith('#/twins')) return 'twins';
  if (h.startsWith('#/scenarios')) return 'scenarios';
  if (h.startsWith('#/effect')) return 'effect';
  return 'mine';
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ICONS: Record<Route | 'grafana' | 'api' | 'collapse', ReactNode> = {
  // чаша карьера с уступами
  mine: (
    <Icon>
      <path d="M2 7h20" />
      <path d="M4.5 7 7 11h10l2.5-4" />
      <path d="M7 11l2.2 4h5.6l2.2-4" />
      <path d="M9.2 15 11 19h2l1.8-4" />
    </Icon>
  ),
  // связанные узлы
  twins: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <path d="M10 6.5h4M17.5 10v4" />
    </Icon>
  ),
  // развилка «что если»
  scenarios: (
    <Icon>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M7 12h4l6-6M11 12l6 6" />
    </Icon>
  ),
  // столбики роста и стрелка вверх
  effect: (
    <Icon>
      <path d="M4 20V14M9 20v-8M14 20v-5M19 20V9" />
      <path d="m4 9 5-4 4 3 7-5" />
      <path d="M16 3h4v4" />
    </Icon>
  ),
  grafana: (
    <Icon>
      <path d="M3 20h18" />
      <path d="M6 16v-4M10 16V8M14 16v-6M18 16V5" />
    </Icon>
  ),
  api: (
    <Icon>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />
    </Icon>
  ),
  collapse: (
    <Icon>
      <path d="m14 6-6 6 6 6" />
    </Icon>
  ),
};

const NAV: { route: Route; label: string; hint: string; group: 'ops' | 'analysis' }[] = [
  { route: 'mine', label: 'Карьер', hint: 'Реальная работа карьера: 3D, показатели, прогноз отказов', group: 'ops' },
  { route: 'twins', label: 'Двойники', hint: 'Объекты рудника в Eclipse Ditto', group: 'ops' },
  { route: 'scenarios', label: 'Сценарии', hint: 'Запуск и отмена «что если»', group: 'analysis' },
  { route: 'effect', label: 'Эффект', hint: 'Реальная работа против теневого расчёта без системы, ₸', group: 'analysis' },
];

interface Props {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
  platform: boolean;
  connected: boolean;
  twinCount: number;
  activeCount: number;
}

export function Sidebar({ route, collapsed, onToggle, platform, connected, twinCount, activeCount }: Props) {
  const grafana = `${window.location.protocol}//${window.location.hostname}:3000/d/aktogay-digital-mine`;
  const item = (active: boolean) =>
    `group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
      active ? 'bg-amber-500/10 text-amber-200' : 'text-ink-2 hover:bg-white/[0.04] hover:text-ink'
    }`;
  const badge = (n: number, tone: string) => (
    <span className={`num ml-auto rounded px-1.5 text-[11px] font-semibold ${tone} ${collapsed ? 'absolute -right-0.5 -top-0.5 px-1 text-[9.5px]' : ''}`}>{n}</span>
  );
  return (
    <aside className={`flex shrink-0 flex-col border-r border-line bg-[#0a0c0f] transition-[width] duration-200 ${collapsed ? 'w-[58px]' : 'w-[214px]'}`}>
      <div className={`flex items-center gap-2.5 px-3 pb-3 pt-3.5 ${collapsed ? 'justify-center px-0' : ''}`}>
        <img src="./favicon.svg" alt="" className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[14.5px] font-bold tracking-tight">Актогай</div>
            <div className="truncate text-[11px] text-ink-3">цифровой двойник карьера</div>
          </div>
        )}
      </div>

      {(['ops', 'analysis'] as const).map((grp) => (
        <div key={grp}>
          <SectionLabel collapsed={collapsed}>{grp === 'ops' ? 'Рудник' : 'Анализ'}</SectionLabel>
          <nav className="flex flex-col gap-0.5 px-2">
            {NAV.filter((n) => n.group === grp).map((n) => (
              <a key={n.route} href={ROUTE_HASH[n.route]} className={item(route === n.route)} title={collapsed ? `${n.label} — ${n.hint}` : n.hint}>
                {route === n.route && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-amber-400" />}
                {ICONS[n.route]}
                {!collapsed && <span className="font-medium">{n.label}</span>}
                {n.route === 'twins' && twinCount > 0 && badge(twinCount, 'bg-panel-2 text-ink-2')}
                {n.route === 'scenarios' && activeCount > 0 && badge(activeCount, 'bg-red-500/20 text-red-300')}
              </a>
            ))}
          </nav>
        </div>
      ))}

      {platform && (
        <>
          <SectionLabel collapsed={collapsed}>Платформа OpenEgiz</SectionLabel>
          <nav className="flex flex-col gap-0.5 px-2">
            <a href={grafana} target="_blank" rel="noreferrer" className={item(false)} title="Дашборд Grafana (InfluxDB + встроенная 3D-сцена)">
              {ICONS.grafana}
              {!collapsed && <span>Grafana ↗</span>}
            </a>
            <a href="ditto/api/2/things/org.aktogay:control" target="_blank" rel="noreferrer" className={item(false)} title="Двойник управления в Ditto API (JSON)">
              {ICONS.api}
              {!collapsed && <span>Ditto API ↗</span>}
            </a>
          </nav>
        </>
      )}

      <div className="mt-auto flex flex-col gap-2 p-2">
        <div
          className={`flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-[11.5px] ${collapsed ? 'justify-center px-0' : ''}`}
          title={platform ? 'Данные из двойников Eclipse Ditto' : 'OpenEgiz не найден: модель считается в браузере'}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${platform ? (connected ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70' : 'bg-amber-400') : 'bg-ink-3'}`} />
          {!collapsed && (
            <span className="leading-tight">
              <span className="block font-semibold text-ink-2">{platform ? 'OpenEgiz · Ditto' : 'Автономный режим'}</span>
              <span className="block text-ink-3">{platform ? (connected ? 'поток данных активен' : 'переподключение…') : 'без платформы'}</span>
            </span>
          )}
        </div>
        <button onClick={onToggle} className="flex items-center justify-center rounded-lg py-1.5 text-ink-3 hover:bg-white/[0.04] hover:text-ink" title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          <span className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>{ICONS.collapse}</span>
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return <div className="mx-3 my-2 border-t border-line" />;
  return <div className="px-4 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">{children}</div>;
}
