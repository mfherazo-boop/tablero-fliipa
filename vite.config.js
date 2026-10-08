import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import planeHandler from "./api/plane.js";

function localBoardApi() {
  const file = path.resolve("data/board.json");
  return {
    name: "local-board-api",
    configureServer(server) {
      server.middlewares.use("/api/board", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        const query = new URLSearchParams((req.url || "").includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        if (req.method === "GET") {
          if (query.has("probe")) {
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
          let data = {};
          try {
            const parsed = JSON.parse(raw || "{}");
            data = parsed && typeof parsed === "object" ? parsed : {};
          } catch (e) {
            data = {};
          }
          if (query.get("file")) {
            const payload = data[`file:${query.get("file")}`];
            if (!payload) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "No se encontró el archivo" }));
              return;
            }
            res.end(JSON.stringify(payload));
            return;
          }
          res.end(raw || "{}");
          return;
        }
        if (req.method === "PUT") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString("utf8") || "{}";
          let incoming = {};
          try {
            const parsed = JSON.parse(body);
            incoming = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Cuerpo inválido" }));
            return;
          }
          let current = {};
          if (fs.existsSync(file)) {
            try {
              const parsed = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
              current = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (e) {
              current = {};
            }
          }
          // Igual que en Vercel: el cliente ya no reenvía los adjuntos en cada guardado.
          const merged = { ...current, ...incoming, _updatedAt: Date.now() };
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(merged));
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Método no permitido" }));
      });
    },
  };
}

function planeApiProxy() {
  return {
    name: "plane-api-proxy",
    configureServer(server) {
      server.middlewares.use("/api/plane", (req, res) => {
        planeHandler(req, res);
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), localBoardApi(), planeApiProxy()],
});
