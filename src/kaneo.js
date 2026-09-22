// Migración de Fliipa (este tablero) hacia Kaneo (https://github.com/usekaneo/kaneo),
// el reemplazo de la vieja migración a Plane. La arquitectura sigue el mismo patrón que
// plane.js: se reutilizan aquí las mismas utilidades de nombres (foldName, PERSON_ALIASES,
// resolvePersonNick, matchMember) para no mantener dos tablas de alias distintas.
//
// OJO — a diferencia de Plane, esto no se pudo probar en vivo contra una instancia real
// (no hay forma de que Claude tenga tu API key): está escrito contra la documentación
// pública de la API de Kaneo (auth Bearer, /task/{projectId}, /task/tasks/{projectId},
// prioridad no-priority|low|medium|high|urgent, estado como texto libre por proyecto).
// Si algo no calza exactamente con tu instancia (orbit.sumz.co, v2.25.0), el error que
// tire la llamada real es la mejor pista para ajustar la ruta o el payload.

import { foldName, cleanRepeatedName, aliasForName, resolvePersonNick, PERSON_ALIASES } from "./plane";

export const KANEO_SOURCE = "fliipa-kanban";

// Debe coincidir con los nombres reales de las columnas de tu proyecto en Kaneo
// (Sumz / Fliipa): Backlog, Blocked, In progress, PR review, QA dev, QA Prod, Hecho.
const COLUMN_HINTS = {
  backlog: ["backlog", "pendiente", "to-do", "to do", "todo"],
  blocked: ["blocked", "bloqueado"],
  in_progress: ["in progress", "in development", "progreso", "doing"],
  review: ["pr review", "review", "revisión", "revision", "in-review"],
  dev_qa: ["qa dev", "dev qa"],
  product_qa: ["qa prod", "product qa"],
  done: ["hecho", "completado", "done", "cerrado"],
};

// Slugs reales del proyecto Fliipa en orbit.sumz.co (Kaneo los reveló tal cual
// en el error de la primera migración real: "Valid statuses for this project:
// to-do, blocked, in-progress, in-review, qa-prod, done, qa-production, planned,
// archived"). Se usan de respaldo cuando no se logra leer la lista de columnas
// en vivo. "QA dev" ↔ qa-production y "QA Prod" ↔ qa-prod es lo único no 100%
// confirmado — si alguna tarea cae en la columna QA equivocada, se intercambian.
const FLIIPA_COLUMN_LABEL = {
  backlog: "to-do",
  blocked: "blocked",
  in_progress: "in-progress",
  review: "in-review",
  dev_qa: "qa-production",
  product_qa: "qa-prod",
  done: "done",
};

export function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function sameId(a, b) {
  if (a == null || b == null || a === "") return false;
  return String(a) === String(b);
}

export function isKaneoBrowserBlocked(e) {
  return (
    e?.code === "KANEO_BROWSER_BLOCKED" ||
    e?.name === "TypeError" ||
    /Failed to fetch|NetworkError|CORS/i.test(e?.message || "")
  );
}

async function parseKaneoResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  if (!res.ok) {
    const message =
      (data && (data.message || data.error || data.detail)) ||
      (typeof data?.raw === "string" && data.raw.slice(0, 180)) ||
      `Kaneo respondió ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function localProxyUrl() {
  if (typeof window === "undefined") return null;
  try {
    const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
    return new URL("api/kaneo", window.location.origin + (base.endsWith("/") ? base : `${base}/`)).toString();
  } catch (e) {
    return null;
  }
}

async function kaneoRequestViaProxy(proxyUrl, { baseUrl, apiKey, path, method, body }) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: normalizeBase(baseUrl), apiKey, path, method, body }),
  });
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("json")) {
    const err = new Error("Este visor no tiene puente hacia Kaneo.");
    err.status = res.status;
    throw err;
  }
  return parseKaneoResponse(res);
}

async function kaneoRequestDirect({ baseUrl, apiKey, path, method, body }) {
  const res = await fetch(`${normalizeBase(baseUrl)}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseKaneoResponse(res);
}

// Igual que con Plane, el navegador no puede hablar directo con la mayoría de
// instancias de Kaneo por CORS, así que primero se intenta por el proxy propio
// de este tablero (api/kaneo.js, servidor a servidor) y solo si eso falla se
// intenta un fetch directo (por si la instancia sí permite CORS).
export async function kaneoRequest({ baseUrl, apiKey, path, method = "GET", body }) {
  const proxy = localProxyUrl();
  if (proxy) {
    try {
      return await kaneoRequestViaProxy(proxy, { baseUrl, apiKey, path, method, body });
    } catch (e) {
      // Si el proxy alcanzó a Kaneo y trae una respuesta JSON real (aunque sea un
      // error), esa es la respuesta válida: no tiene sentido reintentar directo.
      // Solo se reintenta directo cuando el proxy en sí falló (ruta no desplegada,
      // red caída, respuesta que no es JSON).
      if (e.data) throw e;
    }
  }
  try {
    return await kaneoRequestDirect({ baseUrl, apiKey, path, method, body });
  } catch (e) {
    if (e.name === "TypeError" || /Failed to fetch|NetworkError|CORS/i.test(e.message || "")) {
      const err = new Error(
        "El navegador no puede hablar con Kaneo desde aquí (bloqueo de CORS o la URL no responde). Revisa la URL de tu instancia."
      );
      err.code = "KANEO_BROWSER_BLOCKED";
      err.cause = e;
      throw err;
    }
    throw e;
  }
}

function resultsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

// La lista de proyectos de un workspace: se usa para dejarte elegir el proyecto
// destino igual que en la migración de Plane.
export async function listProjects(cfg) {
  try {
    return resultsOf(await kaneoRequest({ ...cfg, path: `/project?workspaceId=${encodeURIComponent(cfg.workspaceId)}` }));
  } catch (e) {
    return [];
  }
}

// Las columnas/estados reales del proyecto. La API de Kaneo no documenta un único
// endpoint estable para esto todavía, así que se intenta por varias rutas plausibles;
// si ninguna responde, se usan directamente los nombres de columna de Fliipa como
// texto de estado (funciona si Kaneo acepta cualquier texto, pero puede no “calzar”
// visualmente con una columna existente si el proyecto espera un slug distinto).
export async function listProjectStatuses(cfg) {
  const candidates = [
    `/project/${cfg.projectId}/status`,
    `/project/${cfg.projectId}/statuses`,
    `/status/${cfg.projectId}`,
    `/project/${cfg.projectId}`,
  ];
  for (const path of candidates) {
    try {
      const data = await kaneoRequest({ ...cfg, path });
      const list = resultsOf(data.statuses || data.columns || data);
      if (list.length) return list;
    } catch (e) {
      /* intenta la siguiente ruta */
    }
  }
  return [];
}

export function matchStatus(statuses, columnId) {
  const hints = COLUMN_HINTS[columnId] || COLUMN_HINTS.backlog;
  const list = statuses || [];
  const found = list.find((s) => {
    const name = String(s.name || s.label || s.title || "").toLowerCase();
    return hints.some((h) => name.includes(h));
  });
  if (found) return found.slug || found.id || found.name;
  // Sin lista de columnas reales: se manda el slug real conocido de Fliipa/Kaneo.
  return FLIIPA_COLUMN_LABEL[columnId] || FLIIPA_COLUMN_LABEL.backlog;
}

// Miembros del proyecto/workspace, para poder asignar userId. La ruta exacta no está
// confirmada contra tu instancia; se intentan varias.
export async function listMembers(cfg) {
  const candidates = [
    `/project/${cfg.projectId}/members`,
    `/workspace/${cfg.workspaceId}/members`,
    `/workspace/${cfg.workspaceId}/user`,
  ];
  for (const path of candidates) {
    try {
      const data = await kaneoRequest({ ...cfg, path });
      const list = resultsOf(data);
      if (list.length) return list;
    } catch (e) {
      /* intenta la siguiente ruta */
    }
  }
  return [];
}

function memberName(member) {
  const person = member?.user && typeof member.user === "object" ? member.user : member;
  return [person?.name, person?.displayName, person?.userName, person?.email].filter(Boolean).join(" ");
}

function memberId(member) {
  if (!member) return null;
  const person = member?.user && typeof member.user === "object" ? member.user : member;
  return person?.userId || person?.id || member?.id || null;
}

function memberMatchesAlias(member, alias) {
  const blob = foldName(`${memberName(member)} ${member?.email || member?.user?.email || ""}`);
  return alias.patterns.some((p) => blob.includes(p));
}

function memberMatchesName(member, needle) {
  const hay = foldName(memberName(member));
  const email = foldName(member?.email || member?.user?.email || "");
  const local = email.split("@")[0];
  if (hay === needle || (hay && hay.includes(needle)) || (local && local === needle)) return true;
  const tokens = `${hay} ${local}`.split(/[\s@._-]+/).filter(Boolean);
  return tokens.some((tok) => tok === needle || (needle.length >= 4 && tok.startsWith(needle)));
}

export function matchMember(members, name) {
  const cleaned = cleanRepeatedName(name);
  const needle = foldName(cleaned);
  if (!needle) return null;
  const alias = aliasForName(cleaned);
  if (alias) {
    const byAlias = (members || []).find((m) => memberMatchesAlias(m, alias));
    if (byAlias) return byAlias;
  }
  return (members || []).find((m) => memberMatchesName(m, needle)) || null;
}

function buildTaskDescription(task, initiative) {
  const lines = [];
  if (task.notes) lines.push(task.notes);
  const extras = [];
  if (initiative && initiative.title) extras.push(`Iniciativa: ${initiative.title}`);
  if (task.type) extras.push(`Tipo en Fliipa: ${task.type}`);
  if (task.blocked) extras.push("Marcada como bloqueada en Fliipa");
  if (task.assignee) extras.push(`Responsable en Fliipa: ${task.assignee}`);
  extras.push("Migrada desde el tablero Kanban de Fliipa");
  if (extras.length) {
    if (lines.length) lines.push("");
    lines.push(...extras);
  }
  return lines.join("\n") || "Migrada desde el tablero Kanban de Fliipa";
}

function buildInitiativeDescription(initiative) {
  const lines = ["Iniciativa migrada desde Fliipa."];
  if (initiative.notes) lines.push(initiative.notes);
  lines.push(`Responsable en Fliipa: ${initiative.owner || "Sin asignar"}`);
  lines.push(`Progreso en Fliipa: ${Number(initiative.progress) || 0}%`);
  return lines.join("\n");
}

export function droppedIdsOf(deletedItems, deletedIds) {
  const records = deletedItems && deletedItems.length ? deletedItems : (deletedIds || []).map((id) => ({ id }));
  return new Set(records.map((row) => String(row.id || row)).filter(Boolean));
}

export function liveMigrationItems({ tasks, initiatives, deletedItems, deletedIds } = {}) {
  const dropped = droppedIdsOf(deletedItems, deletedIds);
  return {
    dropped,
    liveTasks: (tasks || []).filter((t) => t && !dropped.has(String(t.id))),
    liveInits: (initiatives || []).filter((i) => i && !dropped.has(String(i.id))),
  };
}

export function auditMigration({ tasks, initiatives, deletedItems, deletedIds } = {}) {
  const { liveTasks, liveInits } = liveMigrationItems({ tasks, initiatives, deletedItems, deletedIds });
  const initIds = new Set(liveInits.map((ini) => String(ini.id)));
  return {
    liveTasks,
    liveInits,
    withoutInitiative: liveTasks.filter((t) => !t.initiativeId),
    orphanInitiative: liveTasks.filter((t) => t.initiativeId && !initIds.has(String(t.initiativeId))),
  };
}

export function buildMigrationPackage({ tasks, initiatives }) {
  return {
    generatedAt: new Date().toISOString(),
    source: KANEO_SOURCE,
    app: "Fliipa Kanban",
    tasks: (tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || "",
      type: t.type,
      assignee: t.assignee || "",
      status: t.status,
      dueDate: t.dueDate || null,
      blocked: !!t.blocked,
      initiativeId: t.initiativeId || null,
      kaneoTaskId: t.kaneoTaskId || null,
    })),
    initiatives: (initiatives || []).map((i) => ({
      id: i.id,
      title: i.title,
      owner: i.owner || "",
      progress: Number(i.progress) || 0,
      status: i.status || "backlog",
      notes: i.notes || "",
      dueDate: i.dueDate || null,
      kaneoTaskId: i.kaneoTaskId || null,
    })),
  };
}

async function createTask(cfg, { title, description, priority, status, userId }) {
  const body = { title: title || "Sin título", description: description || "", priority: priority || "no-priority", status };
  if (userId) body.userId = userId;
  return kaneoRequest({ ...cfg, method: "POST", path: `/task/${cfg.projectId}`, body });
}

async function updateTask(cfg, taskId, patch) {
  return kaneoRequest({ ...cfg, method: "PUT", path: `/task/${taskId}`, body: patch });
}

async function linkSubtask(cfg, parentTaskId, childTaskId) {
  // Ruta best-effort: la API de Kaneo expone relaciones entre tareas
  // (relationType: "subtask" | "blocks" | "related") en un endpoint aparte;
  // si no calza en tu versión, la tarea igual queda creada, solo sin el
  // vínculo visual a la iniciativa (la iniciativa queda mencionada en su texto).
  try {
    await kaneoRequest({
      ...cfg,
      method: "POST",
      path: `/task/${parentTaskId}/relation`,
      body: { targetTaskId: childTaskId, relationType: "subtask" },
    });
    return true;
  } catch (e) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function migrateToKaneo({
  baseUrl,
  apiKey,
  workspaceId,
  projectId,
  tasks,
  initiatives,
  deletedIds,
  deletedItems,
  onProgress,
  onItemMigrated,
}) {
  const cfg = { baseUrl, apiKey, workspaceId, projectId };
  const deletedRecords = deletedItems && deletedItems.length ? deletedItems : (deletedIds || []).map((id) => ({ id }));
  const { liveTasks, liveInits } = liveMigrationItems({ tasks, initiatives, deletedItems: deletedRecords });

  const statuses = await listProjectStatuses(cfg);
  let members = [];
  try {
    members = await listMembers(cfg);
  } catch (e) {
    members = [];
  }

  const summary = { created: 0, updated: 0, failed: 0, errors: [] };
  const kaneoIds = {};
  liveInits.forEach((ini) => {
    if (ini.kaneoTaskId) kaneoIds[ini.id] = ini.kaneoTaskId;
  });
  liveTasks.forEach((task) => {
    if (task.kaneoTaskId) kaneoIds[task.id] = task.kaneoTaskId;
  });

  const items = [
    ...liveInits.map((initiative) => ({ kind: "initiative", item: initiative })),
    ...liveTasks.map((task) => ({ kind: "task", item: task })),
  ];

  for (let i = 0; i < items.length; i++) {
    const { kind, item } = items[i];
    if (onProgress) onProgress({ current: i + 1, total: items.length, label: item.title || item.id });
    try {
      const status =
        kind === "task"
          ? matchStatus(statuses, item.status)
          : matchStatus(statuses, item.status || "backlog");
      const priority = item.blocked ? "high" : "no-priority";
      let userId = null;
      if (kind === "task" && item.assignee) {
        const member = matchMember(members, item.assignee);
        userId = member ? memberId(member) : null;
      } else if (kind === "initiative" && item.owner) {
        const member = matchMember(members, item.owner);
        userId = member ? memberId(member) : null;
      }
      const description =
        kind === "task"
          ? buildTaskDescription(item, liveInits.find((ini) => sameId(ini.id, item.initiativeId)))
          : buildInitiativeDescription(item);

      const existingId = kaneoIds[item.id];
      let saved;
      if (existingId) {
        saved = await updateTask(cfg, existingId, { title: item.title, description, priority, status, userId });
        saved = saved && saved.id ? saved : { id: existingId };
        summary.updated += 1;
      } else {
        saved = await createTask(cfg, { title: item.title, description, priority, status, userId });
        summary.created += 1;
      }
      if (saved?.id) {
        kaneoIds[item.id] = saved.id;
        if (onItemMigrated) onItemMigrated({ kind, id: item.id, kaneoTaskId: saved.id });
      }
    } catch (e) {
      summary.failed += 1;
      summary.errors.push(`${item.title || item.id}: ${e.message}`);
    }
    await sleep(200);
  }

  // Segunda pasada: enlazar tareas con su iniciativa como subtarea (best-effort).
  for (const task of liveTasks) {
    if (!task.initiativeId) continue;
    const parentKaneoId = kaneoIds[task.initiativeId];
    const childKaneoId = kaneoIds[task.id];
    if (!parentKaneoId || !childKaneoId) continue;
    await linkSubtask(cfg, parentKaneoId, childKaneoId);
    await sleep(120);
  }

  return summary;
}
