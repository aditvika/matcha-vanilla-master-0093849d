import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function PremiumModal({ open, onOpenChange, onUnderstand }: { open: boolean; onOpenChange: (v: boolean) => void; onUnderstand?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="premium-modal-content"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="premium-modal-title">Fitur Premium MVMaster X</DialogTitle>
          <DialogDescription className="premium-modal-desc" asChild>
            <div>
              <p className="premium-modal-line">Halo Teman-teman Kreatif! ✨</p>

              <p className="premium-modal-line">
                Pertama-tama, terima kasih banyak sudah mendukung dan memercayakan kebutuhan HD foto/video kamu di MVMaster X.
              </p>

              <p className="premium-modal-line">
                Perlu diketahui, saat ini aplikasi MVMaster X masih berada dalam tahap{" "}
                <strong>pengembangan aktif</strong>. Kami berkomitmen penuh untuk selalu memberikan hasil up-scaling AI yang{" "}
                <strong>nyata, jujur, dan berkualitas tinggi</strong> tanpa iming-iming palsu.
              </p>

              <p className="premium-modal-line">
                Karena proses AI HD ini membutuhkan komputasi awan (cloud server) yang murni online serta memakan biaya
                operasional mandiri, saat ini akun Premium kami jalankan dengan{" "}
                <strong>Sistem Kredit Berkala</strong> demi menjaga kestabilan server agar performanya tetap optimal dan
                adil bagi semua pengguna:
              </p>

              <ul className="premium-modal-list">
                <li>
                  <strong>Paket Bulanan:</strong> Akses Premium dengan alokasi maksimal{" "}
                  <strong>200 Kredit per bulan</strong> (reset otomatis tiap bulan).
                </li>
                <li>
                  <strong>Paket Tahunan:</strong> Akses Premium dengan alokasi maksimal{" "}
                  <strong>250 Kredit per bulan</strong> (reset otomatis tiap bulan).
                </li>
                <li>
                  <strong>Paket Tahunan VIP+:</strong> Akses Premium dengan alokasi maksimal{" "}
                  <strong>400 Kredit per bulan</strong> (reset otomatis tiap bulan).
                </li>
              </ul>

              <p className="premium-modal-line">
                <strong>Ketentuan Pemakaian Kredit Premium:</strong>
              </p>
              <ul className="premium-modal-list">
                <li>Foto HD / 2K : 1 Kredit | Foto Ultra 4K : 2 Kredit</li>
                <li>Video HD / 1080p : 5 Kredit | Video Ultra 2K / 4K : 15 Kredit</li>
              </ul>

              <p className="premium-modal-line">
                Kami sangat mengharapkan pemahaman dan kerja sama dari teman-teman semua. Setiap dukungan dari kamu akan
                langsung diputar kembali untuk peningkatan kapasitas server, optimalisasi sistem, serta penambahan
                fitur-fitur baru ke depannya sesuai masukan komunitas.
              </p>

              <p className="premium-modal-line">
                Mari kita bangun MVMaster X menjadi aplikasi yang lebih sempurna sama-sama! 🚀
              </p>

              <p className="premium-modal-signature">— Adityo Saputra (Developer MVMaster X)</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="premium-modal-btn"
            onClick={() => {
              onOpenChange(false);
              onUnderstand?.();
            }}
          >
            Saya Mengerti
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
