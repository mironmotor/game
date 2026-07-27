import Decoder from '@/components/decoder/Decoder';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'ДЕКОДЕР — Макс взламывает хэши',
  description: 'Визуальный proof-of-work: настоящий SHA-256, растущая сложность, взломанные блоки. Без крипты и наград.',
};

export default function DecoderPage() {
  return (
    <AuthGate>
      <AccountChip />
      <Decoder />
    </AuthGate>
  );
}
