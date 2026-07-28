import FunnelApp from '@/components/funnel/FunnelApp';

export const metadata = {
  title: 'Воронка — Big Idea Generator',
  description: 'Засыпь сырьё сверху — получи одну Big Idea внизу.',
};

export default function FunnelPage() {
  return (
    <main className="min-h-screen">
        <FunnelApp />
      </main>
  );
}
