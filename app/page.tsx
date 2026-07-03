import HudApp from '@/components/hud/HudApp';
import ModeMenu from '@/components/ModeMenu';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <HudApp />
      <ModeMenu />
    </main>
  );
}
