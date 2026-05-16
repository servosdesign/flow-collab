import vue from "@vitejs/plugin-vue";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      events: require.resolve("events/"),
      util: require.resolve("util/")
    }
  },
  server: {
    port: 5173
  }
});
