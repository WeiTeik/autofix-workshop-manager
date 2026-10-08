import { test } from "node:test";
import assert from "node:assert/strict";
import { db, deletePart, importParts, recordTransaction, savePart, saveSettings, state } from "../src/server";
import { todayMY } from "../src/server";
process.env.DATABASE_PATH=":memory:";
test("seed preserves the supplied stock snapshot and history",()=>{
  const data=state("2026-10-08");
  assert.equal(data.parts.length,30);assert.equal(data.transactions.length,38);
  assert.equal(data.parts.find(p=>p.part_id==="P001")!.quantity,5);
  assert.equal(data.parts.find(p=>p.part_id==="P025")!.unit_cost,null);
  assert.equal(data.parts.find(p=>p.part_id==="P001")!.uses,3);
  assert.equal(data.parts.filter(p=>p.fast).length,0);
});
test("stock OUT is atomic and insufficient stock leaves data unchanged",()=>{
  const before=state();
  assert.throws(()=>recordTransaction({part_id:"P001",type:"OUT",quantity:6,date:todayMY()}),/Only 5/);
  assert.equal(state().transactions.length,before.transactions.length);
  assert.equal(state().parts.find(p=>p.part_id==="P001")!.quantity,5);
  recordTransaction({part_id:"P001",type:"OUT",quantity:2,date:todayMY(),note:"Test job"});
  assert.equal(state().parts.find(p=>p.part_id==="P001")!.quantity,3);
  assert.equal(state().transactions.length,before.transactions.length+1);
});
test("stock IN updates cost, version and quantity together",()=>{
  const before=state().parts.find(p=>p.part_id==="P025")!;
  recordTransaction({part_id:"P025",type:"IN",quantity:10,unit_cost:99.95,date:todayMY(),note:"Supplier delivery"});
  const after=state().parts.find(p=>p.part_id==="P025")!;
  assert.equal(after.quantity,before.quantity+10);assert.equal(after.unit_cost,99.95);assert.equal(after.version,before.version+1);
});
test("fast moving counts events, activates at five, and observes strict safety threshold",()=>{
  const p=state().parts.find(p=>p.part_id==="P024")!;
  db().prepare("DELETE FROM transactions WHERE part_id=?").run(p.part_id);
  for(let i=0;i<5;i++) db().prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(`FAST-${i}`,p.part_id,"OUT",1,35,"2026-10-08","Test");
  let result=state("2026-10-08").parts.find(row=>row.part_id===p.part_id)!;
  assert.equal(result.fast,true);assert.equal(result.target,20);assert.equal(result.low,false);
  db().prepare("UPDATE parts SET quantity=19 WHERE part_id=?").run(p.part_id);
  result=state("2026-10-08").parts.find(row=>row.part_id===p.part_id)!;
  assert.equal(result.low,true);
  db().prepare("UPDATE transactions SET date='2026-09-08' WHERE txn_id='FAST-0'").run();
  assert.equal(state("2026-10-08").parts.find(row=>row.part_id===p.part_id)!.fast,false);
});
test("editing detects stale versions and duplicates need confirmation",()=>{
  const p=state().parts.find(p=>p.part_id==="P001")!;
  assert.throws(()=>savePart({...p,name:"AirFilter"},true),/Similar/);
  savePart({...p,name:"Brake Pad Updated"},true);
  assert.throws(()=>savePart({...p,name:"Brake Pad Updated Again"},true),/Refresh/);
});
test("imports roll back all rows when any row is invalid",()=>{
  const template=state().parts[0],before=state().parts.length;
  assert.throws(()=>importParts([{...template,part_id:"IMPORT-1"},{...template,part_id:"P002"}]),/already exists/);
  assert.equal(state().parts.length,before);assert.equal(db().prepare("SELECT * FROM parts WHERE part_id='IMPORT-1'").get(),undefined);
});
test("delete retains historical movements and rejects nonzero stock",()=>{
  assert.throws(()=>deletePart("P002"),/zero/);
  const id=savePart({...state().parts[0],name:"Test empty part",quantity:0});
  recordTransaction({part_id:id,type:"IN",quantity:1,unit_cost:10,date:todayMY()});
  recordTransaction({part_id:id,type:"OUT",quantity:1,date:todayMY()});
  deletePart(id);
  assert.equal(state().parts.some(p=>p.part_id===id),false);
  assert.equal(state().transactions.filter(t=>t.part_id===id).length,2);
});
test("invalid settings preserve existing rates",()=>{
  const before=state().settings;
  assert.throws(()=>saveSettings({...before,tax_percent:101}));
  assert.deepEqual(state().settings,before);
});
