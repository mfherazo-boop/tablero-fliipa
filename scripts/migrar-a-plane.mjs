/**
 * Reserva si el navegador no puede hablar con Plane (CORS).
 *
 * 1. En el tablero: Migrar a Plane → Descargar paquete
 * 2. Crea un token en Plane (Profile Settings → Personal Access Tokens)
 * 3. Ejecuta:
 *    node scripts/migrar-a-plane.mjs ruta/al/paquete.json
 *
 * Variables:
 *    PLANE_API_KEY   (obligatoria)
 *    PLANE_WORKSPACE (slug, ej. fliipa)
 *    PLANE_PROJECT   (uuid del proyecto)
 *    PLANE_BASE_URL  (opcional, default https://api.plane.so)
 */
import { readFile } from "node:fs/promises";
import { migrateToPlane } from "../src/plane.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/migrar-a-plane.mjs paquete.json");
  process.exit(1);
}

const apiKey = process.env.PLANE_API_KEY;
const workspace = process.env.PLANE_WORKSPACE;
const projectId = process.env.PLANE_PROJECT;
if (!apiKey || !workspace || !projectId) {
  console.error("Faltan PLANE_API_KEY, PLANE_WORKSPACE o PLANE_PROJECT");
  process.exit(1);
}

const pack = JSON.parse(await readFile(file, "utf8"));
const summary = await migrateToPlane({
  baseUrl: process.env.PLANE_BASE_URL,
  apiKey,
  workspace,
  projectId,
  tasks: pack.tasks || [],
  initiatives: pack.initiatives || [],
  onProgress: ({ current, total, label }) => {
    console.log(`${current}/${total} ${label}`);
  },
});

console.log(summary);
if (summary.failed) process.exit(2);
