import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, dateValue, normalizeName, windowStart } from "../src/server";
import type { Part, Settings } from "../src/server";
const settings: Settings = {labour_rate:80,tax_percent:6,shipping_threshold:200,shipping_fee:25};
const part = (id:string,cost:number|null,type="OEM") => ({part_id:id,name:id,unit_cost:cost,part_type:type}) as Part;

test("repair: distinct markups, labour and tax rounded in cents",()=>{
  const q=calculate("repair",[{part_id:"oem",quantity:2},{part_id:"after",quantity:3}],[part("oem",50),part("after",30,"Aftermarket")],settings,1.5);
  assert.equal(q.subtotal,222.5);assert.equal(q.labour,120);assert.equal(q.tax,20.55);assert.equal(q.total,363.05);
});
test("bulk discount boundaries: 9, 10, 49, 50 units",()=>{
  const values = [9,10,49,50].map(quantity=>calculate("topup",[{part_id:"p",quantity}],[part("p",10)],settings));
  assert.deepEqual(values.map(q=>q.discount),[0,5,24.5,60]);
  assert.deepEqual(values.map(q=>q.subtotal),[90,95,465.5,440]);
  assert.equal(values[0].total,115);assert.equal(values[1].total,120);
});
test("shipping uses entire discounted order and is free at exactly RM200",()=>{
  const q=calculate("topup",[{part_id:"a",quantity:1},{part_id:"b",quantity:1}],[part("a",100),part("b",100)],settings);
  assert.equal(q.shipping,0);assert.equal(q.total,200);
  const below=calculate("topup",[{part_id:"a",quantity:10}],[part("a",21)],settings);
  assert.equal(below.subtotal,199.5);assert.equal(below.shipping,25);assert.equal(below.total,224.5);
});
test("missing costs block quotes while zero cost is valid",()=>{
  assert.throws(()=>calculate("repair",[{part_id:"p",quantity:1}],[part("p",null)],settings),/Unit cost missing/);
  assert.equal(calculate("repair",[{part_id:"p",quantity:1}],[part("p",0)],settings).total,0);
});
test("invalid quantities, duplicate lines and invalid hours fail",()=>{
  for(const quantity of [0,-1,1.5,NaN,100001]) assert.throws(()=>calculate("repair",[{part_id:"p",quantity}],[part("p",20)],settings));
  assert.throws(()=>calculate("repair",[{part_id:"p",quantity:1},{part_id:"p",quantity:9}],[part("p",20)],settings),/Combine/);
  assert.throws(()=>calculate("repair",[{part_id:"p",quantity:1}],[part("p",20)],settings,-1));
});
test("duplicate names ignore case and all whitespace",()=>{
  assert.equal(normalizeName(" Oil Filter 1.5 L "),normalizeName("oilfilter1.5L"));
  assert.equal(normalizeName("Brake\tPad"),normalizeName("brake pad"));
});
test("usage window includes today and the preceding 29 days",()=>{
  assert.equal(windowStart("2026-10-08"),"2026-09-09");
  assert.throws(()=>dateValue("2026-02-30","2026-10-08"));
  assert.throws(()=>dateValue("2026-10-09","2026-10-08"));
});
