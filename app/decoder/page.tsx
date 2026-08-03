import Decoder from '@/components/decoder/Decoder';

export const metadata = {
  title: 'ДЕКОДЕР — Макс взламывает хэши',
  description: 'Визуальный proof-of-work: настоящий SHA-256, растущая сложность, взломанные блоки. Без крипты и наград.',
};

export default function DecoderPage() {
  return (
    <Decoder />
  );
}
