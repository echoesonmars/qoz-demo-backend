# Qoz Demo Backend

Высокопроизводительный слой автоматизации на **Fastify** для деплоя на **Railway**. Не хранит пользовательские данные централизованно — Postgres и Storage остаются в **Supabase**. Фронтенд: [qoz-vision-demo](../qoz-vision-demo).

## Граница ответственности

| Компонент | Next.js (Vercel) | Этот бэкенд (Railway) |
|-----------|------------------|------------------------|
| Auth, сессии | да | нет |
| `GET/POST /api/incidents`, upload, signed-url | да | нет |
| ИИ-анализ видео после загрузки | триггер | `POST /api/incidents/analyze` |
| Прямой эфир, оверлей bounding boxes | клиент | `WSS /api/live` |
| Телеметрия устройств | UI | `GET /api/devices/fleet` |

## Модули

### A — WebSocket `/api/live`

Прокси (или mock) потока Gemini Live → JSON оверлея для фронта (`type: "overlay"`, `boxes`, `caption`).

Query: `?deviceId=d1`

Env: `GEMINI_ANALYZE_MODEL=gemini-3.1-flash-lite`, `GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview`, `GEMINI_LIVE_MODE=auto|mock|live` — без ключа в `auto` включается demo-оверлей.

### B — `POST /api/incidents/analyze`

1. Next после upload вызывает с `X-Backend-Secret`
2. Presigned URL видео из S3 (бакет `records`)
3. Gemini Flash анализирует ролик
4. `UPDATE public.incidents` — `category`, `confidence`, `description`

### C — `GET /api/devices/fleet`

Статус камер из in-memory registry активных WS-сессий + seed-устройства для демо.

## Быстрый старт

```bash
cp .env.example .env
# заполнить DATABASE_URL, SUPABASE_S3_*, GEMINI_API_KEY, BACKEND_INTERNAL_SECRET

npm install
npm run dev
```

Проверка: `curl http://localhost:8080/health`

Подробные контракты API: [docs/API.md](docs/API.md)

## Переменные окружения

См. [.env.example](.env.example). Секреты только на Railway / в локальном `.env`, не в репозитории.

`BACKEND_INTERNAL_SECRET` — тот же ключ прописать в `qoz-vision-demo` как `BACKEND_INTERNAL_SECRET` для server-side вызова analyze.

## Деплой Railway

1. New Project → Deploy from repo `qoz-demo-backend`
2. Variables из `.env.example` (обязательны: `DATABASE_URL`, `SUPABASE_S3_*`, `BACKEND_INTERNAL_SECRET` ≥16 символов)
3. **Не задавайте** `HOST=localhost` — только `HOST=0.0.0.0` (в Docker уже по умолчанию)
4. **Не задавайте** `PORT` вручную — Railway подставит свой; healthcheck бьёт в этот порт
5. Public Networking → скопировать URL
4. В `qoz-vision-demo`:
   - `BACKEND_URL=https://<railway-host>`
   - `BACKEND_INTERNAL_SECRET=...`
   - `NEXT_PUBLIC_STREAM_WS_URL=wss://<railway-host>/api/live`
   - `NEXT_PUBLIC_BACKEND_URL=https://<railway-host>` (для fleet UI)

## Стек

- Fastify 5, `@fastify/cors`, `@fastify/websocket`
- Postgres (`postgres`), Supabase S3 (`@aws-sdk/client-s3`)
- Google Gemini (`@google/genai`)

## Схема БД

Таблица `public.incidents` создаётся из `qoz-vision-demo/db/incidents.sql` (`npm run db:incidents` во фронте).
