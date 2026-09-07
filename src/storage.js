const API = `${import.meta.env.BASE_URL || "/"}api/board`.replace(/\/{2,}/g, "/");
const BLOB_API = "https://jsonblob.com/api/jsonBlob";
const BOARD_QUERY = "board";
const BOARD_ID_KEY = "fliipa-kanban:board-id";

let cache = {};
let writeQueue = Promise.resolve();
let mode = null; // "api" | "blob"
let boardId = null;

function currentUrl() {
  return new URL(window.location.href);
}

function readBoardIdFromUrl() {
  try {
    return currentUrl().searchParams.get(BOARD_QUERY);
  } catch (e) {
    return null;
  }
}

function persistBoardId(id) {
  boardId = id;
  try {
    localStorage.setItem(BOARD_ID_KEY, id);
  } catch (e) {
    /* ignore */
  }
  try {
    const url = currentUrl();
    if (url.searchParams.get(BOARD_QUERY) !== id) {
      url.searchParams.set(BOARD_QUERY, id);
      window.history.replaceState(null, "", url.toString());
    }
  } catch (e) {
    /* ignore */
  }
}

async function readPublishedBoardId() {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}board-id.txt`, { cache: "no-store" });
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  return text && text !== "pending" ? text : null;
}

async function probeApi() {
  try {
    const res = await fetch(API, { headers: { Accept: "application/json" } });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function createBlob() {
  const res = await fetch(BLOB_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error("No se pudo crear el tablero compartido");
  const fromHeader = res.headers.get("x-jsonblob");
  const location = res.headers.get("location") || "";
  const id = fromHeader || location.split("/").filter(Boolean).pop();
  if (!id) throw new Error("No se recibió el id del tablero");
  return id;
}

async function ensureMode() {
  if (mode) return mode;
  if (await probeApi()) {
    mode = "api";
    return mode;
  }
  const fromUrl = readBoardIdFromUrl();
  const fromStorage = (() => {
    try {
      return localStorage.getItem(BOARD_ID_KEY);
    } catch (e) {
      return null;
    }
  })();
  const fromSite = await readPublishedBoardId().catch(() => null);
  const id = fromUrl || fromStorage || fromSite || (await createBlob());
  persistBoardId(id);
  mode = "blob";
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
    const res = await fetch(`${BLOB_API}/${boardId}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("No se pudo leer el tablero compartido");
    const data = await res.json();
    cache = data && typeof data === "object" ? data : {};
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
    const res = await fetch(`${BLOB_API}/${boardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("No se pudo guardar el tablero compartido");
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
