import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { QuotaPanel } from "@/components/quota-panel";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSelectedMedia } from "@/hooks/use-selected-media";
import {
  Bell,
  Wand2,
  UserRoundCog,
  Video,
  FolderOpen,
  Home as HomeIcon,
  Plus,
  Settings,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Crown,
  Gift,
  Medal,
  Award,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { PremiumModal } from "@/components/premium-modal";
import { SubscriptionModal } from "@/components/subscription-modal";
import { usePremiumStatus } from "@/hooks/use-premium-status";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home — Matcha Vanilla Production" },
      {
        name: "description",
        content: "Your AI creative studio. Enhance photos, swap faces, upscale video and more.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HomePage />
    </RequireAuth>
  ),
});

type Service = {
  label: string;
  key: string;
  Icon: typeof Wand2;
};

const services: Service[] = [
  { label: "Enhance Photo", key: "svc.enhancePhoto", Icon: Wand2 },
  { label: "Face Swap", key: "svc.faceSwap", Icon: UserRoundCog },
  { label: "Upscale Video", key: "svc.upscaleVideo", Icon: Video },
  { label: "Project History", key: "svc.projectHistory", Icon: FolderOpen },
];

type Notification = {
  id: string;
  Icon: typeof Wand2;
  title: string;
  body: string;
  time: string;
  tone: "success" | "premium" | "info";
};

const notifications: Notification[] = [
  {
    id: "1",
    Icon: CheckCircle2,
    title: "Your video upscale is complete!",
    body: "Tap to preview the 4K render and download.",
    time: "2m ago",
    tone: "success",
  },
  {
    id: "2",
    Icon: Crown,
    title: "Unlock 4K exports with Premium",
    body: "Go pro to remove watermarks and queue limits.",
    time: "1h ago",
    tone: "premium",
  },
  {
    id: "3",
    Icon: Gift,
    title: "New: Face Swap v2 is live",
    body: "Sharper edges, better blending, faster results.",
    time: "Yesterday",
    tone: "info",
  },
];

import {
  fetchLeaderboardData,
  getInitials,
  type LeaderTab,
  type LeaderEntry,
} from "@/lib/leaderboard-data";

const rankMeta = [
  { Icon: Crown, cls: "lb-rank-gold" },
  { Icon: Medal, cls: "lb-rank-silver" },
  { Icon: Award, cls: "lb-rank-bronze" },
  { Icon: Award, cls: "lb-rank-other" },
  { Icon: Award, cls: "lb-rank-other" },
];

function HomePage() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [faceSwapOpen, setFaceSwapOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [leaderTab, setLeaderTab] = useState<LeaderTab>("Bulanan");
  const [leaderboardFull, setLeaderboardFull] = useState<Record<LeaderTab, LeaderEntry[]>>({
    Bulanan: [],
    Tahunan: [],
    Mix: [],
  });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const res = await fetchLeaderboardData();
      if (mounted) setLeaderboardFull(res);
    };
    void load();
    const onUpdate = () => void load();
    window.addEventListener("mv:mvp-updated", onUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("mv:mvp-updated", onUpdate);
    };
  }, []);
  const { isPremium } = usePremiumStatus();
  const { t } = useI18n();
  const { setMedia } = useSelectedMedia();
  const navigate = useNavigate();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleServiceClick = (label: string) => {
    if (label === "Face Swap") return setFaceSwapOpen(true);
    if (label === "Enhance Photo") return photoInputRef.current?.click();
    if (label === "Upscale Video") return videoInputRef.current?.click();
  };

  const handleFilePicked = (kind: "photo" | "video") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMedia(file, kind);
    e.target.value = "";
    void navigate({ to: "/preview" });
  };

  const openNotifications = () => {
    setNotifOpen(true);
    setHasUnread(false);
  };

  return (
    <main className="home-root">
      <div className="home-glow home-glow-green" aria-hidden />
      <div className="home-glow home-glow-warm" aria-hidden />

      <div className="home-content home-fade-in">
        {/* Header */}
        <header className="home-header">
          <div>
            <p className="home-greet-eyebrow">{t("home.welcome")}</p>
            <h1 className="home-greet">{t("home.hello")}</h1>
          </div>
          <button
            className="home-bell"
            aria-label={t("home.notifications")}
            type="button"
            onClick={openNotifications}
          >
            <Bell size={20} />
            {hasUnread && <span className="home-bell-dot" aria-hidden />}
          </button>
        </header>

        {/* Hero carousel */}
        <HeroCarousel isPremium={isPremium} onUpgrade={() => setPremiumOpen(true)} />

        {/* Featured card / Premium activated banner */}

        {isPremium ? (
          <div className="home-premium-banner" role="status" aria-live="polite">
            <div className="home-premium-banner-glow" aria-hidden />
            <div className="home-premium-banner-row">
              <div className="home-premium-banner-icon">
                <Crown size={22} />
              </div>
              <div className="home-premium-banner-text">
                <p className="home-premium-banner-tag">{t("home.premiumActive")}</p>
                <h2 className="home-premium-banner-title">{t("home.premiumActiveSub")}</h2>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="home-featured"
            aria-label="MVMaster Premium"
            onClick={() => setPremiumOpen(true)}
          >
            <div className="home-featured-glow" aria-hidden />
            <div className="home-featured-row">
              <div className="home-featured-icon">
                <Sparkles size={22} />
              </div>
              <div className="home-featured-text">
                <p className="home-featured-tag">{t("home.premiumTag")}</p>
                <h2 className="home-featured-title">{t("home.premiumTitle")}</h2>
                <p className="home-featured-sub">{t("home.premiumSub")}</p>
              </div>
              <ChevronRight size={20} className="home-featured-chev" />
            </div>
          </button>
        )}

        {/* Service grid */}
        <section className="home-section" aria-label="Services">
          <div className="home-section-head">
            <h3 className="home-section-title">{t("home.services")}</h3>
            <span className="home-section-link">{t("common.seeAll")}</span>
          </div>
          <div className="home-grid">
            {services.map(({ label, key, Icon }) => (
              <button
                key={label}
                type="button"
                className="home-card"
                onClick={() => handleServiceClick(label)}
              >
                <div className="home-card-icon">
                  <Icon size={24} />
                </div>
                <span className="home-card-label">{t(key)}</span>
              </button>
            ))}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFilePicked("photo")}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={handleFilePicked("video")}
          />
        </section>

        <QuotaPanel />



        {/* Premium Leaderboard */}
        <section className="home-section" aria-label="Premium Leaderboard">
          <div className="home-section-head">
            <h3 className="home-section-title">{t("home.leaderboard")}</h3>
            <Link to="/leaderboard" search={{ tab: leaderTab }} className="home-section-link">{t("common.seeAll")}</Link>
          </div>

          <div className="lb-tabs" role="tablist">
            {(["Bulanan", "Tahunan", "Mix"] as LeaderTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={leaderTab === t}
                className={`lb-tab ${leaderTab === t ? "lb-tab-active" : ""}`}
                onClick={() => setLeaderTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {leaderboardFull[leaderTab].length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              Belum ada pengguna di kategori ini.
            </p>
          ) : (
            <ul className="lb-list">
              {leaderboardFull[leaderTab].slice(0, 5).map((entry, i) => {
                const { Icon, cls } = rankMeta[i];
                const initials = getInitials(entry.name);
                return (
                  <li key={`${entry.name}-${i}`} className="lb-row">
                    <div className={`lb-rank ${cls}`}>
                      <Icon size={18} />
                      <span className="lb-rank-num">{i + 1}</span>
                    </div>
                    <div className="lb-avatar" aria-hidden>{initials}</div>
                    <div className="lb-user">
                      <p className="lb-name">{entry.name}</p>
                      <span className="lb-tier">{entry.tier}</span>
                    </div>
                    <span className="lb-score">{entry.mvp} MVP</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Bottom nav */}
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
          <Settings size={22} />
          <span>{t("nav.settings")}</span>
        </Link>
      </nav>

      {/* Face Swap — Coming Soon modal */}
      <Dialog open={faceSwapOpen} onOpenChange={setFaceSwapOpen}>
        <DialogContent className="coming-soon-dialog-content">
          <DialogHeader>
            <DialogTitle className="coming-soon-dialog-title">{t("home.comingSoon")}</DialogTitle>
            <DialogDescription className="coming-soon-dialog-desc">
              {t("home.comingSoonBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="coming-soon-dialog-btn"
              onClick={() => setFaceSwapOpen(false)}
            >
              {t("common.gotIt")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notifications bottom sheet */}
      <Drawer open={notifOpen} onOpenChange={setNotifOpen}>
        <DrawerContent className="notif-sheet">
          <DrawerHeader className="notif-sheet-header">
            <DrawerTitle className="notif-sheet-title">{t("home.notifications")}</DrawerTitle>
            <DrawerDescription className="notif-sheet-sub">
              {t("home.notifSub")}
            </DrawerDescription>
          </DrawerHeader>
          <ul className="notif-list">
            {notifications.map(({ id, Icon, title, body, time, tone }) => (
              <li key={id} className="notif-item">
                <div className={`notif-icon notif-icon-${tone}`}>
                  <Icon size={18} />
                </div>
                <div className="notif-text">
                  <p className="notif-title">{title}</p>
                  <p className="notif-body">{body}</p>
                </div>
                <span className="notif-time">{time}</span>
              </li>
            ))}
          </ul>
          <div className="notif-sheet-foot" />
        </DrawerContent>
      </Drawer>

      {/* Premium notification modal */}
      <PremiumModal
        open={premiumOpen}
        onOpenChange={setPremiumOpen}
        onUnderstand={() => setTimeout(() => setSubOpen(true), 250)}
      />

      {/* Subscription plans modal */}
      <SubscriptionModal open={subOpen} onOpenChange={setSubOpen} />
    </main>
  );
}
