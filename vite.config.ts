import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: "web",
  server:{fs:{strict:true,allow:[path.resolve("web"),path.resolve("node_modules")],deny:["**/.data/**","**/.env*"]}},
  plugins: [react(), tailwindcss()],
  build: { outDir: "../build", emptyOutDir: true },
});
