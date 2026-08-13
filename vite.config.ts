import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const mediaFiles = [
  "2026학년도 6월 2학년 영어 듣기평가.mp3",
  "시험종료송.mp3",
] as const;

function copyRootMedia(): Plugin {
  return {
    name: "copy-root-media-with-original-names",
    writeBundle(options) {
      const outputDirectory = resolve(String(options.dir ?? "dist"));
      mkdirSync(outputDirectory, { recursive: true });
      for (const filename of mediaFiles) {
        copyFileSync(resolve(filename), resolve(outputDirectory, filename));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyRootMedia()],
});
