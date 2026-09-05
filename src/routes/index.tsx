import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import splashAsset from "@/assets/splash.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MVMaster X — AI Photo & Video Upscaling" },
      {
        name: "description",
        content:
          "MVMaster X — enhance photos and upscale videos with AI, powered by Gemini AI & Fal.AI.",
      },
      { property: "og:title", content: "MVMaster X — AI Photo & Video Upscaling" },
      {
        property: "og:description",
        content:
          "MVMaster X — enhance photos and upscale videos with AI, powered by Gemini AI & Fal.AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SplashScreen,
});

function SplashScreen() {
  const navigate = useNavigate();
  const { session, loading } = useSupabaseSession();

  // Safety net: never freeze on the splash screen while the session resolves.
  useEffect(() => {
    const safety = setTimeout(() => {
      navigate({ to: session ? "/home" : "/auth", replace: true });
    }, 3000);
    return () => clearTimeout(safety);
  }, [navigate, session]);

  useEffect(() => {
    if (loading) return;
    if (session) {
      navigate({ to: "/home", replace: true });
      return;
    }
    const t = setTimeout(() => navigate({ to: "/auth", replace: true }), 2600);
    return () => clearTimeout(t);
  }, [loading, navigate, session]);

  return (
    <main className="splash-root splash-fade-in">
      <img
        src={splashAsset.url}
        alt="MVMaster X — powered by Gemini AI & Fal.AI"
        className="splash-image"
      />
    </main>
  );
}
