import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.matcha_vanilla_master.twa",
  appName: "MVMaster X",
  webDir: "dist/client",
  android: {
    allowMixedContent: false,
  },
};

export default config;
