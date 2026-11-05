import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT ?? "3001";
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

function pdfjsAssets(): Plugin {
  const cmaps = path.resolve(__dirname, "../node_modules/pdfjs-dist/cmaps");
  const fonts = path.resolve(__dirname, "../node_modules/pdfjs-dist/standard_fonts");
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const raw = req.url?.split("?")[0] ?? "";
    const prefix = raw.startsWith("/pdfjs/cmaps/")
      ? "/pdfjs/cmaps/"
      : raw.startsWith("/pdfjs/standard_fonts/")
        ? "/pdfjs/standard_fonts/"
        : null;
    if (!prefix) return next();
    const root = prefix.includes("cmaps") ? cmaps : fonts;
    const rel = decodeURIComponent(raw.slice(prefix.length));
    if (!rel || rel.includes("..") || rel.includes("\0")) return next();
    const file = path.resolve(root, rel);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return next();
    }
    res.setHeader("Content-Type", "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    closeBundle() {
      const out = path.resolve(__dirname, "dist/pdfjs");
      fs.cpSync(cmaps, path.join(out, "cmaps"), { recursive: true });
      fs.cpSync(fonts, path.join(out, "standard_fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  resolve: {
    alias: {
      "@progress-island/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  optimizeDeps: {
    exclude: ["common-math"],
  },
});
