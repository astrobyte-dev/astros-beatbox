import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "studio",
  base: "/studio/",
  plugins: [react()],
  build: { outDir: "../studio-dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: Object.fromEntries(
      ["/state", "/cmd", "/clock", "/projects", "/sounds", "/recordings"].map((p) => [
        p,
        "http://127.0.0.1:" + (process.env.TIDAL_DASH_PORT || "3737"),
      ]),
    ),
  },
});
