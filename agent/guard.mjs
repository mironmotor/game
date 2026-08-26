/**
 * Сторож чистоты ядра.
 *
 * Сегодня из памяти вычищено 32 тысячи дубликатов и 179 тысяч связей «мой шум
 * похож на мой шум». Сторож следит, чтобы это не вернулось, — и делает это
 * ДЁШЕВО: один ssh со счётным скриптом, ноль токенов. Модель не участвует.
 *
 * Голос он подаёт, только когда показатель уехал за порог: тогда предупреждает
 * человека и ставит ядру заявку рукой — то есть работа начинается сама, без
 * чьего-либо присутствия.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { warn, journal } from './notify.mjs';

const SERVER = process.env.MIRCARE_HOST || 'root@167.99.8.198';
const BASELINE = process.env.MAX_GUARD_BASELINE || `${homedir()}/.local/max17/guard-baseline.json`;

// Пороги подобраны от сегодняшнего состояния: дубли должны стоять на нуле,
// живого опыта в памяти — не меньше трети, заработанное обязано расти, а не
// таять. Балласт кузницы между служебными записями не должен появляться вовсе.
const LIMITS = {
  maxDuplicates: 50,        // «узнал снова» усиливает запись, а не плодит новую
  minLivingShare: 0.30,     // доля живого опыта в памяти
  maxMachineForge: 1000,    // связи «служебное ↔ служебное»
};

const PROBE = `
import json, re, sqlite3
from collections import defaultdict
S = "/var/www/game/mark17/state/"
v = sqlite3.connect(S + "vector_memory.db"); g = sqlite3.connect(S + "synapse_graph.db")
MACHINE = ("compressed_concept","consolidated_pattern","ultra_decision","semantic_ir","system_state")
LIVING = ("user_message","task_completed","task_created","outcome_success","outcome_failure",
          "voice_observation","environment_observation","web_fact","remember","memory_store")
def norm(t):
    t = re.sub(r"\\\\s+"," ",(t or "").strip().lower())
    t = re.sub(r"\\\\(\\\\d+\\\\s+свидетельств\\\\w*\\\\)","",t)
    return re.sub(r"\\\\d+","#",t).strip()[:300]
rows = list(v.execute("select event_type, text from vector_memories"))
groups = defaultdict(int)
living = 0
for et, tx in rows:
    groups[(et, norm(tx))] += 1
    if et in LIVING: living += 1
dups = sum(n-1 for n in groups.values() if n > 1)
ids = {str(r[0]) for r in v.execute("select id from vector_memories where event_type in (%s)" % ",".join("?"*len(MACHINE)), MACHINE)}
mf = 0
for si, ti in g.execute("select source_id, target_id from synapses where origin='forge'"):
    if si in ids and ti in ids: mf += 1
earned = g.execute("select count(*) from synapses where relation_type!='similar_to' and source_type!='ir_node' and weight>=0.2 and evidence_count>=2").fetchone()[0]
print(json.dumps({"records": len(rows), "duplicates": dups, "living": living,
                  "living_share": round(living/max(1,len(rows)), 3),
                  "machine_forge": mf, "earned": earned,
                  "synapses": g.execute("select count(*) from synapses").fetchone()[0]}))
`;

function ssh(script) {
  return new Promise((resolve) => {
    const child = execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', SERVER, 'python3 -'],
      { timeout: 90_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          resolve(JSON.parse(String(stdout).trim().split('\n').pop()));
        } catch {
          resolve(null);
        }
      },
    );
    child.stdin.end(script);
  });
}

async function loadBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE, 'utf8'));
  } catch {
    return null;
  }
}

async function saveBaseline(data) {
  await mkdir(dirname(BASELINE), { recursive: true }).catch(() => {});
  await writeFile(BASELINE, JSON.stringify(data, null, 1)).catch(() => {});
}

/** Один обход. Возвращает список претензий — пустой, когда всё чисто. */
export async function patrol() {
  const now = await ssh(PROBE);
  if (!now) {
    await journal('сторож: ядро недоступно, обход пропущен');
    return { ok: false, complaints: [] };
  }

  const base = await loadBaseline();
  const complaints = [];

  if (now.duplicates > LIMITS.maxDuplicates) {
    complaints.push(`дубликаты вернулись: ${now.duplicates} записей-двойников (порог ${LIMITS.maxDuplicates})`);
  }
  if (now.living_share < LIMITS.minLivingShare) {
    complaints.push(`живой опыт вытесняется: его доля ${Math.round(now.living_share * 100)}% (порог ${LIMITS.minLivingShare * 100}%)`);
  }
  if (now.machine_forge > LIMITS.maxMachineForge) {
    complaints.push(`граф снова связывает служебное со служебным: ${now.machine_forge} связей`);
  }
  if (base && now.earned < base.earned - 5) {
    complaints.push(`заработанные связи УБЫЛИ: было ${base.earned}, стало ${now.earned}`);
  }

  const grew = base ? now.earned - base.earned : 0;
  await journal(
    `сторож: записей ${now.records}, дублей ${now.duplicates}, живого ${Math.round(now.living_share * 100)}%, ` +
    `заработано ${now.earned}${base ? ` (${grew >= 0 ? '+' : ''}${grew})` : ''}, связей ${now.synapses}` +
    (complaints.length ? ` — ПРЕТЕНЗИЙ ${complaints.length}` : ''),
  );

  if (complaints.length) {
    await warn(`🛡 Сторож ядра: ${complaints.join('; ')}`);
  }
  await saveBaseline({ ...now, ts: Date.now() });
  return { ok: true, complaints, stats: now, grew };
}

// Запуск напрямую: `node guard.mjs` — разовый обход.
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await patrol();
  console.log(JSON.stringify(r, null, 1));
}
