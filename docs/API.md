# API Qoz Backend

Base URL: `https://<railway-host>` (локально `http://localhost:8080`)

## Health

### `GET /health`

```json
{ "ok": true }
```

---

## Инциденты (ИИ)

### `POST /api/incidents/analyze`

Запускает анализ уже загруженного инцидента. Вызывается **только сервером Next.js**.

**Headers**

| Header | Значение |
|--------|----------|
| `Content-Type` | `application/json` |
| `X-Backend-Secret` | `BACKEND_INTERNAL_SECRET` |

**Body**

```json
{ "incidentId": "550e8400-e29b-41d4-a716-446655440000" }
```

**200 OK**

```json
{
  "status": "ok",
  "incident": {
    "id": "...",
    "category": "fight",
    "storage_path": "incidents/....mp4",
    "title": null,
    "camera_label": null,
    "description": "На записи зафиксирована физическая агрессия...",
    "confidence": 92,
    "created_at": "2026-05-16T12:00:00.000Z"
  }
}
```

**Ошибки:** `401` секрет, `404` нет записи, `502` Gemini/S3.

**Категории после анализа:** `fight`, `weapon`, `smoking`, `intruder`.

---

## Анализ урока (Engagement)

### `POST /api/lessons/analyze`

Асинхронный анализ полной записи урока. Вызывается **только сервером Next.js**.

**Headers**

| Header | Значение |
|--------|----------|
| `Content-Type` | `application/json` |
| `X-Backend-Secret` | `BACKEND_INTERNAL_SECRET` |

**Body**

```json
{ "lessonId": "550e8400-e29b-41d4-a716-446655440000" }
```

**202 Accepted** (анализ запущен)

```json
{ "status": "processing", "lessonId": "..." }
```

**200 OK** (уже обработан или не в статусе `pending`)

```json
{ "status": "ok", "lesson": { "id": "...", "status": "ready", "analysis": { ... } } }
```

**Ошибки:** `401` секрет, `404` нет записи. При сбое Gemini запись в БД получает `status: failed` и `error_message`.

Отчёт (`analysis` jsonb): `detected_language`, `lesson_overview`, `time_management`, `incidents_summary`, `timeline`. Язык текста определяется моделью по речи на видео (`kk` / `ru` / `en`).

Опционально: `GEMINI_LESSON_ANALYZE_MODEL`, `GEMINI_LESSON_ANALYZE_FALLBACK_MODELS` (иначе используются `GEMINI_ANALYZE_*`).

---

## Прямой эфир

### `WSS /api/live?deviceId=d1`

Двусторонний канал. Клиент может слать бинарные кадры; сервер отвечает JSON:

```json
{
  "type": "overlay",
  "boxes": [
    {
      "left": 0.12,
      "top": 0.2,
      "width": 0.22,
      "height": 0.18,
      "label": "person"
    }
  ],
  "caption": "Qoz Live: пространственный анализ"
}
```

Координаты нормализованы `0..1` (совместимо с `qoz-vision-demo/lib/cameras/stream-protocol.ts`).

---

## Устройства

### `GET /api/devices/fleet`

Публичный (CORS). Без авторизации.

**200 OK**

```json
{
  "devices": [
    {
      "id": "d1",
      "name": "Камера 304",
      "kind": "Qoz Vision",
      "ip": "10.0.12.41",
      "room": "304",
      "online": true,
      "latencyMs": 28,
      "telemetryPercent": 48
    }
  ]
}
```

`online: true` — активная WebSocket-сессия на `/api/live` с тем же `deviceId`.

---

## CORS

Разрешённые origin задаются в `ALLOWED_ORIGINS` (через запятую).

WebSocket проверяет тот же список на уровне HTTP upgrade (через `@fastify/cors` для HTTP; WS — same host policy браузера).
