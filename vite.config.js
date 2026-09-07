import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

function localBoardApi() {
  const file = path.resolve("data/board.json");
  return {
    name: "local-board-api",
    configureServer(server) {
      server.middlewares.use("/api/board", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.method === "GET") {
          if (!fs.existsSync(file)) {
            res.end("{}");
            return;
          }
          res.end(fs.readFileSync(file, "utf8"));
          return;
        }
        if (req.method === "PUT") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString("utf8") || "{}";
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, body);
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Método no permitido" }));
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), localBoardApi()],
});
