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
        f'  |> map(fn: (r) => ({{r with _field: if r.thingId == "{SMART}:{name}" then "Реальная работа" else "Без системы (расчёт)"}}))\n'
        '  |> keep(columns: ["_time", "_value", "_field"])\n'
        '  |> group(columns: ["_field"])\n'
        '  |> sort(columns: ["_time"])'
    )


def per_thing(prefix: str, feature: str, ns: str = SMART) -> str:
    rx = ns.replace(".", "\\.")  # точки в регулярном выражении Flux экранируются одной обратной косой
    return (
        'import "strings"\n'
        'from(bucket: "default")\n'
        "  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n"
        f'  |> filter(fn: (r) => r._measurement == "mqtt_consumer" and r.thingId =~ /^{rx}:{prefix}/ '
        f'and r._field == "value_{feature}_properties_value")\n'
        f'  |> map(fn: (r) => ({{r with _field: strings.trimPrefix(v: r.thingId, prefix: "{ns}:")}}))\n'
        '  |> keep(columns: ["_time", "_value", "_field"])\n'
        '  |> group(columns: ["_field"])\n'
        '  |> sort(columns: ["_time"])'
    )


COLORS = [
    {"matcher": {"id": "byName", "options": "Реальная работа"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "#d95926"}}]},
    {"matcher": {"id": "byName", "options": "Без системы (расчёт)"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "#3987e5"}}]},
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


def row(title, y):
    add({"type": "row", "title": title, "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": [], "datasource": None})


def timeline(title, query, x, y, mapping, w=12, h=8):
    """Состояния объектов во времени (строковые признаки): значение -> (подпись, цвет)."""
    add({
        "type": "state-timeline", "title": title, "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "fieldConfig": {"defaults": {"color": {"mode": "fixed", "fixedColor": "#6b7480"}, "mappings": [
            {"type": "value", "options": {k: {"text": t, "color": c} for k, (t, c) in mapping.items()}}
        ], "custom": {"fillOpacity": 85, "lineWidth": 0}}},
        "options": {"showValue": "never", "mergeValues": True, "rowHeight": 0.85, "legend": {"showLegend": True, "displayMode": "list", "placement": "bottom"}},
        "targets": [{"refId": "A", "datasource": DS, "query": query}],
    })


def bars(title, query, x, y, unit="none", w=12, h=8):
    """Последнее значение по каждому объекту — горизонтальные полосы (рейтинг)."""
    add({
        "type": "bargauge", "title": title, "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "fieldConfig": {"defaults": {"unit": unit, "color": {"mode": "continuous-GrYlRd"}, "min": 0}},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "orientation": "horizontal", "displayMode": "gradient", "showUnfilled": True, "sizing": "auto"},
        "targets": [{"refId": "A", "datasource": DS, "query": query}],
    })


add({
    "type": "text", "title": "", "gridPos": {"x": 0, "y": 0, "w": 24, "h": 2}, "datasource": None,
    "options": {"mode": "markdown", "content": (
        "### Цифровой двойник карьера Актогай — реальная работа и эффект системы диспетчеризации\n"
        "3D-сцена ниже — реальный карьер, данные из Ditto. Показатели: «Реальная работа» против «Без системы (расчёт)» — теневого расчёта той же смены. Полный интерфейс: **[http://localhost:8095](http://localhost:8095)**. "
        "Двойники: приложение **OpenEgiz → Twins**; `org.aktogay.smart` — реальный карьер, `org.aktogay.fixed` — теневой расчёт. "
        "Модель построена по открытым данным, операционные данные смоделированы."
    )},
})
stat("Добыто за смену, т", both("mine", "mined_total"), 0, 2, "none", 0)
stat("Темп, т/ч", both("mine", "tph"), 4, 2, "none", 0)
stat("Простой фабрики без руды, мин", both("mine", "crusher_idle_min"), 8, 2, "none", 1)
stat("Качество руды в норме, % времени", both("mine", "grade_in_band_pct"), 12, 2, "percent", 1)
stat("Аварийные отказы самосвалов", both("mine", "unplanned_failures"), 16, 2, "none", 0)
stat("Отказов предотвращено (ППР)", both("mine", "prevented_failures"), 20, 2, "none", 0)
# 3D-сцена рудника: интерфейс aktogay-ui в компактном режиме (?embed=1); данные — из Ditto.
add({
    "type": "text", "title": "3D-карьер Актогай: реальная работа",
    "gridPos": {"x": 0, "y": 6, "w": 24, "h": 18}, "datasource": None, "transparent": False,
    "options": {"mode": "html", "content": (
        '<iframe src="http://localhost:8095/?embed=1&v=2" title="3D-карьер Актогай" '
        'style="width:100%;height:100%;min-height:420px;border:0;border-radius:6px;background:#0a1526" allow="fullscreen"></iframe>'
    )},
})
series("Темп добычи, т/ч", both("mine", "tph"), 0, 24, "none")
series("Склад дроблёной руды, т (пусто = фабрика стоит)", both("stockpile", "level"), 12, 24, "none")
series("Содержание меди в питании фабрики, % Cu (цель 0,35 ± 0,03)", both("plant", "feed_grade"), 0, 32, "none")
series("Средняя очередь у экскаватора, мин", both("mine", "avg_queue_min"), 12, 32, "m")
series("Риск отказа самосвалов (реальная работа), %", per_thing("truck-", "failure_risk"), 0, 40, "percent", 12, 8, False)
series("Очередь у экскаваторов (реальная работа), самосвалов", per_thing("excavator-", "queue"), 12, 40, "none")
row("Фабрика и агрегаты цехов", 48)
series("Мощность мельниц фабрики (реальная работа), МВт", per_thing("(sag|ball)-mill", "power"), 0, 49, "none")
series("Температура подшипников агрегатов (реальная работа), °C", per_thing("(crusher-drive|conveyor-|sag-mill|ball-mill)", "bearing_temp"), 12, 49, "celsius")
timeline("Агрегаты цехов: состояние (реальная работа)", per_thing("(crusher-drive|conveyor-|sag-mill|ball-mill|cyclones|flotation|thickener)", "state"), 0, 57,
         {"run": ("работает", "#22c55e"), "idling": ("холостой ход", "#38bdf8"), "stop": ("стоит", "#ef4444")}, 24, 7)

row("Буровзрывная подготовка: бурение → взрыв → экскавация", 64)
timeline("Буровые станки: состояние", per_thing("drill-", "state"), 0, 65,
         {"drilling": ("бурит", "#22c55e"), "moving": ("переезд", "#38bdf8"), "idle": ("ожидает", "#6b7480"), "broken": ("поломка", "#ef4444")}, 12, 6)
timeline("Экскаваторы: состояние (фиолетовый — нет взорванной массы)", per_thing("excavator-", "state"), 12, 65,
         {"working": ("грузит", "#22c55e"), "waiting": ("ждёт самосвал", "#f59e0b"), "broken": ("поломка", "#ef4444"), "blast": ("оцепление", "#f97316"), "nostock": ("нет взорванной массы", "#a855f7")}, 12, 6)
series("Буровые: пробурено скважин на блоке (из 30)", per_thing("drill-", "holes_done"), 0, 71, "none", 8)
series("Буровые: скорость проходки, м/ч (по крепости породы)", per_thing("drill-", "penetration"), 8, 71, "none", 8)
series("Запас взорванной горной массы у экскаваторов, т", per_thing("excavator-", "stock"), 16, 71, "none", 8)

row("Склад дроблёной руды и дробилка", 79)
series("Запас руды для фабрики, ч", both("stockpile", "hours_left"), 0, 80, "h", 8)
series("Приёмный бункер дробилки, т", both("crusher", "bin"), 8, 80, "none", 8)
series("Отсыпка на склад, т/ч (0 — дробилка ждёт руду или склад полон)", both("stockpile", "inflow"), 16, 80, "none", 8)

row("Водители самосвалов", 88)
bars("Резкие торможения за смену (акселерометр рамы)", per_thing("truck-", "drv_harsh"), 0, 89, "none", 12, 10)
bars("Пробег за смену (GNSS)", per_thing("truck-", "drv_dist"), 12, 89, "lengthm", 12, 10)

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
