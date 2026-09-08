import { useMemo, useState } from "react";
import {
  DEFAULT_PLANE_BASE,
  buildMigrationPackage,
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

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PlaneMigrateModal({ C, tasks, initiatives, onClose, onItemMigrated }) {
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

  async function handleConnect() {
    setStatus("connecting");
    setMessage("");
    setSummary(null);
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
      if (e.name === "TypeError" || /Failed to fetch|NetworkError|CORS/i.test(e.message || "")) {
        setMessage("El navegador no pudo hablar con Plane (suele ser CORS). Descarga el paquete y migra desde una computadora con Node, o usa una instancia de Plane que permita este origen.");
      } else {
        setMessage(e.message || "No se pudo conectar con Plane.");
      }
    }
  }

  async function handleMigrate() {
    if (!apiKey.trim() || !parseWorkspaceInput(workspace) || !projectId) {
      setMessage("Completa API key, workspace y proyecto.");
      setStatus("error");
      return;
    }
    if (!totalItems) {
      setMessage("No hay tareas ni iniciativas para migrar.");
      setStatus("error");
      return;
    }
    setStatus("migrating");
    setMessage("");
    setSummary(null);
    persistConnection(projectId);
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
      setMessage(e.message || "La migración falló.");
    }
  }

  function handleDownload() {
    downloadJson(`fliipa-para-plane-${new Date().toISOString().slice(0, 10)}.json`, buildMigrationPackage({ tasks, initiatives }));
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
      >
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          Migrar a Plane
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
          Sigan usando este Kanban con normalidad. Cuando quieran pasar todo a Plane (project management),
          esta opción envía las tareas e iniciativas al proyecto que elijan. No borra nada de aquí.
        </div>
        <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 8 }}>
          Ahora mismo hay {tasks.length} tarea{tasks.length === 1 ? "" : "s"} y {initiatives.length} iniciativa{initiatives.length === 1 ? "" : "s"}
          {already ? ` · ${already} ya vinculadas a Plane` : ""}.
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
          placeholder="slug o URL, ej. fliipa o https://app.plane.so/fliipa/"
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
          <button onClick={handleConnect} style={ghost} disabled={status === "connecting" || status === "migrating"}>
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
          <button onClick={handleDownload} style={ghost}>
            Descargar paquete
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={ghost} disabled={status === "migrating"}>
              Cerrar
            </button>
            <button
              onClick={handleMigrate}
              style={{ ...primary, opacity: status === "migrating" ? 0.7 : 1 }}
              disabled={status === "migrating" || !totalItems}
            >
              {status === "migrating" ? "Migrando…" : already ? "Migrar / actualizar" : "Migrar a Plane"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
