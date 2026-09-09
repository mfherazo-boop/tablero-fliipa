function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeBase(url) {
  const raw = String(url || "https://api.plane.so").trim().replace(/\/+$/, "");
  if (/^https?:\/\/app\.plane\.so$/i.test(raw)) return "https://api.plane.so";
  return raw || "https://api.plane.so";
}

function isAllowedPlaneBase(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)plane\.so$/i.test(parsed.hostname);
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json(405, { error: "Método no permitido" });
    }

    try {
      const incoming = await request.json();
      const apiKey = String(incoming.apiKey || "").trim();
      const path = String(incoming.path || "");
      const method = String(incoming.method || "GET").toUpperCase();
      const baseUrl = normalizeBase(incoming.baseUrl);

      if (!apiKey || !path.startsWith("/")) {
        return json(400, { error: "Faltan apiKey o path" });
      }
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        return json(400, { error: "Método de Plane no permitido" });
      }
      if (!isAllowedPlaneBase(baseUrl)) {
        return json(400, { error: "URL de Plane no permitida" });
      }

      const target = `${baseUrl}/api/v1${path}`;
      const proxied = await fetch(target, {
        method,
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
          ...(incoming.body ? { "Content-Type": "application/json" } : {}),
        },
        body: incoming.body ? JSON.stringify(incoming.body) : undefined,
      });
      const text = await proxied.text();
      return new Response(text || "{}", {
        status: proxied.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return json(500, { error: e.message || "No se pudo hablar con Plane" });
    }
  },
};
