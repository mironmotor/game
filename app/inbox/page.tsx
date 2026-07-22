import MaxInbox from '@/components/inbox/MaxInbox';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Инбокс Макса — фильтр потока',
  description: 'Свали поток инфы и задай критерий — Макс отфильтрует важное и запомнит.',
};

export default function InboxPage() {
  return (
    <AuthGate>
      <AccountChip />
      <MaxInbox />
    </AuthGate>
  );
}
