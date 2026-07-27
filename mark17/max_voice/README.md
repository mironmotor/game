# MAX Voice

Локальный голосовой sidecar для GAME ULTRA. Два оригинальных профиля:

- `jarvis` — спокойный стратег MAX;
- `friday` — тёплый оперативный помощник.

Основной движок — Qwen3-TTS 0.6B CustomVoice в 8-bit через MLX. Он работает
на Apple Silicon и поддерживает русский. Пока модель не установлена или не
загрузилась, сервис использует встроенный `say` macOS, поэтому голосовой контур
не остаётся немым.

## Запуск

```bash
cd "/Users/admin/Documents/game ultra"
npm run max17:voice:install
npm run max17:voice
```

В другом терминале:

```bash
npm run max17:voice:smoke
```

Тестовый WAV появится в `mark17/output/max17-voice-smoke.wav`.

## Конфигурация

```dotenv
MAX17_TTS_URL=http://127.0.0.1:8017
MAX17_TTS_TOKEN=
MAX17_VOICE_ENGINE=auto
MAX17_VOICE_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
MAX17_VOICE_PRELOAD=1
MAX17_VOICE_STREAM_INTERVAL=0.24
```

Режимы `MAX17_VOICE_ENGINE`:

- `auto` — MLX с автоматическим запасным голосом macOS;
- `mlx` — только нейросеть, ошибка вместо системного fallback;
- `system` — только встроенный голос macOS, без загрузки модели.

`run.sh` слушает только `127.0.0.1:8017`. При внешнем bind он откажется
запускаться без `MAX17_TTS_TOKEN`. Для Vercel нужен отдельный защищённый HTTPS
туннель именно к этому сервису, а не ко всему локальному MAX.

HUD запрашивает `stream: true` и получает `pcm_s16le`, mono, 24 kHz. Обычный
запрос без этого флага по-прежнему возвращает WAV для студии и скачивания.
