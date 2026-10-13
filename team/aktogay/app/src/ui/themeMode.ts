/**
 * Тема интерфейса: тёмная (по умолчанию) или светлая. Выбор хранится в браузере, атрибут
 * data-theme ставится на <body>. ?theme=light|dark в адресе имеет приоритет; встраивание в Grafana
 * (?embed=1) по умолчанию тёмное, как сама Grafana.
 */
export type ThemeMode = 'dark' | 'light';

const KEY = 'aktogay.theme';

export function loadTheme(): ThemeMode {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('theme');
  if (q === 'light' || q === 'dark') return q;
  if (params.get('embed') === '1') return 'dark';
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'dark';
}

export function applyTheme(t: ThemeMode): void {
  document.body.dataset.theme = t;
}

export function saveTheme(t: ThemeMode): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* без сохранения */
  }
}

/** Цвета графиков (Recharts) для текущей темы. */
export function chartColors() {
  const light = document.body.dataset.theme === 'light';
  return light
    ? { axis: '#6b7480', grid: '#d8dde4', tooltipBg: '#ffffff', tooltipBorder: '#d8dde4', label: '#14181d', legend: '#454e5a', cursor: 'rgba(0,0,0,0.05)', barStroke: '#ffffff' }
    : { axis: '#6f7782', grid: '#2a313a', tooltipBg: '#0b0d10', tooltipBorder: '#2a313a', label: '#e8eaed', legend: '#a9b0ba', cursor: 'rgba(255,255,255,0.04)', barStroke: '#14181d' };
}
