import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';

// Летопись эфира: каждый скан и событие «пришёл/ушёл» пишутся сюда построчно
// (JSONL). Claude Code читает этот файл, чтобы видеть историю эфира во времени.
// Пишем в ~/.game-ether (корень проекта в песочнице не пишется). Переопределить —
// переменной ETHER_LOG_DIR.
const LOG_DIR = process.env.ETHER_LOG_DIR || path.join(os.homedir(), '.game-ether');
const LOG_FILE = path.join(LOG_DIR, 'ether.jsonl');
const LOG_CAP = 8000; // строк; при превышении обрезаем старые

async function logEther(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    // мягкая ротация: раз в ~100 записей проверяем размер и обрезаем хвост
    if (Math.random() < 0.01) {
      const txt = await readFile(LOG_FILE, 'utf8').catch(() => '');
      const lines = txt.split('\n').filter(Boolean);
      if (lines.length > LOG_CAP) await writeFile(LOG_FILE, lines.slice(-LOG_CAP).join('\n') + '\n', 'utf8');
    }
  } catch {
    /* лог — не критичен, скан работает и без него */
  }
}

// «MAX · Эфир» — честный сканер того, что РЕАЛЬНО рядом (macOS):
//   • Bluetooth-устройства с RSSI (сила сигнала → расстояние),
//   • устройства в локальной сети (ARP: IP + MAC + догадка о вендоре),
//   • текущая WiFi-сеть и её сигнал.
// Никаких «сквозь стены» — только то, что отдаёт железо. Ноль внешних вызовов.

const run = promisify(exec);

type DType = 'phone' | 'headphones' | 'computer' | 'router' | 'tv' | 'speaker' | 'watch' | 'unknown';

type Device = {
  id: string;
  kind: 'bt' | 'lan' | 'wifi' | 'self';
  dtype: DType;
  name: string;
  detail: string;
  vendor: string;
  rssi: number | null; // dBm, чем ближе к 0 — тем ближе
  dist: number; // 0 (вплотную) … 1 (на краю эфира)
};

function btType(minor: string, major: string, name = ''): DType {
  const s = `${minor} ${major} ${name}`.toLowerCase();
  if (/headphone|headset|earbud|airpod|buds|audio|наушник/.test(s)) return 'headphones';
  if (/macbook|imac|laptop|computer|pc\b|ноут/.test(s)) return 'computer';
  if (/iphone|phone|pixel|galaxy|redmi|телефон/.test(s)) return 'phone';
  if (/watch|часы/.test(s)) return 'watch';
  if (/homepod|speaker|колонк|beats\s?pill/.test(s)) return 'speaker';
  if (/\btv\b|display|телевизор|appletv/.test(s)) return 'tv';
  return 'unknown';
}

// Малый OUI-словарь: первые 3 байта MAC → вендор (для флейвора, не точная наука).
const OUI: Record<string, string> = {
  '7cf17e': 'роутер/сеть', dca632: 'Raspberry Pi', b827eb: 'Raspberry Pi',
  '3c22fb': 'Apple', '9803d8': 'Apple', a4f6e8: 'Apple', f0d1a9: 'Apple',
  '2c1809': 'Apple', '50a6d8': 'Apple', ac1f74: 'Samsung', '8425db': 'Samsung',
  '18b430': 'Nest/Google', '44070b': 'Amazon', '68370e': 'Amazon',
  '286c07': 'Xiaomi', '78110f': 'Xiaomi', '5cf370': 'Huawei', '0c8063': 'TP-Link',
};

function vendorOf(mac: string): string {
  const p = mac.toLowerCase().replace(/:/g, '').slice(0, 6);
  if (OUI[p]) return OUI[p];
  // «Локально-администрируемый» бит (2/6/A/E во втором ниббле) = приватный/рандомный MAC.
  const second = parseInt(mac.replace(/:/g, '').charAt(1), 16);
  if (!Number.isNaN(second) && (second & 0x2)) return 'приватный MAC';
  return 'неизвестно';
}

function rssiToDist(rssi: number | null, fallback: number): number {
  if (rssi === null) return fallback;
  // −30 dBm ≈ вплотную, −90 ≈ край. Клампим в 0.05…1.
  return Math.min(1, Math.max(0.05, (-rssi - 30) / 55));
}

async function scanBluetooth(): Promise<Device[]> {
  try {
    const { stdout } = await run('system_profiler SPBluetoothDataType -json', { timeout: 9000, maxBuffer: 4 * 1024 * 1024 });
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const root = (data.SPBluetoothDataType as Record<string, unknown>[]) || [];
    const out: Device[] = [];
    const collect = (arr: unknown, connected: boolean) => {
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (!entry || typeof entry !== 'object') continue;
        for (const [name, props] of Object.entries(entry as Record<string, unknown>)) {
          const p = (props ?? {}) as Record<string, string>;
          const rssiRaw = p.device_rssi ?? p.device_RSSI;
          const rssi = rssiRaw != null ? parseInt(String(rssiRaw), 10) : null;
          const minor = p.device_minorType || '';
          const major = p.device_majorType || '';
          const type = minor || major || 'устройство';
          const cleanName = name.replace(/\s*-\s*Find My$/i, '');
          out.push({
            id: 'bt:' + (p.device_address || name),
            kind: 'bt',
            dtype: btType(minor, major, cleanName),
            name: cleanName,
            detail: `Bluetooth · ${type}${connected ? ' · подключено' : ''}${Number.isFinite(rssi as number) ? ` · ${rssi} dBm` : ''}`,
            vendor: p.device_manufacturer || 'Bluetooth',
            rssi: Number.isFinite(rssi as number) ? (rssi as number) : null,
            dist: rssiToDist(Number.isFinite(rssi as number) ? (rssi as number) : null, connected ? 0.35 : 0.75),
          });
        }
      }
    };
    for (const section of root) {
      collect(section.device_connected, true);
      collect(section.device_not_connected, false);
      collect(section.device_paired, false);
    }
    return out;
  } catch {
    return [];
  }
}

async function scanLan(): Promise<Device[]> {
  try {
    // Широкий скан: сначала «будим» всю подсеть пингом (иначе ARP видит только
    // недавно активных), затем читаем таблицу — так всплывают ВСЕ устройства.
    const ipOut = await run("ipconfig getifaddr en0 || ipconfig getifaddr en1", { timeout: 3000 }).catch(() => ({ stdout: '' }));
    const base = ipOut.stdout.trim().split('.').slice(0, 3).join('.');
    if (base) {
      await run(
        `for i in $(seq 1 254); do ping -c1 -W150 ${base}.$i >/dev/null 2>&1 & done; sleep 2`,
        { timeout: 5000, shell: '/bin/bash' },
      ).catch(() => undefined);
    }
    const { stdout } = await run('arp -an', { timeout: 6000 });
    const out: Device[] = [];
    let i = 0;
    for (const line of stdout.split('\n')) {
      const m = line.match(/\(([\d.]+)\) at ([0-9a-fA-F:]+)/);
      if (!m) continue;
      const ip = m[1];
      const mac = m[2];
      if (mac === 'ff:ff:ff:ff:ff:ff' || ip.endsWith('.255')) continue;
      if (ip.startsWith('224.') || ip.startsWith('239.') || mac.startsWith('1:0:5e')) continue;
      const isRouter = ip.endsWith('.1') || ip.endsWith('.254');
      const vendor = isRouter ? 'роутер' : vendorOf(mac);
      const dtype: DType = isRouter ? 'router' : /apple/i.test(vendor) ? 'computer' : 'phone';
      out.push({
        id: 'lan:' + mac,
        kind: 'lan',
        dtype,
        name: isRouter ? `Роутер · ${ip}` : `${vendor} · ${ip}`,
        detail: `Сеть · MAC ${mac}`,
        vendor,
        rssi: null,
        dist: isRouter ? 0.25 : 0.5 + ((i++ % 4) * 0.1),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function scanWifi(): Promise<Device[]> {
  try {
    const { stdout } = await run('system_profiler SPAirPortDataType', { timeout: 7000, maxBuffer: 2 * 1024 * 1024 });
    const sigMatch = stdout.match(/Signal\s*\/\s*Noise:\s*(-?\d+)\s*dBm/i);
    // Имя сети: строка-ключ сразу под «Current Network Information:» (её название).
    let ssid = '';
    const lines = stdout.split('\n');
    const idx = lines.findIndex((l) => /Current Network Information:/.test(l));
    if (idx >= 0) {
      for (let k = idx + 1; k < Math.min(idx + 4, lines.length); k++) {
        const mm = lines[k].match(/^\s*([^\s:][^:]*):\s*$/);
        if (mm) { ssid = mm[1].trim(); break; }
      }
    }
    const rssi = sigMatch ? parseInt(sigMatch[1], 10) : null;
    // Даже без имени сети показываем факт подключения, если знаем сигнал.
    if (!ssid && rssi == null) return [];
    return [{
      id: 'wifi:current',
      kind: 'wifi',
      dtype: 'router',
      name: `Wi-Fi · ${ssid || 'твоя сеть'}`,
      detail: `Твоя сеть${rssi != null ? ` · ${rssi} dBm` : ''}`,
      vendor: 'Wi-Fi',
      rssi,
      dist: rssiToDist(rssi, 0.3),
    }];
  } catch {
    return [];
  }
}

async function readLog(n: number): Promise<Record<string, unknown>[]> {
  const txt = await readFile(LOG_FILE, 'utf8').catch(() => '');
  return txt
    .split('\n')
    .filter(Boolean)
    .slice(-n)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => x !== null);
}

export async function GET(request: Request) {
  // ?log=N — вернуть последние N записей летописи (без свежего скана).
  const logN = new URL(request.url).searchParams.get('log');
  if (logN) {
    const n = Math.min(300, Math.max(1, parseInt(logN, 10) || 60));
    return NextResponse.json({ ok: true, log: await readLog(n) });
  }

  const [bt, lan, wifi] = await Promise.all([scanBluetooth(), scanLan(), scanWifi()]);
  const devices = [...wifi, ...bt, ...lan];
  const closest = devices
    .filter((d) => d.rssi != null)
    .sort((a, b) => (b.rssi as number) - (a.rssi as number))[0];
  const counts = { bt: bt.length, lan: lan.length, wifi: wifi.length, total: devices.length };

  // Летопись: компактный снимок каждого скана.
  await logEther({
    event: 'scan',
    counts,
    closest: closest ? { name: closest.name, rssi: closest.rssi } : null,
    devices: devices.map((d) => ({ id: d.id, kind: d.kind, dtype: d.dtype, name: d.name, rssi: d.rssi })),
  });

  return NextResponse.json({ ok: true, ts: Date.now(), counts, closest: closest ? { name: closest.name, rssi: closest.rssi } : null, devices });
}

// События эфира от клиента (пришёл/ушёл/приблизился) — тоже в летопись.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const event = String(body.event || 'event');
    if (!['arrival', 'leave', 'approach', 'research'].includes(event)) {
      return NextResponse.json({ ok: false, error: 'unknown event' }, { status: 400 });
    }
    await logEther({ event, names: body.names ?? null, detail: body.detail ?? null, text: body.text ?? null });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
