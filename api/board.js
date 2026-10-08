import { createHash } from "node:crypto";

const GIST_ID = process.env.GIST_ID;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

// El gist completo vive en memoria de la instancia solo para revalidar contra
// GitHub. La respuesta al navegador no incluye los adjuntos (claves file:*).
let gistMemo = { tag: "", data: null };

export function resetBoardCache() {
  gistMemo = { tag: "", data: null };
}

export function publicBoard(data) {
  const out = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const key of Object.keys(data)) {
    if (key.startsWith("file:")) continue;
    out[key] = data[key];
  }
  return out;
}

export function boardEtag(body) {
  return `"${createHash("sha1").update(body).digest("hex")}"`;
}

export function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const expected = String(etag).trim();
  return String(header)
    .split(",")
    .some((part) => part.trim() === expected);
}

function header(req, name) {
  const headers = req.headers || {};
  const value = headers[name] || headers[String(name).toLowerCase()];
  if (value == null || value === "") return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function queryOf(req) {
  const fromQuery = req.query && typeof req.query === "object" ? req.query : null;
  if (fromQuery && (fromQuery.probe != null || fromQuery.file != null)) return fromQuery;
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if ([...url.searchParams.keys()].length) return Object.fromEntries(url.searchParams.entries());
  } catch (e) {
    /* sigue con req.query */
  }
  return fromQuery || {};
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, If-None-Match");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
}

function json(res, status, body, extraHeaders) {
  applyCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

function gistHeaders(extra) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tablero-fliipa",
    ...(extra || {}),
  };
}

async function readGist() {
  const headers = gistHeaders();
  if (gistMemo.tag && gistMemo.data) headers["If-None-Match"] = gistMemo.tag;
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers });
  if (res.status === 304 && gistMemo.data) return gistMemo.data;
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || "gist get failed");
    err.status = res.status;
    throw err;
  }
  const gist = await res.json();
  const file = gist.files && (gist.files["board.json"] || Object.values(gist.files)[0]);
  let data = {};
  if (file && file.content) {
    try {
      const parsed = JSON.parse(file.content);
      data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      data = {};
    }
  }
  gistMemo = { tag: res.headers.get("etag") || "", data };
  return data;
}

async function writeGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: "PATCH",
    headers: gistHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      files: {
        "board.json": {
          content: JSON.stringify(data),
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || "gist put failed");
    err.status = res.status;
    throw err;
  }
  gistMemo = { tag: "", data: null };
  return true;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string" && req.body) {
    return Promise.resolve(JSON.parse(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!GIST_ID || !TOKEN) {
    json(res, 500, { error: "Falta configuración del tablero compartido" });
    return;
  }

  try {
    if (req.method === "GET") {
      const query = queryOf(req);
      if (query.probe != null && String(query.probe) !== "0") {
        json(res, 200, { ok: true });
        return;
      }

      const data = await readGist();
      if (query.file) {
        const id = String(query.file);
        const file = data[`file:${id}`];
        if (!file || typeof file !== "object") {
          json(res, 404, { error: "No se encontró el archivo" });
          return;
        }
        // El id del adjunto no se reutiliza: se puede guardar en el navegador.
        json(res, 200, file, { "Cache-Control": "private, max-age=86400" });
        return;
      }

      const body = JSON.stringify(publicBoard(data));
      const etag = boardEtag(body);
      applyCors(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("ETag", etag);
      if (etagMatches(header(req, "if-none-match"), etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end(body);
      return;
    }

    if (req.method === "PUT") {
      const incoming = await readBody(req);
      const current = await readGist();
      const merged = {
        ...(current && typeof current === "object" ? current : {}),
        ...(incoming && typeof incoming === "object" ? incoming : {}),
        _updatedAt: Date.now(),
      };
      await writeGist(merged);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 405, { error: "Método no permitido" });
  } catch (e) {
    json(res, e.status || 500, { error: e.message || "Error del tablero" });
  }
}
