const GIST_ID = process.env.GIST_ID;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tablero-fliipa",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || "gist get failed");
    err.status = res.status;
    throw err;
  }
  const gist = await res.json();
  const file = gist.files && (gist.files["board.json"] || Object.values(gist.files)[0]);
  if (!file || !file.content) return {};
  try {
    const parsed = JSON.parse(file.content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function writeGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tablero-fliipa",
    },
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

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
      const data = await readGist();
      json(res, 200, data);
      return;
    }

    if (req.method === "PUT") {
      const incoming = await readBody(req);
      const current = await readGist();
      const merged = { ...current, ...incoming, _updatedAt: Date.now() };
      await writeGist(merged);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 405, { error: "Método no permitido" });
  } catch (e) {
    json(res, e.status || 500, { error: e.message || "Error del tablero" });
  }
}
