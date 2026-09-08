import { useState, useEffect, useMemo, useRef } from "react";
import PlaneMigrateModal from "./PlaneMigrateModal";

// ---- Design tokens ----
// Two palettes so the dark-mode toggle in the top bar actually re-themes
// the whole board, not just a decorative icon.
function getColors(dark) {
  return dark
    ? {
        bg: "#10131A",
        surface: "#171B24",
        surfaceRaised: "#1E232E",
        border: "#2A303C",
        borderSoft: "#232833",
        text: "#E7E5DF",
        textMuted: "#8B93A3",
        textFaint: "#5C6373",
        accent: "#3F8E8C",
        danger: "#E2574C",
        indigo: "#6D5DFC",
      }
    : {
        bg: "#F7F8FA",
        surface: "#FFFFFF",
        surfaceRaised: "#F1F3F6",
        border: "#E2E5EA",
        borderSoft: "#EAEDF1",
        text: "#1B1F27",
        textMuted: "#5B6472",
        textFaint: "#8A93A3",
        accent: "#2F7A78",
        danger: "#D1453B",
        indigo: "#5B4FE0",
      };
}

const TASK_TYPES = {
  Bug: { color: "#E2574C", label: "Bug" },
  Feature: { color: "#4C9F70", label: "Feature" },
  Task: { color: "#4C7EF3", label: "Tarea" },
  Mejora: { color: "#B48EDE", label: "Mejora" },
};

const COLUMNS = [
  { id: "backlog", label: "Backlog", dot: "#9AA3B2" },
  { id: "todo", label: "Por hacer", dot: "#E7E5DF" },
  { id: "in_progress", label: "En progreso", dot: "#8B7CFF" },
  { id: "review", label: "En revisión", dot: "#B48EDE" },
  { id: "done", label: "Hecho", dot: "#3FA66B" },
];

const ROSTER = ["Mafe", "William", "Alejo", "Aleja", "Fran", "Ivan"];
const AVATAR_COLORS = ["#6D5DFC", "#4C7EF3", "#4C9F70", "#B48EDE", "#E2574C", "#3F8E8C"];

function initiativeColor(ini, index = 0) {
  if (ini && ini.color) return ini.color;
  const seed = String((ini && ini.id) || index);
  let n = 0;
  for (let i = 0; i < seed.length; i++) n += seed.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function idsMatch(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function initiativeColumn(ini) {
  const status = ini && ini.status;
  return COLUMNS.some((c) => c.id === status) ? status : "backlog";
}

function taskStageProgress(status) {
  const idx = COLUMNS.findIndex((c) => c.id === status);
  if (idx < 0) return 0;
  return Math.round((idx / (COLUMNS.length - 1)) * 100);
}

function weightedInitiativeProgress(related, fallback) {
  if (!related || related.length === 0) return Math.max(0, Math.min(100, Number(fallback) || 0));
  const sum = related.reduce((acc, t) => acc + taskStageProgress(t.status), 0);
  return Math.round(sum / related.length);
}

const TASKS_KEY = "fliipa-kanban:tasks";
const THEME_KEY = "fliipa-kanban:theme";
const INITIATIVES_KEY = "fliipa-kanban:initiatives";
const DELETED_TASKS_KEY = "fliipa-kanban:deleted-tasks";
const DELETED_INIT_KEY = "fliipa-kanban:deleted-initiatives";
// Claves antiguas (nombre mal escrito) — se usan solo para migrar datos ya guardados
const TASKS_KEY_LEGACY = "flippa-kanban:tasks";
const THEME_KEY_LEGACY = "flippa-kanban:theme";
const POLL_MS = 4000;

// Reintentos con backoff para tolerar errores transitorios del backend de storage
const SAVE_RETRY_DELAYS_MS = [1000, 3000, 6000, 12000];

async function setWithRetry(key, value, shared) {
  let lastErr = null;
  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await window.storage.set(key, value, shared);
      if (result) return { ok: true };
      lastErr = new Error("Respuesta vacía del storage");
    } catch (e) {
      lastErr = e;
    }
    if (attempt < SAVE_RETRY_DELAYS_MS.length) {
      await new Promise((res) => setTimeout(res, SAVE_RETRY_DELAYS_MS[attempt]));
    }
  }
  return { ok: false, error: lastErr };
}

function itemStamp(item) {
  return (item && (item.updatedAt || item.statusChangedAt || item.createdAt)) || 0;
}

function newerItem(a, b) {
  return itemStamp(a) >= itemStamp(b) ? a : b;
}

function mergeById(existing, incoming) {
  const map = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  return Array.from(map.values());
}

function mergeRecords(local, remote, deleted) {
  const map = new Map();
  (remote || []).forEach((item) => {
    if (item && item.id && !deleted[item.id]) map.set(item.id, item);
  });
  (local || []).forEach((item) => {
    if (!item || !item.id || deleted[item.id]) return;
    const current = map.get(item.id);
    map.set(item.id, current ? newerItem(item, current) : item);
  });
  return Array.from(map.values());
}

function parseList(result) {
  if (!result || result.value == null || result.value === "") return null;
  try {
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function parseDeleted(result) {
  if (!result || result.value == null || result.value === "") return {};
  try {
    const parsed = JSON.parse(result.value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function copyPlainText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      /* sigue al fallback */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

const MAX_ATTACHMENTS = 5;
const MAX_DOC_BYTES = 1.5 * 1024 * 1024;
const ATTACH_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

function isCompressibleImage(type, name) {
  return /image\/(jpeg|jpg|png|webp|gif|bmp)/i.test(type || "") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name || "");
}

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function canvasToJpeg(img, max, quality) {
  let w = img.width;
  let h = img.height;
  if (w > max || h > max) {
    const scale = max / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const data = canvasToJpeg(img, 1280, 0.72);
      const thumb = canvasToJpeg(img, 96, 0.7);
      URL.revokeObjectURL(url);
      resolve({
        name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        type: "image/jpeg",
        size: Math.round((data.length * 3) / 4),
        isImage: true,
        data,
        thumb,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

async function fileToPending(file) {
  if (isCompressibleImage(file.type, file.name)) {
    return compressImage(file);
  }
  if (file.size > MAX_DOC_BYTES) {
    throw new Error(`${file.name} supera 1.5 MB`);
  }
  const data = await readAsDataUrl(file);
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    isImage: /^image\//.test(file.type || ""),
    data,
    thumb: null,
  };
}

async function uploadPending(pending) {
  if (typeof window !== "undefined" && window.storage && typeof window.storage.putFile === "function") {
    const id = await window.storage.putFile({
      name: pending.name,
      type: pending.type,
      data: pending.data,
    });
    return {
      id,
      name: pending.name,
      type: pending.type,
      size: pending.size,
      isImage: pending.isImage,
      thumb: pending.thumb || null,
    };
  }
  return {
    id: "local-" + Date.now() + Math.random().toString(36).slice(2, 6),
    name: pending.name,
    type: pending.type,
    size: pending.size,
    isImage: pending.isImage,
    thumb: pending.thumb || null,
    data: pending.data,
  };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

const seedTasks = () =>
  [
    {
      id: "t1",
      title: "Definir flujo de checkout para vendedores",
      type: "Feature",
      assignee: "Mafe",
      status: "todo",
      createdAt: Date.now() - 86400000 * 3,
      statusChangedAt: Date.now() - 86400000 * 20,
      dueDate: isoDaysAgo(-6),
      blocked: false,
    },
    {
      id: "t2",
      title: "Error al subir imágenes >5MB en listados",
      type: "Bug",
      assignee: "Fran",
      status: "in_progress",
      createdAt: Date.now() - 86400000 * 2,
      statusChangedAt: Date.now() - 86400000 * 1,
      dueDate: isoDaysAgo(2),
      blocked: true,
    },
    {
      id: "t3",
      title: "Migrar autenticación a OpenProject SSO",
      type: "Task",
      assignee: "",
      status: "backlog",
      createdAt: Date.now() - 86400000 * 5,
      statusChangedAt: Date.now() - 86400000 * 15,
      dueDate: null,
      blocked: false,
    },
    {
      id: "t4",
      title: "Optimizar tiempo de carga del panel de métricas",
      type: "Mejora",
      assignee: "Aleja",
      status: "review",
      createdAt: Date.now() - 86400000,
      statusChangedAt: Date.now() - 86400000 * 30,
      dueDate: isoDaysAgo(1),
      blocked: false,
    },
    {
      id: "t5",
      title: "Página de precios no refleja plan anual",
      type: "Bug",
      assignee: "William",
      status: "done",
      createdAt: Date.now() - 86400000 * 6,
      statusChangedAt: Date.now() - 86400000 * 25,
      dueDate: isoDaysAgo(4),
      blocked: false,
    },
    {
      id: "t6",
      title: "Notificaciones por email al cerrar una venta",
      type: "Feature",
      assignee: "Fran",
      status: "todo",
      createdAt: Date.now() - 86400000 * 1.5,
      statusChangedAt: Date.now() - 86400000 * 3,
      dueDate: isoDaysAgo(-4),
      blocked: false,
    },
    {
      id: "t7",
      title: "Preparar dashboard de KPIs para el comité",
      type: "Task",
      assignee: "Ivan",
      status: "backlog",
      createdAt: Date.now() - 86400000 * 4,
      statusChangedAt: Date.now() - 86400000 * 4,
      dueDate: isoDaysAgo(-10),
      blocked: false,
    },
  ].map((task) => ({ ...task, updatedAt: task.statusChangedAt || task.createdAt }));

function initials(name) {
  if (!name) return "—";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function timeAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

function taskNumber(task) {
  const digits = String((task && task.id) || "").replace(/\D/g, "");
  if (digits.length >= 3) return digits.slice(-3);
  let h = 0;
  const seed = String((task && (task.id || task.title)) || "t");
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return String((h % 900) + 100);
}

function idleLabel(task) {
  const ts = (task && (task.updatedAt || task.statusChangedAt || task.createdAt)) || 0;
  if (!ts) return null;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "actualizada hoy";
  if (days === 1) return "1 d sin actualizar";
  return `${days} d sin actualizar`;
}

function recentlyChangedStatus(task) {
  if (!task || !task.statusChangedAt) return false;
  if (task.createdAt && Math.abs(task.statusChangedAt - task.createdAt) < 60000) return false;
  return Date.now() - task.statusChangedAt <= 7 * 86400000;
}

function formatUpdated(ts) {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Bogota",
  });
  return `${datePart}, ${timePart} COT`;
}

export default function KanbanBoard() {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState(null);
  const [assigneeFilter, setAssigneeFilter] = useState("Todos");
  const [initiativeFilter, setInitiativeFilter] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [planeOpen, setPlaneOpen] = useState(false);
  const [initiatives, setInitiatives] = useState([]);
  const [deletedTaskIds, setDeletedTaskIds] = useState({});
  const [deletedInitIds, setDeletedInitIds] = useState({});
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [savingInit, setSavingInit] = useState(false);
  const [initError, setInitError] = useState(null);
  const initSaveTimer = useRef(null);
  const initSaveTokenRef = useRef(0);
  const [draggingId, setDraggingId] = useState(null);
  const [draggingKind, setDraggingKind] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [dark, setDark] = useState(true);
  const [activeTab, setActiveTab] = useState("tablero");
  const saveTimer = useRef(null);
  const saveTokenRef = useRef(0);
  const lastTasksRef = useRef("");
  const lastInitsRef = useRef("");
  const lastDeletedTasksRef = useRef("");
  const lastDeletedInitsRef = useRef("");
  const applyingRemote = useRef(false);

  const C = useMemo(() => getColors(dark), [dark]);

  const hasStorage =
    typeof window !== "undefined" &&
    window.storage &&
    typeof window.storage.get === "function" &&
    typeof window.storage.set === "function";

  async function pullSharedBoard(isInitial) {
    let loadedTasks = parseList(await window.storage.get(TASKS_KEY, true).catch(() => null));
    if (!loadedTasks) {
      try {
        const legacy = parseList(await window.storage.get(TASKS_KEY_LEGACY, true));
        if (legacy && legacy.length > 0) {
          loadedTasks = legacy;
          if (isInitial) setWithRetry(TASKS_KEY, JSON.stringify(legacy), true);
        }
      } catch (e) {
        /* no había datos legacy */
      }
    }
    const loadedInits = parseList(await window.storage.get(INITIATIVES_KEY, true).catch(() => null)) || [];
    const remoteDeletedTasks = parseDeleted(await window.storage.get(DELETED_TASKS_KEY, true).catch(() => null));
    const remoteDeletedInits = parseDeleted(await window.storage.get(DELETED_INIT_KEY, true).catch(() => null));

    if (isInitial) {
      try {
        const localTheme = localStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY_LEGACY);
        if (localTheme) setDark(localTheme === "dark");
      } catch (e) {
        /* keep default */
      }
    }

    return {
      tasks: loadedTasks,
      initiatives: loadedInits,
      deletedTaskIds: remoteDeletedTasks,
      deletedInitIds: remoteDeletedInits,
    };
  }

  // ---- load + sync en vivo ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasStorage) {
        setTasks(seedTasks());
        setInitiatives([]);
        setLoaded(true);
        return;
      }
      try {
        const remote = await pullSharedBoard(true);
        if (cancelled) return;
        const hadRemoteTasks = remote.tasks && remote.tasks.length > 0;
        const initialTasks = hadRemoteTasks ? remote.tasks : seedTasks();
        const initialInits = remote.initiatives || [];
        setDeletedTaskIds(remote.deletedTaskIds);
        setDeletedInitIds(remote.deletedInitIds);
        setTasks(initialTasks.filter((t) => !remote.deletedTaskIds[t.id]));
        setInitiatives(initialInits.filter((i) => !remote.deletedInitIds[i.id]));
        lastTasksRef.current = hadRemoteTasks ? JSON.stringify(initialTasks) : "";
        lastInitsRef.current = JSON.stringify(initialInits);
        lastDeletedTasksRef.current = JSON.stringify(remote.deletedTaskIds);
        lastDeletedInitsRef.current = JSON.stringify(remote.deletedInitIds);
      } catch (e) {
        if (!cancelled) setTasks(seedTasks());
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    async function applyRemote() {
      if (!hasStorage || applyingRemote.current) return;
      try {
        const remote = await pullSharedBoard(false);
        applyingRemote.current = true;
        setDeletedTaskIds((prevDeleted) => {
          const deleted = { ...remote.deletedTaskIds, ...prevDeleted };
          lastDeletedTasksRef.current = JSON.stringify(deleted);
          setTasks((prev) => {
            const pending = JSON.stringify(prev) !== lastTasksRef.current;
            const merged = mergeRecords(prev, remote.tasks, deleted);
            if (!pending) lastTasksRef.current = JSON.stringify(merged);
            return merged;
          });
          return deleted;
        });
        setDeletedInitIds((prevDeleted) => {
          const deleted = { ...remote.deletedInitIds, ...prevDeleted };
          lastDeletedInitsRef.current = JSON.stringify(deleted);
          setInitiatives((prev) => {
            const pending = JSON.stringify(prev) !== lastInitsRef.current;
            const merged = mergeRecords(prev, remote.initiatives, deleted);
            if (!pending) lastInitsRef.current = JSON.stringify(merged);
            return merged;
          });
          return deleted;
        });
      } catch (e) {
        /* el siguiente ciclo reintenta */
      } finally {
        applyingRemote.current = false;
      }
    }

    const poll = setInterval(applyRemote, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") applyRemote();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", applyRemote);
    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", applyRemote);
    };
  }, []);

  // ---- persist tasks (debounced, con reintentos) ----
  useEffect(() => {
    if (!loaded) return;
    if (!hasStorage) {
      setError("no-storage");
      return;
    }
    if (applyingRemote.current) return;
    const snapshot = JSON.stringify(tasks);
    if (snapshot === lastTasksRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const myToken = ++saveTokenRef.current;
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const { ok, error: err } = await setWithRetry(TASKS_KEY, snapshot, true);
      if (myToken !== saveTokenRef.current) return;
      setSaving(false);
      if (!ok) {
        console.error("window.storage.set falló tras reintentos", err);
        setError(
          "No se pudo guardar el tablero (" + (err && err.message ? err.message : "error desconocido") + ")."
        );
      } else {
        lastTasksRef.current = snapshot;
        setError(null);
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [tasks, loaded]);

  useEffect(() => {
    if (!loaded || !hasStorage || applyingRemote.current) return;
    const snapshot = JSON.stringify(deletedTaskIds);
    if (snapshot === lastDeletedTasksRef.current) return;
    lastDeletedTasksRef.current = snapshot;
    setWithRetry(DELETED_TASKS_KEY, snapshot, true);
  }, [deletedTaskIds, loaded]);

  // ---- reintento automático en segundo plano si el guardado de tareas sigue fallando ----
  useEffect(() => {
    if (!error || error === "no-storage") return;
    const t = setTimeout(() => {
      lastTasksRef.current = "";
      setTasks((prev) => [...prev]);
    }, 8000);
    return () => clearTimeout(t);
  }, [error]);

  // ---- persist theme (local, cada persona elige el suyo) ----
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch (e) {
      /* ignore */
    }
  }, [dark, loaded]);

  // ---- persist initiatives (debounced, con reintentos) ----
  useEffect(() => {
    if (!loaded) return;
    if (!hasStorage) {
      setInitError("no-storage");
      return;
    }
    if (applyingRemote.current) return;
    const snapshot = JSON.stringify(initiatives);
    if (snapshot === lastInitsRef.current) return;
    if (initSaveTimer.current) clearTimeout(initSaveTimer.current);
    const myToken = ++initSaveTokenRef.current;
    initSaveTimer.current = setTimeout(async () => {
      setSavingInit(true);
      const { ok, error: err } = await setWithRetry(INITIATIVES_KEY, snapshot, true);
      if (myToken !== initSaveTokenRef.current) return;
      setSavingInit(false);
      if (!ok) {
        console.error("window.storage.set (iniciativas) falló tras reintentos", err);
        setInitError(
          "No se pudieron guardar las iniciativas (" + (err && err.message ? err.message : "error desconocido") + ")."
        );
      } else {
        lastInitsRef.current = snapshot;
        setInitError(null);
      }
    }, 400);
    return () => clearTimeout(initSaveTimer.current);
  }, [initiatives, loaded]);

  useEffect(() => {
    if (!loaded || !hasStorage || applyingRemote.current) return;
    const snapshot = JSON.stringify(deletedInitIds);
    if (snapshot === lastDeletedInitsRef.current) return;
    lastDeletedInitsRef.current = snapshot;
    setWithRetry(DELETED_INIT_KEY, snapshot, true);
  }, [deletedInitIds, loaded]);

  // ---- reintento automático en segundo plano si el guardado de iniciativas sigue fallando ----
  useEffect(() => {
    if (!initError || initError === "no-storage") return;
    const t = setTimeout(() => {
      lastInitsRef.current = "";
      setInitiatives((prev) => [...prev]);
    }, 8000);
    return () => clearTimeout(t);
  }, [initError]);

  function addInitiative({ title, owner, progress }) {
    const now = Date.now();
    setInitiatives((prev) => [
      {
        id: "i" + now,
        title,
        owner,
        progress: Number(progress) || 0,
        color: AVATAR_COLORS[prev.length % AVATAR_COLORS.length],
        status: "backlog",
        createdAt: now,
        updatedAt: now,
      },
      ...prev,
    ]);
    setInitModalOpen(false);
  }

  function deleteInitiative(id) {
    setDeletedInitIds((prev) => ({ ...prev, [id]: Date.now() }));
    setInitiatives((prev) => prev.filter((i) => i.id !== id));
  }

  function adjustInitiativeProgress(id, delta) {
    const now = Date.now();
    setInitiatives((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, progress: Math.max(0, Math.min(100, i.progress + delta)), updatedAt: now } : i
      )
    );
  }

  function retryInitSave() {
    setInitiatives((prev) => [...prev]);
  }

  function applyImportedSnapshot(parsed) {
    if (!parsed || typeof parsed !== "object") throw new Error("Formato inválido");
    if (Array.isArray(parsed.tasks)) setTasks((prev) => mergeById(prev, parsed.tasks));
    if (Array.isArray(parsed.initiatives)) setInitiatives((prev) => mergeById(prev, parsed.initiatives));
    if (parsed.theme === "dark" || parsed.theme === "light") setDark(parsed.theme === "dark");
  }

  function resetToDemoData() {
    setTasks(seedTasks());
  }

  function retrySave() {
    // Fuerza que el efecto de guardado vuelva a correr con el estado actual
    setTasks((prev) => [...prev]);
  }

  const assignees = useMemo(() => {
    const set = new Set([...ROSTER, ...tasks.map((t) => t.assignee).filter(Boolean)]);
    return ["Todos", ...Array.from(set).sort()];
  }, [tasks]);

  const scopedTasks = useMemo(() => {
    if (!initiativeFilter) return tasks;
    return tasks.filter((t) => idsMatch(t.initiativeId, initiativeFilter));
  }, [tasks, initiativeFilter]);

  const filtered = useMemo(() => {
    return scopedTasks.filter(
      (t) =>
        (!typeFilter || t.type === typeFilter) &&
        (assigneeFilter === "Todos" || t.assignee === assigneeFilter)
    );
  }, [scopedTasks, typeFilter, assigneeFilter]);

  const initiativeStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return initiatives.map((ini, index) => {
      const related = tasks.filter((t) => idsMatch(t.initiativeId, ini.id));
      const done = related.filter((t) => t.status === "done").length;
      return {
        ...ini,
        color: initiativeColor(ini, index),
        taskCount: related.length,
        vencidas: related.filter((t) => t.dueDate && t.dueDate < today && t.status !== "done").length,
        sinAsignar: related.filter((t) => !t.assignee).length,
        closed: done,
        progress: weightedInitiativeProgress(related, ini.progress),
      };
    });
  }, [initiatives, tasks]);

  function moveTask(id, status) {
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id && t.status !== status
          ? { ...t, status, statusChangedAt: now, updatedAt: now }
          : t
      )
    );
  }

  function dropOnColumn(colId) {
    if (!draggingId) return;
    if (draggingKind === "initiative") updateInitiative(draggingId, { status: colId });
    else moveTask(draggingId, colId);
    setDraggingId(null);
    setDraggingKind(null);
    setDragOverCol(null);
  }

  function moveByOffset(id, offset) {
    const idx = COLUMNS.findIndex((c) => c.id === tasks.find((t) => t.id === id)?.status);
    const next = COLUMNS[idx + offset];
    if (next) moveTask(id, next.id);
  }

  function addTask(task) {
    const now = Date.now();
    setTasks((prev) => [{ ...task, id: "t" + now, createdAt: now, statusChangedAt: now, updatedAt: now }, ...prev]);
    setModalOpen(false);
  }

  function updateInitiative(id, patch) {
    const now = Date.now();
    setInitiatives((prev) => prev.map((i) => (idsMatch(i.id, id) ? { ...i, ...patch, updatedAt: now } : i)));
  }

  function markPlaneItem({ kind, id, planeWorkItemId }) {
    const patch = { planeWorkItemId, planeMigratedAt: Date.now() };
    if (kind === "initiative") updateInitiative(id, patch);
    else updateTask(id, patch);
  }

  function updateTask(id, patch) {
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch, updatedAt: now };
        if (patch.status && patch.status !== t.status) next.statusChangedAt = now;
        return next;
      })
    );
  }

  function deleteTask(id) {
    setDeletedTaskIds((prev) => ({ ...prev, [id]: Date.now() }));
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (openTaskId === id) setOpenTaskId(null);
  }

  function toggleBlocked(id) {
    const now = Date.now();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, blocked: !t.blocked, updatedAt: now } : t)));
  }

  const boardInitiatives = useMemo(() => {
    if (!initiativeFilter) return initiatives;
    return initiatives.filter((ini) => idsMatch(ini.id, initiativeFilter));
  }, [initiatives, initiativeFilter]);

  const selectedInitiative = useMemo(
    () => initiatives.find((i) => idsMatch(i.id, initiativeFilter)) || null,
    [initiatives, initiativeFilter]
  );

  const counts = useMemo(() => {
    const m = {};
    COLUMNS.forEach((c) => {
      const taskN = filtered.filter((t) => t.status === c.id).length;
      const iniN = boardInitiatives.filter((ini) => initiativeColumn(ini) === c.id).length;
      m[c.id] = taskN + iniN;
    });
    return m;
  }, [filtered, boardInitiatives]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDays = 7 * 86400000;
    const list = scopedTasks;
    return {
      total: list.length,
      vencidas: list.filter((t) => t.dueDate && t.dueDate < today && t.status !== "done").length,
      sinAsignar: list.filter((t) => !t.assignee).length,
      bloqueadas: list.filter((t) => t.blocked).length,
      cambioEstado: list.filter(
        (t) => t.statusChangedAt && Date.now() - t.statusChangedAt <= sevenDays
      ).length,
    };
  }, [scopedTasks]);

  const lastUpdated = useMemo(() => {
    const latest = tasks.reduce(
      (max, t) => Math.max(max, t.statusChangedAt || 0, t.createdAt || 0),
      0
    );
    return formatUpdated(latest || Date.now());
  }, [tasks]);

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: C.bg,
        color: C.text,
        minHeight: "100vh",
        width: "100%",
        boxSizing: "border-box",
        transition: "background 150ms ease, color 150ms ease",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid ${C.accent};
          outline-offset: 2px;
        }
        @keyframes fliipaDrawerIn {
          from { transform: translateX(24px); opacity: 0.4; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      `}</style>

      <TopBar
        C={C}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lastUpdated={lastUpdated}
        syncStatus={saving ? "saving" : !error ? "ok" : error === "no-storage" ? "local" : "error"}
        onOpenExport={() => setExportOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        onOpenPlane={() => setPlaneOpen(true)}
      />

      <div style={{ padding: "22px 20px 40px" }}>
        {activeTab === "iniciativas" ? (
          <InitiativesView
            C={C}
            initiatives={initiativeStats}
            saving={savingInit}
            error={initError}
            dark={dark}
            onRetry={retryInitSave}
            onOpenNew={() => setInitModalOpen(true)}
            onDelete={deleteInitiative}
            onAdjustProgress={adjustInitiativeProgress}
            onOpenBoard={(id) => {
              setInitiativeFilter(id);
              setActiveTab("tablero");
            }}
          />
        ) : (
          <>
            {/* Métricas */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
              <StatCard
                C={C}
                label={
                  selectedInitiative
                    ? `Tareas · ${selectedInitiative.title}`
                    : "Tareas"
                }
                value={stats.total}
                caption={selectedInitiative ? "en la iniciativa" : "en total"}
              />
              <StatCard C={C} label="Vencidas" value={stats.vencidas} caption="en total" color={C.danger} />
              <StatCard C={C} label="Sin asignar" value={stats.sinAsignar} caption="en total" />
              <StatCard C={C} label="Bloqueadas" value={stats.bloqueadas} caption="en total" color={C.textFaint} />
              <StatCard
                C={C}
                label="Cambio de estado · 7 días"
                value={stats.cambioEstado}
                caption="en total"
                color={C.indigo}
              />
            </div>

            {initiatives.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textFaint, marginBottom: 8 }}>
                  Iniciativa
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <FilterChip
                    C={C}
                    active={!initiativeFilter}
                    label={`Todas (${tasks.length})`}
                    onClick={() => setInitiativeFilter(null)}
                  />
                  {initiativeStats.map((ini) => (
                    <FilterChip
                      key={ini.id}
                      C={C}
                      active={idsMatch(initiativeFilter, ini.id)}
                      label={`${ini.title} ${ini.taskCount}`}
                      dotColor={ini.color}
                      onClick={() => setInitiativeFilter(idsMatch(initiativeFilter, ini.id) ? null : ini.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedInitiative && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 14,
                  padding: "12px 14px",
                  background: C.surface,
                  border: `1px solid ${C.borderSoft}`,
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: initiativeColor(selectedInitiative),
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{selectedInitiative.title}</div>
                    <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
                      Tablero de esta iniciativa
                      {selectedInitiative.owner ? ` · ${selectedInitiative.owner}` : ""}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setInitiativeFilter(null)}
                  style={{
                    background: "none",
                    border: `1px solid ${C.border}`,
                    color: C.textMuted,
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Ver todas
                </button>
              </div>
            )}

            {selectedInitiative && scopedTasks.length === 0 && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "10px 14px",
                  background: C.surfaceRaised,
                  border: `1px dashed ${C.border}`,
                  borderRadius: 10,
                  color: C.textMuted,
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                Esta iniciativa ya está en el tablero (columna Backlog). Aún no tiene tareas: pulsa{" "}
                <strong style={{ color: C.text }}>Nueva tarea</strong> y se asignará aquí.
              </div>
            )}

            {/* Header de acción */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                flexWrap: "wrap",
                gap: 16,
                marginBottom: 22,
              }}
            >
              <div style={{ color: C.textMuted, fontSize: 13.5, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>
                  {filtered.length} tarea{filtered.length !== 1 ? "s" : ""} visible
                  {filtered.length !== 1 ? "s" : ""}
                  {boardInitiatives.length > 0
                    ? ` · ${boardInitiatives.length} iniciativa${boardInitiatives.length !== 1 ? "s" : ""} en el tablero`
                    : ""}
                  {" · "}el equipo ve el mismo tablero en este link
                </span>
                {tasks.length === 0 && (
                  <button
                    onClick={resetToDemoData}
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      color: C.accent,
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    Restaurar datos de ejemplo
                  </button>
                )}
              </div>
              <button
                onClick={() => setModalOpen(true)}
                style={{
                  background: C.accent,
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Nueva tarea
              </button>
            </div>

            {error && error !== "no-storage" && (
              <div
                style={{
                  background: dark ? "#2A1517" : "#FBEAE8",
                  border: `1px solid ${C.danger}`,
                  color: dark ? "#F3B8B3" : "#8A2A22",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span>{error} Mientras se soluciona, puedes exportar un respaldo para tu equipo.</span>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => setExportOpen(true)}
                    style={{
                      background: "none",
                      border: `1px solid currentColor`,
                      color: "inherit",
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Exportar respaldo
                  </button>
                  <button
                    onClick={retrySave}
                    style={{
                      background: "none",
                      border: `1px solid currentColor`,
                      color: "inherit",
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            )}
            {error === "no-storage" && (
              <div
                style={{
                  background: C.surfaceRaised,
                  border: `1px solid ${C.borderSoft}`,
                  color: C.textMuted,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  marginBottom: 16,
                }}
              >
                Este visor no tiene guardado activado — los cambios que hagas aquí no se guardarán al recargar la página.
              </div>
            )}

            {/* Filtros */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
              <FilterChip C={C} active={typeFilter === null} label="Todos los tipos" onClick={() => setTypeFilter(null)} />
              {Object.entries(TASK_TYPES).map(([key, val]) => (
                <FilterChip
                  key={key}
                  C={C}
                  active={typeFilter === key}
                  label={val.label}
                  dotColor={val.color}
                  onClick={() => setTypeFilter(typeFilter === key ? null : key)}
                />
              ))}
              <div style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 13.5,
                }}
              >
                {assignees.map((a) => (
                  <option key={a} value={a}>
                    {a === "Todos" ? "Todos los responsables" : a}
                  </option>
                ))}
              </select>
            </div>

            {/* Tablero */}
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
              {COLUMNS.map((col, colIdx) => (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverCol(col.id);
                  }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOnColumn(col.id);
                  }}
                  style={{
                    flex: "0 0 286px",
                    background: C.surface,
                    border: `1px solid ${dragOverCol === col.id ? C.accent : C.borderSoft}`,
                    borderRadius: 14,
                    padding: 12,
                    minHeight: 420,
                    transition: "border-color 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 4px 14px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.dot || C.textMuted, display: "inline-block" }} />
                      {col.label}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: C.textFaint,
                        background: C.surfaceRaised,
                        borderRadius: 20,
                        padding: "1px 8px",
                      }}
                    >
                      {counts[col.id]}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {boardInitiatives
                      .filter((ini) => initiativeColumn(ini) === col.id)
                      .map((ini) => (
                        <InitiativeBoardCard
                          key={"ini-" + ini.id}
                          C={C}
                          initiative={ini}
                          taskCount={(initiativeStats.find((s) => idsMatch(s.id, ini.id)) || {}).taskCount || 0}
                          progress={(initiativeStats.find((s) => idsMatch(s.id, ini.id)) || {}).progress || 0}
                          dragging={draggingKind === "initiative" && draggingId === ini.id}
                          onDragStart={() => {
                            setDraggingKind("initiative");
                            setDraggingId(ini.id);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDraggingKind(null);
                          }}
                          onOpen={() => setInitiativeFilter(ini.id)}
                        />
                      ))}
                    {filtered
                      .filter((t) => t.status === col.id)
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          C={C}
                          task={task}
                          selected={openTaskId === task.id}
                          dragging={draggingKind !== "initiative" && draggingId === task.id}
                          onDragStart={() => {
                            setDraggingKind("task");
                            setDraggingId(task.id);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDraggingKind(null);
                          }}
                          onMoveLeft={colIdx > 0 ? () => moveByOffset(task.id, -1) : null}
                          onMoveRight={colIdx < COLUMNS.length - 1 ? () => moveByOffset(task.id, 1) : null}
                          onDelete={() => deleteTask(task.id)}
                          onToggleBlocked={() => toggleBlocked(task.id)}
                          onOpen={() => setOpenTaskId(task.id)}
                          initiative={initiatives.find((i) => idsMatch(i.id, task.initiativeId)) || null}
                        />
                      ))}
                    {counts[col.id] === 0 && (
                      <div style={{ fontSize: 12.5, color: C.textFaint, padding: "10px 4px", textAlign: "center" }}>
                        Sin tarjetas aquí
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <AddTaskModal
          C={C}
          assignees={assignees.filter((a) => a !== "Todos")}
          initiatives={initiatives}
          defaultInitiativeId={initiativeFilter}
          onClose={() => setModalOpen(false)}
          onSave={addTask}
        />
      )}

      {initModalOpen && (
        <AddInitiativeModal
          C={C}
          assignees={ROSTER}
          onClose={() => setInitModalOpen(false)}
          onSave={addInitiative}
        />
      )}

      {exportOpen && (
        <ExportModal
          C={C}
          data={{ tasks, initiatives, theme: dark ? "dark" : "light", exportedAt: Date.now() }}
          onClose={() => setExportOpen(false)}
        />
      )}

      {importOpen && (
        <ImportModal C={C} onClose={() => setImportOpen(false)} onApply={applyImportedSnapshot} />
      )}

      {previewAttachment && (
        <AttachmentPreview C={C} attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}

      {openTaskId && tasks.find((t) => t.id === openTaskId) && (
        <TaskDetailModal
          C={C}
          task={tasks.find((t) => t.id === openTaskId)}
          assignees={assignees.filter((a) => a !== "Todos")}
          initiatives={initiatives}
          onClose={() => setOpenTaskId(null)}
          onSave={(patch) => updateTask(openTaskId, patch)}
          onDelete={() => deleteTask(openTaskId)}
          onOpenAttachment={setPreviewAttachment}
        />
      )}

      {planeOpen && (
        <PlaneMigrateModal
          C={C}
          tasks={tasks}
          initiatives={initiatives}
          onClose={() => setPlaneOpen(false)}
          onItemMigrated={markPlaneItem}
        />
      )}
    </div>
  );
}

async function copyShareLink(title) {
  const url = typeof window !== "undefined" ? window.location.href : "";
  // 1) Intenta el share nativo del sistema operativo (móvil, y algunos navegadores de escritorio)
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      // El usuario canceló el diálogo nativo, o no se pudo compartir: seguimos con copiar
      if (e && e.name === "AbortError") return "cancelled";
    }
  }
  // 2) Portapapeles moderno
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return "copied";
    } catch (e) {
      /* sigue al fallback */
    }
  }
  // 3) Fallback con un textarea oculto + execCommand, para navegadores/iframes que bloquean el portapapeles moderno
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok ? "copied" : "failed";
  } catch (e) {
    return "failed";
  }
}

function TopBar({ C, dark, onToggleDark, activeTab, setActiveTab, lastUpdated, syncStatus, onOpenExport, onOpenImport, onOpenPlane }) {
  const [shareStatus, setShareStatus] = useState(null);
  const shareTimerRef = useRef(null);

  async function handleShare() {
    const result = await copyShareLink("Fliipa: Tablero de tareas");
    if (result === "cancelled") return;
    setShareStatus(result === "shared" ? "shared" : result === "copied" ? "copied" : "failed");
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    shareTimerRef.current = setTimeout(() => setShareStatus(null), 2200);
  }

  const badge =
    syncStatus === "ok"
      ? { label: "Sincronizado", color: "#3FA66B" }
      : syncStatus === "saving"
      ? { label: "Guardando…", color: C.indigo }
      : syncStatus === "local"
      ? { label: "Sin guardado", color: C.textFaint }
      : { label: "Error al guardar", color: C.danger };
  return (
    <div style={{ borderBottom: `1px solid ${C.borderSoft}`, background: C.surface }}>
      {/* Fila 1: breadcrumb + avatares + compartir */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 14 }}>
          <span>Tablero de Fliipa</span>
          <span style={{ fontSize: 11, color: C.textFaint }}>⌄</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex" }}>
            {["Mafe", "Ivan"].map((name, i) => (
              <span
                key={name}
                title={name}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: AVATAR_COLORS[ROSTER.indexOf(name) % AVATAR_COLORS.length],
                  color: "#fff",
                  fontSize: 10.5,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `2px solid ${C.surface}`,
                  marginLeft: i > 0 ? -8 : 0,
                }}
              >
                {initials(name)}
              </span>
            ))}
          </div>
          <button
            onClick={onOpenPlane}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
            }}
            aria-label="Migrar a Plane"
            title="Migrar este tablero a Plane"
          >
            Plane
          </button>
          <button
            onClick={onOpenExport}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              borderRadius: 6,
              width: 28,
              height: 28,
              cursor: "pointer",
              fontSize: 13,
            }}
            aria-label="Exportar respaldo"
            title="Exportar respaldo (para compartir manualmente con el equipo)"
          >
            ⇩
          </button>
          <button
            onClick={onOpenImport}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              borderRadius: 6,
              width: 28,
              height: 28,
              cursor: "pointer",
              fontSize: 13,
            }}
            aria-label="Importar respaldo"
            title="Importar respaldo (pegado desde otro miembro del equipo)"
          >
            ⇧
          </button>
          <button
            onClick={handleShare}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              borderRadius: 6,
              width: 28,
              height: 28,
              cursor: "pointer",
              fontSize: 13,
            }}
            aria-label="Compartir enlace"
            title="Compartir enlace"
          >
            ⛓
          </button>
          <button
            onClick={handleShare}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 6,
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              minWidth: 64,
            }}
          >
            {shareStatus === "copied" ? "¡Copiado!" : shareStatus === "shared" ? "¡Listo!" : shareStatus === "failed" ? "No se pudo" : "Share"}
          </button>
        </div>
      </div>

      {/* Fila 2: título + tabs + estado */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 20px",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700 }}>
              Fliipa: Tablero de tareas
            </span>
            <span style={{ fontSize: 13, color: C.textFaint }}>Equipo de producto</span>
          </div>
          <div style={{ display: "flex", gap: 18, marginLeft: 8 }}>
            {[
              { id: "iniciativas", label: "Iniciativas" },
              { id: "tablero", label: "Tablero" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === tab.id ? C.accent : "transparent"}`,
                  color: activeTab === tab.id ? C.text : C.textMuted,
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  fontSize: 14,
                  padding: "4px 2px",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12.5, color: C.textFaint }}>
            Última actualización <strong style={{ color: C.textMuted }}>{lastUpdated}</strong>
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: badge.color,
              background: syncStatus === "ok" ? (C.bg === "#10131A" ? "#12261C" : "#E8F6EE") : "transparent",
              borderRadius: 20,
              padding: "3px 10px",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: badge.color,
                display: "inline-block",
              }}
            />
            {badge.label}
          </span>
          <button
            onClick={onToggleDark}
            aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            title={dark ? "Modo claro" : "Modo oscuro"}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              borderRadius: 6,
              width: 28,
              height: 28,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {dark ? "☾" : "☀"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InitiativesView({
  C,
  initiatives,
  saving,
  error,
  dark,
  onRetry,
  onOpenNew,
  onDelete,
  onAdjustProgress,
  onOpenBoard,
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Iniciativas estratégicas de Fliipa</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>
            % de avance sube al mover las tareas de columna (Backlog 0% → Por hacer 25% → En progreso 50% → En revisión 75% → Hecho 100%). Clic en una fila abre su tablero.
          </div>
        </div>
        <button
          onClick={onOpenNew}
          style={{
            background: C.accent,
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Nueva iniciativa
        </button>
      </div>

      {saving && <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 10 }}>Guardando…</div>}

      {error && error !== "no-storage" && (
        <div
          style={{
            background: dark ? "#2A1517" : "#FBEAE8",
            border: `1px solid ${C.danger}`,
            color: dark ? "#F3B8B3" : "#8A2A22",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>{error}</span>
          <button
            onClick={onRetry}
            style={{
              background: "none",
              border: `1px solid currentColor`,
              color: "inherit",
              borderRadius: 6,
              padding: "3px 9px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      )}
      {error === "no-storage" && (
        <div
          style={{
            background: C.surfaceRaised,
            border: `1px solid ${C.borderSoft}`,
            color: C.textMuted,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12.5,
            marginBottom: 16,
          }}
        >
          Este visor no tiene guardado activado — las iniciativas no se guardarán al recargar la página.
        </div>
      )}

      {initiatives.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: C.textFaint,
            border: `1px dashed ${C.border}`,
            borderRadius: 10,
            padding: "22px 16px",
            textAlign: "center",
            marginBottom: 26,
          }}
        >
          Aún no tienes iniciativas. Pulsa Nueva iniciativa para crear una.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 26 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 2fr) 140px 70px 80px 90px minmax(140px, 1fr) 28px",
              gap: 10,
              padding: "0 14px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: C.textFaint,
            }}
          >
            <div>Iniciativa</div>
            <div>Responsable</div>
            <div>Tareas</div>
            <div>Vencidas</div>
            <div>Sin asignar</div>
            <div>% de avance</div>
          </div>
          {initiatives.map((ini) => (
            <InitiativeCard
              key={ini.id}
              C={C}
              initiative={ini}
              onDelete={() => onDelete(ini.id)}
              onAdjustProgress={(delta) => onAdjustProgress(ini.id, delta)}
              onOpen={() => onOpenBoard && onOpenBoard(ini.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InitiativeCard({ C, initiative, onDelete, onAdjustProgress, onOpen }) {
  const [hover, setHover] = useState(false);
  const color = initiativeColor(initiative);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surface,
        border: `1px solid ${C.borderSoft}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "minmax(220px, 2fr) 140px 70px 80px 90px minmax(140px, 1fr) auto",
        gap: 10,
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{initiative.title}</div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>
            {initiative.taskCount || 0} tarea{(initiative.taskCount || 0) !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: C.textMuted }}>{initiative.owner || "Sin asignar"}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{initiative.taskCount || 0}</div>
      <div style={{ fontSize: 13, color: initiative.vencidas ? C.danger : C.textMuted }}>{initiative.vencidas || 0}</div>
      <div style={{ fontSize: 13, color: C.textMuted }}>{initiative.sinAsignar || 0}</div>
      <div>
        <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 4 }}>
          {initiative.progress || 0}% · {initiative.closed || 0} de {initiative.taskCount || 0} en Hecho
        </div>
        <div style={{ height: 6, background: C.surfaceRaised, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${initiative.progress || 0}%`, height: "100%", background: color }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        {hover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Eliminar iniciativa"
            style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function AddInitiativeModal({ C, assignees, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(assignees[0] || "__none__");
  const [customOwner, setCustomOwner] = useState("");
  const [progress, setProgress] = useState(0);
  const useCustom = owner === "__custom__";

  function handleSave() {
    if (!title.trim()) return;
    const finalOwner = useCustom ? customOwner.trim() : owner === "__none__" ? "" : owner;
    onSave({ title: title.trim(), owner: finalOwner, progress });
  }

  const label = labelStyle(C);
  const input = inputStyle(C);
  const ghost = ghostBtn(C);
  const primary = primaryBtn(C);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 380, padding: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Nueva iniciativa</div>

        <label style={label}>Título</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="¿Cuál es la iniciativa?"
          style={input}
        />

        <label style={label}>Responsable</label>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} style={input}>
          <option value="__none__">Sin asignar</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__custom__">Otro…</option>
        </select>
        {useCustom && (
          <input
            value={customOwner}
            onChange={(e) => setCustomOwner(e.target.value)}
            placeholder="Nombre del responsable"
            style={{ ...input, marginTop: 8 }}
          />
        )}

        <label style={label}>Progreso inicial: {progress}%</label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          style={{ width: "100%" }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={ghost}>
            Cancelar
          </button>
          <button onClick={handleSave} style={primary}>
            Crear iniciativa
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportModal({ C, data, onClose }) {
  const [copied, setCopied] = useState(null);
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);

  async function handleCopy() {
    const ok = await copyPlainText(json);
    setCopied(ok ? "ok" : "failed");
    setTimeout(() => setCopied(null), 2200);
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 480, padding: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Exportar respaldo</div>
        <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          Copia este texto y compártelo con tu equipo (por Slack, email, etc). Cualquiera puede pegarlo con
          "Importar respaldo" para sumar estos cambios a su propia vista — no borra nada existente.
        </div>
        <textarea
          readOnly
          value={json}
          rows={10}
          onFocus={(e) => e.target.select()}
          style={{
            width: "100%",
            background: C.surfaceRaised,
            border: `1px solid ${C.border}`,
            color: C.text,
            borderRadius: 8,
            padding: "9px 10px",
            fontSize: 12,
            fontFamily: "monospace",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn(C)}>
            Cerrar
          </button>
          <button onClick={handleCopy} style={primaryBtn(C)}>
            {copied === "ok" ? "¡Copiado!" : copied === "failed" ? "No se pudo copiar" : "Copiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ C, onClose, onApply }) {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState(null);

  function handleApply() {
    try {
      const parsed = JSON.parse(text);
      onApply(parsed);
      setFeedback("ok");
      setTimeout(() => {
        setFeedback(null);
        onClose();
      }, 900);
    } catch (e) {
      setFeedback("error");
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 480, padding: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Importar respaldo</div>
        <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          Pega aquí el texto que alguien de tu equipo exportó. Se combina con lo que ya tienes — no se borra nada.
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Pega aquí el JSON exportado…"
          style={{
            width: "100%",
            background: C.surfaceRaised,
            border: `1px solid ${C.border}`,
            color: C.text,
            borderRadius: 8,
            padding: "9px 10px",
            fontSize: 12,
            fontFamily: "monospace",
            resize: "vertical",
          }}
        />
        {feedback === "error" && (
          <div style={{ fontSize: 12.5, color: C.danger, marginTop: 8 }}>
            Ese texto no es un respaldo válido. Revisa que lo hayas copiado completo.
          </div>
        )}
        {feedback === "ok" && (
          <div style={{ fontSize: 12.5, color: "#3FA66B", marginTop: 8 }}>Importado correctamente.</div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn(C)}>
            Cancelar
          </button>
          <button onClick={handleApply} style={primaryBtn(C)}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ C, label, value, caption, color }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 140, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: C.textMuted, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, color: color || C.text, lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.textFaint }}>{caption}</div>
    </div>
  );
}

function FilterChip({ C, active, label, onClick, dotColor }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: active ? C.surfaceRaised : "transparent",
        border: `1px solid ${active ? C.accent : C.border}`,
        color: active ? C.text : C.textMuted,
        borderRadius: 20,
        padding: "6px 12px",
        fontSize: 13,
        cursor: "pointer",
        maxWidth: 280,
      }}
    >
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

function InitiativeBoardCard({ C, initiative, taskCount, progress, dragging, onDragStart, onDragEnd, onOpen }) {
  const color = initiativeColor(initiative);
  const pct = Math.max(0, Math.min(100, Number(progress) || 0));
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      style={{
        background: C.surfaceRaised,
        border: `1px solid ${C.borderSoft}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        cursor: dragging ? "grabbing" : "pointer",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#0B1A14",
            background: color,
            borderRadius: 20,
            padding: "2px 8px",
            maxWidth: 170,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {initiative.title}
        </span>
        <span style={{ fontSize: 12, color: C.textFaint }}>Iniciativa</span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.35, marginBottom: 10 }}>{initiative.title}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: C.surface,
          borderRadius: 8,
          padding: "7px 9px",
          marginBottom: 10,
          color: C.textMuted,
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.7 }}>◇</span>
        {taskCount} tarea{taskCount !== 1 ? "s" : ""}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: initiative.owner ? C.text : C.textMuted, fontStyle: initiative.owner ? "normal" : "italic" }}>
          {initiative.owner || "Sin asignar"}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: C.surface, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function TaskCard({ C, task, dragging, selected, onDragStart, onDragEnd, onMoveLeft, onMoveRight, onDelete, onToggleBlocked, onOpen, initiative }) {
  const [hover, setHover] = useState(false);
  const typeMeta = TASK_TYPES[task.type] || TASK_TYPES.Task;
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.dueDate && task.dueDate < today && task.status !== "done";
  const iniColor = initiative ? initiativeColor(initiative) : C.accent;
  const shortIni = initiative ? initiative.title : null;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (e.target.closest("button")) return;
        onOpen && onOpen();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surfaceRaised,
        border: `1px solid ${selected ? C.accent : C.borderSoft}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        cursor: dragging ? "grabbing" : "pointer",
        opacity: dragging ? 0.4 : 1,
        boxShadow: selected ? `0 0 0 1px ${C.accent}` : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span
            title={shortIni || typeMeta.label}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#0B1A14",
              background: shortIni ? iniColor : typeMeta.color,
              borderRadius: 20,
              padding: "2px 8px",
              maxWidth: 148,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 1,
            }}
          >
            {shortIni || typeMeta.label}
          </span>
          <span style={{ fontSize: 12, color: C.textFaint, flexShrink: 0 }}>#{taskNumber(task)}</span>
        </div>
        {hover && (
          <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={onToggleBlocked}
              aria-label={task.blocked ? "Desbloquear tarea" : "Bloquear tarea"}
              style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 2 }}
            >
              {task.blocked ? "🔓" : "🔒"}
            </button>
            <button
              onClick={onDelete}
              aria-label="Eliminar tarea"
              style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2 }}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {recentlyChangedStatus(task) && (
        <div
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "#7CFFB2",
            background: "rgba(63,166,107,0.16)",
            borderRadius: 6,
            padding: "2px 7px",
            marginBottom: 8,
          }}
        >
          CAMBIÓ ESTADO
        </div>
      )}

      <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.35, marginBottom: 10 }}>{task.title}</div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: C.surface,
          borderRadius: 8,
          padding: "7px 9px",
          marginBottom: 8,
          color: C.textMuted,
          fontSize: 12,
          minWidth: 0,
        }}
      >
        <span style={{ color: typeMeta.color, flexShrink: 0 }}>◇</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{typeMeta.label}</span>
        {task.blocked && <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.textFaint, flexShrink: 0 }}>Bloqueada</span>}
        {isOverdue && <span style={{ marginLeft: task.blocked ? 6 : "auto", fontSize: 10.5, color: C.danger, flexShrink: 0 }}>Vencida</span>}
      </div>

      {Array.isArray(task.attachments) && task.attachments.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 8 }}>
          {task.attachments.length} adjunto{task.attachments.length !== 1 ? "s" : ""}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span
          style={{
            fontSize: 12.5,
            color: task.assignee ? C.text : C.textMuted,
            fontStyle: task.assignee ? "normal" : "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.assignee || "Sin asignar"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {hover && onMoveLeft && (
            <button onClick={onMoveLeft} aria-label="Mover a columna anterior" style={arrowStyle(C)}>
              ‹
            </button>
          )}
          {hover && onMoveRight && (
            <button onClick={onMoveRight} aria-label="Mover a columna siguiente" style={arrowStyle(C)}>
              ›
            </button>
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.textMuted,
              background: C.surface,
              borderRadius: 20,
              padding: "3px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {idleLabel(task)}
          </span>
        </div>
      </div>
    </div>
  );
}
function arrowStyle(C) {
  return {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.textMuted,
    borderRadius: 5,
    width: 20,
    height: 20,
    fontSize: 13,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function TaskDetailModal({ C, task, assignees, initiatives, onClose, onSave, onDelete, onOpenAttachment }) {
  const [title, setTitle] = useState(task.title || "");
  const [description, setDescription] = useState(task.description || "");
  const [initiativeId, setInitiativeId] = useState(task.initiativeId || "");
  const [attachments, setAttachments] = useState(Array.isArray(task.attachments) ? task.attachments : []);
  const [pending, setPending] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [type, setType] = useState(task.type || "Task");
  const [assignee, setAssignee] = useState(task.assignee || "__none__");
  const [customAssignee, setCustomAssignee] = useState("");
  const [status, setStatus] = useState(task.status || "backlog");
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [blocked, setBlocked] = useState(!!task.blocked);
  const fileInputRef = useRef(null);
  const useCustom = assignee === "__custom__";
  const linkedInitiative = (initiatives || []).find((i) => idsMatch(i.id, task.initiativeId));
  const ownerOptions = Array.from(new Set([...(assignees || []), task.assignee].filter(Boolean)));

  useEffect(() => {
    setTitle(task.title || "");
    setDescription(task.description || "");
    setInitiativeId(task.initiativeId || "");
    setAttachments(Array.isArray(task.attachments) ? task.attachments : []);
    setPending([]);
    setAttachError(null);
    setType(task.type || "Task");
    setAssignee(task.assignee || "__none__");
    setCustomAssignee("");
    setStatus(task.status || "backlog");
    setDueDate(task.dueDate || "");
    setBlocked(!!task.blocked);
  }, [task.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (attachments.length + pending.length + files.length > MAX_ATTACHMENTS) {
      setAttachError("Puedes adjuntar hasta 5 archivos");
      return;
    }
    setAttachError(null);
    const next = [];
    for (const file of files) {
      try {
        next.push({
          ...(await fileToPending(file)),
          localId: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
        });
      } catch (e) {
        setAttachError(e.message || "No se pudo adjuntar el archivo");
      }
    }
    if (next.length) setPending((prev) => [...prev, ...next].slice(0, Math.max(0, MAX_ATTACHMENTS - attachments.length)));
  }

  function patchField(partial) {
    onSave(partial);
  }

  async function handleSaveNotes() {
    if (saving) return;
    const finalAssignee = useCustom ? customAssignee.trim() : assignee === "__none__" ? "" : assignee.trim();
    setSaving(true);
    setAttachError(null);
    try {
      const uploaded = [];
      for (const item of pending) uploaded.push(await uploadPending(item));
      onSave({
        title: title.trim() || task.title,
        description: description.trim(),
        initiativeId: initiativeId || null,
        attachments: [...attachments, ...uploaded],
        type,
        assignee: finalAssignee,
        status,
        dueDate: dueDate || null,
        blocked,
      });
      setPending([]);
      setSaving(false);
    } catch (e) {
      setAttachError("No se pudieron guardar los cambios. Intenta de nuevo.");
      setSaving(false);
    }
  }

  const history = [];
  if (task.createdAt) history.push({ t: task.createdAt, text: "Tarea creada" });
  if (task.statusChangedAt && task.statusChangedAt !== task.createdAt) {
    const col = (COLUMNS.find((c) => c.id === task.status) || {}).label || task.status;
    history.push({ t: task.statusChangedAt, text: `Estado actualizado a ${col}` });
  }
  if (task.planeMigratedAt) history.push({ t: task.planeMigratedAt, text: "Migrada a Plane" });
  history.sort((a, b) => b.t - a.t);

  const label = labelStyle(C);
  const input = inputStyle(C);
  const ghost = ghostBtn(C);
  const primary = primaryBtn(C);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,14,0.28)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={task.title || "Detalle de la tarea"}
        style={{
          width: "min(420px, 100%)",
          height: "100%",
          background: C.surface,
          borderLeft: `1px solid ${C.border}`,
          boxShadow: "-12px 0 40px rgba(0,0,0,0.28)",
          overflowY: "auto",
          padding: "18px 20px 28px",
          animation: "fliipaDrawerIn 180ms ease-out",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <textarea
            value={title}
            rows={2}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title.trim() !== task.title) patchField({ title: title.trim() });
            }}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: C.text,
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.3,
              padding: 0,
              outline: "none",
              resize: "none",
              overflow: "hidden",
            }}
          />
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: "none",
              border: "none",
              color: C.textFaint,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {linkedInitiative && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: initiativeColor(linkedInitiative),
                background: C.surfaceRaised,
                border: `1px solid ${C.borderSoft}`,
                borderRadius: 20,
                padding: "2px 9px",
              }}
            >
              {linkedInitiative.title}
            </span>
          )}
          {task.blocked && <span style={{ fontSize: 11, color: C.textFaint }}>Bloqueada</span>}
        </div>

        <label style={label}>Estado</label>
        <select
          value={status}
          onChange={(e) => {
            const next = e.target.value;
            setStatus(next);
            patchField({ status: next });
          }}
          style={input}
        >
          {COLUMNS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <label style={label}>Responsable</label>
        <select
          value={assignee}
          onChange={(e) => {
            const next = e.target.value;
            setAssignee(next);
            if (next !== "__custom__") patchField({ assignee: next === "__none__" ? "" : next });
          }}
          style={input}
        >
          <option value="__none__">Sin asignar</option>
          {ownerOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__custom__">Otro…</option>
        </select>
        {useCustom && (
          <input
            value={customAssignee}
            onChange={(e) => setCustomAssignee(e.target.value)}
            onBlur={() => {
              if (customAssignee.trim()) patchField({ assignee: customAssignee.trim() });
            }}
            placeholder="Nombre del responsable"
            style={{ ...input, marginTop: 8 }}
          />
        )}

        <label style={label}>Fecha de vencimiento</label>
        <input
          type="date"
          value={dueDate || ""}
          onChange={(e) => {
            const next = e.target.value;
            setDueDate(next);
            patchField({ dueDate: next || null });
          }}
          style={input}
        />

        <label style={label}>Etiqueta</label>
        <select
          value={type}
          onChange={(e) => {
            const next = e.target.value;
            setType(next);
            patchField({ type: next });
          }}
          style={input}
        >
          {Object.entries(TASK_TYPES).map(([key, val]) => (
            <option key={key} value={key}>
              {val.label}
            </option>
          ))}
        </select>

        <label style={label}>Iniciativa</label>
        <select
          value={initiativeId}
          onChange={(e) => {
            const next = e.target.value;
            setInitiativeId(next);
            patchField({ initiativeId: next || null });
          }}
          style={input}
        >
          <option value="">Sin iniciativa</option>
          {(initiatives || []).map((ini) => (
            <option key={ini.id} value={ini.id}>
              {ini.title}
            </option>
          ))}
        </select>

        <label style={label}>Notas</label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropActive(false);
            addFiles(e.dataTransfer.files);
          }}
          style={{
            border: `1px dashed ${dropActive ? C.accent : C.border}`,
            borderRadius: 8,
            padding: 8,
            background: dropActive ? C.surfaceRaised : "transparent",
          }}
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder="Notas de la tarea. Arrastra aquí imágenes o documentos."
            style={{ ...input, resize: "vertical", minHeight: 120, margin: 0, border: "none", background: "transparent" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "0 2px 2px" }}>
            <span style={{ fontSize: 11.5, color: C.textFaint }}>Imágenes o documentos · máx. 1.5 MB · 5 archivos</span>
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              style={{
                background: C.surfaceRaised,
                border: `1px solid ${C.border}`,
                color: C.text,
                borderRadius: 7,
                padding: "6px 10px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Adjuntar
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {[...attachments, ...pending].length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {attachments.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surfaceRaised, borderRadius: 8, padding: "6px 8px" }}>
                  {item.isImage && item.thumb ? (
                    <img
                      src={item.thumb}
                      alt=""
                      onClick={() => onOpenAttachment && onOpenAttachment(item)}
                      style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5, cursor: "pointer" }}
                    />
                  ) : (
                    <span style={{ fontSize: 16, width: 36, textAlign: "center", cursor: "pointer" }} onClick={() => onOpenAttachment && onOpenAttachment(item)}>
                      📄
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                  <button
                    type="button"
                    aria-label="Quitar adjunto"
                    onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== item.id))}
                    style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {pending.map((item) => (
                <div key={item.localId} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surfaceRaised, borderRadius: 8, padding: "6px 8px" }}>
                  {item.isImage && (item.thumb || item.data) ? (
                    <img src={item.thumb || item.data} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5 }} />
                  ) : (
                    <span style={{ fontSize: 16, width: 36, textAlign: "center" }}>📄</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: C.textFaint }}>Nuevo · {formatBytes(item.size)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Quitar adjunto"
                    onClick={() => setPending((prev) => prev.filter((p) => p.localId !== item.localId))}
                    style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {attachError && <div style={{ fontSize: 12.5, color: C.danger, marginTop: 8 }}>{attachError}</div>}

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.textMuted, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={blocked}
            onChange={(e) => {
              const next = e.target.checked;
              setBlocked(next);
              patchField({ blocked: next });
            }}
          />
          Marcar como bloqueada
        </label>

        <button
          onClick={handleSaveNotes}
          style={{ ...primary, width: "100%", marginTop: 16, padding: "10px 14px", opacity: saving ? 0.7 : 1 }}
          disabled={saving}
        >
          {saving ? "Guardando…" : "Guardar notas"}
        </button>

        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 14 }}>
          Actualizada {formatUpdated(task.updatedAt || task.statusChangedAt || task.createdAt || Date.now())}
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.borderSoft}` }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: C.textFaint,
              marginBottom: 10,
            }}
          >
            Historial
          </div>
          {history.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.textFaint }}>Sin eventos todavía</div>
          ) : (
            history.map((item, idx) => (
              <div key={idx} style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                {item.text}
                <div style={{ fontSize: 11.5, color: C.textFaint }}>{formatUpdated(item.t)}</div>
              </div>
            ))
          )}
        </div>

        <button
          onClick={onDelete}
          style={{ ...ghost, color: C.danger, borderColor: C.danger, marginTop: 18, width: "100%" }}
        >
          Eliminar tarea
        </button>
      </div>
    </div>
  );
}

function AddTaskModal({ C, assignees, initiatives, defaultInitiativeId, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [initiativeId, setInitiativeId] = useState(defaultInitiativeId || "");
  const [pending, setPending] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [type, setType] = useState("Task");
  const [assignee, setAssignee] = useState(assignees[0] || "__none__");
  const [customAssignee, setCustomAssignee] = useState("");
  const [status, setStatus] = useState("backlog");
  const [dueDate, setDueDate] = useState("");
  const [blocked, setBlocked] = useState(false);
  const fileInputRef = useRef(null);
  const useCustom = assignee === "__custom__";

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (pending.length + files.length > MAX_ATTACHMENTS) {
      setAttachError("Puedes adjuntar hasta 5 archivos");
      return;
    }
    setAttachError(null);
    const next = [];
    for (const file of files) {
      try {
        next.push({
          ...(await fileToPending(file)),
          localId: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
        });
      } catch (e) {
        setAttachError(e.message || "No se pudo adjuntar el archivo");
      }
    }
    if (next.length) setPending((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
  }

  async function handleSave() {
    if (!title.trim() || saving) return;
    const finalAssignee = useCustom ? customAssignee.trim() : assignee === "__none__" ? "" : assignee.trim();
    setSaving(true);
    setAttachError(null);
    try {
      const attachments = [];
      for (const item of pending) {
        attachments.push(await uploadPending(item));
      }
      onSave({
        title: title.trim(),
        description: description.trim(),
        initiativeId: initiativeId || null,
        attachments,
        type,
        assignee: finalAssignee,
        status,
        dueDate: dueDate || null,
        blocked,
      });
    } catch (e) {
      setAttachError("No se pudieron subir los adjuntos. Intenta de nuevo.");
      setSaving(false);
    }
  }

  const label = labelStyle(C);
  const input = inputStyle(C);
  const ghost = ghostBtn(C);
  const primary = primaryBtn(C);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 440, padding: 20, maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Nueva tarea</div>

        <label style={label}>Título</label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué hay que hacer?" style={input} />

        <label style={label}>Iniciativa</label>
        <select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} style={input}>
          <option value="">Sin iniciativa</option>
          {(initiatives || []).map((ini) => (
            <option key={ini.id} value={ini.id}>
              {ini.title}
            </option>
          ))}
        </select>

        <label style={label}>Descripción</label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropActive(false);
            addFiles(e.dataTransfer.files);
          }}
          style={{
            border: `1px dashed ${dropActive ? C.accent : C.border}`,
            borderRadius: 8,
            padding: 8,
            background: dropActive ? C.surfaceRaised : "transparent",
          }}
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Detalles, contexto o criterios de la tarea (opcional). Arrastra aquí imágenes o documentos."
            style={{ ...input, resize: "vertical", minHeight: 88, margin: 0, border: "none", background: "transparent" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "0 2px 2px" }}>
            <span style={{ fontSize: 11.5, color: C.textFaint }}>Imágenes o documentos · máx. 1.5 MB · 5 archivos</span>
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              style={{
                background: C.surfaceRaised,
                border: `1px solid ${C.border}`,
                color: C.text,
                borderRadius: 7,
                padding: "6px 10px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Adjuntar
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {pending.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {pending.map((item) => (
                <div
                  key={item.localId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: C.surfaceRaised,
                    borderRadius: 8,
                    padding: "6px 8px",
                  }}
                >
                  {item.isImage && (item.thumb || item.data) ? (
                    <img src={item.thumb || item.data} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5 }} />
                  ) : (
                    <span style={{ fontSize: 16, width: 36, textAlign: "center" }}>📄</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: C.textFaint }}>{formatBytes(item.size)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Quitar adjunto"
                    onClick={() => setPending((prev) => prev.filter((p) => p.localId !== item.localId))}
                    style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 14 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {attachError && <div style={{ fontSize: 12.5, color: C.danger, marginTop: 8 }}>{attachError}</div>}

        <label style={label}>Tipo</label>
        <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
          {Object.entries(TASK_TYPES).map(([key, val]) => (
            <option key={key} value={key}>
              {val.label}
            </option>
          ))}
        </select>

        <label style={label}>Responsable</label>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={input}>
          <option value="__none__">Sin asignar</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__custom__">Otro…</option>
        </select>
        {useCustom && (
          <input value={customAssignee} onChange={(e) => setCustomAssignee(e.target.value)} placeholder="Nombre del responsable" style={{ ...input, marginTop: 8 }} />
        )}

        <label style={label}>Columna inicial</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}>
          {COLUMNS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <label style={label}>Fecha límite (opcional)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.textMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
          Marcar como bloqueada
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={ghost} disabled={saving}>
            Cancelar
          </button>
          <button onClick={handleSave} style={{ ...primary, opacity: saving ? 0.7 : 1 }} disabled={saving}>
            {saving ? "Subiendo…" : "Crear tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview({ C, attachment, onClose }) {
  const [src, setSrc] = useState(attachment.data || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (src) return;
    if (!attachment.id || String(attachment.id).startsWith("local-")) {
      setError("No se pudo abrir el adjunto");
      return;
    }
    if (!window.storage || typeof window.storage.getFile !== "function") {
      setError("No se pudo abrir el adjunto");
      return;
    }
    let cancelled = false;
    window.storage
      .getFile(attachment.id)
      .then((file) => {
        if (cancelled) return;
        if (file && file.data) setSrc(file.data);
        else setError("No se encontró el archivo");
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo abrir el adjunto");
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, src]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 560, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</div>
          <button onClick={onClose} style={ghostBtn(C)}>
            Cerrar
          </button>
        </div>
        {error && <div style={{ fontSize: 13, color: C.danger }}>{error}</div>}
        {!error && !src && <div style={{ fontSize: 13, color: C.textFaint }}>Cargando…</div>}
        {src && attachment.isImage && (
          <img src={src} alt={attachment.name} style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8 }} />
        )}
        {src && !attachment.isImage && (
          <a href={src} download={attachment.name} style={{ color: C.accent, fontSize: 14, fontWeight: 600 }}>
            Descargar {attachment.name}
          </a>
        )}
      </div>
    </div>
  );
}

function labelStyle(C) {
  return { display: "block", fontSize: 12, color: C.textMuted, marginTop: 12, marginBottom: 5 };
}

function inputStyle(C) {
  return {
    width: "100%",
    background: C.surfaceRaised,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    fontFamily: "inherit",
  };
}

function ghostBtn(C) {
  return { background: "none", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" };
}

function primaryBtn(C) {
  return { background: C.accent, border: "none", color: "#FFFFFF", borderRadius: 8, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
}
