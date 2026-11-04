import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: "./",
  // ffmpeg.wasm spawns its own module worker and must not be pre-bundled.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  worker: { format: "es" },
  build: { target: "es2022" },
});
