/**
 * Сбор фактов о живом mir.care — то, с чем агент садится думать.
 *
 * Только чтение: ssh-команды здесь ничего не меняют на сервере. Логи режем по
 * хвосту, иначе один game-error.log на 220 КБ съедает весь контекст, а нужны
 * последние сутки.
 */

import { execFile } from 'node:child_process';

const SERVER = process.env.MIRCARE_HOST || 'root@167.99.8.198';
const SITE = process.env.MIRCARE_URL || 'https://mir.care';

function run(cmd, args, timeout = 45_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() }),
    );
  });
}

const ssh = (script) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, script]);

export async function collect() {
  const [health, pm2, resources, logs, models, git] = await Promise.all([
    run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code} %{time_total}', '--max-time', '25', SITE]),
    ssh('pm2 jlist 2>/dev/null | node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d).on(\'end\',()=>{try{console.log(JSON.parse(s).map(p=>`${p.name}: ${p.pm2_env.status}, рестартов ${p.pm2_env.restart_time}, память ${Math.round((p.monit?.memory||0)/1e6)}МБ`).join(String.fromCharCode(10)))}catch(e){console.log(\'pm2 jlist не разобрался\')}})"'),
    ssh('echo "диск: $(df -h / | tail -1 | awk "{print \\$4}") свободно"; echo "память: $(free -m | awk "/^Mem:/{print \\$7}") МБ доступно"; echo "state: $(du -sh /var/www/game/mark17/state 2>/dev/null | cut -f1)"'),
    ssh('for f in /root/.pm2/logs/*-error.log; do n=$(basename "$f"); c=$(wc -l < "$f"); echo "=== $n (строк: $c) ==="; tail -n 40 "$f"; done'),
    run('curl', ['-s', '--max-time', '25', `${SITE}/api/llm-config`]),
    run('git', ['-C', process.env.MAX_AGENT_REPO || `${process.env.HOME}/game-ultra`, 'status', '--porcelain=v1', '-b']),
  ]);

  return {
    site: { url: SITE, probe: health.out },
    pm2: pm2.out,
    resources: resources.out,
    errorLogs: logs.out.slice(0, 60_000),
    models: models.out.slice(0, 4_000),
    repo: git.out.slice(0, 4_000),
  };
}

/**
 * Быстрый снимок сервера для режима руки.
 *
 * Агенту ssh запрещён — и это правильно, иначе белый список Bash не значит
 * ничего. Но ядро спрашивает как раз про место, где живёт: «сколько памяти»,
 * «отвечает ли сайт». Поэтому по ssh ходит НЕ агент, а этот сборщик, и рука
 * получает готовые показания приборов — читать может, дотянуться руками нет.
 * Логи сюда не тянем: снимок должен стоить сотни токенов, а не тысячи.
 */
export async function quickFacts() {
  // Команды держим примитивными, а разбор делаем здесь: awk и node-однострочники
  // внутри ssh-строки живут ровно до первого уровня экранирования, и вместо
  // колонки приезжает вся строка.
  const [health, disk, mem, up, state, pm2raw, models] = await Promise.all([
    run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code} за %{time_total}s', '--max-time', '20', SITE]),
    ssh('df -h /'),
    ssh('free -m'),
    ssh('uptime -p'),
    ssh('du -sh /var/www/game/mark17/state'),
    ssh('pm2 jlist'),
    run('curl', ['-s', '--max-time', '20', `${SITE}/api/llm-config`]),
  ]);

  const diskLine = disk.out.split('\n').pop()?.split(/\s+/) ?? [];
  const memLine = mem.out.split('\n').find((l) => l.startsWith('Mem:'))?.split(/\s+/) ?? [];

  let processes = 'нет данных';
  try {
    processes = JSON.parse(pm2raw.out)
      .map((p) => `${p.name}:${p.pm2_env?.status}`)
      .join(', ');
  } catch {
    /* pm2 мог не ответить json — не повод падать */
  }

  let active = 'неизвестно';
  try {
    active = JSON.parse(models.out)?.active || 'неизвестно';
  } catch {
    /* панель могла не ответить */
  }

  return [
    '## Показания приборов (сняты только что)',
    `сайт ${SITE}: ${health.out}`,
    `диск: свободно ${diskLine[3] ?? '?'} из ${diskLine[1] ?? '?'} (занято ${diskLine[4] ?? '?'})`,
    `память: доступно ${memLine[6] ?? '?'} МБ из ${memLine[1] ?? '?'} МБ`,
    `аптайм: ${up.out || '?'}`,
    `память ядра на диске: ${(state.out.split(/\s+/)[0]) || '?'}`,
    `процессы: ${processes}`,
    `активная модель ядра: ${active}`,
  ].join('\n');
}

export function asBriefing(facts) {
  return [
    `Сайт ${facts.site.url}: код и время ответа — ${facts.site.probe}`,
    '',
    '## Процессы',
    facts.pm2 || '(pm2 не ответил)',
    '',
    '## Ресурсы',
    facts.resources || '(нет данных)',
    '',
    '## Модели (/api/llm-config)',
    facts.models || '(нет данных)',
    '',
    '## Рабочая копия ultra',
    facts.repo || '(нет данных)',
    '',
    '## Хвосты журналов ошибок',
    facts.errorLogs || '(пусто)',
  ].join('\n');
}
