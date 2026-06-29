import Link from 'next/link';
import HudApp from '@/components/hud/HudApp';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <HudApp />
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
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
