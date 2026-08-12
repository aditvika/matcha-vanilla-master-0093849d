import { supabase } from "@/integrations/supabase/client";

export type LeaderTab = "Bulanan" | "Tahunan" | "Mix";

export type LeaderEntry = {
  name: string;
  tier: "Bulanan" | "Tahunan" | "VIP+";
  mvp: number;
};

export const DEFAULT_DISPLAY_NAME = "Matcha User";

export function getDisplayNameFromEmail(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed || DEFAULT_DISPLAY_NAME;
}

export function getInitials(name: string) {
  return name
    .replace(/[_\s.]+/g, " ")
    .trim()
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type LeaderboardRow = {
  display_name: string | null;
  package_type: string | null;
  mvp_points: number | null;
};

const EMPTY: Record<LeaderTab, LeaderEntry[]> = { Bulanan: [], Tahunan: [], Mix: [] };

export async function fetchLeaderboardData(): Promise<Record<LeaderTab, LeaderEntry[]>> {
  try {
    const { data, error } = await (supabase.rpc as any)("get_leaderboard");

    if (error || !data) return { ...EMPTY };

    const bulanan: LeaderEntry[] = [];
    const tahunan: LeaderEntry[] = [];
    const mix: LeaderEntry[] = [];

    (data as LeaderboardRow[]).forEach((row) => {
      const name = getDisplayNameFromEmail(row.display_name);
      const mvp = row.mvp_points ?? 0;
      const pkg = row.package_type ?? "monthly";

      const tier: LeaderEntry["tier"] =
        pkg === "yearly_vip" ? "VIP+" : pkg === "yearly" ? "Tahunan" : "Bulanan";

      const entry: LeaderEntry = { name, tier, mvp };

      if (tier === "Bulanan") bulanan.push(entry);
      else tahunan.push(entry);
      mix.push(entry);
    });

    const desc = (a: LeaderEntry, b: LeaderEntry) => b.mvp - a.mvp;

    return {
      Bulanan: bulanan.sort(desc),
      Tahunan: tahunan.sort(desc),
      Mix: mix.sort(desc),
    };
  } catch (err) {
    console.error("Error fetching leaderboard:", err);
    return { ...EMPTY };
  }
}
