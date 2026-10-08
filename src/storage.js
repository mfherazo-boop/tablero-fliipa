const API = `${import.meta.env.BASE_URL || "/"}api/board`.replace(/\/{2,}/g, "/");
const BOX = "https://extendsclass.com/api/json-storage/bin";
const KV_APP = "x0as3in0";
const KV_KEY = "fliipa-board";
const KV = "https://keyvalue.immanuel.co/api/KeyVal";

let cache = {};
let writeQueue = Promise.resolve();
let mode = null; // "api" | "shared" | "local"
const fileCache = {};
let boardEtag = "";
let fetchedAt = 0;
let cacheStamp = 0;
let inflight = null;
// Una lectura del tablero alimenta las 6 claves que pide cada sincronización.
const BOARD_FRESH_MS = 1200;

function withoutFiles(data) {
  const out = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const key of Object.keys(data)) {
    if (key.startsWith("file:")) continue;
    out[key] = data[key];
  }
  return out;
}

function invalidateBoardCache() {
  cacheStamp += 1;
  boardEtag = "";
  fetchedAt = 0;
}

function shouldUseLocalFallback() {
  if (typeof window === "undefined") return false;
  const host = window.location && window.location.hostname ? window.location.hostname : "";
  return /github\.io|localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.\d+\.\d+/.test(host);
}

function readLocalSnapshot() {
  try {
    const raw = localStorage.getItem("fliipa-kanban:cache");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveLocalSnapshot(data) {
  try {
    localStorage.setItem("fliipa-kanban:cache", JSON.stringify(withoutFiles(data)));
  } catch (e) {
    /* ignore quota */
  }
}

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
    const res = await fetch(`${API}?probe=1`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !type.includes("application/json")) return false;
    const data = await res.json();
    return !!data && typeof data === "object" && !Array.isArray(data);
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

let modePromise = null;

async function ensureMode() {
  if (mode) return mode;
  if (!modePromise) {
    modePromise = (async () => {
      if (await probeApi()) mode = "api";
      else mode = "shared";
      return mode;
    })().catch((error) => {
      modePromise = null;
      throw error;
    });
  }
  return modePromise;
}

async function fetchBoardFromApi() {
  const stamp = cacheStamp;
  const headers = { Accept: "application/json" };
  if (boardEtag) headers["If-None-Match"] = boardEtag;
  const res = await fetch(API, { headers, cache: "no-store" });
  if (stamp !== cacheStamp) return cache;
  if (res.status === 304) {
    fetchedAt = Date.now();
    return cache;
  }
  if (!res.ok) throw new Error("No se pudo leer el tablero compartido");
  const nextEtag = res.headers.get("etag");
  if (nextEtag) boardEtag = nextEtag;
  const data = await res.json();
  if (stamp !== cacheStamp) return cache;
  cache = data && typeof data === "object" ? data : {};
  fetchedAt = Date.now();
  saveLocalSnapshot(cache);
  return cache;
}

async function loadBoard() {
  const stamp = cacheStamp;
  try {
    if (mode === "api") return await fetchBoardFromApi();
    const id = await readPointer();
    const data = id ? await readBox(id) : {};
    if (stamp !== cacheStamp) return cache;
    cache = data;
    fetchedAt = Date.now();
    saveLocalSnapshot(cache);
    return cache;
  } catch (e) {
    if (shouldUseLocalFallback()) {
      if (stamp !== cacheStamp) return cache;
      cache = readLocalSnapshot();
      mode = "local";
      fetchedAt = Date.now();
      return cache;
    }
    throw e;
  }
}

async function fetchBoard() {
  await ensureMode();
  if (mode === "local") return cache;
  if (inflight) return inflight;
  if (Date.now() - fetchedAt < BOARD_FRESH_MS) return cache;
  inflight = loadBoard().finally(() => {
    inflight = null;
  });
  return inflight;
}

function fileFromResponse(data, id) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const nested = data[`file:${id}`];
  if (nested && typeof nested === "object" && nested.data) return nested;
  if (data.data && (data.name || data.type)) return data;
  return null;
}

async function putBoard(data) {
  await ensureMode();
  try {
    if (mode === "api") {
      invalidateBoardCache();
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("No se pudo guardar el tablero compartido");
    } else if (mode !== "local") {
      const id = await writeBox(data);
      await writePointer(id);
    }
  } catch (e) {
    if (shouldUseLocalFallback()) {
      mode = "local";
      cache = data;
      saveLocalSnapshot(data);
      return true;
    }
    throw e;
  }
  cache = data;
  fetchedAt = Date.now();
  cacheStamp += 1;
  saveLocalSnapshot(cache);
  return true;
}

async function putFile(payload) {
  await ensureMode();
  if (mode === "api") {
    const id = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    writeQueue = writeQueue.then(async () => {
      let all = {};
      try {
        all = await fetchBoard();
      } catch (e) {
        all = { ...cache };
      }
      all = withoutFiles(all);
      all[`file:${id}`] = payload;
      all._updatedAt = Date.now();
      return putBoard(all);
    });
    await writeQueue;
    fileCache[id] = payload;
    return id;
  }
  const id = await writeBox(payload);
  fileCache[id] = payload;
  return id;
}

async function getFile(id) {
  if (!id) return null;
  if (fileCache[id]) return fileCache[id];
  await ensureMode();
  if (mode !== "api") {
    const payload = await readBox(id);
    if (payload) fileCache[id] = payload;
    return payload;
  }
  try {
    const res = await fetch(`${API}?file=${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (type.includes("application/json")) {
        const payload = fileFromResponse(await res.json(), id);
        if (payload) {
          fileCache[id] = payload;
          return payload;
        }
      }
    }
  } catch (e) {
    /* el tablero local antiguo mete el adjunto dentro del JSON completo */
  }
  const fromBoard = (await fetchBoard())[`file:${id}`] || null;
  if (fromBoard) fileCache[id] = fromBoard;
  return fromBoard;
}

export function installStorage() {
  if (typeof window === "undefined") return;
  if (window.storage && typeof window.storage.get === "function" && typeof window.storage.set === "function") {
    if (typeof window.storage.putFile !== "function") window.storage.putFile = putFile;
    if (typeof window.storage.getFile !== "function") window.storage.getFile = getFile;
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
          all = withoutFiles(await fetchBoard());
        } catch (e) {
          all = withoutFiles({ ...readLocalSnapshot(), ...cache });
        }
        all[key] = value;
        all._updatedAt = Date.now();
        try {
          return await putBoard(all);
        } catch (e) {
          if (shouldUseLocalFallback()) {
            mode = "local";
            cache = all;
            saveLocalSnapshot(all);
            return true;
          }
          throw e;
        }
      });
      return writeQueue;
    },
    putFile,
    getFile,
  };
}
