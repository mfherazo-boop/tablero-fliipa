function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
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

function normalizeBase(url) {
  const raw = String(url || "https://api.plane.so").trim().replace(/\/+$/, "");
  if (/^https?:\/\/app\.plane\.so$/i.test(raw)) return "https://api.plane.so";
  return raw || "https://api.plane.so";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }

  try {
    const incoming = await readBody(req);
    const apiKey = String(incoming.apiKey || "").trim();
    const path = String(incoming.path || "");
    const method = String(incoming.method || "GET").toUpperCase();
    if (!apiKey || !path.startsWith("/")) {
      json(res, 400, { error: "Faltan apiKey o path" });
      return;
    }
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      json(res, 400, { error: "Método de Plane no permitido" });
      return;
    }

    const target = `${normalizeBase(incoming.baseUrl)}/api/v1${path}`;
    const proxied = await fetch(target, {
      method,
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
        ...(incoming.body ? { "Content-Type": "application/json" } : {}),
      },
      body: incoming.body ? JSON.stringify(incoming.body) : undefined,
    });
    if (proxied.status === 204 || proxied.status === 205) {
      json(res, 200, { ok: true });
      return;
    }
    const text = await proxied.text();
    res.statusCode = proxied.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.end(text || "{}");
  } catch (e) {
    json(res, 500, { error: e.message || "No se pudo hablar con Plane" });
  }
}
