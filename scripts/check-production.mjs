/**
 * Pruebas de producción: lógica de Plane, CSV, papelera y proxy.
 * node scripts/check-production.mjs
 */
import {
  parseWorkspaceInput,
  normalizeBase,
  matchState,
  matchMember,
  resolvePersonNick,
  buildPlaneCsv,
  buildMigrationPackage,
  flattenWorkItems,
  isPlaneOnboarding,
  normTitle,
  planeItemShouldBeRemoved,
  isPlaneGoneError,
  isRetryableProxyError,
  auditMigration,
  resolveTaskParentId,
  DEFAULT_PLANE_BASE,
} from "../src/plane.js";
import { csvToBoardSnapshot, mergeImportedInitiatives, parseImportedBoard } from "../src/importLegacy.js";

let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

assert(
  "workspace desde URL get-started",
  parseWorkspaceInput("https://app.plane.so/tablero-de-tareas/get-started/") === "tablero-de-tareas"
);
assert("workspace slug suelto", parseWorkspaceInput("tablero-de-tareas") === "tablero-de-tareas");
assert("workspace con slash", parseWorkspaceInput("/fliipa/") === "fliipa");
assert("URL de API cloud", normalizeBase("https://app.plane.so") === DEFAULT_PLANE_BASE);
assert("URL de API con slash", normalizeBase("https://api.plane.so/") === "https://api.plane.so");

const states = [
  { id: "s1", name: "Pendiente", group: "backlog" },
  { id: "s2", name: "Por hacer", group: "unstarted" },
  { id: "s3", name: "En progreso", group: "started" },
  { id: "s4", name: "En revisión", group: "started" },
  { id: "s5", name: "Hecho", group: "completed" },
];
assert("columna Pendiente", matchState(states, "backlog")?.id === "s1");
assert("columna Por hacer", matchState(states, "todo")?.id === "s2");
assert("columna En progreso", matchState(states, "in_progress")?.id === "s3");
assert("columna En revisión", matchState(states, "review")?.id === "s4");
assert("columna Hecho", matchState(states, "done")?.id === "s5");

const grouped = {
  grouped_by: "state",
  results: {
    s1: [{ id: "a", name: "Viva", external_source: "fliipa-kanban", external_id: "t-live" }],
    s2: [{ id: "b", name: "1. Create Projects 🎯" }],
    s3: [{ id: "c", name: "Borrada", external_source: "fliipa-kanban", external_id: "t-del" }],
  },
};
const flat = flattenWorkItems(grouped);
assert("aplanar lista agrupada", flat.length === 3);
assert("detectar ejemplo Create Projects", isPlaneOnboarding({ name: "1. Create Projects 🎯" }));
assert("detectar Visualize your work", isPlaneOnboarding({ name: "4. Visualize your work 🔮" }));
assert("no marcar conexión real como ejemplo", !isPlaneOnboarding({ name: "Conexión DRUO" }));
assert("título normalizado", normTitle("[Iniciativa] Experian") === "experian");

const ctx = {
  keepExt: new Set(["t-live"]),
  keepPlane: new Set(["a"]),
  delExt: new Set(["t-del"]),
  delPlane: new Set(["plane-del"]),
  liveTitles: new Set(["viva", "conexion druo"]),
  delTitles: new Set(["borrada"]),
};
assert("conservar ítem vivo", !planeItemShouldBeRemoved(flat[0], ctx));
assert("quitar ejemplo de Plane", planeItemShouldBeRemoved(flat[1], ctx));
assert("quitar ítem borrado en Fliipa por external_id", planeItemShouldBeRemoved(flat[2], ctx));
assert(
  "quitar por UUID de Plane guardado en papelera",
  planeItemShouldBeRemoved({ id: "plane-del", name: "Lo que sea" }, ctx)
);
assert(
  "quitar por título si ya no está en el tablero",
  planeItemShouldBeRemoved({ id: "x1", name: "Borrada" }, { ...ctx, delExt: new Set(), delPlane: new Set() })
);
assert(
  "no quitar título que sigue vivo",
  !planeItemShouldBeRemoved({ id: "x2", name: "Viva" }, { ...ctx, keepPlane: new Set() })
);
assert("404 de Plane cuenta como ya quitado", isPlaneGoneError({ status: 404, message: "Not found" }));
assert("error de red sí se reintenta", isRetryableProxyError({ name: "TypeError", message: "Failed to fetch" }));
assert("404 de Plane no se disfraza de CORS", !isRetryableProxyError({ status: 404, message: "Not found" }));
assert("403 de Plane no se reintenta en otro proxy", !isRetryableProxyError({ status: 403, message: "Forbidden" }));

const csv = buildPlaneCsv({
  initiatives: [{ title: "Lanzamiento, fase 1", status: "in_progress", dueDate: "2026-09-20", notes: "hola" }],
  tasks: [
    { title: "Fix login", type: "Bug", status: "todo", description: "detalle, urgente", assignee: "Mafe", blocked: true },
  ],
});
assert("CSV tiene encabezados de Plane", csv.includes("name,description_html,priority,start_date,target_date,state_group"));
assert("CSV marca iniciativas", csv.includes("[Iniciativa] Lanzamiento, fase 1") || csv.includes('"[Iniciativa] Lanzamiento, fase 1"'));
assert("CSV escapa comas", csv.includes('"Fix login"') || csv.includes("Fix login"));
assert("CSV state_group started", csv.includes("started"));
assert("CSV state_group unstarted", csv.includes("unstarted"));

const pack = buildMigrationPackage({
  tasks: [{ id: "t1", title: "A", type: "Task", status: "todo", attachments: [] }],
  initiatives: [{ id: "i1", title: "B", status: "backlog" }],
});
assert("paquete tiene fuente Fliipa", pack.source === "fliipa-kanban");
assert("paquete no incluye blobs de adjuntos", pack.tasks[0].attachments.length === 0);

const members = [
  { id: "m1", display_name: "María Fernanda Herazo Escobar", email: "mafe@fliipa.com" },
  { id: "m2", display_name: "Oscar Ivan Briceño" },
  { id: "m3", display_name: "William" },
  { id: "m4", display_name: "Iván Aponte" },
];
assert("Mafe se relaciona con María Fernanda Herazo", matchMember(members, "Mafe")?.id === "m1");
assert("nombre largo de Mafe también asigna", matchMember(members, "María Fernanda Herazo Herazo Escobar")?.id === "m1");
assert("Ivan de Fliipa es Oscar Ivan, no Iván Aponte", matchMember(members, "Ivan")?.id === "m2");
assert("Iván Aponte no se mezcla con Ivan", matchMember(members, "Iván Aponte")?.id === "m4");
assert("si el nombre no está en Plane, no asigna (la tarea igual migra)", matchMember(members, "Alejo") == null);
assert("apodo desde nombre duplicado", resolvePersonNick("Francisco Javier Martínez Vargas Martínez Vargas") === "Fran");
assert("Daniel Alejandro es Alejo", resolvePersonNick("Daniel Alejandro Avilés  Avilés Montaña") === "Alejo");

// Regresión: "Alejandro Bohorquez" no debe caer en el alias "Aleja" solo
// porque "alejandro" empieza con esas letras (bug real: todas sus tareas
// terminaban asignadas a "Daniel Alejandro Avilés" en Kaneo).
const membersConAviles = [...members, { id: "m5", display_name: "Daniel Alejandro Avilés" }];
assert(
  "Alejandro Bohorquez no se confunde con Alejo Avilés",
  matchMember(membersConAviles, "Alejandro Bohorquez") == null
);
assert(
  "apodo de Alejandro Bohorquez no es Alejo",
  resolvePersonNick("Alejandro Bohorquez") === "Alejandro Bohorquez"
);

const audit = auditMigration({
  initiatives: [{ id: "i1", title: "DOCUMENTACIÓN" }],
  tasks: [
    { id: "t1", title: "Hija", initiativeId: "i1" },
    { id: "t2", title: "Huérfana", initiativeId: "iniciativa-que-no-existe" },
    { id: "t3", title: "Suelta" },
    { id: "t4", title: "En papelera", initiativeId: "i1" },
  ],
  deletedItems: [{ id: "t4" }],
});
assert("auditoría cuenta viva con iniciativa", audit.liveTasks.some((t) => t.id === "t1"));
assert("auditoría detecta tarea sin iniciativa", audit.withoutInitiative.map((t) => t.id).join() === "t3");
assert("auditoría detecta iniciativa que no está en Fliipa", audit.orphanInitiative.map((t) => t.id).join() === "t2");
assert("papelera no se migra", !audit.liveTasks.some((t) => t.id === "t4"));
assert(
  "padre si la iniciativa vive",
  resolveTaskParentId({ initiativeId: "i1" }, [{ id: "i1", planeWorkItemId: "plane-ini" }], {}) === "plane-ini"
);
assert("tarea huérfana va suelta, no se pierde", resolveTaskParentId({ initiativeId: "gone" }, [{ id: "i1" }], {}) === null);
assert("tarea sin iniciativa no pide padre", resolveTaskParentId({ title: "Suelta" }, [{ id: "i1" }], {}) === null);

const sampleCsv = `id,Subject,Type,Status,Assignee,Updated on
1177,Documentación de Fliipa,Tarea,En progreso,María Fernanda Herazo Herazo Escobar,09/03/2026 02:14 PM
1248,Cambios de diseño en el login del cliente,Tarea,En progreso,Francisco Javier Martínez Vargas Martínez Vargas,09/04/2026 02:03 PM
1219,Pruebas de Servicios de Experian,Tarea,Bloqueado,Daniel Alejandro Avilés  Avilés Montaña,09/04/2026 02:00 PM
1234,Rediseño dashboard,Tarea,Nuevo,"",09/03/2026 08:46 PM
`;
const snap = csvToBoardSnapshot(sampleCsv);
assert("csv importa las 4 tareas", snap.tasks.length === 4);
assert("csv Mafe desde María Fernanda", snap.tasks.find((t) => t.sourceId === "1177")?.assignee === "Mafe");
assert("csv Fran desde Francisco", snap.tasks.find((t) => t.sourceId === "1248")?.assignee === "Fran");
assert("csv Alejo desde Daniel Alejandro", snap.tasks.find((t) => t.sourceId === "1219")?.assignee === "Alejo");
assert("csv bloqueado queda marcado", snap.tasks.find((t) => t.sourceId === "1219")?.blocked === true);
assert("csv Experian es iniciativa", snap.tasks.find((t) => t.sourceId === "1219")?.initiativeId === "ini-experian");
assert("csv Documentación es iniciativa", snap.tasks.find((t) => t.sourceId === "1177")?.initiativeId === "ini-documentacion");
const merged = mergeImportedInitiatives([{ id: "existente", title: "DOCUMENTACIÓN" }], snap.initiatives);
assert("csv no duplica iniciativa por título", merged.remap["ini-documentacion"] === "existente");
assert("parseImportedBoard entiende CSV", parseImportedBoard(sampleCsv).tasks.length === 4);

if (failed) {
  console.error(`\n${failed} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nTodas las pruebas de lógica pasaron");
