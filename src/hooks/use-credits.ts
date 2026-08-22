import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseSession } from "@/hooks/use-supabase-session";

export type CreditTier = "free" | "monthly" | "yearly" | "yearly_vip";

export type CreditPool = {
  key: string;
  kind: "photo" | "video" | "all";
  limit: number;
  used: number;
  remaining: number;
};

export type CreditRate = {
  kind: "photo" | "video";
  resolution: "720p" | "1080p" | "2K" | "4K";
  locked: boolean;
  cost: number | null;
};

export type CreditStatus = {
  tier: CreditTier;
  serverTime: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  mvcBalance: number;
  pools: CreditPool[];
  rates: CreditRate[];
};

const EMPTY: CreditStatus = {
  tier: "free",
  serverTime: null,
  periodStart: null,
  periodEnd: null,
  mvcBalance: 0,
  pools: [],
  rates: [],
};


/**
 * Shared, module-level credit store so every mounted `useCredits()` consumer
 * (quota panel, preview screen, processing screen) reads the same balance and
 * refreshes together. Without this, a refund refreshed only one component.
 */
let sharedStatus: CreditStatus = EMPTY;
let sharedSkew = 0;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

async function loadStatus(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_credit_status");
  if (!error && data) {
    const d = data as Record<string, unknown>;
    const serverTime = (d.server_time as string) ?? null;
    if (serverTime) sharedSkew = new Date(serverTime).getTime() - Date.now();
    sharedStatus = {
      tier: (d.tier as CreditTier) ?? "free",
      serverTime,
      periodStart: (d.period_start as string) ?? null,
      periodEnd: (d.period_end as string) ?? null,
      mvcBalance: Number(d.mvc_balance ?? 0),

      pools: ((d.pools as CreditPool[]) ?? []).map((p) => ({
        ...p,
        limit: Number(p.limit ?? 0),
        used: Number(p.used ?? 0),
        remaining: Number(p.remaining ?? 0),
      })),
      rates: ((d.rates as CreditRate[]) ?? []).map((r) => ({
        ...r,
        cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
      })),
    };
  }
  notify();
}

/** Refetch credits once and broadcast to every consumer. Safe to call anywhere. */
export async function refreshCreditsGlobal(): Promise<void> {
  if (!inFlight) {
    inFlight = loadStatus().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

if (typeof window !== "undefined") {
  window.addEventListener("mv:credits-updated", () => void refreshCreditsGlobal());
}

/** Fire-and-forget broadcast used after a deduction or a refund. */
export function broadcastCreditsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mv:credits-updated"));
  } else {
    void refreshCreditsGlobal();
  }
}

/**
 * Credit state is fully server-driven: pools, costs and the reset window all
 * come from the database clock, so changing the device date has no effect.
 */
export function useCredits() {
  const { user } = useSupabaseSession();
  const [, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cb = () => setVersion((v) => v + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      sharedStatus = EMPTY;
      sharedSkew = 0;
      notify();
      setLoading(false);
      return;
    }
    setLoading(true);
    await refreshCreditsGlobal();
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = sharedStatus;

  const findRate = useCallback(
    (kind: CreditRate["kind"], resolution: CreditRate["resolution"]) =>
      status.rates.find((r) => r.kind === kind && r.resolution === resolution) ?? null,
    [status.rates],
  );

  const poolFor = useCallback(
    (kind: "photo" | "video") =>
      status.tier === "free"
        ? (status.pools.find((p) => p.key === kind) ?? null)
        : (status.pools.find((p) => p.key === "credits") ?? null),
    [status.pools, status.tier],
  );

  return { ...status, skewMs: sharedSkew, loading, refresh, findRate, poolFor };
}


/** Countdown until the server-side reset, corrected for device clock drift. */
export function useResetCountdown(periodEnd: string | null, skewMs: number) {
  const [label, setLabel] = useState("--");

  useEffect(() => {
    if (!periodEnd) {
      setLabel("--");
      return;
    }
    const tick = () => {
      const diff = new Date(periodEnd).getTime() - (Date.now() + skewMs);
      if (diff <= 0) {
        setLabel("0d 00:00:00");
        return;
      }
      const s = Math.floor(diff / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const pad = (n: number) => String(n).padStart(2, "0");
      setLabel(`${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [periodEnd, skewMs]);

  return label;
}
