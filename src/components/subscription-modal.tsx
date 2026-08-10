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

const PLANS = [
  {
    id: "monthly",
    name: "VIP Bulanan",
    price: "Rp 15.000",
    period: "/bulan",
    description: "Cocok untuk penggunaan rutin bulanan",
    badge: null,
    features: [
      "Akses penuh semua fitur AI",
      "Bonus +2 MVP Point Leaderboard",
      "Prioritas kompilasi cepat",
      "Dukungan Komunitas VIP",
    ],
  },
  {
    id: "yearly",
    name: "VIP Tahunan Hemat",
    price: "Rp 120.000",
    period: "/tahun",
    description: "Hemat hingga 33% dibandingkan bulanan",
    badge: "Hemat 33%",
    popular: true,
    features: [
      "Akses penuh semua fitur AI",
      "Bonus +3 MVP Point Leaderboard",
      "Prioritas kompilasi lebih cepat",
      "Hemat Rp 60.000 / tahun",
      "Dukungan Komunitas VIP",
    ],
  },
  {
    id: "yearly_vip",
    name: "VIP+ Sultan",
    price: "Rp 250.000",
    period: "/tahun",
    description: "Paket lengkap untuk creator profesional",
    badge: "Sultan Edition",
    features: [
      "Akses tanpa batas semua fitur AI",
      "Bonus +5 MVP Point Leaderboard",
      "Prioritas kompilasi server utama",
      "Akses eksklusif fitur beta baru",
      "Dukungan prioritas 24/7",
    ],
  },
];

export function SubscriptionModal({ open, onOpenChange }: SubscriptionModalProps) {
  const { user } = useAuth();
  const [voucherCode, setVoucherCode] = useState("");
  const [claiming, setClaiming] = useState(false);

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

      const payload = data as { package_type?: string } | null;
      const pkgType = payload?.package_type || "monthly";

      // 2. Hitung Poin MVP berdasarkan Paket
      // Bulanan = +2, Tahunan Hemat = +3, VIP+ Sultan = +5
      let mvpToAdd = 2;
      let pkgName = "Bulanan";

      if (pkgType === "yearly_vip" || pkgType === "sultan") {
        mvpToAdd = 5;
        pkgName = "Tahunan VIP+ Sultan";
      } else if (pkgType === "yearly") {
        mvpToAdd = 3;
        pkgName = "Tahunan Hemat";
      }

      // 3. Ambil nilai MVP saat ini dari profil menggunakan cast 'as any' agar aman dari strict TS
      const { data: profile } = await (supabase
        .from("profiles") as any)
        .select("mvp_points")
        .eq("id", user.id)
        .single();

      const currentMvp = profile?.mvp_points || 0;
      const newMvp = currentMvp + mvpToAdd;

      // 4. Update profil pengguna di database Supabase
      await (supabase.from("profiles") as any)
        .update({
          plan_type: pkgType,
          mvp_points: newMvp,
          email: user.email,
        })
        .eq("id", user.id);

      toast.success(`Selamat! Premium ${pkgName} aktif & +${mvpToAdd} Poin MVP berhasil ditambahkan! 🎉`);
      setVoucherCode("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan saat mengklaim voucher");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Sewa / Beli Akses Premium
          </DialogTitle>
          <DialogDescription>
            Pilih paket keanggotaan atau klaim kode voucher kamu untuk membuka semua fitur VIP.
          </DialogDescription>
        </DialogHeader>

        {/* Form Klaim Voucher */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 my-2">
          <div className="flex items-center gap-2 mb-2 font-semibold text-sm">
            <Gift className="w-4 h-4 text-primary" />
            Punya Kode Voucher / Akses VIP?
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="voucher" className="sr-only">
                Kode Voucher
              </Label>
              <Input
                id="voucher"
                placeholder="Masukkan kode voucher (contoh: VIP-SULTAN)..."
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value)}
                disabled={claiming}
                className="bg-background"
              />
            </div>
            <Button onClick={handleClaimVoucher} disabled={claiming}>
              {claiming ? "Mengklaim..." : "Aktifkan Voucher"}
            </Button>
          </div>
        </div>

        {/* Pilihan Paket */}
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`border rounded-xl p-5 flex flex-col justify-between relative bg-card ${
                plan.popular ? "border-primary shadow-md" : "border-border"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 right-4">
                  <Badge variant={plan.popular ? "default" : "secondary"}>
                    {plan.badge}
                  </Badge>
                </div>
              )}

              <div>
                <h3 className="font-bold text-lg">{plan.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  {plan.description}
                </p>

                <div className="mb-4">
                  <span className="text-2xl font-extrabold">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.period}</span>
                </div>

                <ul className="space-y-2 text-xs mb-6">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-primary shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                variant={plan.popular ? "default" : "outline"}
                className="w-full"
                onClick={() => {
                  toast.info("Gunakan form Klaim Voucher di atas untuk mengaktifkan paket!");
                }}
              >
                Pilih Paket
              </Button>
            </div>
          ))}
        </div>

        <div className="text-center text-xs text-muted-foreground mt-4 flex items-center justify-center gap-4">
          <span className="flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" /> Pembayaran Aman & Terverifikasi
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> Aktivasi Otomatis Real-time
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
a
