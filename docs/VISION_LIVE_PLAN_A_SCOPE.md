# План A — границы (секция 0 чеклиста)

## В scope

- Периодические снапшоты live: `live-hls-ingest` → Postgres → таймлайн и fleet incidents в демо.

## По умолчанию вне scope

- WebSocket `GET /api/live` (оверлей Gemini Live) — без изменений; отдельная задача при необходимости.
- Офлайн-анализ уроков: `POST /api/lessons/analyze`, `gemini-lesson-analyze` — не затрагиваются планом A.
- Смена источника видео во фронте: по-прежнему HLS URL из демо; в qoz-vision на кадр уходит только JPEG с бэкенда.

## Типы инцидентов, которые vision не выставляет

Модели и DTO vision **не** заполняют в маппере: `wanted_person`, `anpr` (и любые будущие категории без сигнала из `detections` / `actions`). В `detected_incidents` они не попадают, пока не появится соответствующий сырой сигнал в Python.

## Приоритет режимов live (бэкенд)

1. `GEMINI_LIVE_MODE=mock` — мок-анализ, без Gemini и без vision.
2. `GEMINI_LIVE_MODE=auto` без `GEMINI_API_KEY`: при заданных `VISION_LIVE_MODE` и `VISION_LIVE_URL` ingest идёт в vision (`live`/`fallback`); без vision как раньше — мок.
3. Иначе: vision-first или только Gemini см. `live-hls-ingest` и [VISION_LIVE.md](VISION_LIVE.md).
