'use client';

// Доска игроков + общий прогресс к миссии компании.
// Данные настоящие: читаются из Firestore (коллекция leaderboard).

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGameState } from '@/hooks/use-game-state';
import { useLeaderboardSync } from '@/hooks/use-leaderboard-sync';
import {
  MISSION,
  fetchTop,
  levelProgress,
  missionProgress,
  type LeaderboardEntry,
} from '@/lib/leaderboard';
import './leaderboard.css';

const nf = new Intl.NumberFormat('ru-RU');

function timeAgo(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч`;
  return `${Math.floor(s / 86400)} д`;
}

export default function Leaderboard() {
  const { user, loading: authLoading, signInGoogle, signInGuest } = useAuth();
  const { xp } = useGameState();

  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Свой прогресс уезжает на доску, когда игрок вошёл.
  useLeaderboardSync(xp);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setEntries(await fetchTop(50));
    } catch {
      setFailed(true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Firebase Auth при недоступной сети может не ответить вовсе — тогда
  // authLoading висит вечно и вход не показывается. Через паузу перестаём
  // ждать и всё равно предлагаем войти.
  const [authSettled, setAuthSettled] = useState(false);
  useEffect(() => {
    if (!authLoading) { setAuthSettled(true); return; }
    const t = setTimeout(() => setAuthSettled(true), 5000);
    return () => clearTimeout(t);
  }, [authLoading]);

  const rows = entries ?? [];
  const mission = missionProgress(rows);
  const myRow = user ? rows.find((r) => r.uid === user.uid) : undefined;
  const myPlace = myRow ? rows.findIndex((r) => r.uid === user!.uid) + 1 : null;

  return (
    <div className="lb-wrap">
      <div className="lb-inner">
        <header className="lb-head">
          <div className="lb-kicker">// Миссия компании</div>
          <h1 className="lb-title">{MISSION.title}</h1>
          <p className="lb-sub">{MISSION.subtitle}</p>

          <div className="lb-mission">
            <div className="lb-mission-bar">
              <span style={{ width: failed ? '0%' : `${mission.ratio * 100}%` }} />
            </div>
            <div className="lb-mission-nums">
              {/* при обрыве связи нельзя показывать 0 — это читалось бы как
                  «никто ничего не сделал», а мы просто не знаем цифру */}
              <b>{failed ? '—' : nf.format(mission.total)}</b>
              <span>из {nf.format(mission.target)} XP</span>
            </div>
          </div>
        </header>

        {/* Своя строка / приглашение войти */}
        {authSettled && !user && (
          <div className="lb-cta">
            <p>Войди, чтобы твой прогресс попал на доску.</p>
            <div className="lb-cta-btns">
              <button type="button" onClick={() => signInGoogle()}>
                Войти через Google
              </button>
              <button type="button" className="ghost" onClick={() => signInGuest()}>
                Зайти гостем
              </button>
            </div>
          </div>
        )}

        {user && (
          <div className="lb-me">
            <div className="lb-me-place">
              {myPlace ? `#${String(myPlace).padStart(3, '0')}` : '—'}
            </div>
            <div className="lb-me-body">
              <div className="lb-me-name">
                {user.displayName || user.email || 'Гость'}
              </div>
              <div className="lb-me-bar">
                <span style={{ width: `${levelProgress(xp) * 100}%` }} />
              </div>
            </div>
            <div className="lb-me-xp">
              <b>{nf.format(xp)}</b>
              <span>XP</span>
            </div>
          </div>
        )}

        {/* Доска */}
        <section className="lb-board">
          <div className="lb-board-head">
            <span>// Лидерборд</span>
            <button type="button" className="lb-refresh" onClick={load}>
              обновить
            </button>
          </div>

          {loading && <div className="lb-state">Загружаю доску…</div>}

          {!loading && failed && (
            <div className="lb-state">
              Не удалось связаться с базой — доска сейчас недоступна.
              <br />
              Это не значит, что она пуста: попробуй обновить.
            </div>
          )}

          {!loading && !failed && rows.length === 0 && (
            <div className="lb-state">
              Доска пока пуста. Первый, кто войдёт и наберёт XP, займёт вершину.
            </div>
          )}

          {!loading &&
            rows.map((r, i) => (
              <div
                key={r.uid}
                className={`lb-row${user && r.uid === user.uid ? ' me' : ''}`}
              >
                <span className="lb-rank">#{String(i + 1).padStart(3, '0')}</span>
                <span className="lb-name">{r.displayName}</span>
                <span className="lb-lvl">LV {r.level}</span>
                <span className="lb-xp">{nf.format(r.xp)} XP</span>
                <span className="lb-time">{timeAgo(r.updatedAt)}</span>
              </div>
            ))}
        </section>

        <p className="lb-note">
          XP начисляется за выполненные миссии в HUD. Запись на доске обновляется
          автоматически, пока ты в игре.
        </p>
      </div>
    </div>
  );
}
