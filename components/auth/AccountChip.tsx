'use client';

import { useAuth } from '@/lib/auth';
import { DEFAULT_TIER } from '@/lib/subscription';
import './auth.css';

// Small top-right chip: who's signed in, their tier, and sign-out.
export default function AccountChip() {
  const { user, record, signOut } = useAuth();
  if (!user) return null;

  const tier = record?.tier ?? DEFAULT_TIER;
  const label =
    user.displayName ||
    user.email ||
    (user.isAnonymous ? 'Гость' : 'Аккаунт');

  return (
    <div className="acct-chip">
      <span className="acct-name">{label}</span>
      <span className={`acct-tier ${tier}`}>{tier}</span>
      <button type="button" onClick={() => signOut()} title="Выйти">
        выйти
      </button>
    </div>
  );
}
