import { useMemo, useState } from "react";
import { auditMigration, buildMigrationPackage, cleanupMigratedInitiatives, isKaneoBrowserBlocked, listProjects, migrateToKaneo } from "./kaneo";

const SETTINGS_KEY = "fliipa-kanban:kaneo-settings";

// Datos conocidos de la instancia real (Sumz / proyecto Fliipa en orbit.sumz.co),
// para que no haya que volver a copiarlos cada vez.
const KNOWN_DEFAULTS = {
  baseUrl: "https://orbit.sumz.co",
  workspaceId: "MkTlo8xLKTamsDDOlA7lhi1IjwC7c0Rt",
  projectId: "g9jozizb4uqgpvizxar79lps",
};

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

export default function KaneoMigrateModal({ C, tasks, initiatives, deletedItems, onClose, onItemMigrated, onInitiativeCleaned, onBackup }) {
  const saved = useMemo(loadSettings, []);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl || KNOWN_DEFAULTS.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState(saved.workspaceId || KNOWN_DEFAULTS.workspaceId);
  const [projectId, setProjectId] = useState(saved.projectId || KNOWN_DEFAULTS.projectId);
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [browserBlocked, setBrowserBlocked] = useState(false);

  const [cleanupStatus, setCleanupStatus] = useState("idle");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupProgress, setCleanupProgress] = useState(null);
  const [cleanupSummary, setCleanupSummary] = useState(null);

  const totalItems = (tasks || []).length;
  const already = (tasks || []).filter((t) => t.kaneoTaskId).length;
  const migratedInitiatives = (initiatives || []).filter((ini) => ini && ini.kaneoTaskId);
  const audit = useMemo(() => auditMigration({ tasks, initiatives, deletedItems }), [tasks, initiatives, deletedItems]);

  const label = { display: "block", fontSize: 12, color: C.textMuted, marginTop: 12, marginBottom: 5 };
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
      baseUrl: baseUrl.trim() || KNOWN_DEFAULTS.baseUrl,
      workspaceId: workspaceId.trim(),
      projectId: nextProjectId || projectId,
    });
  }

  const canConnect = Boolean(apiKey.trim() && baseUrl.trim());
  const canMigrate = Boolean(canConnect && projectId.trim() && totalItems);

  function missingHint() {
    if (!apiKey.trim()) return "Pega la API key que generaste en Kaneo (Configuración de cuenta → API Keys).";
    if (!baseUrl.trim()) return "Falta la URL de tu instancia de Kaneo.";
    if (!projectId.trim()) return "Falta el ID del proyecto destino (está en la URL del tablero de Kaneo).";
    if (!totalItems) return "No hay tareas para migrar.";
    return "";
  }

  async function handleConnect() {
    setStatus("connecting");
    setMessage("");
    setSummary(null);
    setBrowserBlocked(false);
    try {
      const list = await listProjects({ baseUrl, apiKey: apiKey.trim(), workspaceId: workspaceId.trim() });
      setProjects(list);
      persistConnection(projectId);
      setStatus("ready");
      setMessage(
        list.length
          ? `Conectado. ${list.length} proyecto${list.length === 1 ? "" : "s"} encontrado${list.length === 1 ? "" : "s"} en el workspace.`
          : "Se conectó, pero no se pudo listar proyectos automáticamente — puedes dejar el ID de proyecto que ya está escrito abajo."
      );
    } catch (e) {
      setStatus("error");
      if (isKaneoBrowserBlocked(e)) {
        setBrowserBlocked(true);
        setMessage("El navegador no pudo hablar con Kaneo (CORS o URL). Puedes seguir y migrar igual, o descargar el respaldo.");
      } else {
        setMessage(e.message || "No se pudo conectar con Kaneo.");
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
    setBrowserBlocked(false);
    persistConnection(projectId);
    if (onBackup) onBackup();
    try {
      const result = await migrateToKaneo({
        baseUrl,
        apiKey: apiKey.trim(),
        workspaceId: workspaceId.trim(),
        projectId: projectId.trim(),
        tasks,
        initiatives,
        deletedItems,
        onProgress: setProgress,
        onItemMigrated,
      });
      // Nota: `initiatives` sigue viajando aquí solo porque migrateToKaneo la usa
      // para buscar el título de la iniciativa de cada tarea (texto en la descripción);
      // ya no crea tarjetas de Kaneo a partir de iniciativas.
      setSummary(result);
      setProgress(null);
      setStatus("done");
      setMessage(
        result.failed
          ? "La migración terminó con algunos errores (abajo el detalle). Puedes volver a pulsar Migrar: lo ya enviado se actualiza, no se duplica."
          : "Listo. Se envió a Kaneo. Revisa el tablero allá — si alguna tarea no aparece en la columna esperada, dime y ajustamos el mapeo de estados."
      );
    } catch (e) {
      setStatus("error");
      setProgress(null);
      if (isKaneoBrowserBlocked(e)) {
        setBrowserBlocked(true);
        setMessage("El navegador no pudo hablar con Kaneo (CORS o URL). Descarga el respaldo mientras lo revisamos.");
      } else {
        setMessage(e.message || "La migración falló.");
      }
    }
  }

  function handleDownload() {
    downloadJson(`fliipa-para-kaneo-${new Date().toISOString().slice(0, 10)}.json`, buildMigrationPackage({ tasks, initiatives }));
  }

  async function handleCleanupInitiatives() {
    if (!migratedInitiatives.length) return;
    if (!canConnect) {
      setCleanupStatus("error");
      setCleanupMessage("Conecta primero (URL, proyecto y API key) para poder borrar en Kaneo.");
      return;
    }
    const ok = window.confirm(
      `Esto borra en Kaneo ${migratedInitiatives.length} tarjeta${migratedInitiatives.length === 1 ? "" : "s"} que quedaron ahí de cuando las iniciativas se migraban por error (no toca tareas reales, ni nada en Fliipa). ¿Seguro?`
    );
    if (!ok) return;
    setCleanupStatus("running");
    setCleanupMessage("");
    setCleanupSummary(null);
    try {
      const result = await cleanupMigratedInitiatives({
        baseUrl,
        apiKey: apiKey.trim(),
        workspaceId: workspaceId.trim(),
        projectId: projectId.trim(),
        initiatives,
        onProgress: setCleanupProgress,
        onItemCleaned: onInitiativeCleaned,
      });
      setCleanupSummary(result);
      setCleanupProgress(null);
      setCleanupStatus("done");
      setCleanupMessage(
        result.failed
          ? "Se borraron algunas, otras fallaron (detalle abajo)."
          : `Listo, se borraron ${result.deleted} tarjeta${result.deleted === 1 ? "" : "s"} de iniciativas en Kaneo.`
      );
    } catch (e) {
      setCleanupStatus("error");
      setCleanupProgress(null);
      setCleanupMessage(e.message || "No se pudo limpiar.");
    }
  }

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
          Migrar todo a Kaneo
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
          Sigan trabajando aquí. Esta opción envía{" "}
          <strong style={{ color: C.text, fontWeight: 600 }}>las tareas</strong> al proyecto de Kaneo que indiques
          (las iniciativas no se crean como tarjetas aparte; cada tarea lleva su iniciativa escrita en la
          descripción). No borra ni deja de sincronizar este tablero.
        </div>
        <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 10 }}>
          Ahora mismo hay {tasks.length} tarea{tasks.length === 1 ? "" : "s"}
          {already ? ` · ${already} ya vinculadas a Kaneo` : ""}.
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
            Antes de migrar
          </div>
          <div style={{ marginBottom: 8 }}>
            El vínculo entre una tarea de Fliipa y su tarea en Kaneo queda guardado en la tarea de Fliipa, así que
            volver a migrar actualiza en vez de duplicar.
          </div>
          <div style={{ marginBottom: 8 }}>
            Los responsables se intentan reconocer por nombre (igual que con Plane). Si Kaneo no tiene a esa persona
            invitada al proyecto, la tarea igual llega, solo que sin asignar — el nombre de Fliipa queda escrito en
            la descripción para no perder el dato.
          </div>
          {audit.orphanInitiative.length > 0 && (
            <div style={{ marginBottom: 6, color: C.text }}>
              {audit.orphanInitiative.length} tarea{audit.orphanInitiative.length === 1 ? "" : "s"} apunta
              {audit.orphanInitiative.length === 1 ? "" : "n"} a una iniciativa que ya no está en el tablero; igual se
              migran, sueltas.
            </div>
          )}
          {audit.withoutInitiative.length > 0 && (
            <div>{audit.withoutInitiative.length} tarea{audit.withoutInitiative.length === 1 ? "" : "s"} sin iniciativa: van sueltas en Kaneo.</div>
          )}
        </div>

        {migratedInitiatives.length > 0 && (
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
              Tarjetas de iniciativas para limpiar
            </div>
            <div style={{ marginBottom: 10 }}>
              {migratedInitiatives.length} iniciativa{migratedInitiatives.length === 1 ? "" : "s"} de Fliipa quedaron con su propia tarjeta en Kaneo de
              cuando la migración todavía las incluía por error. Ya no se van a volver a crear, pero las que ya existen
              hay que borrarlas a mano o con este botón (conecta primero arriba).
            </div>
            <button
              onClick={handleCleanupInitiatives}
              style={ghost}
              disabled={cleanupStatus === "running" || !canConnect}
              title={!canConnect ? "Conecta primero con tu API key" : ""}
            >
              {cleanupStatus === "running" ? "Borrando…" : `Borrar ${migratedInitiatives.length} tarjeta${migratedInitiatives.length === 1 ? "" : "s"} de iniciativas`}
            </button>
            {cleanupProgress && (
              <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 10 }}>
                Borrando {cleanupProgress.current} de {cleanupProgress.total}: {cleanupProgress.label}
              </div>
            )}
            {cleanupMessage && (
              <div style={{ fontSize: 13, color: cleanupStatus === "error" ? C.danger : C.textMuted, marginTop: 10, lineHeight: 1.45 }}>
                {cleanupMessage}
              </div>
            )}
            {cleanupSummary && cleanupSummary.errors.length > 0 && (
              <div style={{ marginTop: 8, color: C.danger, fontSize: 12.5 }}>
                {cleanupSummary.errors.slice(0, 5).map((err) => (
                  <div key={err}>{err}</div>
                ))}
              </div>
            )}
          </div>
        )}

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
              Entra a tu cuenta en Kaneo y ve a <strong style={{ color: C.text, fontWeight: 600 }}>Configuración de cuenta → API Keys</strong>, crea una clave y cópiala (solo se muestra una vez).
            </li>
            <li style={{ marginBottom: 6 }}>La URL de la instancia y el ID del proyecto ya están rellenados abajo con los de Sumz / Fliipa.</li>
            <li>
              Pega la API key y pulsa <strong style={{ color: C.text, fontWeight: 600 }}>Conectar</strong>, revisa el
              proyecto y luego <strong style={{ color: C.text, fontWeight: 600 }}>Migrar a Kaneo</strong>.
            </li>
          </ol>
        </div>

        <label style={label}>URL de tu instancia de Kaneo</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://orbit.sumz.co" style={input} />

        <label style={label}>ID del workspace</label>
        <input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} placeholder="ID del workspace en Kaneo" style={input} />

        <label style={label}>ID del proyecto destino</label>
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="ID del proyecto en Kaneo" style={input} />

        <label style={label}>API key de Kaneo</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Pega aquí tu API key"
          autoComplete="off"
          style={input}
        />
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4 }}>
          La clave no se comparte con el equipo ni se guarda en este tablero.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={handleConnect} style={ghost} disabled={!canConnect || status === "connecting" || status === "migrating"}>
            {status === "connecting" ? "Conectando…" : "Conectar"}
          </button>
        </div>

        {projects.length > 0 && (
          <>
            <label style={label}>Proyecto destino</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={input}>
              <option value="">Elige un proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
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

        {browserBlocked && (
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
            Mientras se revisa la conexión, descarga el respaldo de tus tareas e iniciativas para no perder nada.
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
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={handleDownload} style={ghost}>
            Descargar respaldo (JSON)
          </button>
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
              {status === "migrating" ? "Migrando…" : already ? "Migrar / actualizar" : "Migrar a Kaneo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
