#!/usr/bin/env python3
"""Генерирует aktogay-dashboard.json (Grafana) для рудника «Актогай».

Данные: симулятор -> MQTT -> Ditto -> Telegraf -> InfluxDB (measurement mqtt_consumer,
поле value_<признак>_properties_value, тег thingId). Запуск: python make_dashboard.py
"""
import json
import os

DS = {"type": "influxdb", "uid": "opentwins-influxdb"}
SMART = "org.aktogay.smart"
FIXED = "org.aktogay.fixed"


def both(name: str, feature: str) -> str:
    """Поток для двух вариантов одного двойника; серии подписаны стратегиями."""
    return (
        'from(bucket: "default")\n'
        "  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n"
        f'  |> filter(fn: (r) => r._measurement == "mqtt_consumer" and (r.thingId == "{SMART}:{name}" or r.thingId == "{FIXED}:{name}") '
        f'and r._field == "value_{feature}_properties_value")\n'
        f'  |> map(fn: (r) => ({{r with _field: if r.thingId == "{SMART}:{name}" then "Умная" else "Фиксированная"}}))\n'
        '  |> keep(columns: ["_time", "_value", "_field"])'
    )


def per_thing(prefix: str, feature: str, ns: str = SMART) -> str:
    rx = ns.replace(".", "\\.")  # точки в регулярном выражении Flux экранируются одной обратной косой
    return (
        'from(bucket: "default")\n'
        "  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n"
        f'  |> filter(fn: (r) => r._measurement == "mqtt_consumer" and r.thingId =~ /^{rx}:{prefix}/ '
        f'and r._field == "value_{feature}_properties_value")\n'
        '  |> map(fn: (r) => ({r with _field: r.thingId}))\n'
        '  |> keep(columns: ["_time", "_value", "_field"])'
    )


COLORS = [
    {"matcher": {"id": "byName", "options": "Умная"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "#d95926"}}]},
    {"matcher": {"id": "byName", "options": "Фиксированная"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "#3987e5"}}]},
]

panels = []
pid = 1


def add(panel):
    global pid
    panel["id"] = pid
    pid += 1
    panel.setdefault("datasource", DS)
    panels.append(panel)


def stat(title, query, x, y, unit="none", decimals=0, w=4, h=4):
    add({
        "type": "stat", "title": title, "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "fieldConfig": {"defaults": {"unit": unit, "decimals": decimals}, "overrides": COLORS},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "value", "graphMode": "area", "textMode": "value_and_name", "orientation": "horizontal"},
        "targets": [{"refId": "A", "datasource": DS, "query": query}],
    })


def series(title, query, x, y, unit="none", w=12, h=8, legend=True):
    add({
        "type": "timeseries", "title": title, "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "fieldConfig": {"defaults": {"unit": unit, "custom": {"lineWidth": 2, "fillOpacity": 8, "showPoints": "never"}}, "overrides": COLORS},
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": legend}, "tooltip": {"mode": "multi"}},
        "targets": [{"refId": "A", "datasource": DS, "query": query}],
    })


add({
    "type": "text", "title": "", "gridPos": {"x": 0, "y": 0, "w": 24, "h": 2}, "datasource": None,
    "options": {"mode": "markdown", "content": (
        "### Цифровой двойник карьера Актогай — умная диспетчеризация против фиксированного закрепления\n"
        "3D-сцена ниже читает двойников из Ditto; полный интерфейс с KPI и графиками: **[http://localhost:8095](http://localhost:8095)**. "
        "Двойники: приложение **OpenEgiz → Twins**, пространства имён `org.aktogay`, `org.aktogay.smart`, `org.aktogay.fixed`. "
        "Модель построена по открытым данным, операционные данные смоделированы."
    )},
})
stat("Добыто за смену, т", both("mine", "mined_total"), 0, 2, "none", 0)
stat("Темп, т/ч", both("mine", "tph"), 4, 2, "none", 0)
stat("Простой дробилки, мин", both("mine", "crusher_idle_min"), 8, 2, "none", 1)
stat("Качество руды в норме, % времени", both("mine", "grade_in_band_pct"), 12, 2, "percent", 1)
stat("Аварийные отказы самосвалов", both("mine", "unplanned_failures"), 16, 2, "none", 0)
stat("Отказов предотвращено (ППР)", both("mine", "prevented_failures"), 20, 2, "none", 0)
# 3D-сцена рудника: интерфейс aktogay-ui в компактном режиме (?embed=1); данные — из Ditto.
add({
    "type": "text", "title": "3D-карьер: умная диспетчеризация (справа) против фиксированного закрепления (слева)",
    "gridPos": {"x": 0, "y": 6, "w": 24, "h": 18}, "datasource": None, "transparent": False,
    "options": {"mode": "html", "content": (
        '<iframe src="http://localhost:8095/?embed=1" title="3D-карьер Актогай" '
        'style="width:100%;height:100%;min-height:420px;border:0;border-radius:6px;background:#0a1526" allow="fullscreen"></iframe>'
    )},
})
series("Темп добычи, т/ч", both("mine", "tph"), 0, 24, "none")
series("Бункер дробилки, т (пусто = фабрика стоит)", both("crusher", "bin"), 12, 24, "none")
series("Содержание меди в питании фабрики, % Cu (цель 0,35 ± 0,03)", both("plant", "feed_grade"), 0, 32, "none")
series("Средняя очередь у экскаватора, мин", both("mine", "avg_queue_min"), 12, 32, "m")
series("Риск отказа самосвалов (умная стратегия), %", per_thing("truck-", "failure_risk"), 0, 40, "percent", 12, 8, False)
series("Очередь у экскаваторов (умная стратегия), самосвалов", per_thing("excavator-", "queue"), 12, 40, "none")

dash = {
    "uid": "aktogay-digital-mine",
    "title": "Aktogay — цифровой двойник карьера",
    "tags": ["aktogay", "mine", "openegiz"],
    "timezone": "browser",
    "schemaVersion": 39,
    "version": 1,
    "refresh": "5s",
    "time": {"from": "now-30m", "to": "now"},
    "description": "Карьер Актогай: двойники в Ditto, данные симулятора team/aktogay через MQTT -> Ditto -> Telegraf -> InfluxDB.",
    "panels": panels,
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aktogay-dashboard.json")
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(dash, fh, ensure_ascii=False, indent=2)
print(out)
