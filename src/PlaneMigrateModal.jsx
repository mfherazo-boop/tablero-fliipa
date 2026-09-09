import { useMemo, useState } from "react";
import {
  DEFAULT_PLANE_BASE,
  buildMigrationPackage,
  buildPlaneCsv,
  listProjects,
  migrateToPlane,
  parseWorkspaceInput,
} from "./plane";

const SETTINGS_KEY = "fliipa-kanban:plane-settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSettings(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (e) {
    /* ignore */
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, data) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

function isBrowserBlocked(error) {
  return (
    error?.code === "PLANE_BROWSER_BLOCKED" ||
    error?.name === "TypeError" ||
    /Failed to fetch|NetworkError|CORS|no puede hablar con Plane/i.test(error?.message || "")
  );
}

export default function PlaneMigrateModal({ C, tasks, initiatives, onClose, onItemMigrated, onBackup }) {
  const saved = useMemo(loadSettings, []);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl || DEFAULT_PLANE_BASE);
  const [apiKey, setApiKey] = useState("");
  const [workspace, setWorkspace] = useState(saved.workspace || "");
  const [projectId, setProjectId] = useState(saved.projectId || "");
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [corsBlocked, setCorsBlocked] = useState(false);

  const totalItems = (tasks || []).length + (initiatives || []).length;
  const already = (tasks || []).filter((t) => t.planeWorkItemId).length + (initiatives || []).filter((i) => i.planeWorkItemId).length;
  const label = (text) => ({ display: "block", fontSize: 12, color: C.textMuted, marginTop: 12, marginBottom: 5 });
  const input = {
    width: "100%",
    background: C.surfaceRaised,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13.5,
    fontFamily: "inherit",
  };
  const ghost = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.textMuted,
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13.5,
    cursor: "pointer",
  };
  const primary = {
    background: C.accent,
    border: "none",
    color: C.onAccent || "#06251C",
    borderRadius: 20,
    padding: "8px 16px",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
  };

  function persistConnection(nextProjectId) {
    saveSettings({
      baseUrl: baseUrl.trim() || DEFAULT_PLANE_BASE,
      workspace: parseWorkspaceInput(workspace),
      projectId: nextProjectId || projectId,
    });
  }

  const workspaceSlug = parseWorkspaceInput(workspace);
  const canConnect = Boolean(apiKey.trim() && workspaceSlug);
  const canMigrate = Boolean(canConnect && projectId && totalItems);

  function missingHint() {
    if (!apiKey.trim()) return "Pega la API key que acabas de generar en Plane.";
    if (!workspaceSlug) return "Falta el workspace: es el nombre de la URL de Plane, por ejemplo app.plane.so/fliipa/ → escribe fliipa.";
    if (!projectId) return "Pulsa «Conectar y ver proyectos» y elige el proyecto destino. Todavía no pulses Migrar.";
    if (!totalItems) return "No hay tareas ni iniciativas para migrar.";
    return "";
  }

  async function handleConnect() {
    setStatus("connecting");
    setMessage("");
    setSummary(null);
    setCorsBlocked(false);
    try {
      const list = await listProjects({
        baseUrl,
        apiKey: apiKey.trim(),
        workspace: parseWorkspaceInput(workspace),
      });
      setProjects(list);
      persistConnection(projectId);
      if (!projectId && list[0]?.id) setProjectId(list[0].id);
      setStatus("ready");
      setMessage(list.length ? `Conectado. ${list.length} proyecto${list.length === 1 ? "" : "s"} encontrado${list.length === 1 ? "" : "s"}.` : "Conectado, pero no hay proyectos en ese workspace.");
    } catch (e) {
      setStatus("error");
      if (isBrowserBlocked(e)) {
        setCorsBlocked(true);
        setMessage(
          "Plane no deja conectar desde este visor (el navegador bloquea la API). No hace falta Node: descarga el CSV e impórtalo en Plane."
        );
      } else {
        setMessage(e.message || "No se pudo conectar con Plane.");
      }
    }
  }

  async function handleMigrate() {
    if (!canMigrate) {
      setMessage(missingHint());
      setStatus("error");
      return;
    }
    setStatus("migrating");
    setMessage("");
    setSummary(null);
    setCorsBlocked(false);
    persistConnection(projectId);
    if (onBackup) onBackup();
    try {
      const result = await migrateToPlane({
        baseUrl,
        apiKey: apiKey.trim(),
        workspace,
        projectId,
        tasks,
        initiatives,
        onProgress: setProgress,
        onItemMigrated,
      });
      setSummary(result);
      setProgress(null);
      setStatus("done");
      setMessage(
        result.failed
          ? "La migración terminó con algunos errores. Puedes volver a intentarlo: lo ya enviado se actualiza, no se duplica."
          : "Listo. El tablero de Fliipa sigue igual; ahora también está en Plane."
      );
    } catch (e) {
      setStatus("error");
      setProgress(null);
      if (isBrowserBlocked(e)) {
        setCorsBlocked(true);
        setMessage(
          "Plane no deja conectar desde este visor (el navegador bloquea la API). Descarga el CSV e impórtalo en Plane."
        );
      } else {
        setMessage(e.message || "La migración falló.");
      }
    }
  }

  function handleDownload() {
    downloadJson(`fliipa-para-plane-${new Date().toISOString().slice(0, 10)}.json`, buildMigrationPackage({ tasks, initiatives }));
  }

  function handleDownloadCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      `fliipa-para-plane-${stamp}.csv`,
      new Blob([buildPlaneCsv({ tasks, initiatives })], { type: "text/csv;charset=utf-8" })
    );
  }

  const selectedName = (projects.find((p) => p.id === projectId) || {}).name;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,14,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 520, padding: 20, maxHeight: "90vh", overflowY: "auto" }}
        className="fliipa-modal-pad"
      >
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          Migrar todo a Plane
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
          Sigan trabajando aquí. Cuando quieran pasar el Kanban a Plane, esta opción envía{" "}
          <strong style={{ color: C.text, fontWeight: 600 }}>todas las iniciativas y tareas</strong> al proyecto
          que elijan. No borra ni deja de sincronizar este tablero: Fliipa sigue siendo la fuente de trabajo
          hasta que decidan quedarse solo en Plane.
        </div>
        <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 10 }}>
          Ahora mismo hay {tasks.length} tarea{tasks.length === 1 ? "" : "s"} y {initiatives.length} iniciativa{initiatives.length === 1 ? "" : "s"}
          {already ? ` · ${already} ya vinculadas a Plane` : ""}.
        </div>

        <div
          style={{
            background: C.surfaceRaised,
            border: `1px solid ${C.borderSoft}`,
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 12,
            fontSize: 13,
            color: C.textMuted,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textFaint, marginBottom: 8 }}>
            Cómo hacerlo
          </div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              En <a href="https://app.plane.so" target="_blank" rel="noreferrer" style={{ color: C.accent }}>app.plane.so</a> entra a tu workspace y ten un proyecto creado (puede estar vacío).
            </li>
            <li style={{ marginBottom: 6 }}>
              Ve a <strong style={{ color: C.text, fontWeight: 600 }}>Profile Settings → Personal Access Tokens</strong>, crea un token y cópialo.
            </li>
            <li style={{ marginBottom: 6 }}>
              El workspace es el texto de la URL: <span style={{ color: C.text }}>app.plane.so/<strong>tu-workspace</strong>/</span>
            </li>
            <li>
              Pégalo abajo y pulsa <strong style={{ color: C.text, fontWeight: 600 }}>Conectar y ver proyectos</strong>. Si el visor no deja hablar con Plane, usa <strong style={{ color: C.text, fontWeight: 600 }}>Descargar CSV para Plane</strong> y en Plane ve a Workspace Settings → Imports → CSV.
            </li>
          </ol>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}`, fontSize: 12.5 }}>
            <strong style={{ color: C.text, fontWeight: 600 }}>Cómo se ve en Plane:</strong> arriba a la derecha cambia de Lista al icono de <strong style={{ color: C.text }}>tablero</strong> (columnas). Al migrar, las columnas quedan en español: Pendiente, Por hacer, En progreso, En revisión, Hecho. Los menús de Plane (Work items, Add work item) se cambian en tu cuenta: avatar → Settings → Preferences → Language → Español. Este Kanban no se borra; lo eliminado se guarda en Papelera.
          </div>
        </div>

        <label style={label(C)}>URL de Plane</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.plane.so"
          style={input}
        />
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4 }}>
          Cloud: déjala así. Si Plane está autoalojado, usa la URL de esa instancia.
        </div>

        <label style={label(C)}>Workspace</label>
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          placeholder="fliipa  (el texto de app.plane.so/fliipa/)"
          style={input}
        />

        <label style={label(C)}>API key de Plane</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="plane_api_…"
          autoComplete="off"
          style={input}
        />
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4 }}>
          En Plane: Profile Settings → Personal Access Tokens. La clave no se comparte con el equipo ni se guarda en el tablero.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={handleConnect} style={ghost} disabled={!canConnect || status === "connecting" || status === "migrating"}>
            {status === "connecting" ? "Conectando…" : "Conectar y ver proyectos"}
          </button>
        </div>

        {projects.length > 0 && (
          <>
            <label style={label(C)}>Proyecto destino</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={input}>
              <option value="">Elige un proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.identifier || p.id}
                </option>
              ))}
            </select>
          </>
        )}

        {progress && (
          <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 12 }}>
            Migrando {progress.current} de {progress.total}: {progress.label}
          </div>
        )}

        {message && (
          <div style={{ fontSize: 13, color: status === "error" ? C.danger : C.textMuted, marginTop: 12, lineHeight: 1.45 }}>
            {message}
          </div>
        )}

        {corsBlocked && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: C.surfaceRaised,
              border: `1px solid ${C.accent}`,
              fontSize: 13,
              color: C.textMuted,
              lineHeight: 1.5,
            }}
          >
            <div style={{ color: C.text, fontWeight: 600, marginBottom: 6 }}>Importar con CSV (sin Node)</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 4 }}>Pulsa <strong style={{ color: C.text }}>Descargar CSV para Plane</strong>.</li>
              <li style={{ marginBottom: 4 }}>
                En Plane: <strong style={{ color: C.text }}>Workspace Settings → Imports → CSV</strong>.
              </li>
              <li>Elige el proyecto y sube el archivo. Las iniciativas van con el prefijo [Iniciativa].</li>
            </ol>
          </div>
        )}

        {summary && (
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
            Creadas: {summary.created} · Actualizadas: {summary.updated} · Fallidas: {summary.failed}
            {summary.errors.length > 0 && (
              <div style={{ marginTop: 8, color: C.danger, fontSize: 12.5 }}>
                {summary.errors.slice(0, 5).map((err) => (
                  <div key={err}>{err}</div>
                ))}
              </div>
            )}
            {selectedName && (
              <div style={{ marginTop: 8 }}>
                Revisa el proyecto <strong style={{ color: C.text }}>{selectedName}</strong> en Plane.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleDownloadCsv} style={corsBlocked ? primary : ghost}>
              Descargar CSV para Plane
            </button>
            <button onClick={handleDownload} style={ghost}>
              Descargar paquete
            </button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={ghost} disabled={status === "migrating"}>
              Cerrar
            </button>
            <button
              onClick={handleMigrate}
              style={{ ...primary, opacity: canMigrate && status !== "migrating" ? 1 : 0.55 }}
              disabled={!canMigrate || status === "migrating"}
              title={!canMigrate ? missingHint() : ""}
            >
              {status === "migrating" ? "Migrando…" : !projectId ? "Elige un proyecto" : already ? "Migrar / actualizar" : "Migrar a Plane"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
