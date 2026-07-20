import FunnelApp from '@/components/funnel/FunnelApp';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Воронка — Big Idea Generator',
  description: 'Засыпь сырьё сверху — получи одну Big Idea внизу.',
};

export default function FunnelPage() {
  return (
    <AuthGate>
      <AccountChip />
      <main className="min-h-screen">
        <FunnelApp />
      </main>
    </AuthGate>
  );
}
