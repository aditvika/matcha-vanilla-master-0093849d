import { useState } from "react";
import { Image as ImageIcon, Video, Timer, Gauge, Crown, Sparkles } from "lucide-react";
import { useCredits, useResetCountdown } from "@/hooks/use-credits";
import { useI18n } from "@/hooks/use-i18n";
import { SubscriptionModal } from "@/components/subscription-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  monthly: "Premium Bulanan",
  yearly: "Premium Tahunan",
  yearly_vip: "Premium Tahunan VIP+",
};

function CreditList({ onUpgrade }: { onUpgrade: () => void }) {
  const { tier, pools, rates, periodEnd, skewMs, loading } = useCredits();
  const countdown = useResetCountdown(periodEnd, skewMs);
  const isFree = tier === "free";

  const cycle = isFree ? "Resets daily (24h)" : "Resets monthly";

  const photo = pools.find((p) => p.key === "photo");
  const video = pools.find((p) => p.key === "video");
  const unified = pools.find((p) => p.key === "credits");

  const bar = (used: number, limit: number) =>
    limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const rateRows = isFree
    ? [
        { label: "Photo (720p – 1080p)", cost: "1 Credit" },
        { label: "Video (720p)", cost: "3 Credits" },
      ]
    : [
        { label: "Photo (720p – 2K)", cost: "1 Credit" },
        { label: "Photo Ultra (4K)", cost: "2 Credits" },
        { label: "Video HD (720p – 1080p)", cost: "5 Credits" },
        { label: "Video Ultra (2K – 4K)", cost: "15 Credits" },
      ];

  return (
    <>
      <div className="quota-modal-head">
        <h3 className="quota-modal-title">Your Credits</h3>
        <span className="quota-reset">
          <Timer size={13} /> {cycle} · {countdown}
        </span>
      </div>

      <span className="credit-tier-chip">
        {!isFree && <Crown size={12} />} {TIER_LABEL[tier] ?? tier}
      </span>

      <div className="quota-grid">
        {loading && pools.length === 0 ? (
          <p className="quota-empty">Loading credits…</p>
        ) : isFree ? (
          <>
            <div className="quota-item">
              <div className="quota-item-top">
                <span className="quota-item-label">
                  <ImageIcon size={14} /> Photo Credits
                </span>
                <span className="quota-item-count">
                  {photo?.remaining ?? 0}/{photo?.limit ?? 5}
                </span>
              </div>
              <div className="quota-bar" aria-hidden>
                <span style={{ width: `${bar(photo?.used ?? 0, photo?.limit ?? 5)}%` }} />
              </div>
            </div>
            <div className="quota-item">
              <div className="quota-item-top">
                <span className="quota-item-label">
                  <Video size={14} /> Video Credits
                </span>
                <span className="quota-item-count">
                  {video?.remaining ?? 0}/{video?.limit ?? 9}
                </span>
              </div>
              <div className="quota-bar" aria-hidden>
                <span style={{ width: `${bar(video?.used ?? 0, video?.limit ?? 9)}%` }} />
              </div>
            </div>
          </>
        ) : (
          <div className="quota-item credit-item-unified">
            <div className="quota-item-top">
              <span className="quota-item-label">
                <Sparkles size={14} /> Total Credits
              </span>
              <span className="quota-item-count">
                {unified?.remaining ?? 0} / {unified?.limit ?? 0} Credits
              </span>
            </div>
            <div className="quota-bar" aria-hidden>
              <span style={{ width: `${bar(unified?.used ?? 0, unified?.limit ?? 0)}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="credit-rate-card">
        <p className="credit-rate-title">Rate Breakdown</p>
        <ul className="credit-rate-list">
          {rateRows.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <strong>{r.cost}</strong>
            </li>
          ))}
        </ul>
        {isFree && (
          <p className="credit-rate-note">
            2K &amp; 4K locked on Free · Video limited to 720p
          </p>
        )}
        {!isFree && rates.length === 0 && null}
      </div>

      {isFree && (
        <button type="button" className="credit-upgrade-banner" onClick={onUpgrade}>
          <Crown size={16} />
          <span>
            <strong>Upgrade to Premium</strong>
            <em>Up to 400 credits/month, 2K &amp; 4K unlocked</em>
          </span>
        </button>
      )}
    </>
  );
}

export function QuotaPanel() {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const { t } = useI18n();

  return (
    <section className="quota-panel" aria-label="Remaining credits">
      <button
        type="button"
        className="quota-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Gauge size={16} />
        <span>{t("home.quotaButton")}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="quota-modal-content">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("quota.title")}</DialogTitle>
            <DialogDescription>{t("quota.desc")}</DialogDescription>
          </DialogHeader>
          <CreditList
            onUpgrade={() => {
              setOpen(false);
              setTimeout(() => setSubOpen(true), 220);
            }}
          />
        </DialogContent>
      </Dialog>

      <SubscriptionModal open={subOpen} onOpenChange={setSubOpen} />
    </section>
  );
}
