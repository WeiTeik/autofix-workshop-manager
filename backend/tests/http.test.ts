import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { checkOrigin, createApiServer } from "../src/server";
process.env.DATABASE_PATH = ":memory:";
const frontendOrigin = "http://127.0.0.1:3000";
test("origin check allows the separate frontend and rejects unknown origins",()=>{
  assert.doesNotThrow(()=>checkOrigin(new Request("http://127.0.0.1:3001/api/parts",{headers:{origin:frontendOrigin}})));
  assert.throws(()=>checkOrigin(new Request("http://localhost:3000/api/parts",{headers:{host:"127.0.0.1:3000",origin:"https://evil.example"}})),/workshop app/);
});

test("independent API supports cross-origin reads, preflight, JSON writes and stock validation", async t => {
  const server = createApiServer();
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(() => {server.closeAllConnections();server.close();});
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const initial = await fetch(`${base}/api/state`,{headers:{Origin:frontendOrigin}});
  assert.equal(initial.headers.get("Access-Control-Allow-Origin"),frontendOrigin);
  const data = await initial.json(); assert.equal(data.parts.length,30);
  const preflight = await fetch(`${base}/api/parts`,{method:"OPTIONS",headers:{Origin:frontendOrigin,"Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"Content-Type"}});
  assert.equal(preflight.status,204);assert.match(preflight.headers.get("Access-Control-Allow-Methods")!,/POST/);
  const send = (endpoint:string,body:unknown) => fetch(`${base}/api/${endpoint}`,{method:"POST",headers:{Origin:frontendOrigin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const quote = await send("calculate",{kind:"repair",items:[{part_id:"P001",quantity:2}],hours:1.5});
  assert.equal(quote.status,200);assert.equal((await quote.json()).total,230);
  const created = await send("parts",{name:"HTTP test part",category:"test",part_type:"OEM",quantity:0,unit_cost:10,supplier:"Test supplier",reorder_level:2,lead_time_days:3,location:"Test rack"});
  assert.equal(created.status,200);const id=(await created.json()).part_id;
  assert.equal((await send("transactions",{part_id:id,type:"IN",quantity:2,unit_cost:9,date:data.today})).status,200);
  assert.equal((await send("transactions",{part_id:id,type:"OUT",quantity:3,date:data.today})).status,400);
  const current = await (await fetch(`${base}/api/state`)).json();assert.equal(current.parts.find((p:{part_id:string})=>p.part_id===id).quantity,2);
  const denied = await fetch(`${base}/api/state`,{headers:{Origin:"https://evil.example"}});assert.equal(denied.status,400);assert.equal(denied.headers.get("Access-Control-Allow-Origin"),null);
});

test("standalone API transports Excel downloads and multipart uploads", async t => {
  const server = createApiServer();server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(() => {server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const download = await fetch(`${base}/api/export`,{headers:{Origin:frontendOrigin}});
  assert.equal(download.status,200);assert.match(download.headers.get("Content-Disposition")!,/\.xlsx/);
  const exported = new ExcelJS.Workbook();await exported.xlsx.load(await download.arrayBuffer());assert.ok(exported.getWorksheet("Transactions"));
  const workbook = new ExcelJS.Workbook();const sheet=workbook.addWorksheet("Parts");
  sheet.addRow(["part_id","name","category","part_type","quantity","unit_cost","supplier","reorder_level","lead_time_days","location"]);
  sheet.addRow(["HTTP-IMPORT","HTTP imported part","test","OEM",2,5,"Test supplier",2,3,"Test rack"]);
  const form = new FormData();form.set("file",new File([new Uint8Array(await workbook.xlsx.writeBuffer())],"parts.xlsx"));
  const upload = await fetch(`${base}/api/import`,{method:"POST",headers:{Origin:frontendOrigin},body:form});
  assert.equal(upload.status,200);assert.equal((await upload.json()).count,1);
});
