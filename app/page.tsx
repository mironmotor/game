import HudApp from '@/components/hud/HudApp';
import ModeMenu from '@/components/ModeMenu';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export default function Home() {
  return (
    <AuthGate>
      <main className="min-h-screen overflow-hidden">
        <AccountChip />
        <HudApp />
        <ModeMenu />
      </main>
    </AuthGate>
  );
}
