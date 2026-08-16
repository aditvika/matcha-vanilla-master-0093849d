import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Zap, Shield, Gift } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseSession } from "@/hooks/use-supabase-session";

interface SubscriptionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Plan = {
  id: string;
  name: string;
  tab: string;
  price: string;
  period: string;
  description: string;
  badge: string | null;
  popular?: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "monthly",
    name: "VIP Bulanan",
    tab: "Bulanan",
    price: "Rp 55.000",
    period: "/bulan",
    description: "Cocok untuk penggunaan rutin bulanan",
    badge: null,
    features: [
      "Semua akses resolusi terbuka",
      "Bonus +2 MVP Point Leaderboard",
      "Alokasi hingga 200 Kredit per bulan (Sisa kredit reset/hangus tiap akhir bulan)",
      "Konsumsi: Foto (1-2 Kredit), Video (5-15 Kredit)",
      "Dukungan Komunitas VIP",
    ],
  },
  {
    id: "yearly",
    name: "VIP Tahunan Hemat",
    tab: "Tahunan",
    price: "Rp 239.000",
    period: "/tahun",
    description: "Hemat hingga 33% dibandingkan bulanan",
    badge: "Hemat 33%",
    popular: true,
    features: [
      "Semua akses resolusi terbuka",
      "Bonus +3 MVP Point Leaderboard",
      "Alokasi hingga 250 Kredit per bulan (Reset tiap bulan, total 3.000 kredit/tahun)",
      "Konsumsi: Foto (1-2 Kredit), Video (5-15 Kredit)",
      "Prioritas kompilasi server cepat",
      "Metode hemat untuk sehari-hari",
      "Dukungan komunitas VIP",
    ],
  },
  {
    id: "yearly_vip",
    name: "VIP+ Sultan",
    tab: "VIP+",
    price: "Rp 350.000",
    period: "/tahun",
    description: "Paket lengkap untuk content creator profesional",
    badge: "Sultan Edition",
    features: [
      "Semua akses resolusi terbuka",
      "Bonus +5 MVP Point Leaderboard",
      "Alokasi hingga 400 Kredit per bulan (Reset tiap bulan, total 4.800 kredit/tahun)",
      "Konsumsi: Foto (1-2 Kredit), Video (5-15 Kredit)",
      "Prioritas kompilasi server tercepat (diutamakan)",
      "Akses eksklusif versi mendatang & beta",
      "Support Prioritas 24/7",
    ],
  },
];

export function SubscriptionModal({ open, onOpenChange }: SubscriptionModalProps) {
  const { user } = useSupabaseSession();
  const [voucherCode, setVoucherCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [showVoucher, setShowVoucher] = useState(false);
  const [activePlan, setActivePlan] = useState("yearly");

  const selected = PLANS.find((p) => p.id === activePlan) ?? PLANS[0];

  const handleClaimVoucher = async () => {
    if (!voucherCode.trim()) {
      toast.error("Masukkan kode voucher terlebih dahulu!");
      return;
    }

    if (!user) {
      toast.error("Silakan masuk (Sign In) terlebih dahulu untuk mengklaim voucher!");
      return;
    }

    setClaiming(true);
    try {
      // 1. Klaim voucher via RPC
      const { data, error } = await supabase.rpc("claim_voucher", {
        p_code: voucherCode.trim(),
      });

      if (error) {
        if (error.message.includes("NOT_AUTHENTICATED")) {
          toast.error("Silakan masuk terlebih dahulu!");
        } else if (error.message.includes("VOUCHER_NOT_FOUND")) {
          toast.error("Kode voucher tidak ditemukan!");
        } else if (error.message.includes("VOUCHER_EXPIRED")) {
          toast.error("Kode voucher sudah kadaluarsa!");
        } else if (error.message.includes("VOUCHER_USAGE_EXCEEDED")) {
          toast.error("Kuota voucher ini sudah habis!");
        } else if (error.message.includes("ALREADY_CLAIMED")) {
          toast.error("Kamu sudah pernah mengklaim voucher ini!");
        } else {
          toast.error(error.message || "Gagal mengklaim voucher");
        }
        return;
      }

      const payload = data as
        | {
            package_type?: string;
            mvp_added?: number;
            total_mvp_points?: number;
            reviewer?: boolean;
          }
        | null;
      const pkgType = payload?.package_type || "monthly";
      const mvpAdded = payload?.mvp_added ?? 0;

      if (payload?.reviewer) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("mv:mvp-updated"));
        }
        toast.success("Welcome Fal.ai Audit Team! VIP Priority Access Activated.");
        setVoucherCode("");
        setShowVoucher(false);
        onOpenChange(false);
        return;
      }

      const pkgName =
        pkgType === "yearly_vip"
          ? "Tahunan VIP+ Sultan"
          : pkgType === "yearly"
            ? "Tahunan Hemat"
            : "Bulanan";

      // MVP points are awarded server-side by claim_voucher; just refresh the UI.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mv:mvp-updated"));
      }

      toast.success(
        `Selamat! Premium ${pkgName} aktif & +${mvpAdded} Poin MVP berhasil ditambahkan! 🎉`,
      );
      setVoucherCode("");
      setShowVoucher(false);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan saat mengklaim voucher");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setShowVoucher(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto p-4 gap-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            Pilih Paket Premium Kamu 🚀
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-snug">
            Pilih paket keanggotaan yang paling cocok untuk kebutuhan kreatif kamu.
          </DialogDescription>
        </DialogHeader>

        {/* Tab toggle paket */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1">
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setActivePlan(plan.id)}
              className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors ${
                activePlan === plan.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {plan.tab}
            </button>
          ))}
        </div>

        {/* Kartu paket aktif */}
        <div
          className={`relative rounded-xl border bg-card p-3.5 ${
            selected.popular ? "border-primary shadow-sm" : "border-border"
          }`}
        >
          {selected.badge && (
            <div className="absolute -top-2.5 right-3">
              <Badge variant={selected.popular ? "default" : "secondary"} className="text-[10px] px-2 py-0">
                {selected.badge}
              </Badge>
            </div>
          )}

          <h3 className="font-bold text-sm">{selected.name}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{selected.description}</p>

          <div className="mt-2 mb-2.5">
            <span className="text-xl font-extrabold">{selected.price}</span>
            <span className="text-[11px] text-muted-foreground">{selected.period}</span>
          </div>

          <ul className="space-y-1 text-[11px] leading-snug mb-3">
            {selected.features.map((feature, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-[1px]" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <Button
            size="sm"
            className="w-full h-9 text-xs"
            onClick={() => {
              toast.info('Klik "Punya Kode Voucher?" untuk mengaktifkan paket dengan kode.');
            }}
          >
            Pilih {selected.tab}
          </Button>
        </div>

        {/* Voucher — hanya tampil bila diminta user */}
        {!showVoucher ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-9 text-xs gap-1.5"
            onClick={() => setShowVoucher(true)}
          >
            <Gift className="w-3.5 h-3.5 text-primary" />
            Punya Kode Voucher?
          </Button>
        ) : (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-2 font-semibold text-xs">
              <Gift className="w-3.5 h-3.5 text-primary" />
              Klaim Kode Voucher / Akses VIP
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Label htmlFor="voucher" className="sr-only">
                  Kode Voucher
                </Label>
                <Input
                  id="voucher"
                  placeholder="Masukkan kode voucher..."
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  disabled={claiming}
                  className="bg-background h-9 text-xs"
                />
              </div>
              <Button size="sm" className="h-9 text-xs shrink-0" onClick={handleClaimVoucher} disabled={claiming}>
                {claiming ? "Mengklaim..." : "Aktifkan"}
              </Button>
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-snug text-center">
          Catatan: Kredit di-reset setiap bulan dan tidak diakumulasikan. Konsumsi kredit: Foto
          720p-1080p (1 cr), Foto 2K-4K (2 cr), Video 1080p (5 cr), Video 2K-4K (15 cr).
        </p>

        <p className="text-[10px] text-muted-foreground leading-snug text-center">
          (NOTE) Nominal harga yang tertera sudah harga akhir, dan untuk kenyamanan bersama harga akan
          terus di update lewat komunitas sesuai dengan pasar
        </p>

        <div className="text-center text-[10px] text-muted-foreground flex items-center justify-center gap-3">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" /> Pembayaran Aman
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" /> Aktivasi Real-time
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

