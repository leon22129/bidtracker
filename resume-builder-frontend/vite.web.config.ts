import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { version } from "./package.json"

export default defineConfig({
  root: resolve("src/renderer"),
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": resolve("src/renderer/src"),
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve("dist-web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("src/renderer/index.html"),
    },
  },
})
