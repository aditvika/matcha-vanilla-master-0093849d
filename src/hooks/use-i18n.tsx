import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "id" | "en";

const STORAGE_KEY = "mv:lang";

type Dict = Record<string, string>;

const en: Dict = {
  // common
  "common.gotIt": "Got it",
  "common.ok": "Oke",
  "common.seeAll": "See all",
  "common.loading": "Loading…",
  "common.save": "Save Changes",
  // nav
  "nav.home": "Home",
  "nav.settings": "Settings",
  // home
  "home.welcome": "Welcome back",
  "home.hello": "Hello, User!",
  "home.notifications": "Notifications",
  "home.notifSub": "Updates from your AI studio",
  "home.services": "Services",
  "home.leaderboard": "Premium Leaderboard",
  "home.premiumTag": "MVMaster X Premium",
  "home.premiumTitle": "Unlock unlimited AI magic",
  "home.premiumSub": "Pro models, 4K exports & priority queue.",
  "home.premiumActive": "PREMIUM ACTIVATED",
  "home.premiumActiveSub": "enjoy your premium access",
  "svc.enhancePhoto": "Enhance Photo",
  "svc.faceSwap": "Face Swap",
  "svc.upscaleVideo": "Upscale Video",
  "svc.projectHistory": "Project History",
  "home.comingSoon": "Coming Soon!",
  "home.comingSoonBody": "We will bring this feature to you very soon.",
  "home.quotaButton": "Quota & Plan",
  "quota.title": "Your Quota",
  "quota.desc": "Remaining credits and reset timer",
  // settings
  "settings.eyebrow": "Preferences",
  "settings.title": "Settings",
  "settings.admin": "Admin Dashboard",
  "settings.adminDesc": "Manage vouchers & subscribers",
  "settings.profile": "Account Profile",
  "settings.profileDesc": "Name, email and avatar",
  "settings.premium": "Manage Premium Subscription",
  "settings.language": "Language",
  "settings.privacy": "Privacy Policy",
  "settings.privacyDesc": "Opens in a new tab",
  "settings.logout": "Log out",
  "settings.freePlan": "Free Plan",
  "settings.premiumMonthly": "Premium Active - Bulanan",
  "settings.premiumYearly": "Premium Active - Tahunan",
  "settings.profileSheetDesc": "Update your personal information",
  "settings.name": "Name",
  "settings.account": "Account",
  "settings.languageDesc": "Choose your preferred language",
  "settings.signedOut": "Berhasil keluar dari akun.",
  "settings.signOutFailed": "Gagal keluar dari akun. Silakan coba lagi.",
  // auth
  "auth.eyebrow": "Account",
  "auth.signIn": "Sign In",
  "auth.createAccount": "Create Account",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.google": "Continue with Google",
  "auth.toSignup": "Don't have an account? Sign up",
  "auth.toSignin": "Already have an account? Sign in",
  "auth.working": "Please wait…",
  // remove watermark
  "svc.removeWatermark": "Remove Watermark",
  "service.remove_watermark": "Remove Watermark",
  "wm.chooseType": "Choose media type",
  "wm.chooseTypeDesc": "Pick what you want to clean up",
  "wm.image": "Image",
  "wm.video": "Video",
  "wm.cost": "Cost",
  "wm.mvc": "MVC",
  "wm.insufficient": "Not enough MVC. Get more credits at VanillaMarket.",
  "wm.buyMvc": "Buy MVC",
  "wm.title": "Remove Watermark",
  "wm.tabText": "Watermark Text",
  "wm.tabAuto": "Auto Remove",
  "wm.tabArea": "Select Area",
  "wm.textLabel": "Watermark text to erase",
  "wm.textPlaceholder": "e.g. TikTok, @username",
  "wm.textRequired": "Enter the watermark text first.",
  "wm.autoNote": "AI will automatically detect and remove watermarks",
  "wm.brush": "Brush",
  "wm.rectangle": "Rectangle",
  "wm.areaNote": "Draw over the watermark on the preview.",
  "wm.areaRequired": "Mark the watermark area first.",
  "wm.clearMask": "Clear",
  "wm.removeNow": "Remove Now",
  "wm.processing": "Processing…",
  "wm.estimate": "Estimated time",
  "wm.estImage": "about 20-40 seconds",
  "wm.estVideo": "about 2-4 minutes",
  "wm.done": "Watermark removed",
  "wm.saveGallery": "Save to Gallery",
  "wm.backHome": "Back to Home",
  "wm.saved": "Saved to your gallery.",
  "wm.failed": "Failed to remove the watermark. Your credits were not deducted.",
  "wm.busy": "The engine is busy. Please try again shortly.",
  "wm.uploadFailed": "Upload failed. Please try again.",
  "wm.charged": "credits used",
  // MVC market
  "mvc.title": "Matcha Vanilla Coin (MVC) Market",
  "mvc.subtitle": "Buy coins for Watermark Removal & Exclusive Features",
  "mvc.modalTitle": "MVC Coin Packages",
  "mvc.modalDesc": "Pick a pack and top up instantly via WhatsApp.",
  "mvc.balance": "Your balance",
  "mvc.coins": "MVC Coins",
  "mvc.pack5": "Mini Pack",
  "mvc.pack10": "Starter Pack",
  "mvc.pack15": "Popular Pack",
  "mvc.pack20": "Plus Pack",
  "mvc.pack25": "Smart Pack",
  "mvc.pack30": "Pro Pack",
  "mvc.pack35": "Max Pack",
  "mvc.pack50": "Super Pack",
  "mvc.pack100": "Sultan Pack",
  "mvc.bestSeller": "Best Seller",
  "mvc.bestValue": "Best Value",
  "mvc.sultanPack": "Sultan Pack",
  "mvc.topUp": "Top Up Now",
  // admin injector
  "admin.injectTitle": "Admin Injector",
  "admin.injectDesc": "Add MVC balance to any user account",
  "admin.targetEmail": "Target User Email",
  "admin.amount": "MVC Amount",
  "admin.injectBtn": "Inject MVC Balance",
  "admin.injecting": "Injecting…",
  "admin.injectSuccess": "MVC balance updated",
  "admin.userNotFound": "No user found with that email",
  "admin.injectFailed": "Failed to inject MVC balance",
};


const id: Dict = {
  "common.gotIt": "Mengerti",
  "common.ok": "Oke",
  "common.seeAll": "Lihat semua",
  "common.loading": "Memuat…",
  "common.save": "Simpan Perubahan",
  "nav.home": "Beranda",
  "nav.settings": "Pengaturan",
  "home.welcome": "Selamat datang kembali",
  "home.hello": "Halo, Pengguna!",
  "home.notifications": "Notifikasi",
  "home.notifSub": "Kabar terbaru dari studio AI kamu",
  "home.services": "Layanan",
  "home.leaderboard": "Papan Peringkat Premium",
  "home.premiumTag": "MVMaster X Premium",
  "home.premiumTitle": "Buka keajaiban AI tanpa batas",
  "home.premiumSub": "Model pro, ekspor 4K & antrean prioritas.",
  "home.premiumActive": "PREMIUM AKTIF",
  "home.premiumActiveSub": "selamat menikmati",
  "svc.enhancePhoto": "Perjelas Foto",
  "svc.faceSwap": "Tukar Wajah",
  "svc.upscaleVideo": "Perjelas Video",
  "svc.projectHistory": "Riwayat Proyek",
  "home.comingSoon": "Segera Hadir!",
  "home.comingSoonBody": "Fitur ini akan segera kami hadirkan untuk kamu.",
  "home.quotaButton": "Cek Kuota",
  "quota.title": "Kuota Kamu",
  "quota.desc": "Sisa kredit dan timer reset",
  "settings.eyebrow": "Preferensi",
  "settings.title": "Pengaturan",
  "settings.admin": "Dasbor Admin",
  "settings.adminDesc": "Kelola voucher & pelanggan",
  "settings.profile": "Profil Akun",
  "settings.profileDesc": "Nama, email, dan avatar",
  "settings.premium": "Kelola Langganan Premium",
  "settings.language": "Bahasa",
  "settings.privacy": "Kebijakan Privasi",
  "settings.privacyDesc": "Dibuka di tab baru",
  "settings.logout": "Keluar",
  "settings.freePlan": "Paket Gratis",
  "settings.premiumMonthly": "Premium Aktif - Bulanan",
  "settings.premiumYearly": "Premium Aktif - Tahunan",
  "settings.profileSheetDesc": "Perbarui informasi pribadi kamu",
  "settings.name": "Nama",
  "settings.account": "Akun",
  "settings.languageDesc": "Pilih bahasa yang kamu inginkan",
  "settings.signedOut": "Berhasil keluar dari akun.",
  "settings.signOutFailed": "Gagal keluar dari akun. Silakan coba lagi.",
  "auth.eyebrow": "Akun",
  "auth.signIn": "Masuk",
  "auth.createAccount": "Buat Akun",
  "auth.email": "Email",
  "auth.password": "Kata Sandi",
  "auth.google": "Lanjutkan dengan Google",
  "auth.toSignup": "Belum punya akun? Daftar",
  "auth.toSignin": "Sudah punya akun? Masuk",
  "auth.working": "Mohon tunggu…",
  // hapus watermark
  "svc.removeWatermark": "Hapus Watermark",
  "service.remove_watermark": "Hapus Watermark",
  "wm.chooseType": "Pilih jenis media",
  "wm.chooseTypeDesc": "Pilih media yang ingin dibersihkan",
  "wm.image": "Gambar",
  "wm.video": "Video",
  "wm.cost": "Biaya",
  "wm.mvc": "MVC",
  "wm.insufficient": "MVC kamu tidak cukup. Beli MVC di VanillaMarket.",
  "wm.buyMvc": "Beli MVC",
  "wm.title": "Hapus Watermark",
  "wm.tabText": "Teks Watermark",
  "wm.tabAuto": "Hapus Otomatis",
  "wm.tabArea": "Pilih Area",
  "wm.textLabel": "Teks watermark yang ingin dihapus",
  "wm.textPlaceholder": "mis. TikTok, @username",
  "wm.textRequired": "Masukkan teks watermark terlebih dahulu.",
  "wm.autoNote": "AI akan mendeteksi dan menghapus watermark secara otomatis",
  "wm.brush": "Kuas",
  "wm.rectangle": "Kotak",
  "wm.areaNote": "Tandai area watermark pada pratinjau.",
  "wm.areaRequired": "Tandai area watermark terlebih dahulu.",
  "wm.clearMask": "Hapus Tanda",
  "wm.removeNow": "Hapus Sekarang",
  "wm.processing": "Memproses…",
  "wm.estimate": "Perkiraan waktu",
  "wm.estImage": "sekitar 20-40 detik",
  "wm.estVideo": "sekitar 2-4 menit",
  "wm.done": "Watermark berhasil dihapus",
  "wm.saveGallery": "Simpan ke Galeri",
  "wm.backHome": "Kembali ke Beranda",
  "wm.saved": "Tersimpan di galeri kamu.",
  "wm.failed": "Gagal menghapus watermark. Kredit kamu tidak terpotong.",
  "wm.busy": "Server sedang padat. Silakan coba lagi sebentar.",
  "wm.uploadFailed": "Gagal mengunggah media. Silakan coba lagi.",
  "wm.charged": "kredit terpakai",
  // pasar MVC
  "mvc.title": "Pasar Matcha Vanilla Coin (MVC)",
  "mvc.subtitle": "Beli koin untuk fitur Remove Watermark & Akses Khusus",
  "mvc.modalTitle": "Paket Koin MVC",
  "mvc.modalDesc": "Pilih paket dan isi ulang langsung lewat WhatsApp.",
  "mvc.balance": "Saldo kamu",
  "mvc.coins": "Koin MVC",
  "mvc.pack5": "Paket Mini",
  "mvc.pack10": "Paket Starter",
  "mvc.pack15": "Paket Populer",
  "mvc.pack20": "Paket Plus",
  "mvc.pack25": "Paket Smart",
  "mvc.pack30": "Paket Pro",
  "mvc.pack35": "Paket Max",
  "mvc.pack50": "Paket Super",
  "mvc.pack100": "Paket Sultan",
  "mvc.bestSeller": "Terlaris",
  "mvc.bestValue": "Paling Hemat",
  "mvc.sultanPack": "PRO VALUE",
  "mvc.topUp": "Isi Ulang Sekarang",
  // injector admin
  "admin.injectTitle": "Admin Injector",
  "admin.injectDesc": "Tambah saldo MVC ke akun pengguna mana pun",
  "admin.targetEmail": "Email User Target",
  "admin.amount": "Jumlah MVC",
  "admin.injectBtn": "Suntik Saldo MVC",
  "admin.injecting": "Menyuntik…",
  "admin.injectSuccess": "Saldo MVC berhasil diperbarui",
  "admin.userNotFound": "Pengguna dengan email itu tidak ditemukan",
  "admin.injectFailed": "Gagal menyuntik saldo MVC",
};


const dicts: Record<Lang, Dict> = { en, id };

type I18nState = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "id" || stored === "en") setLangState(stored);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: string) => dicts[lang][key] ?? en[key] ?? key, [lang]);

  const value = useMemo<I18nState>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
