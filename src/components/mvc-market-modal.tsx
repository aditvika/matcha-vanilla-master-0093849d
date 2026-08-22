import { Coins, Sparkles, Store } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { useCredits } from "@/hooks/use-credits";

const WA_NUMBER = "62895365351729";

type Pack = {
  id: "mini" | "popular" | "super";
  nameKey: string;
  coins: number;
  idr: string;
  usd: string;
  badgeKey?: string;
};

const PACKS: Pack[] = [
  { id: "mini", nameKey: "mvc.mini", coins: 5, idr: "Rp 10.000", usd: "$0.70" },
  {
    id: "popular",
    nameKey: "mvc.popular",
    coins: 15,
    idr: "Rp 25.000",
    usd: "$1.70",
    badgeKey: "mvc.bestSeller",
  },
  {
    id: "super",
    nameKey: "mvc.super",
    coins: 50,
    idr: "Rp 70.000",
    usd: "$4.50",
    badgeKey: "mvc.bestValue",
  },
];

export function MvcMarketModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { user } = useSupabaseSession();
  const { mvcBalance } = useCredits();
  const [selected, setSelected] = useState<Pack["id"]>("popular");

  const pack = PACKS.find((p) => p.id === selected) ?? PACKS[1]!;

  const topUp = () => {
    const label = `${t(pack.nameKey)} (${pack.coins} MVC)`;
    const email = user?.email ?? "-";
    const text =
      `Halo Admin MVMaster, saya mau top up ${label}.\n\n` +
      `Email Akun: ${email}\n` +
      `Total: ${pack.idr} / ${pack.usd}`;
    window.open(
      `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mvc-modal">
        <div className="mvc-modal-head">
          <span className="mvc-modal-icon" aria-hidden>
            <Store size={22} />
          </span>
          <DialogTitle className="mvc-modal-title">{t("mvc.modalTitle")}</DialogTitle>
          <DialogDescription className="mvc-modal-desc">
            {t("mvc.modalDesc")}
          </DialogDescription>
          <p className="mvc-balance">
            <Coins size={14} /> {t("mvc.balance")}: <strong>{mvcBalance} MVC</strong>
          </p>
        </div>

        <div className="mvc-packs">
          {PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`mvc-pack${selected === p.id ? " mvc-pack-active" : ""}`}
              onClick={() => setSelected(p.id)}
              aria-pressed={selected === p.id}
            >
              {p.badgeKey && <span className="mvc-pack-badge">{t(p.badgeKey)}</span>}
              <span className="mvc-pack-coins">
                <Coins size={16} /> {p.coins} <em>{t("mvc.coins")}</em>
              </span>
              <span className="mvc-pack-name">{t(p.nameKey)}</span>
              <span className="mvc-pack-price">
                {p.idr} <i>/ {p.usd}</i>
              </span>
            </button>
          ))}
        </div>

        <button type="button" className="mvc-topup" onClick={topUp}>
          <Sparkles size={16} /> {t("mvc.topUp")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
