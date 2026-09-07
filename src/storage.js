const API = `${import.meta.env.BASE_URL || "/"}api/board`.replace(/\/{2,}/g, "/");
const BOX = "https://extendsclass.com/api/json-storage/bin";
const KV_APP = "x0as3in0";
const KV_KEY = "fliipa-board";
const KV = "https://keyvalue.immanuel.co/api/KeyVal";

let cache = {};
let writeQueue = Promise.resolve();
let mode = null; // "api" | "shared"

function parsePointer(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : trimmed.replace(/^"|"$/g, "");
  } catch (e) {
    return trimmed.replace(/^"|"$/g, "");
  }
}

async function probeApi() {
  try {
    const res = await fetch(API, { headers: { Accept: "application/json" } });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    return res.ok && type.includes("application/json");
  } catch (e) {
    return false;
  }
}

async function readPointer() {
  const res = await fetch(`${KV}/GetValue/${KV_APP}/${KV_KEY}?t=${Date.now()}`);
  if (!res.ok) throw new Error("No se pudo ubicar el tablero compartido");
  return parsePointer(await res.text());
}

async function writePointer(id) {
  const res = await fetch(`${KV}/UpdateValue/${KV_APP}/${KV_KEY}/${encodeURIComponent(id)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("No se pudo publicar el tablero compartido");
}

async function readBox(id) {
  const res = await fetch(`${BOX}/${id}?t=${Date.now()}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("No se pudo leer el tablero compartido");
  const data = await res.json();
  return data && typeof data === "object" ? data : {};
}

async function writeBox(data) {
  const res = await fetch(BOX, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("No se pudo guardar el tablero compartido");
  const out = await res.json();
  if (!out || !out.id) throw new Error("El guardado no devolvió un id");
  return out.id;
}

async function ensureMode() {
  if (mode) return mode;
  if (await probeApi()) {
    mode = "api";
    return mode;
  }
  mode = "shared";
  return mode;
}

async function fetchBoard() {
  await ensureMode();
  if (mode === "api") {
    const res = await fetch(API, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("No se pudo leer el tablero compartido");
    const data = await res.json();
    cache = data && typeof data === "object" ? data : {};
  } else {
    const id = await readPointer();
    cache = id ? await readBox(id) : {};
  }
  try {
    localStorage.setItem("fliipa-kanban:cache", JSON.stringify(cache));
  } catch (e) {
    /* ignore quota */
  }
  return cache;
}

async function putBoard(data) {
  await ensureMode();
  if (mode === "api") {
    const res = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("No se pudo guardar el tablero compartido");
  } else {
    const id = await writeBox(data);
    await writePointer(id);
  }
  cache = data;
  try {
    localStorage.setItem("fliipa-kanban:cache", JSON.stringify(cache));
  } catch (e) {
    /* ignore quota */
  }
  return true;
}

export function installStorage() {
  if (typeof window === "undefined") return;
  if (window.storage && typeof window.storage.get === "function" && typeof window.storage.set === "function") {
    return;
  }

  window.storage = {
    async get(key) {
      try {
        const all = await fetchBoard();
        if (all[key] == null || all[key] === "") return null;
        return { value: typeof all[key] === "string" ? all[key] : JSON.stringify(all[key]) };
      } catch (e) {
        try {
          const raw = localStorage.getItem("fliipa-kanban:cache");
          const all = raw ? JSON.parse(raw) : {};
          if (all[key] == null || all[key] === "") return null;
          return { value: typeof all[key] === "string" ? all[key] : JSON.stringify(all[key]) };
        } catch (err) {
          throw e;
        }
      }
    },
    async set(key, value) {
      writeQueue = writeQueue.then(async () => {
        let all = {};
        try {
          all = await fetchBoard();
        } catch (e) {
          all = { ...cache };
        }
        all[key] = value;
        all._updatedAt = Date.now();
        return putBoard(all);
      });
      return writeQueue;
    },
  };
}
