import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.humeto.tasks",
  appName: "Humeto",
  webDir: "dist",
  server: { androidScheme: "https" },
  ios: { contentInset: "automatic", backgroundColor: "#f7f8f2" },
  android: { backgroundColor: "#f7f8f2", allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_humeto", iconColor: "#234c3b" },
  },
};
export default config;
