import { foldName, resolvePersonNick } from "./plane.js";

const AVATAR_COLORS = ["#3EE0B4", "#8B8CFF", "#5B8CFF", "#F0C14B", "#F07178", "#B48EDE"];

const STATUS_MAP = {
  nuevo: { status: "backlog", blocked: false },
  "por hacer": { status: "backlog", blocked: false },
  "en progreso": { status: "in_progress", blocked: false },
  "en revision": { status: "review", blocked: false },
  "en revisión": { status: "review", blocked: false },
  cerrado: { status: "done", blocked: false },
  hecho: { status: "done", blocked: false },
  bloqueado: { status: "blocked", blocked: true },
  "in testing": { status: "dev_qa", blocked: false },
  "test failed": { status: "blocked", blocked: true },
};

const PREFIX_INITIATIVE = {
  admin: "Admin",
  pagos: "Pagos",
  front: "Front",
  back: "Backend",
  design: "Diseño",
  arq: "Arquitectura",
  fix: "Fixes",
  devops: "DevOps",
  logistics: "Logística",
};

function slugTitle(value) {
  return foldName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "general";
}

export function looksLikeTaskCsv(text) {
  const first = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)[0] || "";
  return /subject/i.test(first) && /status/i.test(first) && /assignee/i.test(first);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function parseUpdatedOn(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return Date.now();
  let hour = Number(m[4]);
  const ap = (m[6] || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5])).getTime();
}

function mapStatus(raw) {
  const key = foldName(raw);
  return STATUS_MAP[key] || { status: "backlog", blocked: false };
}

function mapType(title, type) {
  if (/^\[fix\]/i.test(title) || /bug|incidencia/i.test(type || "")) return "Bug";
  if (/^\[design\]/i.test(title) || /feature|funcionalidad/i.test(type || "")) return "Feature";
  if (/mejora/i.test(type || "")) return "Mejora";
  return "Task";
}

export function initiativeTitleFor(title) {
  const raw = String(title || "").trim();
  const prefix = raw.match(/^\[([^\]]+)\]/);
  if (prefix) {
    const mapped = PREFIX_INITIATIVE[foldName(prefix[1])];
    if (mapped) return mapped;
  }
  if (/druo/i.test(raw)) return "DRUO";
  if (/experian/i.test(raw)) return "Experian";
  if (/documentaci/i.test(raw)) return "DOCUMENTACIÓN";
  if (/comit[eé]/i.test(raw)) return "Comité";
  if (/onboarding/i.test(raw)) return "Onboarding";
  if (/redemption|checkout/i.test(raw)) return "Redemption";
  if (/^front\b/i.test(raw)) return "Front";
  if (/^admin\b|\(admin\)/i.test(raw)) return "Admin";
  if (/calculadora/i.test(raw)) return "Calculadora";
  if (/infra|gcp|deploy|ip estatica|enmascarar url|db prod/i.test(raw)) return "Infra";
  if (/kyc|originaci|colpatria|blacklist|olimpia/i.test(raw)) return "Originación";
  if (/b2c/i.test(raw)) return "B2C";
  if (/pre commit/i.test(raw)) return "DevEx";
  if (/qa demo/i.test(raw)) return "QA";
  if (/login del cliente|rediseño dashboard|rediseño y ajustes/i.test(raw)) return "Diseño";
  return "General";
}

function headerIndex(header) {
  const idx = {};
  header.forEach((name, i) => {
    idx[foldName(name).replace(/\s+/g, " ")] = i;
  });
  return idx;
}

function cell(row, idx, key) {
  const i = idx[key];
  return i == null ? "" : String(row[i] || "").trim();
}

export function csvToBoardSnapshot(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { tasks: [], initiatives: [] };
  const idx = headerIndex(rows[0]);
  const groups = new Map();
  const tasks = [];

  rows.slice(1).forEach((row) => {
    const id = cell(row, idx, "id");
    const title = cell(row, idx, "subject") || cell(row, idx, "title") || cell(row, idx, "name");
    if (!id || !title) return;
    const iniTitle = initiativeTitleFor(title);
    const { status, blocked } = mapStatus(cell(row, idx, "status"));
    const updatedAt = parseUpdatedOn(cell(row, idx, "updated on") || cell(row, idx, "updated"));
    const assignee = resolvePersonNick(cell(row, idx, "assignee"));
    const task = {
      id: "legacy-" + id,
      title,
      description: "",
      notes: `Importado desde el listado anterior (#${id}).`,
      type: mapType(title, cell(row, idx, "type")),
      assignee,
      status,
      blocked,
      dueDate: null,
      initiativeId: "ini-" + slugTitle(iniTitle),
      createdAt: updatedAt,
      updatedAt,
      statusChangedAt: updatedAt,
      attachments: [],
      source: "legacy-csv",
      sourceId: id,
    };
    tasks.push(task);
    if (!groups.has(iniTitle)) groups.set(iniTitle, []);
    groups.get(iniTitle).push(task);
  });

  const initiatives = [...groups.entries()].map(([title, related], index) => {
    const counts = {};
    related.forEach((t) => {
      if (t.assignee) counts[t.assignee] = (counts[t.assignee] || 0) + 1;
    });
    const owner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const open = related.filter((t) => t.status !== "done");
    let status = "backlog";
    if (related.length && related.every((t) => t.status === "done")) status = "done";
    else if (open.some((t) => ["in_progress", "review", "dev_qa", "product_qa"].includes(t.status))) status = "in_progress";
    else if (open.some((t) => t.status === "blocked")) status = "blocked";
    const updatedAt = Math.max(...related.map((t) => t.updatedAt || 0));
    return {
      id: "ini-" + slugTitle(title),
      title,
      owner,
      progress: 0,
      color: AVATAR_COLORS[index % AVATAR_COLORS.length],
      status,
      dueDate: null,
      notes: `${related.length} tarea${related.length === 1 ? "" : "s"} importadas del listado anterior.`,
      createdAt: updatedAt,
      updatedAt,
    };
  });

  return { tasks, initiatives, importedAt: Date.now(), source: "legacy-csv" };
}

export function parseImportedBoard(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Vacío");
  if (looksLikeTaskCsv(raw)) return csvToBoardSnapshot(raw);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("Formato inválido");
  return parsed;
}

export function mergeImportedInitiatives(existing, incoming) {
  const list = [...(existing || [])];
  const remap = {};
  (incoming || []).forEach((item) => {
    if (!item || !item.id) return;
    const byId = list.findIndex((ini) => String(ini.id) === String(item.id));
    const byTitle = list.findIndex((ini) => foldName(ini.title) === foldName(item.title) && foldName(item.title));
    const idx = byId >= 0 ? byId : byTitle;
    if (idx >= 0) {
      remap[item.id] = list[idx].id;
      list[idx] = { ...list[idx], ...item, id: list[idx].id };
    } else {
      list.unshift(item);
      remap[item.id] = item.id;
    }
  });
  return { list, remap };
}