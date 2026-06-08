# Live-анализ: qoz-demo-backend + qoz-vision

По умолчанию снимок с HLS берётся в **qoz-demo-backend** (ffmpeg); разбор JPEG уходит в **qoz-vision** (`POST /api/analyze/frame`). Контракт для UI и БД — `LiveAnalysisPayload`; сырой DTO и русские тексты собираются в Node.

При **`VISION_LIVE_DRIVER=on`** на backend **ffmpeg-тикеры ingest не запускаются**: qoz-vision сам тянет HLS (OpenCV), гонит инференс и POSTит результат в backend (`POST /api/live/internal/vision-ingest/snapshot`). Интервал **записи снапшота в Postgres** задаёт **`LIVE_CAPTURE_INTERVAL_MS`** (нижний предел задаёт **`LIVE_CAPTURE_MIN_INTERVAL_MS`**, по умолчанию 200–250 мс; верхний 120 с). Опционально на vision включи **`LIVE_DRIVER_ANALYZE_EVERY_DECODE=true`**: каждый прочитанный кадр прогоняется через модели (CPU/GPU), а в базу отправляются только точки не чаще, чем раз в `interval` — нагрузка резко вырастает. На стороне qoz-vision задай **`BACKEND_PUSH_URL`**, **`BACKEND_INTERNAL_SECRET`**, заголовок **`X-Backend-Secret`**.

Индекс **«вовлечённость» в Python сейчас не «мышление как Gemini»**: в `models/action_tracker.py` он считается как доля людей по позам, смотрящих к «доске» (`looking_at_board / total_students * 100`). Это численно другой смысл, чем качественная оценка Gemini по целому кадру — чтобы приблизиться к «старому» ощущению, нужна другая модель скоринга или калибровка порогов, а не одна лишь более частая выборка по времени.

## Архитектура

```
Два режима ingest:

 ffmpeg в Node ──► JPEG ──► qoz-vision /api/analyze/frame ──► mapper ──► insertLiveSnapshot
     (режим по умолчанию, VISION_LIVE_DRIVER=off)

 qoz-vision OpenCV ──► analyze ──► POST .../internal/vision-ingest/snapshot
     (VISION_LIVE_DRIVER=on на backend + BACKEND_* на vision)
```

WebSocket `/api/live` (оверлей Gemini) **не** заменяется этим планом.

## Непрерывное видео только в qoz-vision (OpenCV loop)

Если нужно **живой поток без поштучных JPEG из Node**, в qoz-vision включи фон: `DISABLE_BACKGROUND_STREAMS=false` и добавь URL в **`RTSP_URLS`** или **`STREAM_URLS`** (`rtsp://...` или `https://.../*.m3u8`). Цикл постоянно читает поток и шлёт обновления в WebSocket/MJPEG (`/api/video_feed/{camera_id}`). Частота анализа — `STREAM_PROCESS_EVERY_NTH_FRAME` и `STREAM_AFTER_FRAME_SLEEP_SEC` (см. README qoz-vision).

Это **другая** дорожка, не `LiveAnalysisPayload` и не таблицы live ingest в Postgres, если не связывать их отдельно. Не смешивай тяжёлый поток OpenCV и Plan A ingest на один и тот же многочасовой URL без нужды — будет двойной инференс.

## Переменные (backend)

| Переменная | Назначение |
|------------|------------|
| `VISION_LIVE_URL` | Базовый URL qoz-vision без завершающего `/` |
| `VISION_LIVE_MODE` | `off` — только Gemini; `live` — только vision; `fallback` — vision, при сбое Gemini |
| `VISION_LIVE_TIMEOUT_MS` | Таймаут HTTP к vision (по умолчанию 60000) |
| `VISION_LIVE_MAX_RETRIES` | Повторы при сетевых сбоях |
| `VISION_LIVE_MAX_CONCURRENT` | Одновременных исходящих запросов к vision (для ~4 GB VRAM: **1**) |
| `VISION_INTERNAL_SECRET` | Если задан в vision и в backend — заголовок `X-Vision-Internal-Secret` |
| `VISION_LIVE_DRIVER` | `off` — ffmpeg-снапшоты в Node как раньше; `on` — qoz-vision тянет HLS и пушит в backend (нужен тот же секрет, см. выше) |
| `LIVE_CAPTURE_INTERVAL_MS` | Период **сохранённых в БД снапшотов** ingest (/ffmpeg или live-driver): от нижней границы **`LIVE_CAPTURE_MIN_INTERVAL_MS`** до 120 000 мс |
| `LIVE_CAPTURE_MIN_INTERVAL_MS` | Минимально допустимый интервал (по умолчанию ~250 мс) |
| `GEMINI_LIVE_MODE` | `mock` перекрывает всё; `auto` при отсутствии ключа Gemini **не** уходит в мок, если включён vision |

## Переменные (qoz-vision)

| Переменная | Назначение |
|------------|------------|
| `DISABLE_BACKGROUND_STREAMS` | `true` — не поднимать RTSP-цикл, только API + модели |
| `VISION_INTERNAL_SECRET` | Опциональная проверка заголовка на `/api/analyze/frame`, `/api/live-driver/sessions/*` |
| `BACKEND_PUSH_URL` | Базовый URL qoz-demo-backend (для режима live-driver: пуш снапшотов) |
| `BACKEND_INTERNAL_SECRET` | То же значение, что `BACKEND_INTERNAL_SECRET` в backend; заголовок `X-Backend-Secret` |
| `LIVE_DRIVER_PUSH_TIMEOUT_SEC` | Таймаут HTTP при пуше снапшота на backend (по умолчанию 90) |
| `LIVE_DRIVER_ANALYZE_EVERY_DECODE` | `false` — анализ с частотой пушей; **`true`** — каждый декодированный кадр через модели (очень дорого), в БД пишется не чаще `interval` |
| `LIVE_DRIVER_MIN_PUSH_GAP_MS` | Нижняя граница интервала пушей (совместить с backend) |
| `LIVE_DRIVER_LOOP_YIELD_SEC` | Пауза в плотном цикле при `LIVE_DRIVER_ANALYZE_EVERY_DECODE=true` |
| `STREAM_PROCESS_EVERY_NTH_FRAME`, `STREAM_AFTER_FRAME_SLEEP_SEC` | Как часто гонять YOLO/pose по кадрам из **непрерывного** потока (demo: **5**) |
| `STREAM_URLS` | Дополнительный список URL (можно засунуть HLS), сливается с `RTSP_URLS` |
| `USE_BASE_DETECT` | `true` — yolo11m (person, phone, baggage) |
| `ENABLED_MODELS` | Demo: `weapon,fire_smoke,fight,smoking` (heavy.pt) |
| `SPECIALIZED_ROTATE_PER_FRAME` | `true` — 2 specialized/кадр (A: weapon+fire, B: fight+smoking) |
| `VISION_FRAME_MAX_CONCURRENT` | Demo: **1** (нет параллельных analyze → OOM) |

Эвристики (phone, sleep, crowd, fall, baggage) требуют стабильный **`X-Device-Id`** (или `cam:{id}` в RTSP) — отдельный debounce-state на камеру.

## Health и readiness

- qoz-vision: `GET /health` → `models_loaded`, детектор/трекер.
- Backend: `GET /health` учитывает `live.vision` если `VISION_LIVE_MODE=live` **или** включён `VISION_LIVE_DRIVER`.

## Безопасность и сеть (§9)

- Держите qoz-vision в **приватной** сети (VPC, Railway private, Docker internal). JPEG не содержит HLS URL — в логи vision URL потока не попадает.
- В интернет выносите только через **TLS**; задайте `VISION_INTERNAL_SECRET` с обеих сторон.
- Для публичного доступа рассмотрите mTLS / allowlist IP.

## Нагрузка и лимиты (§8)

- Узкие места: GPU/CPU vision, `VISION_FRAME_MAX_CONCURRENT`, `VISION_LIVE_MAX_CONCURRENT`, `MAX_CONCURRENT_LIVE_INGEST`, `LIVE_CAPTURE_INTERVAL_MS`.
- Если кадры стабильно тормозят — увеличьте интервал или уменьшите число одновременных камер / concurrent к vision.
- CPU inference может выполняться в `asyncio.to_thread` — не линейно масштабируется с числом воркеров uvicorn; при высокой нагрузке — горизонтально несколько реплик за балансировщиком.

## Наблюдаемость (§11)

- Ingest логирует `analysisSource`, `visionDurationMs`, `sessionId`, `deviceId`.
- Метрики: `GET /api/live/metrics` (секрет) — `ingest_tick` с `analysisSource`, `visionDurationMs`; `vision_http_error`; `lastVisionHttpErrorAt`.
- Fleet: `GET /api/live/fleet` — `visionMaxConcurrent`, `lastVisionHttpErrorAt`.

Алерты по 5xx/таймаутам: ориентируйтесь на `lastVisionHttpErrorAt` и логи `vision HTTP`.

## Миграция существующих деплоев

1. Задеплойте qoz-vision (Docker или venv), смонтируйте каталог `weights/`.
2. Выставите `VISION_LIVE_URL` на backend (внутренний hostname).
3. Сначала `VISION_LIVE_MODE=fallback` + рабочий `GEMINI_API_KEY` — проверка без отключения Gemini.
4. Затем `VISION_LIVE_MODE=live` — убедитесь, что `/health` на backend зелёный и снапшоты идут без Gemini.

## Один JPEG через curl

```bash
curl -sS -X POST "http://localhost:8000/api/analyze/frame" \
  -H "X-Request-Id: manual-test-1" \
  -F "file=@frame.jpg" | jq .
```

С секретом:

```bash
curl -sS -X POST "http://localhost:8000/api/analyze/frame" \
  -H "X-Vision-Internal-Secret: $VISION_INTERNAL_SECRET" \
  -F "file=@frame.jpg"
```

## Troubleshooting

- **503 Vision models unavailable** — веса не скачаны или `ObjectDetector` не поднялся; см. `GET /api/models/status` и `weights/README.md`.
- **CUDA** — в Docker обычно нужен образ с NVIDIA runtime; на CPU задайте в `.env` vision то, что ожидает ваш стек (см. `USE_GPU` в qoz-vision).
- **Таймауты** — поднимите `VISION_LIVE_TIMEOUT_MS` или интервал `LIVE_CAPTURE_INTERVAL_MS`.

## Нагрузочный прогон (§12)

Автотест в репозитории не гоняет N параллельных HLS-сессий. Рекомендация: поднять несколько live-сессий в демо или скриптом вызывать `/api/analyze/frame` с пакетом воркеров и следить за latency и 5xx.

## Загрузка видео инцидентов (отдельно от live)

`INCIDENT_ANALYZE_MODE` в backend: `vision` (YOLO) или `gemini`. При `vision` backend скачивает ролик; по умолчанию `INCIDENT_VISION_ALL_FRAMES=true` — ffmpeg отдаёт **каждый** кадр ролика (нативный FPS, `scale=640:480`). При `INCIDENT_VISION_ALL_FRAMES=false` — субсэмпл `INCIDENT_VISION_SAMPLE_FPS` (по умолчанию 1 кадр/с). `INCIDENT_VISION_MAX_FRAMES=0` — без лимита, `>0` — обрезка. Затем **последовательно** `POST /api/analyze/frame` с `X-Run-All-Specialized: 1` (все 9 спец-моделей на кадре). Агрегация с **severity weights** (weapon/fight выше fall). Temp-папка удаляется в `finally`. См. [LIVE_ANALYSIS_GEMINI_VS_PYTHON.md](../../docs/LIVE_ANALYSIS_GEMINI_VS_PYTHON.md).

## Дальнейшие шаги (§14, не входит в минимальный план A)

- Оверлей `/api/live` из bbox vision.
- Синхронизация лиц / attendance из vision в демо-БД.
- Детекторы `wanted_person` / `anpr`.

См. также: [VISION_LIVE_PLAN_A_SCOPE.md](./VISION_LIVE_PLAN_A_SCOPE.md), чеклист в корне монорепозитория `PLAN_A_VISION_LIVE_CHECKLIST.md`.
