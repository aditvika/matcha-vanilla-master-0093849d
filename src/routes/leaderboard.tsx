import { useState, useEffect } from "react";
import { RequireAuth } from "@/components/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Crown, Medal, Award, Trophy, Loader2 } from "lucide-react";
import {
  fetchLeaderboardData,
  getInitials,
  type LeaderTab,
  type LeaderEntry,
} from "@/lib/leaderboard-data";

type Search = { tab?: LeaderTab };

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Premium Leaderboard — MVMaster X" },
      { name: "description", content: "Top ranking of MVMaster X premium members." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => {
    const tab = s.tab as LeaderTab | undefined;
    return { tab: tab === "Tahunan" || tab === "Mix" ? tab : "Bulanan" };
  },
  component: () => (
    <RequireAuth>
      <LeaderboardPage />
    </RequireAuth>
  ),
});

function rankMeta(i: number) {
  if (i === 0) return { Icon: Crown, cls: "lb-rank-gold" };
  if (i === 1) return { Icon: Medal, cls: "lb-rank-silver" };
  if (i === 2) return { Icon: Award, cls: "lb-rank-bronze" };
  return { Icon: Trophy, cls: "lb-rank-other" };
}

function LeaderboardPage() {
  const { tab } = Route.useSearch();
  const [leaderTab, setLeaderTab] = useState<LeaderTab>(tab ?? "Bulanan");
  const [data, setData] = useState<Record<LeaderTab, LeaderEntry[]>>({
    Bulanan: [],
    Tahunan: [],
    Mix: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      const res = await fetchLeaderboardData();
      if (isMounted) {
        setData(res);
        setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const currentList = data[leaderTab] || [];

  return (
    <main className="home-root">
      <div className="home-glow home-glow-green" aria-hidden />
      <div className="home-glow home-glow-warm" aria-hidden />

      <div className="home-content home-fade-in">
        <header className="lb-page-header">
          <Link to="/home" className="lb-back" aria-label="Back to home">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="home-greet-eyebrow">Premium</p>
            <h1 className="home-greet">Leaderboard</h1>
          </div>
        </header>

        <section className="home-section" aria-label="Full leaderboard">
          <div className="lb-tabs" role="tablist">
            {(["Bulanan", "Tahunan", "Mix"] as LeaderTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={leaderTab === t}
                className={`lb-tab ${leaderTab === t ? "lb-tab-active" : ""}`}
                onClick={() => setLeaderTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={24} className="animate-spin mb-2" />
              <p>Memuat Top Leaderboard...</p>
            </div>
          ) : currentList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Belum ada pengguna di kategori ini.</p>
            </div>
          ) : (
            <ul className="lb-list">
              {currentList.slice(0, 50).map((entry, i) => {
                const { Icon, cls } = rankMeta(i);
                const initials = getInitials(entry.name);
                return (
                  <li key={`${entry.name}-${i}`} className="lb-row">
                    <div className={`lb-rank ${cls}`}>
                      <Icon size={18} />
                      <span className="lb-rank-num">{i + 1}</span>
                    </div>
                    <div className="lb-avatar" aria-hidden>
                      {initials}
                    </div>
                    <div className="lb-user">
                      <p className="lb-name">{entry.name}</p>
                      <span className="lb-tier">{entry.tier}</span>
                    </div>
                    <span className="lb-score">{entry.mvp} MVP</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
