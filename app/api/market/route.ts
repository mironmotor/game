import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';

// NOTE: this server route runs the Python and works under `npm run dev`. The
// app is configured for static export (output: 'export'), so for a deployed
// build the dashboard would instead be served as a pre-generated static file.
export const runtime = 'nodejs';

const CORE_DIR = path.join(process.cwd(), 'game_market_core');
const DASHBOARD = path.join(CORE_DIR, 'reports', 'output', 'dashboard.html');

function errorHtml(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;background:#0e1117;color:#e6e6e6;padding:24px">
<h2>Market Core dashboard failed to build</h2>
<pre style="white-space:pre-wrap;color:#ea3943">${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>
<p>Run it directly to debug: <code>cd game_market_core &amp;&amp; python3 main.py paper</code></p>
</body></html>`;
}

function buildDashboard(useMl: boolean, useMax: boolean, useLlm: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['main.py', 'paper'];
    if (useMl) args.push('--ml');
    if (useLlm) args.push('--max-llm');
    else if (useMax) args.push('--max');

    const child = spawn(process.env.PYTHON_BIN || 'python3', args, {
      cwd: CORE_DIR,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Dashboard build timed out (120s).'));
    }, 120_000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr || `paper exited with code ${code}`));
    });
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const useMl = url.searchParams.get('ml') === '1';
  const useMax = url.searchParams.get('max') === '1';
  const useLlm = url.searchParams.get('llm') === '1';

  try {
    await buildDashboard(useMl, useMax, useLlm);
    const html = await readFile(DASHBOARD, 'utf-8');
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(errorHtml(message), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
