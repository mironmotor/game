import Link from 'next/link';
import HudApp from '@/components/hud/HudApp';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <HudApp />
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        <Link
          href="/handbrain"
          className="rounded-full border border-[#ff2bd6]/40 bg-[#ff2bd6]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#ff6ae0] backdrop-blur transition hover:bg-[#ff2bd6]/20"
        >
          △∞ Нейро-рука · камера
        </Link>
        <Link
          href="/maxgraph"
          className="rounded-full border border-[#4ea8ff]/40 bg-[#4ea8ff]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#4ea8ff] backdrop-blur transition hover:bg-[#4ea8ff]/20"
        >
          △∞ Синапс-граф Max
        </Link>
        <Link
          href="/autoplan"
          className="rounded-full border border-[#ffb14e]/40 bg-[#ffb14e]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#ffb14e] backdrop-blur transition hover:bg-[#ffb14e]/20"
        >
          △∞ Автоплан · ядро Max
        </Link>
        <Link
          href="/evolution"
          className="rounded-full border border-[#c9a0ff]/40 bg-[#c9a0ff]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#c9a0ff] backdrop-blur transition hover:bg-[#c9a0ff]/20"
        >
          △∞ Эволюция · 1 трлн
        </Link>
        <Link
          href="/brain"
          className="rounded-full border border-[#00ffc8]/40 bg-[#00ffc8]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#00ffc8] backdrop-blur transition hover:bg-[#00ffc8]/20"
        >
          △∞ EdgeAI · Нейро-мозг
        </Link>
        <Link
          href="/funnel"
          className="rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#00ff88] backdrop-blur transition hover:bg-[#00ff88]/20"
        >
          Воронка → Big Idea
        </Link>
      </div>
    </main>
  );
}
