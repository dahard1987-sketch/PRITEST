import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const mediaFiles = [
  "2026학년도 6월 2학년 영어 듣기평가.mp3",
  "시험종료송.mp3",
] as const;

function copyRootMedia(): Plugin {
  return {
    name: "prepare-static-deployment",
    writeBundle(options) {
      const outputDirectory = resolve(String(options.dir ?? "dist"));
      mkdirSync(outputDirectory, { recursive: true });
      copyFileSync(resolve("index.html"), resolve(outputDirectory, "index.html"));
      for (const filename of mediaFiles) {
        copyFileSync(resolve(filename), resolve(outputDirectory, filename));
      }

      const builtAssets = resolve(outputDirectory, "assets");
      const rootAssets = resolve("assets");
      rmSync(rootAssets, { recursive: true, force: true });
      cpSync(builtAssets, rootAssets, { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyRootMedia()],
  build: {
    lib: {
      entry: resolve("src/main.ts"),
      name: "EnglishExamClock",
      formats: ["iife"],
      fileName: () => "assets/app.js",
      cssFileName: "app",
    },
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
