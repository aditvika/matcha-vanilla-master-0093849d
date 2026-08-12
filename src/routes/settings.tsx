import { RequireAuth } from "@/components/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  UserCircle2,
  Crown,
  Languages,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Home as HomeIcon,
  Plus,
  Settings as SettingsIcon,
  Camera,
  Check,
  Sparkles,
  Zap,
  BadgeCheck,
  ExternalLink,
  Mail,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PremiumModal } from "@/components/premium-modal";
import { SubscriptionModal } from "@/components/subscription-modal";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { usePremiumStatus } from "@/hooks/use-premium-status";
import { useI18n } from "@/hooks/use-i18n";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useNavigate } from "@tanstack/react-router";
import { Shield, Crown as CrownIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";


const ADMIN_EMAIL = "tyozxtar@gmail.com";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Matcha Vanilla Production" },
      {
        name: "description",
        content: "Manage your account, subscription, language and privacy preferences.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <SettingsPage />
    </RequireAuth>
  ),
});

type SheetKey = "profile" | "premium" | "language" | null;

const LANGUAGES: Array<{ code: "en" | "id"; label: string }> = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
];

function SettingsPage() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const { user: supaUser, loading: authLoading } = useSupabaseSession();
  void authLoading;
  const [openSheet, setOpenSheet] = useState<SheetKey>(null);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [premiumActiveOpen, setPremiumActiveOpen] = useState(false);
  const [name, setName] = useState<string>(() => {
    if (typeof window === "undefined") return "Matcha User";
    return localStorage.getItem("mv:profile:name") || "Matcha User";
  });
  const [avatar, setAvatar] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("mv:profile:avatar");
  });
  const [emailInput, setEmailInput] = useState<string>("");
  const [sendingLink, setSendingLink] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { isPremium, packageType } = usePremiumStatus();
  const premiumLabel = isPremium
    ? packageType === "yearly"
      ? t("settings.premiumYearly")
      : t("settings.premiumMonthly")
    : t("settings.freePlan");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoggedIn = !!supaUser;
  const userEmail = supaUser?.email ?? "";

  useEffect(() => {
    localStorage.setItem("mv:profile:name", name);
  }, [name]);
  useEffect(() => {
    if (avatar) localStorage.setItem("mv:profile:avatar", avatar);
    else localStorage.removeItem("mv:profile:avatar");
  }, [avatar]);

  // Load the saved profile name from the account profile.
  useEffect(() => {
    if (!supaUser) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", supaUser.id)
      .maybeSingle()
      .then(({ data }) => {
        const saved = (data?.display_name ?? "").trim();
        if (active && saved) setName(saved);
      });
    return () => {
      active = false;
    };
  }, [supaUser]);

  const handleSaveProfile = async () => {
    const finalName = name.trim() || "Matcha User";
    setName(finalName);
    if (supaUser) {
      await supabase
        .from("profiles")
        .upsert({ id: supaUser.id, email: supaUser.email ?? null, display_name: finalName });
      window.dispatchEvent(new CustomEvent("mv:mvp-updated"));
    }
    setOpenSheet(null);
  };


  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleLogout = async () => {
    setOpenSheet(null);
    try {
      await supabase.auth.signOut();
      // Clear every cached credential/profile artifact left behind.
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("sb-") || k.startsWith("mv:profile"))
          .forEach((k) => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch {
        /* storage may be unavailable */
      }
      toast.success(t("settings.signedOut"));
    } catch (err) {
      console.error("[settings:logout]", err);
      toast.error(t("settings.signOutFailed"));
    }
    // Replace history so Back cannot return into protected screens.
    navigate({ to: "/auth", replace: true });
  };

  const handleSendMagicLink = async () => {
    const email = emailInput.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setSendingLink(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success("Magic link sent! Check your inbox.");
      setEmailInput("");
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to send link";
      toast.error(message);
    } finally {
      setSendingLink(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (!result.redirected) toast.success("Welcome!");
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      toast.error(message);
    } finally {
      setGoogleLoading(false);
    }
  };


  const currentLangLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? "English";

  const items: Array<{
    label: string;
    desc: string;
    Icon: typeof UserCircle2;
    onClick: () => void;
    isExternal?: boolean;
    isAdmin?: boolean;
  }> = [
    ...(userEmail.toLowerCase() === ADMIN_EMAIL
      ? [
          {
            label: t("settings.admin"),
            desc: t("settings.adminDesc"),
            Icon: Shield,
            onClick: () => navigate({ to: "/admin" }),
            isAdmin: true,
          },
        ]
      : []),
    {
      label: t("settings.profile"),
      desc: t("settings.profileDesc"),
      Icon: UserCircle2,
      onClick: () => setOpenSheet("profile"),
    },
    {
      label: t("settings.premium"),
      desc: premiumLabel,
      Icon: Crown,
      onClick: () => (isPremium ? setPremiumActiveOpen(true) : setPremiumOpen(true)),
    },
    {
      label: t("settings.language"),
      desc: currentLangLabel,
      Icon: Languages,
      onClick: () => setOpenSheet("language"),
    },
    {
      label: t("settings.privacy"),
      desc: t("settings.privacyDesc"),
      Icon: ShieldCheck,
      onClick: () => {
        window.open("https://www.privacypolicies.com/live/sample", "_blank", "noopener,noreferrer");
      },
      isExternal: true,
    },
  ];

  return (
    <main className="home-root">
      <div className="home-glow home-glow-green" aria-hidden />
      <div className="home-glow home-glow-warm" aria-hidden />

      <div className="home-content home-fade-in">
        <header className="home-header">
          <div>
            <p className="home-greet-eyebrow">{t("settings.eyebrow")}</p>
            <h1 className="home-greet">{t("settings.title")}</h1>
          </div>
        </header>

        <section className="home-section" aria-label="Account settings">
          <ul className="settings-list">
            {items.map(({ label, desc, Icon, onClick, isExternal, isAdmin }) => (
              <li key={label}>
                <button
                  type="button"
                  className={`settings-item${isAdmin ? " settings-item-admin" : ""}`}
                  onClick={onClick}
                >
                  <div className="settings-item-icon">
                    <Icon size={20} />
                  </div>
                  <div className="settings-item-text">
                    <p className="settings-item-label">{label}</p>
                    <p className="settings-item-desc">{desc}</p>
                  </div>
                  {isExternal ? (
                    <ExternalLink size={18} className="settings-item-chev" />
                  ) : (
                    <ChevronRight size={18} className="settings-item-chev" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button type="button" className="settings-logout" onClick={handleLogout}>
            <LogOut size={18} />
            <span>{t("settings.logout")}</span>
          </button>
        </section>
      </div>

      <nav className="home-nav" aria-label="Primary">
        <Link
          to="/home"
          className="home-nav-item"
          activeProps={{ className: "home-nav-item home-nav-active" }}
        >
          <HomeIcon size={22} />
          <span>{t("nav.home")}</span>
        </Link>
        <Link to="/home" className="home-nav-item home-nav-create">
          <Plus size={26} />
        </Link>
        <Link
          to="/settings"
          className="home-nav-item"
          activeProps={{ className: "home-nav-item home-nav-active" }}
        >
          <SettingsIcon size={22} />
          <span>{t("nav.settings")}</span>
        </Link>
      </nav>

      {/* Profile Sheet */}
      <Drawer open={openSheet === "profile"} onOpenChange={(o) => !o && setOpenSheet(null)}>
        <DrawerContent className="settings-sheet">
          <DrawerHeader className="settings-sheet-header">
            <DrawerTitle className="settings-sheet-title">{t("settings.profile")}</DrawerTitle>
            <DrawerDescription className="settings-sheet-desc">
              {t("settings.profileSheetDesc")}
            </DrawerDescription>
          </DrawerHeader>

          <div className="settings-sheet-body">
            <div className="profile-avatar-wrap">
              <div
                className="profile-avatar"
                aria-hidden
                style={
                  avatar
                    ? {
                        backgroundImage: `url(${avatar})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        color: "transparent",
                      }
                    : undefined
                }
              >
                {name.charAt(0).toUpperCase()}
              </div>
              <button
                type="button"
                className="profile-avatar-edit"
                aria-label="Change avatar"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleAvatarPick}
              />
            </div>

            <div className="profile-field">
              <Label htmlFor="profile-name" className="profile-label">{t("settings.name")}</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="profile-input"
                placeholder="Your name"
              />
            </div>

            {isLoggedIn ? (
              <div className="profile-field">
                <Label className="profile-label">{t("settings.account")}</Label>
                <div className="profile-email-display">
                  <Mail size={16} />
                  <span>{userEmail}</span>
                  <BadgeCheck size={16} className="profile-email-verified" />
                </div>
              </div>
            ) : (
              <>
                <div className="profile-field">
                  <Label htmlFor="profile-email" className="profile-label">
                    Email Address
                  </Label>
                  <Input
                    id="profile-email"
                    type="email"
                    autoComplete="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="profile-input"
                    placeholder="you@example.com"
                  />
                  <button
                    type="button"
                    className="profile-magic-link-btn"
                    onClick={handleSendMagicLink}
                    disabled={sendingLink}
                  >
                    <Mail size={16} />
                    <span>{sendingLink ? "Sending..." : "Send Verification Link"}</span>
                  </button>
                </div>

                <div className="profile-divider">
                  <span>or</span>
                </div>

                <button
                  type="button"
                  className="profile-google-btn"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
                    <path fill="#4285F4" d="M21.2 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1v.1l3.6 2.8c2.1-2 3.6-4.9 3.6-9.3z"/>
                    <path fill="#FBBC05" d="M5.4 14.3l-.7.5-2.3 1.8C3.9 19.9 7.7 22 12 22c2.6 0 4.8-.9 6.4-2.3l-3.6-2.8c-1 .7-2.3 1.2-2.8 1.2-2.6 0-4.8-1.7-5.6-4.1z"/>
                    <path fill="#34A853" d="M12 21.6c2.6 0 4.8-.9 6.4-2.3l-3.6-2.8c-1 .7-2.3 1.1-2.8 1.1-2.6 0-4.8-1.7-5.6-4.1l-3 2.3C5 19.5 8.2 21.6 12 21.6z"/>
                  </svg>
                  <span>{googleLoading ? "Connecting..." : "Continue with Google"}</span>
                </button>
              </>
            )}
          </div>

          <DrawerFooter className="settings-sheet-footer">
            <button
              type="button"
              className="settings-sheet-primary"
              onClick={() => void handleSaveProfile()}
            >
              {t("common.save")}
            </button>
            {isLoggedIn && (
              <button
                type="button"
                className="profile-logout-btn"
                onClick={handleLogout}
              >
                <LogOut size={16} />
                <span>{t("settings.logout")}</span>
              </button>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Premium Notification Modal */}
      <PremiumModal
        open={premiumOpen}
        onOpenChange={setPremiumOpen}
        onUnderstand={() => setTimeout(() => setSubOpen(true), 250)}
      />

      {/* Subscription plans modal */}
      <SubscriptionModal open={subOpen} onOpenChange={setSubOpen} />

      {/* KAMU SUDAH AKTIF PREMIUM popup */}
      <Dialog open={premiumActiveOpen} onOpenChange={setPremiumActiveOpen}>
        <DialogContent className="premium-active-modal">
          <div className="premium-active-icon" aria-hidden>
            <CrownIcon size={30} />
          </div>
          <DialogTitle className="premium-active-title">
            KAMU SUDAH AKTIF PREMIUM
          </DialogTitle>
          <DialogDescription className="premium-active-sub">
            {packageType === "yearly"
              ? "Paket Tahunan aktif — selamat menikmati semua fitur premium."
              : "Paket Bulanan aktif — selamat menikmati semua fitur premium."}
          </DialogDescription>
          <button
            type="button"
            className="premium-active-btn"
            onClick={() => setPremiumActiveOpen(false)}
          >
            Oke
          </button>
        </DialogContent>
      </Dialog>

      {/* Language Sheet */}
      <Drawer open={openSheet === "language"} onOpenChange={(o) => !o && setOpenSheet(null)}>
        <DrawerContent className="settings-sheet">
          <DrawerHeader className="settings-sheet-header">
            <DrawerTitle className="settings-sheet-title">{t("settings.language")}</DrawerTitle>
            <DrawerDescription className="settings-sheet-desc">
              {t("settings.languageDesc")}
            </DrawerDescription>
          </DrawerHeader>

          <div className="settings-sheet-body">
            <ul className="language-list">
              {LANGUAGES.map((option) => {
                const selected = option.code === lang;
                return (
                  <li key={option.code}>
                    <button
                      type="button"
                      className={`language-item${selected ? " language-item-active" : ""}`}
                      onClick={() => {
                        setLang(option.code);
                        setOpenSheet(null);
                      }}
                    >
                      <span>{option.label}</span>
                      {selected && <Check size={18} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <DrawerClose className="sr-only">Close</DrawerClose>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
