# Переключение Live-анализа: Gemini ⇄ Python (qoz-vision)

Кратко: **`qoz-demo-backend`** решает, что разбирает кадры (**Gemini** или **qoz-vision**). Фронт только ходит на backend. Сервис **`qoz-vision`** можно вообще не поднимать в режиме «только Gemini».

---

## Сейчас (временный профиль «всё через Gemini»)

В **`qoz-demo-backend/.env`** должно быть примерно так:

| Переменная | Значение |
|------------|----------|
| `GEMINI_LIVE_MODE` | `live` (снимки идут через Gemini, не мок; нужен ключ) |
| `GEMINI_API_KEY` | ваш ключ Google AI / Vertex (как было) |
| `VISION_LIVE_MODE` | `off` — **не** звать qoz-vision по HTTP за кадром |
| `VISION_LIVE_URL` | пусто |
| `VISION_LIVE_DRIVER` | `off` — **не** использовать OpenCV-драйвер из Python для ingest |

После правок перезапусти **`qoz-demo-backend`**. `qoz-vision` можно остановить — live-таймлайн и снапшоты пойдут через **`gemini-live-frame`**.

Остальное (уроки по видео, инциденты, чат агента, WebSocket overlay) и так на Gemini — там ничего менять не нужно.

---

## Вернуться на Python / qoz-vision

1. Подними **qoz-vision** (веса, `GET /health` → `models_loaded: true`).

2. В **`qoz-demo-backend/.env`**:

| Цель | Переменные |
|------|------------|
| Снапшоты **только** vision, без Gemini | `VISION_LIVE_MODE=live`, `VISION_LIVE_URL=http://HOST:8000` (без `/`), `GEMINI_LIVE_MODE` можно `auto` или оставить ключ на всякий случай |
| Vision **с запасным** Gemini при ошибке | `VISION_LIVE_MODE=fallback` + тот же URL + рабочий `GEMINI_API_KEY` |
| HLS тянет **Python**, пушит снапшоты в Node | `VISION_LIVE_DRIVER=on` + **`VISION_LIVE_URL`** + в **qoz-vision** `.env`: `BACKEND_PUSH_URL=http://HOST:8080`, `BACKEND_INTERNAL_SECRET` = тот же, что `BACKEND_INTERNAL_SECRET` в backend |

3. Секрет заголовка (если включён): одинаковый **`VISION_INTERNAL_SECRET`** в backend и qoz-vision.

4. Подробности и лимиты интервала: **`qoz-demo-backend/docs/VISION_LIVE.md`**.

5. Перезапусти **backend** (и **vision**, если режим с драйвером или `live`/`fallback`).

---

## Быстрый чеклист

- **Только Gemini**: `VISION_LIVE_MODE=off`, пустой `VISION_LIVE_URL`, `VISION_LIVE_DRIVER=off`, `GEMINI_LIVE_MODE=live`, есть `GEMINI_API_KEY`.
- **Python вперёд**: задать `VISION_LIVE_URL`, не `off` для `VISION_LIVE_MODE`, при драйвере — `VISION_LIVE_DRIVER=on` и push-переменные в vision.

Файл шаблона переменных backend: **`qoz-demo-backend/.env.example`**.
