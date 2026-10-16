import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.API_TARGET_URL || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": apiTarget,
      "/v1": apiTarget,
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": apiTarget,
      "/v1": apiTarget,
    },
  },
});
