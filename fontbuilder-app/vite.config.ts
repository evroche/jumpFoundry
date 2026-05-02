import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        fontPreview: fileURLToPath(new URL("./font-preview.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
  },
});
