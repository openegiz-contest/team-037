#!/usr/bin/env bash
#
# Проверка работающего стенда карьера Актогай (make aktogay-check): контейнеры, интерфейс, двойники
# в Ditto, ход смены, поток данных в InfluxDB и дашборд Grafana. Ничего не меняет на стенде —
# только читает. Пароли берутся из deploy/compose/.env и на экран не выводятся.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$ROOT/deploy/compose/.env" ]; then
  echo "Стенд ещё не запускали: сначала выполните make aktogay"
  exit 1
fi
COMPOSE=(docker compose -f "$ROOT/deploy/compose/docker-compose.yml" -f "$ROOT/team/aktogay/compose.yml")
# shellcheck disable=SC1091
set -a; . "$ROOT/deploy/compose/.env"; set +a

HOST=127.0.0.1
DITTO="http://$HOST:$DITTO_PORT"
GRAFANA="http://$HOST:$GRAFANA_PORT"
UI="http://$HOST:${AKTOGAY_UI_PORT:-8095}"
FAILED=0

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
# Сразу после запуска Ditto какое-то время отвечает 503 — повторяем до минуты.
retry() {
  local name="$1"; shift
  for _ in $(seq 1 20); do
    if "$@" >/dev/null 2>&1; then pass "$name"; return; fi
    sleep 3
  done
  fail "$name"
}
ditto() { curl -sf -u "ditto:$DITTO_PASSWORD" "$DITTO$1"; }
feature() { ditto "/api/2/things/$1/features/$2/properties/value" 2>/dev/null || echo ""; }

echo "Контейнеры карьера"
for svc in aktogay-sim aktogay-ui; do
  state=$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$svc" '$1==s{print $2}')
  if [ "$state" = "running" ]; then pass "$svc работает"; else fail "$svc: ${state:-не запущен} (make aktogay)"; fi
done

echo "Интерфейс"
retry "открывается $UI" curl -sf -o /dev/null "$UI/"
retry "интерфейс читает двойники из Ditto (прокси /ditto/)" curl -sf -o /dev/null "$UI/ditto/api/2/things/org.aktogay:control"

echo "Двойники в Ditto"
retry "двойник управления org.aktogay:control" ditto "/api/2/things/org.aktogay:control"
missing=""
for t in mine crusher stockpile plant heap-leach sxew tailings concentrate weather energy cost \
         crusher-2 plant-2 substation-1 camp checkpoint fuel-depot repair-shop water-tanks control-room \
         laboratory explosives-magazine truck-101 excavator-1 drill-1; do
  ditto "/api/2/things/org.aktogay.smart:$t" >/dev/null 2>&1 || missing="$missing $t"
done
if [ -z "$missing" ]; then pass "ключевые двойники реального карьера на месте (25 проверено)"; else fail "нет двойников:$missing"; fi
ditto "/api/2/things/org.aktogay.fixed:mine" >/dev/null 2>&1 && pass "теневой расчёт org.aktogay.fixed:mine" || fail "нет теневого расчёта org.aktogay.fixed:mine"
total=0
for ns in org.aktogay org.aktogay.smart org.aktogay.fixed; do
  n=$(ditto "/api/2/search/things/count?namespaces=$ns" 2>/dev/null || echo 0)
  total=$((total + ${n:-0}))
done
if [ "$total" -ge 100 ]; then pass "всего двойников карьера: $total"; else fail "двойников карьера всего $total — симулятор ещё создаёт их или не запущен"; fi

echo "Смена идёт"
t1=$(feature org.aktogay.smart:mine sim_time)
sleep 6
t2=$(feature org.aktogay.smart:mine sim_time)
if [ -n "$t1" ] && [ -n "$t2" ] && awk -v a="$t1" -v b="$t2" 'BEGIN{exit !(b>a)}'; then
  pass "время смены растёт: $(printf '%.0f' "$t1") → $(printf '%.0f' "$t2") с"
else
  fail "время смены не растёт (${t1:-?} → ${t2:-?}): симулятор на паузе или остановлен"
fi
mined=$(feature org.aktogay.smart:mine mined_total)
[ -n "$mined" ] && pass "добыто за смену: $(printf '%.0f' "$mined") т" || fail "нет признака mined_total у двойника рудника"

echo "Поток данных"
flux='from(bucket:"default") |> range(start:-2m) |> filter(fn:(r) => r.thingId == "org.aktogay.smart:mine") |> count()'
ok=0
for _ in $(seq 1 15); do
  if "${COMPOSE[@]}" exec -T influxdb influx query --org opentwins --token "$INFLUXDB_TOKEN" --raw "$flux" 2>/dev/null | grep -qE ',[1-9][0-9]*,'; then ok=1; break; fi
  sleep 2
done
if [ $ok = 1 ]; then pass "двойники → MQTT → Telegraf → InfluxDB: точки за последние 2 мин есть"; else fail "в InfluxDB нет данных карьера за последние 2 минуты"; fi
retry "дашборд Grafana «Aktogay» загружен" curl -sf -u "admin:$GRAFANA_ADMIN_PASSWORD" "$GRAFANA/api/dashboards/uid/aktogay-digital-mine"

echo
if [ $FAILED = 0 ]; then
  echo "Всё работает."
  echo "  Интерфейс  $UI   (казахский: $UI/?lang=kk, английский: $UI/?lang=en)"
  echo "  Grafana    $GRAFANA   → Dashboards → OpenEgiz Examples → Aktogay"
else
  echo "Проверка не прошла — см. строки FAIL выше. Логи: make logs S=aktogay-sim"
  exit 1
fi
