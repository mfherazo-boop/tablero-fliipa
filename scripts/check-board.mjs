/**
 * Contrato de /api/board: la lectura del tablero no reenvía adjuntos,
 * responde 304 si no cambió y un guardado no borra los archivos ya guardados.
 */
process.env.GIST_ID = "gist-test";
process.env.GITHUB_TOKEN = "token-test";

const { default: handler, publicBoard, boardEtag, etagMatches, resetBoardCache } = await import("../api/board.js");

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function makeReq(method, { headers = {}, query = {}, body = null, url = "/api/board" } = {}) {
  return {
    method,
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    query,
    url,
    body,
  };
}

const tasks = JSON.stringify([{ id: "t1", title: "Conexión DRUO" }]);
let gistContent = {
  "fliipa-kanban:tasks": tasks,
  "file:abc": { name: "foto.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,AAAA" },
  _updatedAt: 1,
};
let gistTag = '"git-1"';
const calls = [];

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || "GET";
  calls.push({ url: String(url), method, inm: opts.headers && opts.headers["If-None-Match"], body: opts.body || null });
  if (!String(url).includes("/gists/gist-test")) throw new Error("URL inesperada");
  if (method === "GET") {
    if (opts.headers && opts.headers["If-None-Match"] === gistTag) {
      return new Response(null, { status: 304, headers: { etag: gistTag } });
    }
    return new Response(
      JSON.stringify({ files: { "board.json": { content: JSON.stringify(gistContent) } } }),
      { status: 200, headers: { etag: gistTag, "content-type": "application/json" } }
    );
  }
  if (method === "PATCH") {
    gistContent = JSON.parse(JSON.parse(opts.body).files["board.json"].content);
    gistTag = '"git-2"';
    return new Response("{}", { status: 200, headers: { etag: gistTag } });
  }
  throw new Error(`Método inesperado ${method}`);
};

const withFile = { a: 1, "file:x": { data: "grande" } };
const withOtherFile = { a: 1, "file:x": { data: "otro-blob" } };
assert("el tablero público omite adjuntos", publicBoard(withFile)["file:x"] == null && publicBoard(withFile).a === 1);
assert(
  "el etag no cambia si solo cambia un adjunto",
  boardEtag(JSON.stringify(publicBoard(withFile))) === boardEtag(JSON.stringify(publicBoard(withOtherFile)))
);
assert("etag distinto si cambia una tarea", boardEtag(JSON.stringify(publicBoard({ a: 1 }))) !== boardEtag(JSON.stringify(publicBoard({ a: 2 }))));
assert("If-None-Match acepta el etag exacto", etagMatches('"abc"', '"abc"'));
assert("If-None-Match acepta una lista", etagMatches('"otro", "abc"', '"abc"'));
assert("If-None-Match rechaza otro valor", !etagMatches('"zzz"', '"abc"'));

resetBoardCache();
const beforeProbe = calls.length;
const probeRes = makeRes();
await handler(makeReq("GET", { query: { probe: "1" } }), probeRes);
assert("probe responde ok sin leer el gist", probeRes.statusCode === 200 && probeRes.body === '{"ok":true}' && calls.length === beforeProbe);

const first = makeRes();
await handler(makeReq("GET"), first);
const firstBody = JSON.parse(first.body);
assert("GET del tablero no incluye el adjunto", first.statusCode === 200 && firstBody["file:abc"] == null);
assert("GET del tablero sí incluye las tareas", firstBody["fliipa-kanban:tasks"] === tasks);
assert("GET publica un etag", typeof first.headers.etag === "string" && first.headers.etag.startsWith('"'));
assert("la primera lectura sí baja el gist", calls.some((call) => call.method === "GET"));

const cached = makeRes();
await handler(makeReq("GET", { headers: { "If-None-Match": first.headers.etag } }), cached);
assert("si el tablero no cambió responde 304", cached.statusCode === 304 && (cached.body == null || cached.body === ""));
assert(
  "la revalidación no vuelve a bajar el gist",
  calls[calls.length - 1].method === "GET" && calls[calls.length - 1].inm === gistTag
);

const fileRes = makeRes();
await handler(makeReq("GET", { query: { file: "abc" } }), fileRes);
const fileBody = JSON.parse(fileRes.body);
assert("un adjunto se pide aparte", fileRes.statusCode === 200 && fileBody.data === "data:image/jpeg;base64,AAAA");
assert("el adjunto se puede guardar en el navegador", fileRes.headers["cache-control"] === "private, max-age=86400");

const missing = makeRes();
await handler(makeReq("GET", { url: "/api/board?file=no-existe" }), missing);
assert("un adjunto inexistente responde 404", missing.statusCode === 404);

const putRes = makeRes();
await handler(
  makeReq("PUT", {
    body: { "fliipa-kanban:tasks": JSON.stringify([{ id: "t1", title: "Actualizada" }]) },
  }),
  putRes
);
assert("PUT confirma el guardado", putRes.statusCode === 200 && JSON.parse(putRes.body).ok === true);
assert("PUT conserva el adjunto que el cliente ya no reenvía", gistContent["file:abc"] && gistContent["file:abc"].data.includes("AAAA"));
assert("PUT aplica la tarea nueva", gistContent["fliipa-kanban:tasks"].includes("Actualizada"));

const after = makeRes();
await handler(makeReq("GET"), after);
const afterBody = JSON.parse(after.body);
assert("después de guardar el GET sigue sin el adjunto", after.statusCode === 200 && afterBody["file:abc"] == null);
assert("después de guardar el GET trae la tarea nueva", afterBody["fliipa-kanban:tasks"].includes("Actualizada"));

if (failed) {
  console.error(`\n${failed} prueba(s) del tablero fallaron`);
  process.exit(1);
}
console.log("\nTodas las pruebas del tablero pasaron");
