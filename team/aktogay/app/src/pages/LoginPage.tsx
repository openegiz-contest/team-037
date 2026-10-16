/** Демо-вход в разделы «Диспетчер» и «Терминал водителя». */
import { useState } from 'react';
import { checkLogin, DISPATCHER, DRIVER_PASSWORD, DRIVER_PREFIX, TRUCK_BASE, type Role, type Session } from '../platform/accounts';

interface Props {
  truckCount: number;
  /** Какой раздел просили открыть — подсказка роли. */
  want?: Role;
  onLogin: (s: Session) => void;
}

export function LoginPage({ truckCount, want, onLogin }: Props) {
  const [role, setRole] = useState<Role>(want ?? 'dispatcher');
  const [login, setLogin] = useState(want === 'driver' ? `${DRIVER_PREFIX}${TRUCK_BASE}` : DISPATCHER.login);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const pick = (r: Role) => {
    setRole(r);
    setLogin(r === 'dispatcher' ? DISPATCHER.login : `${DRIVER_PREFIX}${TRUCK_BASE}`);
    setError('');
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = checkLogin(login, password, truckCount);
    if (!s) {
      setError('Неверный логин или пароль');
      return;
    }
    onLogin(s);
  };

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-5">
      <form onSubmit={submit} className="panel w-full max-w-[440px] px-6 py-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">Смена · вход</div>
        <h1 className="mt-1 text-[22px] font-bold tracking-tight">Вход в рабочее место</h1>
        <p className="mt-1 text-[13px] text-ink-3">Диспетчер раздаёт приказы самосвалам и пишет водителям. Водитель видит задание в терминале кабины и отвечает.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(
            [
              ['dispatcher', 'Диспетчер', 'пульт смены'],
              ['driver', 'Водитель', 'терминал в кабине'],
            ] as const
          ).map(([r, t, s]) => (
            <button
              type="button"
              key={r}
              onClick={() => pick(r)}
              className={`rounded-lg border px-3 py-2.5 text-left ${role === r ? 'border-amber-500 bg-amber-500/10' : 'border-line hover:bg-panel-2'}`}
            >
              <div className="text-[14px] font-semibold">{t}</div>
              <div className="text-[12px] text-ink-3">{s}</div>
            </button>
          ))}
        </div>

        <label className="mt-4 block text-[12px] text-ink-3">
          Логин
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" className="mt-1 block w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-amber-500" />
        </label>
        <label className="mt-3 block text-[12px] text-ink-3">
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 block w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-amber-500" />
        </label>
        {error && <div className="mt-2 text-[13px] text-red-400">{error}</div>}
        <button type="submit" className="mt-4 w-full rounded-md bg-amber-500 px-3 py-2 text-[14px] font-semibold text-black hover:bg-amber-400">
          Войти
        </button>

        <div className="mt-4 rounded-md border border-line bg-panel-2 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
          <b className="text-ink-2">Демо-доступ</b> (прототип, без настоящей авторизации):
          <br />
          диспетчер — <code>{DISPATCHER.login}</code> / <code>{DISPATCHER.password}</code>
          <br />
          водитель — <code>{DRIVER_PREFIX}{TRUCK_BASE}</code>…<code>{DRIVER_PREFIX}{TRUCK_BASE + truckCount - 1}</code> / <code>{DRIVER_PASSWORD}</code>
        </div>
      </form>
    </div>
  );
}
