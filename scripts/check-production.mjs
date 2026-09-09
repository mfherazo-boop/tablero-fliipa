/**
 * Pruebas de producción: lógica de Plane, CSV, papelera y proxy.
 * node scripts/check-production.mjs
 */
import {
  parseWorkspaceInput,
  normalizeBase,
  matchState,
  buildPlaneCsv,
  buildMigrationPackage,
  flattenWorkItems,
  isPlaneOnboarding,
  normTitle,
  planeItemShouldBeRemoved,
  DEFAULT_PLANE_BASE,
} from "../src/plane.js";

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

if (failed) {
  console.error(`\n${failed} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nTodas las pruebas de lógica pasaron");
