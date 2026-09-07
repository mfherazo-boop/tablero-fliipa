import { useState, useEffect, useMemo, useRef } from "react";

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
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Por hacer" },
  { id: "in_progress", label: "En progreso" },
  { id: "review", label: "En revisión" },
  { id: "done", label: "Hecho" },
];

const ROSTER = ["Mafe", "William", "Alejo", "Aleja", "Fran", "Ivan"];
const AVATAR_COLORS = ["#6D5DFC", "#4C7EF3", "#4C9F70", "#B48EDE", "#E2574C", "#3F8E8C"];

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

const INITIATIVE_SUGGESTIONS = [
  { id: "sugg-verticales", title: "Expansión a nuevos verticales", owner: "Alejo", progress: 62 },
  { id: "sugg-onboarding", title: "Rediseño del onboarding de vendedores", owner: "Mafe", progress: 41 },
  { id: "sugg-reportes", title: "Automatización de reportes financieros", owner: "Ivan", progress: 18 },
];

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
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [initiatives, setInitiatives] = useState([]);
  const [deletedTaskIds, setDeletedTaskIds] = useState({});
  const [deletedInitIds, setDeletedInitIds] = useState({});
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [savingInit, setSavingInit] = useState(false);
  const [initError, setInitError] = useState(null);
  const initSaveTimer = useRef(null);
  const initSaveTokenRef = useRef(0);
  const [draggingId, setDraggingId] = useState(null);
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
        const initialTasks = remote.tasks && remote.tasks.length > 0 ? remote.tasks : seedTasks();
        const initialInits = remote.initiatives || [];
        setDeletedTaskIds(remote.deletedTaskIds);
        setDeletedInitIds(remote.deletedInitIds);
        setTasks(initialTasks.filter((t) => !remote.deletedTaskIds[t.id]));
        setInitiatives(initialInits.filter((i) => !remote.deletedInitIds[i.id]));
        lastTasksRef.current = JSON.stringify(initialTasks);
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
      { id: "i" + now, title, owner, progress: Number(progress) || 0, createdAt: now, updatedAt: now },
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

  function addFromSuggestion(sugg) {
    const already = initiatives.some(
      (i) => i.title.trim().toLowerCase() === sugg.title.trim().toLowerCase()
    );
    if (already) return;
    addInitiative({ title: sugg.title, owner: sugg.owner, progress: sugg.progress });
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

  const filtered = useMemo(() => {
    return tasks.filter(
      (t) =>
        (!typeFilter || t.type === typeFilter) &&
        (assigneeFilter === "Todos" || t.assignee === assigneeFilter)
    );
  }, [tasks, typeFilter, assigneeFilter]);

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

  function deleteTask(id) {
    setDeletedTaskIds((prev) => ({ ...prev, [id]: Date.now() }));
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function toggleBlocked(id) {
    const now = Date.now();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, blocked: !t.blocked, updatedAt: now } : t)));
  }

  const counts = useMemo(() => {
    const m = {};
    COLUMNS.forEach((c) => (m[c.id] = filtered.filter((t) => t.status === c.id).length));
    return m;
  }, [filtered]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDays = 7 * 86400000;
    return {
      total: tasks.length,
      vencidas: tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "done").length,
      sinAsignar: tasks.filter((t) => !t.assignee).length,
      bloqueadas: tasks.filter((t) => t.blocked).length,
      cambioEstado: tasks.filter(
        (t) => t.statusChangedAt && Date.now() - t.statusChangedAt <= sevenDays
      ).length,
    };
  }, [tasks]);

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
      />

      <div style={{ padding: "22px 20px 40px" }}>
        {activeTab === "iniciativas" ? (
          <InitiativesView
            C={C}
            initiatives={initiatives}
            suggestions={INITIATIVE_SUGGESTIONS}
            saving={savingInit}
            error={initError}
            dark={dark}
            onRetry={retryInitSave}
            onOpenNew={() => setInitModalOpen(true)}
            onDelete={deleteInitiative}
            onAdjustProgress={adjustInitiativeProgress}
            onAddSuggestion={addFromSuggestion}
          />
        ) : (
          <>
            {/* Métricas */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
              <StatCard C={C} label="Tareas" value={stats.total} caption="en total" />
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
                  {filtered.length !== 1 ? "s" : ""} · el equipo ve el mismo tablero en este link
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
                    if (draggingId) moveTask(draggingId, col.id);
                    setDraggingId(null);
                    setDragOverCol(null);
                  }}
                  style={{
                    flex: "0 0 268px",
                    background: C.surface,
                    border: `1px solid ${dragOverCol === col.id ? C.accent : C.borderSoft}`,
                    borderRadius: 12,
                    padding: 12,
                    minHeight: 420,
                    transition: "border-color 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 12px" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{col.label}</span>
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
                    {filtered
                      .filter((t) => t.status === col.id)
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          C={C}
                          task={task}
                          dragging={draggingId === task.id}
                          onDragStart={() => setDraggingId(task.id)}
                          onDragEnd={() => setDraggingId(null)}
                          onMoveLeft={colIdx > 0 ? () => moveByOffset(task.id, -1) : null}
                          onMoveRight={colIdx < COLUMNS.length - 1 ? () => moveByOffset(task.id, 1) : null}
                          onDelete={() => deleteTask(task.id)}
                          onToggleBlocked={() => toggleBlocked(task.id)}
                        />
                      ))}
                    {counts[col.id] === 0 && (
                      <div style={{ fontSize: 12.5, color: C.textFaint, padding: "10px 4px", textAlign: "center" }}>
                        Sin tareas aquí
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

function TopBar({ C, dark, onToggleDark, activeTab, setActiveTab, lastUpdated, syncStatus, onOpenExport, onOpenImport }) {
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
  suggestions,
  saving,
  error,
  dark,
  onRetry,
  onOpenNew,
  onDelete,
  onAdjustProgress,
  onAddSuggestion,
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
            Crea las tuyas o agrega alguna sugerencia abajo — se guardan igual que las tareas del tablero.
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
          Aún no tienes iniciativas. Crea una nueva arriba o elige una sugerencia abajo.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
          {initiatives.map((ini) => (
            <InitiativeCard
              key={ini.id}
              C={C}
              initiative={ini}
              onDelete={() => onDelete(ini.id)}
              onAdjustProgress={(delta) => onAdjustProgress(ini.id, delta)}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textFaint, marginBottom: 10 }}>Sugerencias</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {suggestions.map((s) => {
          const added = initiatives.some(
            (i) => i.title.trim().toLowerCase() === s.title.trim().toLowerCase()
          );
          return (
            <div
              key={s.id}
              style={{
                background: "transparent",
                border: `1px dashed ${C.borderSoft}`,
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textMuted }}>{s.title}</div>
                <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>
                  Sugerido para {s.owner} · {s.progress}%
                </div>
              </div>
              <button
                onClick={() => onAddSuggestion(s)}
                disabled={added}
                style={{
                  background: added ? "none" : C.surfaceRaised,
                  border: `1px solid ${added ? C.border : C.accent}`,
                  color: added ? C.textFaint : C.accent,
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: added ? "default" : "pointer",
                }}
              >
                {added ? "Agregada ✓" : "+ Agregar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InitiativeCard({ C, initiative, onDelete, onAdjustProgress }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surface,
        border: `1px solid ${C.borderSoft}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{initiative.title}</div>
        <div style={{ fontSize: 12.5, color: C.textFaint, marginTop: 2 }}>
          Responsable: {initiative.owner || "Sin asignar"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onAdjustProgress(-5)} aria-label="Reducir progreso 5%" style={arrowStyle(C)}>
          −
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 150 }}>
          <div style={{ flex: 1, height: 6, background: C.surfaceRaised, borderRadius: 3, overflow: "hidden", minWidth: 90 }}>
            <div style={{ width: `${initiative.progress}%`, height: "100%", background: C.accent }} />
          </div>
          <span style={{ fontSize: 12.5, color: C.textMuted, minWidth: 32, textAlign: "right" }}>
            {initiative.progress}%
          </span>
        </div>
        <button onClick={() => onAdjustProgress(5)} aria-label="Aumentar progreso 5%" style={arrowStyle(C)}>
          +
        </button>
        {hover && (
          <button
            onClick={onDelete}
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
      }}
    >
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block" }} />}
      {label}
    </button>
  );
}

function TaskCard({ C, task, dragging, onDragStart, onDragEnd, onMoveLeft, onMoveRight, onDelete, onToggleBlocked }) {
  const [hover, setHover] = useState(false);
  const typeMeta = TASK_TYPES[task.type] || TASK_TYPES.Task;
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.dueDate && task.dueDate < today && task.status !== "done";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surfaceRaised,
        border: `1px solid ${C.borderSoft}`,
        borderLeft: `3px solid ${typeMeta.color}`,
        borderRadius: 9,
        padding: "10px 11px",
        cursor: "grab",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: typeMeta.color }}>{typeMeta.label}</span>
          {task.blocked && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, background: C.border, borderRadius: 4, padding: "1px 6px" }}>
              Bloqueada
            </span>
          )}
          {isOverdue && <span style={{ fontSize: 10.5, fontWeight: 600, color: C.danger }}>Vencida</span>}
        </div>
        {hover && (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={onToggleBlocked}
              aria-label={task.blocked ? "Desbloquear tarea" : "Bloquear tarea"}
              style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2 }}
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
      <div style={{ fontSize: 13.5, lineHeight: 1.4, marginBottom: 10 }}>{task.title}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: C.border,
              color: C.text,
              fontSize: 10.5,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={task.assignee || "Sin asignar"}
          >
            {initials(task.assignee)}
          </span>
          <span style={{ fontSize: 11.5, color: C.textFaint }}>{timeAgo(task.createdAt)}</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {onMoveLeft && (
            <button onClick={onMoveLeft} aria-label="Mover a columna anterior" style={arrowStyle(C)}>
              ‹
            </button>
          )}
          {onMoveRight && (
            <button onClick={onMoveRight} aria-label="Mover a columna siguiente" style={arrowStyle(C)}>
              ›
            </button>
          )}
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

function AddTaskModal({ C, assignees, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Task");
  const [assignee, setAssignee] = useState(assignees[0] || "__none__");
  const [customAssignee, setCustomAssignee] = useState("");
  const [status, setStatus] = useState("backlog");
  const [dueDate, setDueDate] = useState("");
  const [blocked, setBlocked] = useState(false);
  const useCustom = assignee === "__custom__";

  function handleSave() {
    if (!title.trim()) return;
    const finalAssignee = useCustom ? customAssignee.trim() : assignee === "__none__" ? "" : assignee.trim();
    onSave({ title: title.trim(), type, assignee: finalAssignee, status, dueDate: dueDate || null, blocked });
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
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Nueva tarea</div>

        <label style={label}>Título</label>
        <textarea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} rows={2} placeholder="¿Qué hay que hacer?" style={{ ...input, resize: "vertical" }} />

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
          <button onClick={onClose} style={ghost}>
            Cancelar
          </button>
          <button onClick={handleSave} style={primary}>
            Crear tarea
          </button>
        </div>
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
