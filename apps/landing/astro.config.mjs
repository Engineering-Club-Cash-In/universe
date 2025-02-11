import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import viteConfig from "./vite.config";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  site: "https://master--kreatif-software.netlify.app",
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [tailwind({ configFile: "./tailwind.config.mjs" })],
  vite: viteConfig,
});
