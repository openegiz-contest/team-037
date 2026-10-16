/**
 * Демо-вход для разделов «Диспетчер» и «Терминал водителя».
 *
 * Это прототип: учётные записи и пароли — демонстрационные, лежат здесь открыто и проверяются
 * в браузере. Настоящей авторизации (Keycloak и т. п.) нет — на стенде её подключают отдельно.
 */
export type Role = 'dispatcher' | 'driver';

export interface Session {
  role: Role;
  login: string;
  name: string;
  /** Индекс самосвала (для водителя). */
  truck?: number;
}

/** Диспетчер смены. */
export const DISPATCHER = { login: 'dispatcher', password: 'demo', name: 'Диспетчер смены' };
/** Водители: логин driver-<номер самосвала>, пароль demo (например, driver-101). */
export const DRIVER_PREFIX = 'driver-';
export const DRIVER_PASSWORD = 'demo';
/** Номера самосвалов начинаются с 101. */
export const TRUCK_BASE = 101;

export function checkLogin(login: string, password: string, truckCount: number): Session | null {
  const l = login.trim().toLowerCase();
  if (l === DISPATCHER.login && password === DISPATCHER.password) return { role: 'dispatcher', login: l, name: DISPATCHER.name };
  if (l.startsWith(DRIVER_PREFIX) && password === DRIVER_PASSWORD) {
    const n = Number(l.slice(DRIVER_PREFIX.length));
    const i = n - TRUCK_BASE;
    if (Number.isInteger(n) && i >= 0 && i < truckCount) return { role: 'driver', login: l, name: `Водитель самосвала №${n}`, truck: i };
  }
  return null;
}

const KEY = 'aktogay.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && (s.role === 'dispatcher' || s.role === 'driver') ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно — сессия живёт до перезагрузки */
  }
}
