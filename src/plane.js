export const PLANE_SOURCE = "fliipa-kanban";
export const DEFAULT_PLANE_BASE = "https://api.plane.so";

const TYPE_COLORS = {
  Bug: "#E2574C",
  Feature: "#3EE0B4",
  Task: "#4C7EF3",
  Mejora: "#B48EDE",
  Iniciativa: "#6D5DFC",
};

const COLUMN_HINTS = {
  backlog: { groups: ["backlog"], names: ["backlog", "pendiente"] },
  todo: { groups: ["unstarted"], names: ["todo", "to do", "por hacer", "to-do"] },
  in_progress: { groups: ["started"], names: ["in progress", "progress", "progreso", "doing", "started"] },
  review: { groups: ["started"], names: ["review", "revisión", "revision", "en revisión"] },
  done: { groups: ["completed"], names: ["done", "hecho", "completed", "complete", "cerrado"] },
};

const FLIIPA_STATE_STYLE = {
  backlog: { name: "Pendiente", color: "#C5CAD8" },
  todo: { name: "Por hacer", color: "#8B8CFF" },
  in_progress: { name: "En progreso", color: "#5B8CFF" },
  review: { name: "En revisión", color: "#B48EDE" },
  done: { name: "Hecho", color: "#3EE0B4" },
};

export function normalizeBase(url) {
  const raw = String(url || DEFAULT_PLANE_BASE).trim().replace(/\/+$/, "");
  if (/^https?:\/\/app\.plane\.so$/i.test(raw)) return DEFAULT_PLANE_BASE;
  return raw || DEFAULT_PLANE_BASE;
}

export function parseWorkspaceInput(text) {
  const value = String(text || "").trim();
  const fromApp = value.match(/^https?:\/\/(?:app\.)?plane\.so\/([^/?#]+)/i);
  if (fromApp) return fromApp[1];
  const fromPath = value.match(/workspaces\/([^/?#]+)/i);
  if (fromPath) return fromPath[1];
  return value.replace(/^\/+|\/+$/g, "");
}

function sameId(a, b) {
  if (a == null || b == null || a === "") return false;
  return String(a) === String(b);
}

function resultsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function planeRequest({ baseUrl, apiKey, path, method = "GET", body }) {
  let lastErr = null;
  const proxies = planeProxyUrls();
  for (const proxy of proxies) {
    try {
      return await planeRequestViaProxy(proxy, { baseUrl, apiKey, path, method, body });
    } catch (e) {
      lastErr = e;
    }
  }
  try {
    return await planeRequestDirect({ baseUrl, apiKey, path, method, body });
  } catch (e) {
    if (e.name === "TypeError" || /Failed to fetch|NetworkError|CORS/i.test(e.message || "")) {
      const err = new Error(
        "El navegador no puede hablar con Plane (CORS). Descarga el CSV e impórtalo en Plane: Workspace Settings → Imports → CSV."
      );
      err.code = "PLANE_BROWSER_BLOCKED";
      err.cause = lastErr || e;
      throw err;
    }
    throw e;
  }
}

function isGithubPages() {
  return typeof window !== "undefined" && /\.github\.io$/i.test(window.location.hostname);
}

const HOSTED_PLANE_PROXY = "https://tablero-fliipa-plane.excited-marshmallow.workers.dev";

function planeProxyUrls() {
  const urls = [];
  if (typeof window !== "undefined") {
    const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
    try {
      const local = new URL("api/plane", window.location.origin + (base.endsWith("/") ? base : `${base}/`)).toString();
      if (!isGithubPages()) urls.push(local);
    } catch (e) {
      /* ignore */
    }
  }
  const hosted = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_PLANE_PROXY) || HOSTED_PLANE_PROXY;
  if (hosted) urls.push(hosted);
  return urls;
}

async function parsePlaneResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || data.message)) ||
      (typeof data?.raw === "string" && data.raw.slice(0, 180)) ||
      `Plane respondió ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function planeRequestViaProxy(proxyUrl, { baseUrl, apiKey, path, method, body }) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey, path, method, body }),
  });
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("json")) {
    const err = new Error("Este visor no tiene puente hacia Plane.");
    err.status = res.status;
    throw err;
  }
  return parsePlaneResponse(res);
}

async function planeRequestDirect({ baseUrl, apiKey, path, method, body }) {
  const res = await fetch(`${normalizeBase(baseUrl)}/api/v1${path}`, {
    method,
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parsePlaneResponse(res);
}

export async function listProjects(cfg) {
  return resultsOf(
    await planeRequest({
      ...cfg,
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/?per_page=100`,
    })
  );
}

export async function listStates(cfg) {
  return resultsOf(
    await planeRequest({
      ...cfg,
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/states/?per_page=100`,
    })
  );
}

export async function listLabels(cfg) {
  return resultsOf(
    await planeRequest({
      ...cfg,
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/labels/?per_page=100`,
    })
  );
}

export async function listMembers(cfg) {
  const paths = [
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/members/?per_page=100`,
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/project-members/?per_page=100&expand=member`,
  ];
  let lastErr = null;
  for (const path of paths) {
    try {
      return resultsOf(await planeRequest({ ...cfg, path }));
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

export function matchState(states, columnId) {
  const hint = COLUMN_HINTS[columnId] || COLUMN_HINTS.todo;
  const list = states || [];
  const byName = list.find((s) => hint.names.some((n) => String(s.name || "").toLowerCase().includes(n)));
  if (byName) return byName;
  return list.find((s) => hint.groups.includes(s.group)) || list.find((s) => s.default) || list[0] || null;
}

function memberName(member) {
  const person = member?.member && typeof member.member === "object" ? member.member : member;
  return [person?.display_name, person?.first_name, person?.last_name, person?.email, member?.display_name]
    .filter(Boolean)
    .join(" ");
}

function memberId(member) {
  if (!member) return null;
  if (typeof member.member === "string") return member.member;
  if (member.member && member.member.id) return member.member.id;
  return member.id || null;
}

export function matchMember(members, name) {
  if (!name) return null;
  const needle = String(name).trim().toLowerCase();
  return (members || []).find((m) => {
    const hay = memberName(m).toLowerCase();
    const email = String(m?.email || m?.member?.email || "").toLowerCase();
    return hay === needle || hay.includes(needle) || email.split("@")[0] === needle;
  });
}

async function alignPlaneLabels(cfg, labels) {
  const renames = { bug: "Incidencia", feature: "Funcionalidad", task: "Tarea" };
  for (const label of labels || []) {
    const next = renames[String(label.name || "").toLowerCase()];
    if (!next || String(label.name) === next) continue;
    try {
      const updated = await planeRequest({
        ...cfg,
        method: "PATCH",
        path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/labels/${label.id}/`,
        body: { name: next },
      });
      Object.assign(label, updated || { name: next });
    } catch (e) {
      /* ignore */
    }
    await sleep(120);
  }
}

async function ensureLabel(cfg, labels, name, color) {
  const existing = labels.find((l) => String(l.name || "").toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const created = await planeRequest({
    ...cfg,
    method: "POST",
    path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/labels/`,
    body: { name, color, external_source: PLANE_SOURCE, external_id: `label-${name}` },
  });
  labels.push(created);
  return created;
}

async function ensureReviewState(cfg, states) {
  if (matchState(states, "review") && /review|revis/i.test(matchState(states, "review").name || "")) {
    return matchState(states, "review");
  }
  try {
    const created = await planeRequest({
      ...cfg,
      method: "POST",
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/states/`,
      body: { name: "En revisión", color: "#B48EDE", group: "started" },
    });
    states.push(created);
    return created;
  } catch (e) {
    return matchState(states, "in_progress");
  }
}

async function patchState(cfg, state, body) {
  if (!state?.id) return state;
  const nextName = body.name;
  const nextColor = body.color;
  if (nextName && String(state.name) === nextName && (!nextColor || String(state.color || "").toLowerCase() === nextColor.toLowerCase())) {
    return state;
  }
  const updated = await planeRequest({
    ...cfg,
    method: "PATCH",
    path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/states/${state.id}/`,
    body,
  });
  Object.assign(state, updated || body);
  return state;
}

async function alignPlaneStates(cfg, states) {
  await ensureReviewState(cfg, states);
  for (const columnId of ["backlog", "todo", "in_progress", "review", "done"]) {
    const style = FLIIPA_STATE_STYLE[columnId];
    const state = matchState(states, columnId);
    if (!state || !style) continue;
    try {
      await patchState(cfg, state, { name: style.name, color: style.color });
    } catch (e) {
      /* el nombre puede chocar si ya existe otro estado igual */
    }
    await sleep(120);
  }
  const cancelled = (states || []).find((s) => s.group === "cancelled");
  if (cancelled) {
    try {
      await patchState(cfg, cancelled, { name: "Cancelado", color: "#E2574C" });
    } catch (e) {
      /* ignore */
    }
  }
}

async function preferBoardLayout(cfg) {
  const viewsPath = `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/views/?per_page=50`;
  try {
    const views = resultsOf(await planeRequest({ ...cfg, path: viewsPath }));
    const view =
      views.find((v) => v.is_default) ||
      views.find((v) => /work items|all issues|todas/i.test(v.name || "")) ||
      views[0];
    if (!view?.id) return;
    const filters = { ...(view.display_filters || {}), layout: "kanban", group_by: "state" };
    try {
      await planeRequest({
        ...cfg,
        method: "PATCH",
        path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/views/${view.id}/`,
        body: { display_filters: filters },
      });
    } catch (e) {
      filters.layout = "board";
      await planeRequest({
        ...cfg,
        method: "PATCH",
        path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/views/${view.id}/`,
        body: { display_filters: filters },
      });
    }
  } catch (e) {
    /* Plane no siempre deja cambiar la vista por API; el usuario puede pulsar Tablero */
  }
}

function buildTaskHtml(task, initiative) {
  const lines = [];
  if (task.description) {
    escapeHtml(task.description)
      .split(/\n/)
      .forEach((line) => lines.push(`<p>${line || "&nbsp;"}</p>`));
  }
  if (task.notes) {
    escapeHtml(task.notes)
      .split(/\n/)
      .forEach((line) => lines.push(`<p>${line || "&nbsp;"}</p>`));
  }
  const extras = [];
  if (initiative && initiative.title) extras.push(`Iniciativa: ${escapeHtml(initiative.title)}`);
  if (task.type) extras.push(`Tipo: ${escapeHtml(TASK_TYPES_LABEL(task.type))}`);
  if (task.blocked) extras.push("Marcada como bloqueada en Fliipa");
  if (task.assignee) extras.push(`Responsable en Fliipa: ${escapeHtml(task.assignee)}`);
  if (Array.isArray(task.attachments) && task.attachments.length) {
    extras.push("Adjuntos: " + task.attachments.map((a) => escapeHtml(a.name)).join(", "));
  }
  extras.push("Migrado desde el tablero Kanban de Fliipa");
  if (extras.length) {
    lines.push("<p>&nbsp;</p>");
    extras.forEach((item) => lines.push(`<p>${item}</p>`));
  }
  return lines.join("") || "<p></p>";
}

function TASK_TYPES_LABEL(type) {
  if (type === "Task") return "Tarea";
  return type || "Tarea";
}

function buildInitiativeHtml(initiative) {
  const lines = [`<p>Iniciativa estratégica migrada desde Fliipa.</p>`];
  if (initiative.notes) {
    escapeHtml(initiative.notes)
      .split(/\n/)
      .forEach((line) => lines.push(`<p>${line || "&nbsp;"}</p>`));
  }
  lines.push(`<p>Responsable: ${escapeHtml(initiative.owner || "Sin asignar")}</p>`);
  lines.push(`<p>Progreso: ${Number(initiative.progress) || 0}%</p>`);
  return lines.join("");
}

function flattenWorkItems(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((item) => item && item.id);
  const results = data.results;
  if (Array.isArray(results)) return results.filter((item) => item && item.id);
  if (results && typeof results === "object") {
    return Object.values(results).flatMap((value) => flattenWorkItems(value));
  }
  return [];
}

async function listAllWorkItems(cfg) {
  const all = [];
  const seen = new Set();
  const paths = [
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/`,
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/issues/`,
  ];
  for (const basePath of paths) {
    let cursor = "";
    for (let page = 1; page <= 30; page++) {
      const qs = new URLSearchParams({ per_page: "100" });
      if (cursor) qs.set("cursor", cursor);
      let data;
      try {
        data = await planeRequest({ ...cfg, path: `${basePath}?${qs.toString()}` });
      } catch (e) {
        break;
      }
      const batch = flattenWorkItems(data);
      for (const item of batch) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          all.push(item);
        }
      }
      const hasNext = data?.next_page_results === true;
      const next = data?.next_cursor || "";
      if (!hasNext || !next || batch.length === 0) break;
      cursor = next;
    }
    if (all.length) break;
  }
  return all;
}

function isFliipaItem(item) {
  return String(item?.external_source || "") === PLANE_SOURCE;
}

function isPlaneOnboarding(item) {
  const name = String(item?.name || item?.title || "").replace(/\s+/g, " ").trim();
  return (
    /create projects/i.test(name) ||
    /create and assign work items/i.test(name) ||
    /visualize your work/i.test(name) ||
    /invite (your )?team/i.test(name) ||
    /getting started/i.test(name) ||
    /^\d+\.\s+.+(🎯|🖊️|🔮|🚀)/u.test(name)
  );
}

async function removeWorkItem(cfg, item, cancelledStateId) {
  const id = item.id;
  const attempts = [
    { method: "DELETE", path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${id}/` },
    { method: "DELETE", path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/issues/${id}/` },
  ];
  for (const attempt of attempts) {
    try {
      await planeRequest({ ...cfg, ...attempt });
      return true;
    } catch (e) {
      if (e.status === 404) return true;
    }
  }
  if (cancelledStateId) {
    try {
      await planeRequest({
        ...cfg,
        method: "PATCH",
        path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${id}/`,
        body: { state: cancelledStateId },
      });
    } catch (e) {
      /* sigue al archivo */
    }
  }
  try {
    await planeRequest({
      ...cfg,
      method: "POST",
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${id}/archive/`,
    });
    return true;
  } catch (e) {
    /* ignore */
  }
  try {
    await planeRequest({
      ...cfg,
      method: "PATCH",
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${id}/`,
      body: { archived_at: new Date().toISOString() },
    });
    return true;
  } catch (e) {
    return false;
  }
}

function normTitle(value) {
  return String(value || "")
    .replace(/^\[iniciativa\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parentIdOf(item) {
  if (!item || item.parent == null || item.parent === "") return "";
  if (typeof item.parent === "string") return item.parent;
  return item.parent.id || "";
}

async function hydrateWorkItem(cfg, item) {
  if (!item?.id) return item;
  if (item.external_id || item.external_source) return item;
  const paths = [
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${item.id}/`,
    `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/issues/${item.id}/`,
  ];
  for (const path of paths) {
    try {
      const detail = await planeRequest({ ...cfg, path });
      if (detail && detail.id) return { ...item, ...detail };
    } catch (e) {
      /* try next */
    }
  }
  return item;
}

async function cleanupPlaneExtras(cfg, { keepIds, keepPlaneIds, keepTitles, deletedItems, states }) {
  const keepExt = new Set([...(keepIds || [])].map(String));
  const keepPlane = new Set([...(keepPlaneIds || [])].filter(Boolean).map(String));
  const records = (deletedItems || []).map((row) => (typeof row === "string" ? { id: row } : row || {}));
  const delExt = new Set(records.map((row) => String(row.id || "")).filter(Boolean));
  const delPlane = new Set(records.map((row) => String(row.planeWorkItemId || "")).filter(Boolean));
  const liveTitles = new Set([...(keepTitles || [])].map(normTitle).filter(Boolean));
  const delTitles = new Set();
  records.forEach((row) => {
    const title = normTitle(row.title);
    if (title) delTitles.add(title);
  });
  const cancelled = (states || []).find((s) => s.group === "cancelled");
  let removed = 0;
  const errors = [];
  const alreadyRemoved = new Set();

  for (const planeId of delPlane) {
    if (keepPlane.has(planeId)) continue;
    const ok = await removeWorkItem(cfg, { id: planeId }, cancelled?.id);
    if (ok) {
      removed += 1;
      alreadyRemoved.add(planeId);
    } else {
      errors.push(`No se pudo quitar en Plane el ítem ya borrado (${planeId.slice(0, 8)}…)`);
    }
    await sleep(180);
  }

  const remote = [];
  for (const item of await listAllWorkItems(cfg)) {
    remote.push(await hydrateWorkItem(cfg, item));
    await sleep(40);
  }

  const drop = [];
  const dropIds = new Set();
  function markDrop(item) {
    if (!item?.id || keepPlane.has(item.id) || dropIds.has(item.id) || alreadyRemoved.has(item.id)) return;
    dropIds.add(item.id);
    drop.push(item);
  }

  for (const item of remote) {
    const ext = item.external_id == null || item.external_id === "" ? "" : String(item.external_id);
    const title = normTitle(item.name || item.title);
    const gone =
      delPlane.has(item.id) ||
      (ext && delExt.has(ext)) ||
      (isFliipaItem(item) && ext && !keepExt.has(ext)) ||
      (title && delTitles.has(title) && !liveTitles.has(title)) ||
      isPlaneOnboarding(item);
    if (gone) markDrop(item);
  }
  for (const item of remote) {
    const parent = parentIdOf(item);
    if (parent && dropIds.has(parent)) markDrop(item);
  }

  drop.sort((a, b) => (parentIdOf(a) ? 0 : 1) - (parentIdOf(b) ? 0 : 1));
  for (const item of drop) {
    if (alreadyRemoved.has(item.id)) continue;
    const ok = await removeWorkItem(cfg, item, cancelled?.id);
    if (ok) removed += 1;
    else errors.push(`No se pudo quitar: ${item.name || item.id}`);
    await sleep(180);
  }
  return { removed, scanned: remote.length, errors };
}

async function findExisting(cfg, externalId) {
  try {
    const found = resultsOf(
      await planeRequest({
        ...cfg,
        path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/?per_page=5&external_id=${encodeURIComponent(externalId)}&external_source=${encodeURIComponent(PLANE_SOURCE)}`,
      })
    );
    return found[0] || null;
  } catch (e) {
    return null;
  }
}

async function upsertWorkItem(cfg, payload, existingId) {
  if (existingId) {
    return planeRequest({
      ...cfg,
      method: "PATCH",
      path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/${existingId}/`,
      body: payload,
    });
  }
  return planeRequest({
    ...cfg,
    method: "POST",
    path: `/workspaces/${encodeURIComponent(cfg.workspace)}/projects/${cfg.projectId}/work-items/`,
    body: payload,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildMigrationPackage({ tasks, initiatives }) {
  return {
    generatedAt: new Date().toISOString(),
    source: PLANE_SOURCE,
    app: "Fliipa Kanban",
    tasks: (tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      notes: t.notes || "",
      type: t.type,
      assignee: t.assignee || "",
      status: t.status,
      dueDate: t.dueDate || null,
      blocked: !!t.blocked,
      initiativeId: t.initiativeId || null,
      attachments: (t.attachments || []).map((a) => ({ id: a.id, name: a.name, type: a.type, isImage: !!a.isImage })),
      planeWorkItemId: t.planeWorkItemId || null,
    })),
    initiatives: (initiatives || []).map((i) => ({
      id: i.id,
      title: i.title,
      owner: i.owner || "",
      progress: Number(i.progress) || 0,
      status: i.status || "backlog",
      notes: i.notes || "",
      dueDate: i.dueDate || null,
      planeWorkItemId: i.planeWorkItemId || null,
    })),
  };
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const STATE_GROUP = {
  backlog: "backlog",
  todo: "unstarted",
  in_progress: "started",
  review: "started",
  done: "completed",
};

export function buildPlaneCsv({ tasks, initiatives }) {
  const header = ["name", "description_html", "priority", "start_date", "target_date", "state_group"];
  const rows = [header.join(",")];
  (initiatives || []).forEach((ini) => {
    const title = ini.title ? `[Iniciativa] ${ini.title}` : "[Iniciativa]";
    rows.push(
      [
        csvCell(title),
        csvCell(buildInitiativeHtml(ini)),
        "none",
        "",
        csvCell(ini.dueDate || ""),
        STATE_GROUP[ini.status] || "backlog",
      ].join(",")
    );
  });
  (tasks || []).forEach((task) => {
    const initiative = (initiatives || []).find((ini) => sameId(ini.id, task.initiativeId));
    rows.push(
      [
        csvCell(task.title || "Sin título"),
        csvCell(buildTaskHtml(task, initiative)),
        task.blocked ? "high" : "none",
        "",
        csvCell(task.dueDate || ""),
        STATE_GROUP[task.status] || "unstarted",
      ].join(",")
    );
  });
  return `\uFEFF${rows.join("\n")}`;
}

export async function migrateToPlane({
  baseUrl,
  apiKey,
  workspace,
  projectId,
  tasks,
  initiatives,
  deletedIds,
  deletedItems,
  onProgress,
  onItemMigrated,
}) {
  const cfg = { baseUrl, apiKey, workspace: parseWorkspaceInput(workspace), projectId };
  const deletedRecords =
    deletedItems && deletedItems.length
      ? deletedItems
      : (deletedIds || []).map((id) => ({ id }));
  const dropped = new Set(deletedRecords.map((row) => String(row.id || row)).filter(Boolean));
  const liveTasks = (tasks || []).filter((t) => t && !dropped.has(String(t.id)));
  const liveInits = (initiatives || []).filter((i) => i && !dropped.has(String(i.id)));
  const keepIds = [...liveTasks.map((t) => t.id), ...liveInits.map((i) => i.id)];
  const states = await listStates(cfg);
  const labels = await listLabels(cfg);
  let members = [];
  try {
    members = await listMembers(cfg);
  } catch (e) {
    members = [];
  }

  await alignPlaneStates(cfg, states);
  try {
    await preferBoardLayout(cfg);
  } catch (e) {
    /* ignore */
  }
  try {
    await alignPlaneLabels(cfg, labels);
  } catch (e) {
    /* ignore */
  }
  const summary = { created: 0, updated: 0, failed: 0, removed: 0, errors: [] };
  const stateMap = {
    backlog: matchState(states, "backlog"),
    todo: matchState(states, "todo"),
    in_progress: matchState(states, "in_progress"),
    review: matchState(states, "review"),
    done: matchState(states, "done"),
  };

  const typeLabels = {};
  const planeTypeNames = [
    { key: "Bug", name: "Incidencia" },
    { key: "Feature", name: "Funcionalidad" },
    { key: "Task", name: "Tarea" },
    { key: "Mejora", name: "Mejora" },
    { key: "Iniciativa", name: "Iniciativa" },
  ];
  for (const { key, name } of planeTypeNames) {
    typeLabels[key] = await ensureLabel(cfg, labels, name, TYPE_COLORS[key] || TYPE_COLORS.Iniciativa);
    await sleep(150);
  }

  const items = [
    ...liveInits.map((initiative) => ({ kind: "initiative", item: initiative })),
    ...liveTasks.map((task) => ({ kind: "task", item: task })),
  ];
  const planeIds = {};
  liveInits.forEach((ini) => {
    if (ini.planeWorkItemId) planeIds[ini.id] = ini.planeWorkItemId;
  });
  liveTasks.forEach((task) => {
    if (task.planeWorkItemId) planeIds[task.id] = task.planeWorkItemId;
  });

  for (let i = 0; i < items.length; i++) {
    const { kind, item } = items[i];
    if (onProgress) onProgress({ current: i + 1, total: items.length, label: item.title || item.id });
    try {
      const existing =
        (item.planeWorkItemId && { id: item.planeWorkItemId }) ||
        (planeIds[item.id] && { id: planeIds[item.id] }) ||
        (await findExisting(cfg, item.id));
      let payload;
      if (kind === "task") {
        const member = matchMember(members, item.assignee);
        const initiative = liveInits.find((ini) => sameId(ini.id, item.initiativeId));
        const parentId = item.initiativeId ? planeIds[item.initiativeId] || initiative?.planeWorkItemId : null;
        payload = {
          name: item.title || "Sin título",
          description_html: buildTaskHtml(item, initiative),
          state: (stateMap[item.status] || stateMap.todo)?.id,
          target_date: item.dueDate || null,
          priority: item.blocked ? "high" : "none",
          labels: typeLabels[item.type] ? [typeLabels[item.type].id] : [],
          assignees: member && memberId(member) ? [memberId(member)] : [],
          external_source: PLANE_SOURCE,
          external_id: item.id,
        };
        if (parentId) payload.parent = parentId;
      } else {
        const member = matchMember(members, item.owner);
        payload = {
          name: item.title || "Iniciativa",
          description_html: buildInitiativeHtml(item),
          state: (stateMap[item.status] || stateMap.backlog || stateMap.todo)?.id,
          target_date: item.dueDate || null,
          priority: "none",
          labels: typeLabels.Iniciativa ? [typeLabels.Iniciativa.id] : [],
          assignees: member && memberId(member) ? [memberId(member)] : [],
          external_source: PLANE_SOURCE,
          external_id: item.id,
        };
      }
      let saved;
      try {
        saved = await upsertWorkItem(cfg, payload, existing?.id);
      } catch (e) {
        if (payload.parent) {
          delete payload.parent;
          saved = await upsertWorkItem(cfg, payload, existing?.id);
        } else {
          throw e;
        }
      }
      if (existing?.id) summary.updated += 1;
      else summary.created += 1;
      if (saved?.id) {
        planeIds[item.id] = saved.id;
        if (onItemMigrated) onItemMigrated({ kind, id: item.id, planeWorkItemId: saved.id });
      }
    } catch (e) {
      summary.failed += 1;
      summary.errors.push(`${item.title || item.id}: ${e.message}`);
    }
    await sleep(250);
  }

  try {
    if (onProgress) onProgress({ current: items.length, total: items.length, label: "Quitando en Plane lo que ya no está en Fliipa" });
    const cleaned = await cleanupPlaneExtras(cfg, {
      keepIds,
      keepPlaneIds: Object.values(planeIds),
      keepTitles: [...liveTasks.map((t) => t.title), ...liveInits.map((i) => i.title)],
      deletedItems: deletedRecords,
      states,
    });
    summary.removed = cleaned.removed;
    if (cleaned.errors?.length) summary.errors.push(...cleaned.errors.slice(0, 8));
  } catch (e) {
    summary.errors.push(`Limpieza: ${e.message}`);
  }

  return summary;
}
