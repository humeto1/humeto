import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const target = process.env.HUMETO_MOBILE_DEV_API || "http://127.0.0.1:4173";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (req) => req.setHeader("Origin", target));
        },
        cookieDomainRewrite: "",
      },
    },
  },
});
