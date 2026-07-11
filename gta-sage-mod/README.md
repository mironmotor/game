# Мудрец из особняка — GTA IV NPC на ядре MAX (Уровень 2)

Внутриигровой NPC в GTA IV, чей «мозг» — твоё ядро MAX. Подходишь к старику в особняке,
задаёшь вопрос — он отвечает по-мудрому, **с памятью** (через `persona:sage`).

`SageNPC.cs` — C#-скрипт для **ScriptHookDotNet** (HazardX, namespace `GTA`, .NET FW 4.0).
API выверен по исходникам HazardX (не путать с GTA V ScriptHookVDotNet).

## Управление
- **F9** — призвать Мудреца рядом (старик `M_O_SUITED`, стоит и смотрит на тебя).
- Подойди (≤3.5 м), нажми **E** → откроется консоль с `sage `.
- Набери вопрос, **Enter**. Команда `sage <вопрос>` уходит в MAX → ответ субтитром.
- Можно и вручную: открой консоль (`~`) и набери `sage В чём смысл этого города?`

Скрипт зовёт `http://localhost:3000/game/api/max17` (POST, `persona:sage`) на фоновом
потоке — игра не фризится. **MAX должен быть запущен** (`npm run dev`).

---

## ⚠️ Сначала — поэтапная проверка (НЕ прыгай сразу к этому скрипту)

Критичный неизвестный фактор: заработает ли **.NET ScriptHook под твоим CrossOver на M3**
(нигде не подтверждено). Проверяй дёшево-к-дорогому — если падёт, падёт рано:

**Этап 1 — грузится ли ASI вообще** (дёшево, решающе):
1. Скачай **Ultimate ASI Loader** (ThirteenAG) → положи `dinput8.dll` в папку игры
   (рядом с `GTAIV.exe`).
2. В бутыльке CrossOver выставь override: `dinput8` → **native, builtin**
   (Wine config → Libraries), либо env `WINEDLLOVERRIDES="dinput8=n,b"`.
3. Кинь любой простой **no-overlay** ASI (например FusionFix) → запусти. Грузится?
   Если нет — Уровень 2 на этом железе не выйдет, стоп.

**Этап 2 — грузится ли ScriptHookDotNet** (make-or-break):
1. В бутылёк поставь .NET: `winetricks dotnet48 vcrun2017` (готовься, что .NET-в-Wine
   капризен; иногда установщик надо убить на стадии «Optimization»).
2. Поставь CE-цепочку для версии 1.2.0.59:
   - **ScriptHook** (C++ .asi)
   - **`aCompleteEditionHook.asi`** — патч LMS под Complete Edition (грузится первым)
   - **ScriptHookDotNet** — форк **Tomasak** v1.7.1.8 (совместимость с 1.2.0.59)
3. Кинь любой готовый `.net.dll`-скрипт → проверь, что SHDN его подхватывает (лог).
   Заработало — 80% дела.

**Этап 3 — этот скрипт** (только если Этап 2 прошёл).

---

## Сборка SageNPC.cs → SageNPC.net.dll

Нужен .NET Framework 4 компилятор (Windows `csc`, Visual Studio, или mono на Mac).
Ссылки: `ScriptHookDotNet.dll`, `System.dll`, `System.Net` (в System), `System.Windows.Forms.dll`.

Пример (Windows, из папки с `ScriptHookDotNet.dll`):
```
csc /target:library /out:SageNPC.net.dll ^
    /reference:ScriptHookDotNet.dll ^
    /reference:System.Windows.Forms.dll ^
    SageNPC.cs
```
**Важно:** имя файла обязано оканчиваться на `.net.dll` (иначе SHDN игнорит).

## Установка
Положи `SageNPC.net.dll` в папку **`scripts\`** внутри директории игры:
```
.../Grand Theft Auto IV/scripts/SageNPC.net.dll
```

---

## Честно про статус
- Скрипт написан под **выверенный** API HazardX SHDN — но **скомпилировать/протестить его
  здесь нельзя** (нужен Windows-тулчейн SHDN + сам ScriptHook загруженный в игру).
- Реальная стена — **Этап 2** (.NET ScriptHook под CrossOver/M3). Если он не заведётся,
  Уровень 2 не поедет, и остаётся **Уровень 1** (голосовой Мудрец в окне MAX, уже работает),
  либо Windows/Parallels, где моддинг GTA IV куда дружелюбнее.
- Голос Мудреца в самой игре (TTS) — отдельная фаза: пока ответ показывается **текстом**.
  MAX уже получает `user_message`, так что озвучку можно навесить позже.
