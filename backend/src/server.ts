/** Independent backend API. Contains no React or Next.js imports. */
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
const dataDirectory = fileURLToPath(new URL("../data/", import.meta.url));
const seed = JSON.parse(readFileSync(path.join(dataDirectory, "seed.json"), "utf8")) as {parts: Array<{name: string; [key: string]: unknown}>; transactions: Record<string, unknown>[]};

// API response types used by this backend. The frontend defines its own DTO types.
export type Part = {
  part_id: string; name: string; category: string; part_type: "OEM" | "Aftermarket";
  quantity: number; unit_cost: number | null; supplier: string; reorder_level: number;
  lead_time_days: number; location: string; last_updated: string; version: number;
  uses: number; units_used: number; fast: boolean; low: boolean; target: number; duplicate: boolean;
};
export type Transaction = {
  txn_id: string; part_id: string; name: string; part_type: string; type: "IN" | "OUT";
  quantity: number; unit_cost: number | null; date: string; note: string;
};
export type Settings = { labour_rate: number; tax_percent: number; shipping_threshold: number; shipping_fee: number };
export type AppState = { parts: Part[]; transactions: Transaction[]; settings: Settings; today: string; window_start: string };
export type QuoteLine = { part_id: string; quantity: number };
export type Calculation = {
  kind: "repair" | "topup";
  lines: { part_id: string; name: string; quantity: number; unit_cost: number; rate: number; total: number }[];
  subtotal: number; labour: number; tax: number; shipping: number; discount: number; total: number;
  hours: number; labour_rate: number; tax_percent: number;
};

// Business rules and validation
export const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const normalizeName = (name: string) => name.toLowerCase().replace(/\s/g, "");
export function todayMY() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function windowStart(today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}
export function numberValue(value: unknown, label: string, integer = false, max = 1_000_000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value)))
    throw new Error(`${label} must be a ${integer ? "whole " : ""}number between 0 and ${max}.`);
  return value;
}
export function textValue(value: unknown, label: string, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function dateValue(value: unknown, today = todayMY()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value > today)
    throw new Error("Choose a valid date on or before today.");
  return value;
}
export function calculate(kind: string, items: QuoteLine[], parts: Part[], settings: Settings, hours = 0): Calculation {
  if (kind !== "repair" && kind !== "topup") throw new Error("Unknown calculation type.");
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error("Add at least one part (maximum 100).");
  const ids = new Set<string>();
  let subtotalCents = 0, discountCents = 0;
  const lines = items.map(item => {
    if (!item || ids.has(item.part_id)) throw new Error("Combine quantities for the same part into one line.");
    ids.add(item.part_id);
    const part = parts.find(p => p.part_id === item.part_id);
    if (!part) throw new Error("A selected part no longer exists.");
    if (part.unit_cost === null) throw new Error(`${part.name}: Unit cost missing — update before using`);
    const quantity = numberValue(item.quantity, "Quantity", true, 100_000);
    if (quantity < 1) throw new Error("Quantity must be at least 1.");
    const rate = kind === "repair" ? (part.part_type === "OEM" ? 0.10 : 0.25) : (quantity >= 50 ? 0.12 : quantity >= 10 ? 0.05 : 0);
    const baseCents = Math.round(part.unit_cost * 100) * quantity;
    const adjustment = Math.round(baseCents * rate);
    const totalCents = kind === "repair" ? baseCents + adjustment : baseCents - adjustment;
    subtotalCents += totalCents;
    if (kind === "topup") discountCents += adjustment;
    return { part_id: part.part_id, name: part.name, quantity, unit_cost: part.unit_cost, rate, total: totalCents / 100 };
  });
  const labourCents = kind === "repair" ? Math.round(numberValue(hours, "Labour hours", false, 1000) * settings.labour_rate * 100) : 0;
  const taxCents = kind === "repair" ? Math.round((subtotalCents + labourCents) * settings.tax_percent / 100) : 0;
  const shippingCents = kind === "topup" && subtotalCents < Math.round(settings.shipping_threshold * 100) ? Math.round(settings.shipping_fee * 100) : 0;
  return { kind, lines, hours: kind === "repair" ? hours : 0, labour_rate: settings.labour_rate, tax_percent: settings.tax_percent, subtotal: subtotalCents / 100, labour: labourCents / 100, tax: taxCents / 100, shipping: shippingCents / 100, discount: discountCents / 100, total: (subtotalCents + labourCents + taxCents + shippingCents) / 100 };
}

// SQLite persistence and stock operations

let instance: Database.Database | undefined;
export function db() {
  if (instance) return instance;
  const filename = process.env.DATABASE_PATH || path.join(dataDirectory, "workshop.sqlite");
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  instance = new Database(filename);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
  instance.exec(`
    CREATE TABLE IF NOT EXISTS parts (
      part_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      part_type TEXT NOT NULL CHECK(part_type IN ('OEM','Aftermarket')),
      quantity INTEGER NOT NULL CHECK(quantity >= 0), unit_cost REAL CHECK(unit_cost >= 0),
      supplier TEXT NOT NULL, reorder_level INTEGER NOT NULL CHECK(reorder_level >= 0),
      lead_time_days INTEGER NOT NULL CHECK(lead_time_days >= 0), location TEXT NOT NULL,
      last_updated TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      txn_id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(part_id),
      type TEXT NOT NULL CHECK(type IN ('IN','OUT')), quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_cost REAL, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS txn_part_date ON transactions(part_id, date);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1),
      labour_rate REAL NOT NULL, tax_percent REAL NOT NULL, shipping_threshold REAL NOT NULL, shipping_fee REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!instance.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) {
    instance.transaction(() => {
      const insertPart = instance!.prepare(`INSERT INTO parts (part_id,name,category,part_type,quantity,unit_cost,supplier,reorder_level,lead_time_days,location,last_updated) VALUES (@part_id,@name,@category,@part_type,@quantity,@unit_cost,@supplier,@reorder_level,@lead_time_days,@location,@last_updated)`);
      seed.parts.forEach(p => insertPart.run({ ...p, name: p.name.trim() }));
      const insertTxn = instance!.prepare(`INSERT INTO transactions VALUES (@txn_id,@part_id,@type,@quantity,@unit_cost,@date,@note)`);
      seed.transactions.forEach(t => insertTxn.run(t));
      instance!.prepare("INSERT INTO settings VALUES (1,80,0,200,25)").run();
      instance!.prepare("INSERT INTO metadata VALUES ('seeded','1')").run();
    })();
  }
  return instance;
}
export function state(today = todayMY()): AppState {
  const start = windowStart(today);
  const parts = db().prepare(`SELECT p.*, COALESCE(u.uses,0) AS uses, COALESCE(u.units_used,0) AS units_used
    FROM parts p LEFT JOIN (SELECT part_id, COUNT(*) uses, SUM(quantity) units_used FROM transactions
    WHERE type='OUT' AND date >= ? AND date <= ? GROUP BY part_id) u ON p.part_id=u.part_id
    WHERE p.archived=0 ORDER BY p.part_id`).all(start, today) as Part[];
  const names = new Map<string, number>();
  parts.forEach(p => names.set(normalizeName(p.name), (names.get(normalizeName(p.name)) || 0) + 1));
  parts.forEach(p => {
    p.fast = p.uses >= 5;
    p.target = p.reorder_level * (p.fast ? 2 : 1);
    p.low = p.quantity <= p.reorder_level || (p.fast && p.quantity < p.target);
    p.duplicate = names.get(normalizeName(p.name))! > 1;
  });
  const transactions = db().prepare(`SELECT t.*, p.name, p.part_type FROM transactions t JOIN parts p ON p.part_id=t.part_id ORDER BY t.date DESC, t.rowid DESC`).all() as Transaction[];
  const settings = db().prepare("SELECT labour_rate,tax_percent,shipping_threshold,shipping_fee FROM settings WHERE id=1").get() as Settings;
  return { parts, transactions, settings, today, window_start: start };
}
function validatePart(input: Record<string, unknown>) {
  const part_type = input.part_type;
  if (part_type !== "OEM" && part_type !== "Aftermarket") throw new Error("Choose OEM or Aftermarket.");
  return {
    name: textValue(input.name, "Part name"), category: textValue(input.category, "Category"), part_type,
    unit_cost: input.unit_cost === null ? null : round(numberValue(input.unit_cost, "Unit cost")),
    supplier: textValue(input.supplier, "Supplier"), reorder_level: numberValue(input.reorder_level, "Reorder level", true),
    lead_time_days: numberValue(input.lead_time_days, "Lead time", true, 365), location: textValue(input.location, "Location")
  };
}
export function savePart(input: Record<string, unknown>, edit = false) {
  const values = validatePart(input);
  const part_id = edit ? textValue(input.part_id, "Part ID") : `P-${randomUUID().slice(0,8).toUpperCase()}`;
  const duplicates = state().parts.filter(p => p.part_id !== part_id && normalizeName(p.name) === normalizeName(values.name));
  if (duplicates.length && input.confirm_duplicate !== true) throw new Error(`Similar part names exist: ${duplicates.map(p => `${p.name} (${p.part_id}, ${p.part_type})`).join(", ")}. Confirm the duplicate warning to continue.`);
  const last_updated = todayMY();
  db().transaction(() => {
    if (edit) {
      const version = numberValue(input.version, "Version", true);
      const result = db().prepare(`UPDATE parts SET name=@name,category=@category,part_type=@part_type,unit_cost=@unit_cost,supplier=@supplier,reorder_level=@reorder_level,lead_time_days=@lead_time_days,location=@location,last_updated=@last_updated,version=version+1 WHERE part_id=@part_id AND version=@version AND archived=0`).run({ ...values, part_id, last_updated, version });
      if (!result.changes) throw new Error("This part changed. Refresh and try again.");
    } else {
      const quantity = numberValue(input.quantity, "Opening quantity", true);
      db().prepare(`INSERT INTO parts (part_id,name,category,part_type,quantity,unit_cost,supplier,reorder_level,lead_time_days,location,last_updated) VALUES (@part_id,@name,@category,@part_type,@quantity,@unit_cost,@supplier,@reorder_level,@lead_time_days,@location,@last_updated)`).run({ ...values, part_id, quantity, last_updated });
      if (quantity > 0) db().prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(`T-${randomUUID()}`, part_id, "IN", quantity, values.unit_cost, last_updated, "Opening stock");
    }
  })();
  return part_id;
}
export function deletePart(id: unknown) {
  const part_id = textValue(id, "Part ID");
  const result = db().prepare("UPDATE parts SET archived=1, version=version+1 WHERE part_id=? AND quantity=0 AND archived=0").run(part_id);
  if (!result.changes) throw new Error("Record a stock OUT to bring this part to zero before deleting it. Transaction history is retained.");
}
export function recordTransaction(input: Record<string, unknown>) {
  const part_id = textValue(input.part_id, "Part");
  const type = input.type;
  if (type !== "IN" && type !== "OUT") throw new Error("Choose IN or OUT.");
  const quantity = numberValue(input.quantity, "Quantity", true, 100_000);
  if (quantity < 1) throw new Error("Quantity must be at least 1.");
  const date = dateValue(input.date);
  const note = typeof input.note === "string" ? input.note.trim().slice(0,500) : "";
  db().transaction(() => {
    const part = db().prepare("SELECT * FROM parts WHERE part_id=? AND archived=0").get(part_id) as Part | undefined;
    if (!part) throw new Error("Part not found.");
    if (type === "OUT" && quantity > part.quantity) throw new Error(`Only ${part.quantity} units are available. Stock cannot go below zero.`);
    const unit_cost = type === "IN" ? round(numberValue(input.unit_cost, "Received unit cost")) : part.unit_cost;
    db().prepare("UPDATE parts SET quantity=quantity+?,unit_cost=?,last_updated=?,version=version+1 WHERE part_id=?").run(type === "IN" ? quantity : -quantity, type === "IN" ? unit_cost : part.unit_cost, todayMY(), part_id);
    db().prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(`T-${randomUUID()}`,part_id,type,quantity,unit_cost,date,note);
  })();
}
export function saveSettings(input: Record<string, unknown>) {
  const settings = {
    labour_rate: round(numberValue(input.labour_rate,"Labour rate")),
    tax_percent: numberValue(input.tax_percent,"Tax percentage",false,100),
    shipping_threshold: round(numberValue(input.shipping_threshold,"Shipping threshold")),
    shipping_fee: round(numberValue(input.shipping_fee,"Shipping fee"))
  };
  db().prepare("UPDATE settings SET labour_rate=@labour_rate,tax_percent=@tax_percent,shipping_threshold=@shipping_threshold,shipping_fee=@shipping_fee WHERE id=1").run(settings);
}
export function importParts(rows: Record<string, unknown>[]) {
  if (rows.length === 0 || rows.length > 1000) throw new Error("Import between 1 and 1,000 parts at a time.");
  const imported: string[] = [];
  db().transaction(() => {
    for (const [index, input] of rows.entries()) {
      try {
        const values = validatePart(input);
        const part_id = textValue(input.part_id,"Part ID",80);
        const quantity = numberValue(input.quantity,"Quantity",true);
        if (db().prepare("SELECT part_id FROM parts WHERE part_id=?").get(part_id)) throw new Error(`Part ID ${part_id} already exists. Edit it in Parts instead.`);
        db().prepare(`INSERT INTO parts (part_id,name,category,part_type,quantity,unit_cost,supplier,reorder_level,lead_time_days,location,last_updated) VALUES (@part_id,@name,@category,@part_type,@quantity,@unit_cost,@supplier,@reorder_level,@lead_time_days,@location,@last_updated)`).run({...values,part_id,quantity,last_updated:todayMY()});
        if (quantity > 0) db().prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(`T-${randomUUID()}`,part_id,"IN",quantity,values.unit_cost,todayMY(),"Opening stock from Excel import");
        imported.push(part_id);
      } catch (error) { throw new Error(`Row ${index + 2}: ${(error as Error).message}`); }
    }
  })();
  return imported.length;
}

// HTTP request validation
export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to complete this action.";
  if (/SQLITE|database|no such/i.test(message)) { console.error(error); return Response.json({error:"Unable to save. Please try again."},{status:500}); }
  return Response.json({ error: message }, { status: 400 });
}
export function allowedOrigins() {
  return (process.env.FRONTEND_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000").split(",").map(origin => origin.trim()).filter(Boolean);
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const sameOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (origin && origin !== sameOrigin && !allowedOrigins().includes(origin)) throw new Error("This action must be performed from the workshop app.");
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  checkOrigin(request);
  const input = await request.json();
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid request.");
  return input;
}

// Excel workbook export.
export async function exportWorkbook() {
  const data = state();
  const book = new ExcelJS.Workbook();
  book.creator = "AutoFix Workshop";
  const partKeys = ["part_id","name","category","part_type","quantity","unit_cost","supplier","reorder_level","lead_time_days","location","last_updated"] as const;
  const txnKeys = ["txn_id","part_id","name","type","quantity","unit_cost","date","note"] as const;
  const parts = book.addWorksheet("Parts");
  parts.columns = partKeys.map(k => ({header:k,key:k,width:k === "name" ? 32 : 20}));
  data.parts.forEach(p => parts.addRow(p));
  const txns = book.addWorksheet("Transactions");
  txns.columns = txnKeys.map(k => ({header:k,key:k,width:k === "txn_id" ? 40 : k === "name" ? 32 : 22}));
  data.transactions.forEach(t => txns.addRow(t));
  const summary = book.addWorksheet("Summary");
  summary.columns = [{header:"Metric",key:"metric",width:42},{header:"Value",key:"value",width:28}];
  summary.addRows([
    {metric:"Export date (Malaysia)",value:data.today},
    {metric:"Total active parts",value:data.parts.length},
    {metric:"Total transactions",value:data.transactions.length},
    {metric:"Known inventory value (RM)",value:data.parts.reduce((s,p)=>s+Math.round((p.unit_cost??0)*100)*p.quantity,0)/100},
    {metric:"Parts with missing unit costs",value:data.parts.filter(p=>p.unit_cost===null).length},
    {metric:"Usage window starts",value:data.window_start},
    {metric:"Fast-moving definition",value:"5+ OUT transactions in 30 days"},
    ...Object.entries(data.settings).map(([metric,value])=>({metric,value}))
  ]);
  for (const sheet of book.worksheets) {
    sheet.views = [{state:"frozen",ySplit:1}];
    sheet.getRow(1).font = {bold:true,color:{argb:"FFFFFFFF"}};
    sheet.getRow(1).fill = {type:"pattern",pattern:"solid",fgColor:{argb:"FF164D42"}};
    sheet.getRow(1).height = 26;
    if (sheet !== summary) sheet.autoFilter = {from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};
    const costColumn = sheet.columns.find(c=>c.key==="unit_cost");
    if (costColumn) costColumn.numFmt = '#,##0.00';
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="AutoFix-inventory-${data.today}.xlsx"`,"Cache-Control":"no-store"}});
}

// Excel workbook import.
export async function importWorkbook(req: Request) {
  try {
    checkOrigin(req);
    const form = await req.formData(); const file = form.get("file");
    if (!(file instanceof File) || !file.name.endsWith(".xlsx") || file.size > 5_000_000) throw new Error("Choose an .xlsx workbook smaller than 5 MB.");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    const sheet = book.getWorksheet("Parts") || book.worksheets[0];
    if (!sheet || sheet.rowCount > 1001) throw new Error("Choose a Parts sheet with at most 1,000 rows.");
    const keys: string[] = [];
    sheet.getRow(1).eachCell((cell,col)=> { keys[col] = String(cell.value).trim(); });
    const required = ["part_id","name","category","part_type","quantity","unit_cost","supplier","reorder_level","lead_time_days","location"];
    if (required.some(k=>!keys.includes(k))) throw new Error(`Missing columns. Use the Parts sheet from an app export as your template.`);
    if (new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length) throw new Error("Column headers must be unique.");
    const rows: Record<string,unknown>[] = [];
    sheet.eachRow((row,index)=> {
      if (index === 1) return;
      const data: Record<string,unknown> = {};
      keys.forEach((key,col)=> { if (key) { const value = row.getCell(col).value; if (value && typeof value === "object") throw new Error(`Row ${index}: use plain values, not formulas or rich text.`); data[key] = value; } });
      data.unit_cost ??= null; rows.push(data);
    });
    const count = importParts(rows);
    return Response.json({count});
  } catch (e) { return errorResponse(e); }
}

// Independent HTTP API router. The frontend reaches these endpoints using fetch().
export async function handleApi(request: Request): Promise<Response> {
  const endpoint = new URL(request.url).pathname.replace(/^\/api\//, "");
  const allowed: Record<string, string[]> = {
    state: ["GET", "HEAD"], parts: ["POST", "PUT", "DELETE"],
    transactions: ["POST"], settings: ["PUT"], calculate: ["POST"],
    export: ["GET", "HEAD"], import: ["POST"]
  };
  const methods = allowed[endpoint];
  if (!methods) return Response.json({error: "Unknown API endpoint."}, {status: 404});
  const allow = [...methods, "OPTIONS"].join(", ");
  if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: {Allow: allow}});
  if (!methods.includes(request.method)) return Response.json({error: "Method not allowed."}, {status: 405, headers: {Allow: allow}});
  try {
    if (endpoint === "state") return Response.json(state());
    if (endpoint === "export") return await exportWorkbook();
    if (endpoint === "import") return await importWorkbook(request);
    const input = await body(request);
    if (endpoint === "parts") {
      if (request.method === "DELETE") { deletePart(input.part_id); return Response.json({ok: true}); }
      return Response.json({part_id: savePart(input, request.method === "PUT")});
    }
    if (endpoint === "transactions") { recordTransaction(input); return Response.json({ok: true}); }
    if (endpoint === "settings") { saveSettings(input); return Response.json({ok: true}); }
    const data = state();
    return Response.json(calculate(input.kind as string, input.items as QuoteLine[], data.parts, data.settings, input.hours as number));
  } catch (error) { return errorResponse(error); }
}

// HTTP transport and CORS for the separate frontend process.
export function createApiServer() {
  return createServer(async (incoming, outgoing) => {
    const origin = incoming.headers.origin;
    outgoing.setHeader("Vary", "Origin");
    outgoing.setHeader("Cache-Control", "no-store");
    if (origin && allowedOrigins().includes(origin)) {
      outgoing.setHeader("Access-Control-Allow-Origin", origin);
      outgoing.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
      outgoing.setHeader("Access-Control-Allow-Headers", "Content-Type");
      outgoing.setHeader("Access-Control-Max-Age", "600");
    }
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const url = `http://${incoming.headers.host || "127.0.0.1:3001"}${incoming.url || "/"}`;
      checkOrigin(new Request(url, {headers}));
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > 6_000_000) {
          outgoing.writeHead(413, {"Content-Type": "application/json"});
          outgoing.end(JSON.stringify({error: "Request too large. Choose a workbook smaller than 5 MB."}));
          return;
        }
        chunks.push(bytes);
      }
      const method = incoming.method || "GET";
      const request = new Request(url, {method, headers, body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(Buffer.concat(chunks))});
      const result = await handleApi(request);
      outgoing.statusCode = result.status;
      result.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(method === "HEAD" ? undefined : Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      const result = errorResponse(error);
      outgoing.statusCode = result.status;
      result.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  db();
  const server = createApiServer();
  server.listen(port, host, () => console.log(`AutoFix backend API: http://${host}:${port}/api/state`));
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    server.close(() => { instance?.close(); process.exit(0); });
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
