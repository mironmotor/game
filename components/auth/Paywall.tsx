'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { canUseFeature, PLANS, DEFAULT_TIER } from '@/lib/subscription';
import './auth.css';

// Gate a heavy feature behind a subscription tier. If the user's tier is high
// enough, renders children; otherwise renders an upgrade wall.
export default function Paywall({
  feature,
  children,
}: {
  feature: string;
  children: ReactNode;
}) {
  const { record, loading } = useAuth();
  const tier = record?.tier ?? DEFAULT_TIER;

  if (loading) return <>{children}</>; // don't flash the wall while resolving
  if (canUseFeature(tier, feature)) return <>{children}</>;

  const pro = PLANS.pro;
  return (
    <div className="paywall-wrap">
      <div className="paywall-card">
        <div className="auth-logo">△∞</div>
        <h2 className="paywall-title">Нужен доступ Pro</h2>
        <p className="paywall-sub">{pro.blurb}</p>
        <ul className="paywall-perks">
          {pro.perks.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Link href="/pricing" className="paywall-cta">
          Открыть Pro — {pro.priceLabel}
        </Link>
        <Link href="/" className="paywall-back">
          ← На главную
        </Link>
      </div>
    </div>
  );
}
