import { RequireAuth } from "@/components/require-auth";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, RefreshCw, Ticket, Shield, Check, Crown, Coins } from "lucide-react";
import { toast } from "sonner";
import {
  generateVouchersFn,
  listVouchersFn,
  listSubscribersFn,
  checkIsAdminFn,
  injectMvcFn,
  type PackageType,
} from "@/lib/admin-vouchers";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { useI18n } from "@/hooks/use-i18n";

const ADMIN_EMAIL = "tyozxtar@gmail.com";

const PACKAGES: { key: PackageType; label: string; short: string; sub: string }[] = [
  { key: "monthly", label: "Monthly", short: "MONTHLY", sub: "200 Credits/mo" },
  { key: "yearly", label: "Yearly", short: "YEARLY", sub: "250 Credits/mo" },
  { key: "yearly_vip", label: "Yearly VIP+", short: "YEARLY VIP+", sub: "400 Credits/mo" },
];

function packageLabel(type: string) {
  return PACKAGES.find((p) => p.key === type)?.short ?? type.toUpperCase();
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — Matcha Vanilla Production" }],
  }),
  component: () => (
    <RequireAuth>
      <AdminPage />
    </RequireAuth>
  ),
});

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatRemaining(untilIso: string, now: number) {
  const diff = new Date(untilIso).getTime() - now;
  if (diff <= 0) return "Expired";
  const totalHours = Math.floor(diff / 36e5);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days} Days, ${hours} Hours remaining`;
}

function AdminPage() {
  const navigate = useNavigate();
  const { session, loading } = useSupabaseSession();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [packageType, setPackageType] = useState<PackageType>("monthly");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [subTab, setSubTab] = useState<PackageType>("monthly");
  const [injectEmail, setInjectEmail] = useState("");
  const [injectAmount, setInjectAmount] = useState("");
  const { t } = useI18n();
  const qc = useQueryClient();
  const now = useNow(60_000);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    const email = session.user.email?.toLowerCase() ?? "";
    if (email !== ADMIN_EMAIL) {
      toast.error("Access denied");
      navigate({ to: "/home", replace: true });
      return;
    }
    let cancelled = false;
    void checkIsAdminFn()
      .then((res) => {
        if (cancelled) return;
        if (!res.isAdmin) {
          toast.error("Access denied");
          navigate({ to: "/home", replace: true });
          return;
        }
        setAuthorized(true);
      })
      .catch(() => {
        if (!cancelled) navigate({ to: "/home", replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [loading, session, navigate]);

  const vouchersQuery = useQuery({
    queryKey: ["admin-vouchers"],
    queryFn: () => listVouchersFn(),
    enabled: authorized === true,
  });

  const subsQuery = useQuery({
    queryKey: ["admin-subscribers"],
    queryFn: () => listSubscribersFn(),
    enabled: authorized === true,
    refetchInterval: 60_000,
  });

  const genMutation = useMutation({
    mutationFn: (input: { quantity: number; packageType: PackageType }) =>
      generateVouchersFn({ data: input }),
    onSuccess: (rows) => {
      const code = rows[0]?.code ?? null;
      setLastCode(code);
      setCopied(false);
      toast.success(`Voucher generated: ${code}`);
      qc.invalidateQueries({ queryKey: ["admin-vouchers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const injectMutation = useMutation({
    mutationFn: (input: { email: string; amount: number }) =>
      injectMvcFn({ data: input }),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(
          res.reason === "USER_NOT_FOUND"
            ? t("admin.userNotFound")
            : t("admin.injectFailed"),
        );
        return;
      }
      toast.success(`${t("admin.injectSuccess")}: ${res.balance} MVC`);
      setInjectEmail("");
      setInjectAmount("");
    },
    onError: () => toast.error(t("admin.injectFailed")),
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success(`Copied ${code}`);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const filteredSubs = useMemo(
    () => (subsQuery.data ?? []).filter((s) => s.package_type === subTab),
    [subsQuery.data, subTab],
  );

  if (loading || authorized === null) {
    return (
      <main className="home-root">
        <div className="home-content">
          <p style={{ color: "white", padding: 24 }}>Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="home-root">
      <div className="home-glow home-glow-green" aria-hidden />
      <div className="home-content home-fade-in">
        <header className="home-header">
          <Link to="/settings" className="home-icon-btn" aria-label="Back">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="home-greet-eyebrow">
              <Shield size={12} style={{ display: "inline", marginRight: 4 }} />
              Admin
            </p>
            <h1 className="home-greet">Voucher Dashboard</h1>
          </div>
        </header>

        <section className="home-section">
          <h2 className="home-section-title">Generate Voucher</h2>
          <div className="admin-gen-card">
            <div className="admin-pkg-select">
              {PACKAGES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`admin-pkg-opt${packageType === p.key ? " admin-pkg-opt-active" : ""}${p.key === "yearly_vip" ? " admin-pkg-opt-vip" : ""}`}
                  onClick={() => setPackageType(p.key)}
                >
                  <span className="admin-pkg-opt-label">
                    {p.key === "yearly_vip" && <Crown size={12} />} {p.label}
                  </span>
                  <span className="admin-pkg-opt-sub">{p.sub}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="admin-generate-btn"
              onClick={() =>
                genMutation.mutate({ quantity: 1, packageType })
              }
              disabled={genMutation.isPending}
            >
              <Ticket size={16} />
              <span>
                {genMutation.isPending ? "Generating…" : "Generate 1 Voucher Code"}
              </span>
            </button>

            {lastCode && (
              <div className="admin-last-code">
                <div className="admin-last-code-label">New voucher code</div>
                <div className="admin-last-code-row">
                  <code className="admin-last-code-value">{lastCode}</code>
                  <button
                    type="button"
                    className="admin-last-code-copy"
                    onClick={() => copyCode(lastCode)}
                    aria-label="Copy code"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">{t("admin.injectTitle")}</h2>
          <div className="admin-inject-card">
            <p className="admin-inject-desc">
              <Coins size={14} /> {t("admin.injectDesc")}
            </p>
            <label className="admin-inject-field">
              <span>{t("admin.targetEmail")}</span>
              <input
                type="email"
                className="admin-inject-input"
                value={injectEmail}
                placeholder="user@email.com"
                onChange={(e) => setInjectEmail(e.target.value)}
              />
            </label>
            <label className="admin-inject-field">
              <span>{t("admin.amount")}</span>
              <input
                type="number"
                className="admin-inject-input"
                value={injectAmount}
                placeholder="10"
                onChange={(e) => setInjectAmount(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="admin-inject-btn"
              disabled={
                injectMutation.isPending ||
                !injectEmail.trim() ||
                !Number(injectAmount)
              }
              onClick={() =>
                injectMutation.mutate({
                  email: injectEmail.trim(),
                  amount: Number(injectAmount),
                })
              }
            >
              <Coins size={16} />
              {injectMutation.isPending ? t("admin.injecting") : t("admin.injectBtn")}
            </button>
          </div>
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2 className="home-section-title">Active Subscribers</h2>
            <button
              type="button"
              className="home-section-more"
              onClick={() => subsQuery.refetch()}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          <div className="admin-subs-tabs">
            {PACKAGES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`lb-tab${subTab === t.key ? " lb-tab-active" : ""}`}
                onClick={() => setSubTab(t.key)}
              >
                {t.label} Subscribers
              </button>
            ))}
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Package</th>
                  <th>Credits</th>
                  <th>Expires</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubs.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="admin-user-cell">
                        <span className="admin-user-name">
                          {s.display_name || s.email || "Unknown"}
                        </span>
                        {s.email && (
                          <span className="admin-user-email">{s.email}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`admin-pkg admin-pkg-${s.package_type}`}>
                        {s.package_type === "yearly_vip" && <Crown size={11} />}
                        {packageLabel(s.package_type)}
                      </span>
                    </td>
                    <td className="admin-credits">
                      {s.credits_remaining} / {s.credits_total}
                    </td>
                    <td className="admin-muted">
                      {s.premium_until
                        ? new Date(s.premium_until).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="admin-countdown">
                      {s.premium_until ? formatRemaining(s.premium_until, now) : "—"}
                    </td>
                  </tr>
                ))}
                {!subsQuery.isLoading && !filteredSubs.length && (
                  <tr>
                    <td colSpan={5} className="admin-empty">
                      No active {packageLabel(subTab)} subscribers yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2 className="home-section-title">All Vouchers</h2>
            <button
              type="button"
              className="home-section-more"
              onClick={() => vouchersQuery.refetch()}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Package</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {vouchersQuery.data?.map((v) => (
                  <tr key={v.id}>
                    <td className="admin-code">{v.code}</td>
                    <td>
                      <span className={`admin-pkg admin-pkg-${v.package_type}`}>
                        {v.package_type === "yearly_vip" && <Crown size={11} />}
                        {packageLabel(v.package_type)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`admin-status ${v.is_used ? "admin-status-used" : "admin-status-unused"}`}
                      >
                        {v.is_used ? "Used" : "Unused"}
                      </span>
                    </td>
                    <td className="admin-muted">
                      {new Date(v.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      {!v.is_used && (
                        <button
                          type="button"
                          className="admin-copy-btn"
                          onClick={() => copyCode(v.code)}
                          aria-label="Copy"
                        >
                          <Copy size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!vouchersQuery.isLoading && !vouchersQuery.data?.length && (
                  <tr>
                    <td colSpan={5} className="admin-empty">
                      No vouchers yet. Generate some above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
