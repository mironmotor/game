import MaxInbox from '@/components/inbox/MaxInbox';

export const metadata = {
  title: 'Инбокс Макса — фильтр потока',
  description: 'Свали поток инфы и задай критерий — Макс отфильтрует важное и запомнит.',
};

export default function InboxPage() {
  return (
    <MaxInbox />
  );
}
