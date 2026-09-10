export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MVMaster X — Matcha Vanilla Production" },
      {
        name: "description",
        content: "MVMaster X by Matcha Vanilla Production for premium AI creative tools.",
      },
      { name: "author", content: "Matcha Vanilla Production" },
      { property: "og:title", content: "MVMaster X — Matcha Vanilla Production" },
      {
        property: "og:description",
        content: "Premium AI creative tools for photo enhancement, video upscale, and more.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
    scripts: [
      {
        src: "https://cdn.jsdelivr.net/npm/eruda",
      },
      {
        children: "window.addEventListener('load', function() { if (window.eruda) { eruda.init(); } });",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});
