import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { version } from "./package.json"
import manifest from "./src/renderer/public/manifest.json"

if (manifest.version !== version) {
  throw new Error("Resume Builder package.json and manifest.json versions must match.")
}

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
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "app-version",
      transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", version),
    },
  ],
  build: {
    outDir: resolve("dist-web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("src/renderer/index.html"),
    },
  },
})
