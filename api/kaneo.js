// Puente server-side hacia la API de Kaneo, igual de necesario que el que usa Plane:
// el navegador no puede hablar directo con orbit.sumz.co por CORS, pero un serverless
// function de este mismo dominio sí puede (es una llamada de servidor a servidor).

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
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

  let payload;
  try {
    payload = await readBody(req);
  } catch (e) {
    json(res, 400, { error: "Cuerpo inválido" });
    return;
  }

  const { baseUrl, apiKey, path, method, body } = payload || {};
  if (!baseUrl || !apiKey || !path) {
    json(res, 400, { error: "Faltan baseUrl, apiKey o path" });
    return;
  }

  try {
    const target = `${String(baseUrl).replace(/\/+$/, "")}/api${path}`;
    const upstream = await fetch(target, {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(text || "{}");
  } catch (e) {
    json(res, 502, { error: e.message || "No se pudo hablar con Kaneo" });
  }
}
