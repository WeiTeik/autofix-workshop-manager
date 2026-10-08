"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Box, Calculator, Check, ChevronDown, CircleHelp, ClipboardList, Download, Gauge, LayoutDashboard, Package, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, TriangleAlert, Truck, Upload, Wrench, X } from "lucide-react";
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
// Client-side preview of the duplicate-name warning. The backend validates it again.
const normalizeName = (name: string) => name.toLowerCase().replace(/\s/g, "");

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const apiUrl = (path: string) => `${API_BASE}${path}`;

const money = (n: number) => new Intl.NumberFormat("en-MY", {style:"currency",currency:"MYR",minimumFractionDigits:2}).format(n);
const shortMoney = (n: number) => new Intl.NumberFormat("en-MY", {maximumFractionDigits:0}).format(n);
const navigation = [
  {id:"overview",label:"Overview",icon:LayoutDashboard},
  {id:"parts",label:"Parts inventory",icon:Package},
  {id:"transactions",label:"Stock movements",icon:ArrowDownLeft},
  {id:"repair",label:"Repair estimator",icon:Calculator},
  {id:"topup",label:"Top-up planner",icon:Truck},
  {id:"settings",label:"Settings",icon:Settings2}
] as const;
type View = typeof navigation[number]["id"];
type Modal = {kind:"part";part?:Part} | {kind:"stock";part?:Part;direction?:"IN"|"OUT"} | {kind:"import"} | {kind:"delete";part:Part} | null;
async function api(url:string,method:string,data:unknown) {
  const res = await fetch(apiUrl(url),{method,headers:data instanceof FormData ? undefined : {"Content-Type":"application/json"},body:data instanceof FormData ? data : JSON.stringify(data)});
  const result = await res.json(); if (!res.ok) throw new Error(result.error || "Unable to complete this action."); return result;
}
function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:string}) {return <span className={`badge ${tone}`}>{children}</span>;}
function Empty({title,detail}:{title:string;detail:string}) {return <div className="empty"><Box size={32}/><h3>{title}</h3><p>{detail}</p></div>;}

function Workshop({initial}:{initial:AppState}) {
  const [data,setData] = useState(initial), [view,setView] = useState<View>("overview");
  const [modal,setModal] = useState<Modal>(null), [toast,setToast] = useState(""), [globalError,setGlobalError] = useState("");
  const [search,setSearch] = useState(""), [filter,setFilter] = useState("all"), [category,setCategory] = useState("all");
  const [txnPart,setTxnPart] = useState("all"), [txnType,setTxnType] = useState("all"), [from,setFrom] = useState(""), [to,setTo] = useState("");
  const [notification,setNotification] = useState(false);
  const low = data.parts.filter(p=>p.low), missing = data.parts.filter(p=>p.unit_cost===null), duplicate = data.parts.filter(p=>p.duplicate);
  const value = data.parts.reduce((sum,p)=>sum+Math.round((p.unit_cost??0)*100)*p.quantity,0)/100;
  const top = [...data.parts].filter(p=>p.units_used>0).sort((a,b)=>b.units_used-a.units_used).slice(0,5);
  const go = (next:View) => { setView(next); setNotification(false); setGlobalError(""); };
  const refresh = async () => {
    const res = await fetch(apiUrl("/api/state"),{cache:"no-store"});
    if (!res.ok) throw new Error("Unable to refresh the inventory.");
    setData(await res.json());
  };
  const saved = async (message:string) => {await refresh();setModal(null);setToast(message);};
  useEffect(()=> { if (toast) {const t=setTimeout(()=>setToast(""),4500);return ()=>clearTimeout(t);} },[toast]);
  useEffect(()=> {
    const update = () => { if (document.visibilityState === "visible") refresh().catch(()=>setGlobalError("Inventory could not be refreshed. Check your connection.")); };
    const timer = setInterval(update,60_000); document.addEventListener("visibilitychange",update);
    return ()=> {clearInterval(timer);document.removeEventListener("visibilitychange",update);};
  },[]);
  const filtered = data.parts.filter(p=>`${p.name} ${p.category} ${p.supplier} ${p.part_id}`.toLowerCase().includes(search.toLowerCase()) && (category==="all" || p.category===category) && (filter==="all" || (filter==="low" ? p.low : filter==="missing" ? p.unit_cost===null : filter==="duplicate" ? p.duplicate : p.part_type===filter)));
  const txns = data.transactions.filter(t=>(txnPart==="all" || t.part_id===txnPart) && (txnType==="all" || t.type===txnType) && (!from || t.date>=from) && (!to || t.date<=to));
  const titles:Record<View,{title:string;subtitle:string}> = {
    overview:{title:"Workshop overview",subtitle:"A clear view of your parts, stock and daily activity."},
    parts:{title:"Parts inventory",subtitle:"Every part in its place. Keep your workshop moving."},
    transactions:{title:"Stock movements",subtitle:"Track every part coming in and going out."},
    repair:{title:"Repair estimator",subtitle:"Build a clear, accurate quote in a few clicks."},
    topup:{title:"Top-up planner",subtitle:"Plan your order with bulk discounts and shipping included."},
    settings:{title:"Workshop settings",subtitle:"Set the rates your estimates and orders use."}
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="AutoFix home"><span className="brand-icon"><Wrench size={24}/></span><span>AutoFix<span className="brand-sub">WORKSHOP MANAGER</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(({id,label,icon:Icon})=><button key={id} aria-label={label} aria-current={view===id?"page":undefined} className={`nav-item ${view===id?"active":""}`} onClick={()=>go(id)}><Icon size={19}/><span>{label}</span>{id==="parts" && low.length>0 && <span className="nav-count">{low.length}</span>}</button>)}</nav>
      <div className="sidebar-note"><span className="note-icon"><ShieldCheck size={20}/></span><strong>Your workshop, organised.</strong><p>Less time checking spreadsheets.<br/>More time getting jobs done.</p><span className="local-dot"/> Saved on this laptop</div>
      <div className="profile"><span className="avatar">AR</span><div><strong>AutoFix Workshop</strong><small>Workshop workspace</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{navigation.find(n=>n.id===view)?.label}</strong></div><div className="topbar-actions"><span className="today"><span className="live-dot"/> {new Date(data.today+"T12:00:00").toLocaleDateString("en-MY",{day:"numeric",month:"short",year:"numeric"})}</span><div className="notification-wrapper"><button className="icon-btn notification-btn" aria-label="View inventory alerts" onClick={()=>setNotification(!notification)}><Bell size={19}/>{low.length>0&&<i/>}</button>{notification&&<div className="notification-panel"><strong>Inventory alerts</strong><p>{low.length} parts need a top-up. {missing.length} parts have no unit cost.</p><button className="text-button" onClick={()=>{go("parts");setFilter("low");}}>View low-stock parts <ArrowRight size={14}/></button></div>}</div><span className="mini-avatar">AR</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">AUTOFIX WORKSHOP</div><h1>{titles[view].title}</h1><p>{titles[view].subtitle}</p></div><div className="heading-actions">{view==="overview"||view==="parts"||view==="transactions"?<><a className="button secondary" href={apiUrl("/api/export")}><Download size={16}/> Export Excel</a><button className="button primary" onClick={()=>setModal(view==="transactions"?{kind:"stock"}:{kind:"part"})}><Plus size={17}/>{view==="transactions"?"Record movement":"Add part"}</button></>:<span className="heading-tag"><ShieldCheck size={16}/> Built for your workshop</span>}</div></div>
        {globalError&&<div className="error-banner" role="alert">{globalError}<button onClick={()=>refresh().then(()=>setGlobalError("")).catch(()=>{})}>Retry</button></div>}
        {view==="overview"&&<>
          <div className="stats-grid">
            <Stat label="Total parts" value={String(data.parts.length).padStart(2,"0")} detail={`${data.parts.reduce((s,p)=>s+p.quantity,0)} units across your workshop`} icon={Package} tone="green"/>
            <Stat label="Inventory value" value={`RM ${shortMoney(value)}`} detail={missing.length?`${missing.length} parts excluded · cost missing`:"Based on current unit costs"} icon={Gauge} tone="blue"/>
            <Stat label="Low-stock parts" value={String(low.length).padStart(2,"0")} detail="Ready for your next top-up" icon={TriangleAlert} tone="orange" action={()=>{go("parts");setFilter("low");}}/>
            <Stat label="Stock movements" value={String(data.transactions.filter(t=>t.date>=data.window_start&&t.date<=data.today).length).padStart(2,"0")} detail="Recorded in the last 30 days" icon={Activity} tone="purple"/>
          </div>
          {low.length>0&&<div className="stock-callout"><span className="callout-icon"><TriangleAlert size={20}/></span><div><strong>A little attention keeps things running.</strong><p>{low.length} parts are running low. Review your stock before the next job.</p></div><button onClick={()=>{go("parts");setFilter("low");}}>Review low stock <ArrowRight size={16}/></button></div>}
          <div className="dashboard-grid">
            <section className="panel low-panel"><div className="panel-heading"><div><h2>Parts that need attention <span className="count-pill">{low.length}</span></h2><p>Prioritise these in your next order.</p></div><button className="text-button" onClick={()=>{go("parts");setFilter("low");}}>View all <ArrowRight size={14}/></button></div><div className="table-scroll"><table><thead><tr><th>PART NAME</th><th>STOCK / TARGET</th><th>STATUS</th><th/></tr></thead><tbody>{low.slice(0,5).map(p=><tr key={p.part_id}><td><div className="part-name"><span className={`part-icon ${p.category}`}><Package size={17}/></span><div><strong>{p.name}</strong><small>{p.part_id} <span>·</span> {p.part_type}</small></div></div></td><td><div className="stock-number"><strong className={p.quantity===0?"red-text":""}>{p.quantity}</strong><span> / {p.target}</span></div><div className="stock-track"><div style={{width:`${Math.min(100,p.quantity/Math.max(1,p.target)*100)}%`}}/></div></td><td><Badge tone={p.quantity===0?"red":"amber"}>{p.quantity===0?"Out of stock":"Low stock"}</Badge></td><td><button className="icon-btn" aria-label={`Top up ${p.name}`} onClick={()=>setModal({kind:"stock",part:p,direction:"IN"})}><Plus size={16}/></button></td></tr>)}</tbody></table></div>{low.length===0&&<Empty title="Stock is looking good" detail="All parts are above their reorder levels."/>}</section>
            <section className="panel usage-panel"><div className="panel-heading"><div><h2>Most-used parts</h2><p>Units used in the last 30 days</p></div><span className="small-tag">30 days</span></div><div className="usage-chart">{top.map((p,i)=><div className="usage-row" key={p.part_id}><div><span className="rank">{String(i+1).padStart(2,"0")}</span><span>{p.name}</span><strong>{p.units_used}<small> units</small></strong></div><div className="usage-track"><div style={{width:`${p.units_used/Math.max(1,top[0]?.units_used)*100}%`,opacity:1-i*.13}}/></div></div>)}{top.length===0&&<Empty title="No usage yet" detail="Stock OUT movements will appear here."/>}</div><div className="panel-footer"><span className="legend-dot"/> {data.parts.filter(p=>p.fast).length} fast-moving parts <span title="Fast-moving means at least 5 separate OUT transactions in the last 30 days."><CircleHelp size={14}/></span><span className="footer-spacer"/>{data.parts.filter(p=>!p.fast).length} slow-moving</div></section>
            <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest stock movements, in one place.</p></div><button className="text-button" onClick={()=>go("transactions")}>All movements <ArrowRight size={14}/></button></div><div className="activity-list">{data.transactions.slice(0,4).map(t=><div className="activity-row" key={t.txn_id}><span className={`movement-icon ${t.type==="IN"?"in":"out"}`}>{t.type==="IN"?<ArrowDownLeft size={19}/>:<ArrowUpRight size={19}/>}</span><div className="activity-description"><strong>{t.name} <span>{t.type==="IN"?"received":"used"}</span></strong><p>{t.note||"Stock movement"} <span>·</span> {t.part_id}</p></div><div className="activity-amount"><strong className={t.type==="IN"?"green-text":""}>{t.type==="IN"?"+":"−"}{t.quantity}<small> units</small></strong><span>{t.date}</span></div></div>)}{data.transactions.length===0&&<Empty title="No movements yet" detail="Record your first stock IN or OUT."/>}</div></section>
            <section className="quick-panel"><span className="quick-icon"><Calculator size={24}/></span><div className="eyebrow">FROM PARTS TO PRICE</div><h2>A quote in minutes.<br/>A customer on their way.</h2><p>Parts, markup, labour and tax.<br/>Every number accounted for.</p><button className="button" onClick={()=>go("repair")}>Create repair estimate <ArrowRight size={17}/></button><div className="quick-decoration"><Wrench size={105} strokeWidth={.6}/></div></section>
          </div>
          <div className="bottom-note"><ShieldCheck size={14}/> Changes saved automatically <span>·</span> Currency in Malaysian ringgit (RM)</div>
        </>}
        {view==="parts"&&<>
          <div className="inventory-summary"><span><strong>{data.parts.length}</strong> total parts</span><span><i className="tiny-dot amber-dot"/><strong>{low.length}</strong> low stock</span><span><i className="tiny-dot red-dot"/><strong>{missing.length}</strong> missing costs</span><span><strong>{duplicate.length}</strong> parts with similar names</span><button className="text-button" onClick={()=>setModal({kind:"import"})}><Upload size={15}/> Import new parts</button></div>
          <section className="panel"><div className="filter-toolbar"><div className="search-box"><Search size={17}/><input aria-label="Search parts" placeholder="Search parts, category or supplier…" value={search} onChange={e=>setSearch(e.target.value)}/></div><label className="select-wrap"><SlidersHorizontal size={16}/><select aria-label="Filter parts" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All parts</option><option>OEM</option><option>Aftermarket</option><option value="low">Low stock</option><option value="missing">Missing cost</option><option value="duplicate">Similar names</option></select></label><select aria-label="Filter category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{[...new Set(data.parts.map(p=>p.category))].sort().map(c=><option key={c}>{c}</option>)}</select></div>
          <div className="table-scroll"><table className="inventory-table"><thead><tr><th>PART / LOCATION</th><th>CATEGORY</th><th>TYPE</th><th>STOCK</th><th>UNIT COST</th><th>SUPPLIER</th><th>ACTIONS</th></tr></thead><tbody>{filtered.map(p=><tr key={p.part_id}><td><div className="part-name"><span className="part-icon"><Package size={18}/></span><div><strong>{p.name}{p.duplicate&&<span className="duplicate-marker" title="Similar name exists; review the part type before merging."><TriangleAlert size={12}/></span>}</strong><small>{p.part_id} · {p.location}</small></div></div></td><td className="capitalize">{p.category}</td><td><Badge tone={p.part_type==="OEM"?"green":"blue"}>{p.part_type}</Badge></td><td><div className={`stock-cell ${p.low?"low":""}`}><strong>{p.quantity}</strong>{p.low&&<TriangleAlert size={13}/>}</div><small className="cell-sub">Target {p.target}{p.fast?" · Fast-moving":""}</small></td><td>{p.unit_cost===null?<span className="missing-cost" title="Unit cost missing — update before using"><TriangleAlert size={12}/> Missing cost</span>:money(p.unit_cost)}</td><td>{p.supplier}<small className="cell-sub">{p.lead_time_days}-day lead time</small></td><td><div className="row-actions"><button className="text-button" onClick={()=>setModal({kind:"part",part:p})}>Edit</button><button className="icon-btn" aria-label={`Record stock for ${p.name} ${p.part_id}`} onClick={()=>setModal({kind:"stock",part:p})}><ArrowDownLeft size={16}/></button><button className="icon-btn delete-icon" aria-label={`Delete ${p.name} ${p.part_id}`} onClick={()=>setModal({kind:"delete",part:p})}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>{filtered.length===0&&<Empty title="No matching parts" detail="Try a different search or filter."/>}<div className="table-bottom">Showing {filtered.length} of {data.parts.length} parts <span>Stock changes are recorded in Stock movements.</span></div></section>
          {missing.length>0&&<div className="info-note"><TriangleAlert size={17}/><span>Unit cost missing — update before using. These parts are blocked from estimates and excluded from inventory value.</span></div>}
          {duplicate.length>0&&<div className="info-note"><CircleHelp size={17}/><span>Similar names are flagged ignoring case and spaces. OEM and Aftermarket variants can share a name; they remain separate parts.</span></div>}
        </>}
        {view==="transactions"&&<section className="panel"><div className="filter-toolbar transaction-filters"><label>Part<select value={txnPart} onChange={e=>setTxnPart(e.target.value)}><option value="all">All parts</option>{[...new Map(data.transactions.map(t=>[t.part_id,{part_id:t.part_id,name:t.name}])).values(),...data.parts.filter(p=>!data.transactions.some(t=>t.part_id===p.part_id))].map(p=><option key={p.part_id} value={p.part_id}>{p.name} · {p.part_id}</option>)}</select></label><label>Movement<select value={txnType} onChange={e=>setTxnType(e.target.value)}><option value="all">IN & OUT</option><option>IN</option><option>OUT</option></select></label><label>From<input type="date" value={from} max={to||data.today} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} min={from} max={data.today} onChange={e=>setTo(e.target.value)}/></label><button className="text-button" onClick={()=>{setTxnPart("all");setTxnType("all");setFrom("");setTo("");}}>Clear filters</button></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>PART</th><th>MOVEMENT</th><th>QUANTITY</th><th>RECORDED COST</th><th>NOTE</th></tr></thead><tbody>{txns.map(t=><tr key={t.txn_id}><td>{t.date}</td><td><strong>{t.name}</strong><small className="cell-sub">{t.part_id} · {t.part_type}</small></td><td><Badge tone={t.type==="IN"?"green":"blue"}>{t.type==="IN"?<ArrowDownLeft size={12}/>:<ArrowUpRight size={12}/>} Stock {t.type}</Badge></td><td><strong className={t.type==="IN"?"green-text":""}>{t.type==="IN"?"+":"−"}{t.quantity}</strong></td><td>{t.unit_cost===null?"Not recorded":money(t.unit_cost)}</td><td>{t.note||"—"}</td></tr>)}</tbody></table></div>{txns.length===0&&<Empty title="No movements found" detail="Change the filters or record a new movement."/>}<div className="table-bottom">{txns.length} movements <span>Historical sample movements are retained without changing opening quantities.</span></div></section>}
        {(view==="repair"||view==="topup")&&<Estimator key={view} kind={view} data={data}/>}
        {view==="settings"&&<SettingsForm settings={data.settings} onSave={async()=>{await refresh();setToast("Workshop settings saved");}}/>}
      </main>
    </div>
    {modal&&<ModalFrame title={modal.kind==="part"?(modal.part?"Edit part":"Add a new part"):modal.kind==="stock"?"Record stock movement":modal.kind==="import"?"Import new parts":"Delete part"} onClose={()=>setModal(null)}>
      {modal.kind==="part"&&<PartForm part={modal.part} parts={data.parts} onSave={saved}/>}
      {modal.kind==="stock"&&<StockForm data={data} part={modal.part} direction={modal.direction} onSave={saved}/>}
      {modal.kind==="import"&&<ImportForm onSave={saved}/>}
      {modal.kind==="delete"&&<DeleteForm part={modal.part} onSave={saved} onClose={()=>setModal(null)}/>}
    </ModalFrame>}
    {toast&&<div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast("")}><X size={15}/></button></div>}
  </div>;
}

function Stat({label,value,detail,icon:Icon,tone,action}:{label:string;value:string;detail:string;icon:typeof Package;tone:string;action?:()=>void}) {
  return <div className={`stat-card ${action?"clickable":""}`}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={19}/></span></div><div className="stat-value">{value}</div><div className="stat-bottom">{detail}{action&&<button aria-label="View low stock" onClick={action}><ArrowRight size={15}/></button>}</div></div>;
}
function ModalFrame({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=> {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    const handle = (e:KeyboardEvent) => {
      if (e.key==="Escape") onClose();
      if (e.key==="Tab") {
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')||[]);
        const first=nodes[0], last=nodes[nodes.length-1];
        if (e.shiftKey&&document.activeElement===first) {e.preventDefault();last?.focus();}
        if (!e.shiftKey&&document.activeElement===last) {e.preventDefault();first?.focus();}
      }
    };
    document.addEventListener("keydown",handle); const overflow = document.body.style.overflow; document.body.style.overflow="hidden";
    return ()=> {document.removeEventListener("keydown",handle);document.body.style.overflow=overflow;previous?.focus();};
  },[onClose]);
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={21}/></button></div>{children}</div></div>;
}
function PartForm({part,parts,onSave}:{part?:Part;parts:Part[];onSave:(message:string)=>Promise<void>}) {
  const [name,setName]=useState(part?.name||""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const duplicates=parts.filter(p=>p.part_id!==part?.part_id&&normalizeName(p.name)===normalizeName(name));
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");
    try {await api("/api/parts",part?"PUT":"POST",{part_id:part?.part_id,version:part?.version,name,category:f.get("category"),part_type:f.get("part_type"),quantity:Number(f.get("quantity")),unit_cost:f.get("unit_cost")===""?null:Number(f.get("unit_cost")),supplier:f.get("supplier"),reorder_level:Number(f.get("reorder_level")),lead_time_days:Number(f.get("lead_time_days")),location:f.get("location"),confirm_duplicate:confirmed});await onSave(part?"Part updated":"New part added");} catch(err){setError((err as Error).message);} finally {setBusy(false);}
  }
  return <form onSubmit={submit} className="form-body"><p className="form-intro">{part?`${part.part_id} · Update this part’s details. Record quantity changes in Stock movements.`:"Add the part details below. You can update the unit cost later."}</p><label>Part name<input required maxLength={160} name="name" value={name} onChange={e=>{setName(e.target.value);setConfirmed(false);}} placeholder="e.g. Brake Pad"/></label><div className="form-grid"><label>Category<input required name="category" list="categories" defaultValue={part?.category||""} placeholder="e.g. brakes"/><datalist id="categories">{[...new Set(parts.map(p=>p.category))].map(c=><option key={c} value={c}/>)}</datalist></label><label>Part type<select name="part_type" defaultValue={part?.part_type||"OEM"}><option>OEM</option><option>Aftermarket</option></select></label><label>{part?"Current stock (read only)":"Opening quantity"}<input type="number" name="quantity" required min="0" step="1" max="1000000" defaultValue={part?.quantity??0} disabled={!!part}/></label><label>Unit cost (RM)<input type="number" name="unit_cost" min="0" max="1000000" step="0.01" defaultValue={part?.unit_cost??""} placeholder="Leave blank if unknown"/></label><label>Reorder level<input type="number" name="reorder_level" required min="0" step="1" max="1000000" defaultValue={part?.reorder_level??5}/></label><label>Lead time (days)<input type="number" name="lead_time_days" required min="0" max="365" step="1" defaultValue={part?.lead_time_days??3}/></label><label>Supplier<input required maxLength={160} name="supplier" defaultValue={part?.supplier||""} placeholder="Supplier name"/></label><label>Storage location<input required maxLength={160} name="location" defaultValue={part?.location||""} placeholder="e.g. Rack A1"/></label></div>{duplicates.length>0&&<div className="form-warning"><strong><TriangleAlert size={16}/> Similar part name found</strong><p>{duplicates.map(p=>`${p.name} (${p.part_id}, ${p.part_type})`).join(", ")}</p><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> This is a separate part or variant.</label></div>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><span><ShieldCheck size={14}/> Saved to your workshop</span><button className="button primary" disabled={busy||(duplicates.length>0&&!confirmed)}>{busy?"Saving…":part?"Save changes":"Add part"}</button></div></form>;
}
function StockForm({data,part,direction,onSave}:{data:AppState;part?:Part;direction?:"IN"|"OUT";onSave:(message:string)=>Promise<void>}) {
  const [id,setId]=useState(part?.part_id||data.parts[0]?.part_id||""),[type,setType]=useState(direction||"OUT"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const selected=data.parts.find(p=>p.part_id===id);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");try{await api("/api/transactions","POST",{part_id:id,type,quantity:Number(f.get("quantity")),unit_cost:Number(f.get("unit_cost")),date:f.get("date"),note:f.get("note")});await onSave(`Stock ${type} recorded`);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  return <form onSubmit={submit} className="form-body"><p className="form-intro">Stock updates immediately when you save this movement.</p><div className="segmented"><button type="button" className={type==="IN"?"selected":""} onClick={()=>setType("IN")}><ArrowDownLeft size={17}/> Stock IN</button><button type="button" className={type==="OUT"?"selected":""} onClick={()=>setType("OUT")}><ArrowUpRight size={17}/> Stock OUT</button></div><label>Part<select value={id} onChange={e=>setId(e.target.value)} required>{data.parts.map(p=><option key={p.part_id} value={p.part_id}>{p.name} · {p.part_type} · {p.part_id}</option>)}</select></label>{selected&&<div className="available-stock"><Package size={18}/><span>Available stock</span><strong>{selected.quantity} units</strong></div>}<div className="form-grid"><label>Quantity<input type="number" required name="quantity" min="1" max={type==="OUT"?Math.max(1,selected?.quantity||0):100000} step="1" defaultValue="1"/></label><label>Date<input type="date" required name="date" max={data.today} defaultValue={data.today}/></label></div>{type==="IN"&&<label>Received unit cost (RM)<input key={id} type="number" name="unit_cost" required min="0" max="1000000" step="0.01" defaultValue={selected?.unit_cost??""}/><small>Use the actual invoice cost per unit after discounts, excluding shipping. This updates the part’s current unit cost.</small></label>}<label>Note<textarea name="note" maxLength={500} placeholder={type==="IN"?"e.g. Supplier delivery, invoice #123":"e.g. Brake replacement, Job J-1040"} rows={3}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><span>Recorded in transaction history</span><button className="button primary" disabled={busy||!selected||(type==="OUT"&&selected.quantity===0)}>{busy?"Saving…":`Record stock ${type}`}</button></div></form>;
}
function DeleteForm({part,onSave,onClose}:{part:Part;onSave:(message:string)=>Promise<void>;onClose:()=>void}) {
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <div className="form-body"><p>Delete <strong>{part.name} ({part.part_id})</strong> from the active inventory? Its transaction history will be retained.</p>{part.quantity>0&&<div className="form-warning">This part still has {part.quantity} units. Record a stock OUT before deleting it.</div>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button danger" disabled={busy||part.quantity>0} onClick={async()=>{setBusy(true);try{await api("/api/parts","DELETE",{part_id:part.part_id});await onSave("Part deleted. History retained.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?"Deleting…":"Delete part"}</button></div></div>;
}
function ImportForm({onSave}:{onSave:(message:string)=>Promise<void>}) {
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <form className="form-body" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");try{const result=await api("/api/import","POST",f);await onSave(`${result.count} new parts imported`);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><p className="form-intro">Use the <strong>Parts</strong> sheet from an <a href={apiUrl("/api/export")}>Excel export</a> as your template. Add only new part IDs. Existing IDs will stop the import to protect your stock.</p><div className="form-warning">Both original sample files are already loaded. Opening quantities are recorded once; historical transactions are not replayed.</div><label>Excel workbook (.xlsx)<input name="file" type="file" accept=".xlsx" required/></label><p className="muted">Maximum 1,000 rows and 5 MB. All rows must be valid before any are imported. Similar names will be flagged in Parts.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><span>Import adds new parts only</span><button className="button primary" disabled={busy}><Upload size={16}/>{busy?"Importing…":"Import parts"}</button></div></form>;
}
function Estimator({kind,data}:{kind:"repair"|"topup";data:AppState}) {
  const [items,setItems]=useState<QuoteLine[]>([]),[selected,setSelected]=useState(""),[hours,setHours]=useState(1),[result,setResult]=useState<Calculation|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const requestId=useRef(0);
  const valid=data.parts.filter(p=>p.unit_cost!==null), available=valid.filter(p=>!items.some(i=>i.part_id===p.part_id));
  const signature=JSON.stringify({items,hours,settings:data.settings,costs:data.parts.map(p=>[p.part_id,p.unit_cost,p.part_type])});
  useEffect(()=>{setResult(null);setError("");requestId.current++;},[signature]);
  const low=data.parts.filter(p=>p.low&&p.unit_cost!==null);
  async function compute(){const id=++requestId.current;setBusy(true);setError("");try{const r=await api("/api/calculate","POST",{kind,items,hours});if(id===requestId.current)setResult(r);}catch(e){if(id===requestId.current)setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="estimator-grid"><section className="panel estimate-builder"><div className="panel-heading"><div><h2>{kind==="repair"?"Build your repair quote":"Build your supplier order"}</h2><p>{kind==="repair"?"Choose parts, quantities and labour time.":"Bulk discounts apply to each part’s ordered quantity."}</p></div><span className="estimate-heading-icon">{kind==="repair"?<Wrench size={23}/>:<Truck size={23}/>}</span></div><div className="builder-body">{kind==="topup"&&low.length>0&&<button className="suggestion-button" onClick={()=>{setItems(low.map(p=>({part_id:p.part_id,quantity:Math.max(1,p.target-p.quantity)})));}}><TriangleAlert size={16}/> Fill from {low.length} low-stock parts <ArrowRight size={15}/></button>}<label>Add a part<div className="add-line"><select aria-label="Select estimate part" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a part…</option>{available.map(p=><option key={p.part_id} value={p.part_id}>{p.name} · {p.part_type} · {money(p.unit_cost!)}</option>)}</select><button className="button primary" disabled={!selected} onClick={()=>{setItems([...items,{part_id:selected,quantity:1}]);setSelected("");}}><Plus size={16}/> Add</button></div></label>{items.length===0?<div className="estimate-empty"><ClipboardList size={38} strokeWidth={1.2}/><h3>Your {kind==="repair"?"quote":"order"} starts here</h3><p>Add a part to start calculating.</p></div>:<div className="estimate-lines">{items.map((item,index)=>{const p=data.parts.find(p=>p.part_id===item.part_id);return <div className="estimate-line" key={item.part_id}><div><strong>{p?.name||"Removed part"}</strong><small>{p?.part_type} · {p?.unit_cost===null?"Cost missing":money(p?.unit_cost||0)} each{kind==="repair"?` · ${p?.part_type==="OEM"?10:25}% markup`:""}</small>{kind==="repair"&&item.quantity>(p?.quantity??0)&&<span className="line-warning">Only {p?.quantity??0} in stock. Top up before this job.</span>}</div><label className="quantity-label">Qty<input aria-label={`Quantity for ${p?.name||item.part_id}`} type="number" min="1" max="100000" step="1" value={item.quantity} onChange={e=>setItems(items.map((i,j)=>j===index?{...i,quantity:Number(e.target.value)}:i))}/></label><button className="icon-btn" aria-label={`Remove ${p?.name||item.part_id}`} onClick={()=>setItems(items.filter((_,j)=>j!==index))}><X size={16}/></button></div>;})}</div>}{kind==="repair"&&<div className="labour-box"><div><strong>Labour</strong><p>{money(data.settings.labour_rate)} / hour</p></div><label>Hours<input type="number" min="0" max="1000" step="0.25" value={hours} onChange={e=>setHours(Number(e.target.value))}/></label></div>}{kind==="topup"&&<div className="discount-guide"><h3>Supplier discounts</h3><div><span>1–9 units<strong>0%</strong></span><span>10–49 units<strong>5%</strong></span><span>50+ units<strong>12%</strong></span></div><p>Shipping {money(data.settings.shipping_fee)} below {money(data.settings.shipping_threshold)} after discounts; free at or above the threshold. Shipping is not discounted.</p></div>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary calculate-button" disabled={busy||items.length===0||items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>100000)||!Number.isFinite(hours)||hours<0||hours>1000} onClick={compute}><Calculator size={17}/>{busy?"Calculating…":kind==="repair"?"Calculate estimate":"Calculate order"}<ArrowRight size={16}/></button></div></section><aside className="quote-sidebar"><section className="panel quote-card"><div className="quote-title"><span className="brand-icon"><Wrench size={21}/></span><div><strong>AutoFix Workshop</strong><small>{kind==="repair"?"REPAIR ESTIMATE":"SUPPLIER ORDER PLAN"}</small></div></div><div className="quote-meta"><span>{data.today}</span><Badge tone="green">MYR</Badge></div>{result?<><div className="quote-lines">{result.lines.map(l=><div key={l.part_id}><span>{l.name}<small>{l.quantity} × {money(l.unit_cost)} {kind==="repair"?`+ ${Math.round(l.rate*100)}% markup`:`− ${Math.round(l.rate*100)}% discount`}</small></span><strong>{money(l.total)}</strong></div>)}</div><div className="quote-breakdown"><div><span>Parts {kind==="topup"?"after discount":"subtotal"}</span><strong>{money(result.subtotal)}</strong></div>{kind==="repair"?<><div><span>Labour · {result.hours} hours at {money(result.labour_rate)}/hr</span><strong>{money(result.labour)}</strong></div><div><span>Tax · {result.tax_percent}%</span><strong>{money(result.tax)}</strong></div></>:<><div><span>Discount saved</span><strong className="green-text">{money(result.discount)}</strong></div><div><span>Shipping</span><strong>{result.shipping===0?"Free":money(result.shipping)}</strong></div></>}</div><div className="quote-total"><span>Total {kind==="repair"?"estimate":"order cost"}</span><strong>{money(result.total)}</strong></div><button className="button secondary print-button" onClick={()=>window.print()}><Download size={16}/> Print / save PDF</button><p className="quote-footnote">{kind==="repair"?"Estimate only. Stock is unchanged until a stock OUT is recorded.":"Planning only. Record a stock IN when the delivery arrives."}</p></>:<div className="quote-placeholder"><Calculator size={32} strokeWidth={1.2}/><p>Your itemised {kind==="repair"?"estimate":"order"} will appear here.</p><strong>RM —</strong></div>}</section><div className="estimate-info"><ShieldCheck size={19}/><div><strong>Every calculation follows your rules.</strong><p>{kind==="repair"?"OEM markup 10%, Aftermarket 25%. Tax applies to parts plus labour. Missing-cost parts cannot be selected.":"Discounts apply per part. Shipping is calculated once on the whole order after discounts."}</p></div></div></aside></div>;
}
function SettingsForm({settings,onSave}:{settings:Settings;onSave:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div className="settings-grid"><form className="panel" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");try{await api("/api/settings","PUT",Object.fromEntries(Object.entries(settings).map(([k])=>[k,Number(f.get(k))])));await onSave();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><div className="panel-heading"><div><h2>Pricing & shipping</h2><p>Changes apply to your next calculation.</p></div><Settings2 size={21}/></div><div className="form-body"><div className="form-grid"><label>Labour rate (RM / hour)<input type="number" name="labour_rate" required min="0" max="1000000" step="0.01" defaultValue={settings.labour_rate}/></label><label>Tax (%)<input type="number" name="tax_percent" required min="0" max="100" step="0.01" defaultValue={settings.tax_percent}/></label><label>Free-shipping threshold (RM)<input type="number" name="shipping_threshold" required min="0" max="1000000" step="0.01" defaultValue={settings.shipping_threshold}/></label><label>Shipping fee (RM)<input type="number" name="shipping_fee" required min="0" max="1000000" step="0.01" defaultValue={settings.shipping_fee}/></label></div><div className="info-note"><CircleHelp size={17}/><span>Starting labour rate RM80/hour and tax 0% are defaults because the scenario does not specify them. Set your workshop’s rates here.</span></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><span>Currency: Malaysian ringgit</span><button className="button primary" disabled={busy}>{busy?"Saving…":"Save settings"}</button></div></div></form><section className="panel business-rules"><h2>Your inventory rules</h2><ul><li><Check size={16}/><div><strong>OEM / Aftermarket markup</strong><p>10% / 25% on the recorded part cost.</p></div></li><li><Check size={16}/><div><strong>Fast-moving parts</strong><p>5 or more separate stock OUT transactions in the last 30 days, including today. Keep twice the reorder level.</p></div></li><li><Check size={16}/><div><strong>Low-stock alerts</strong><p>At or below reorder level, or below twice the level for fast-moving parts.</p></div></li><li><Check size={16}/><div><strong>Duplicate detection</strong><p>Names are compared ignoring case and spaces. Variants remain separate parts.</p></div></li><li><Check size={16}/><div><strong>Local storage</strong><p>Your workshop data is saved on this laptop. Excel exports include active parts and all movement history.</p></div></li></ul></section></div>;
}



// The browser loads all workshop data through the independent backend API.
export default function Page() {
  const [initial, setInitial] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    fetch(apiUrl("/api/state"), {cache: "no-store", signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load the inventory.");
        return response.json() as Promise<AppState>;
      })
      .then(setInitial)
      .catch(error => {
        if (error.name !== "AbortError") setLoadError("Unable to connect to your workshop. Please check that the app is running and try again.");
      });
    return () => controller.abort();
  }, [retry]);
  if (initial) return <Workshop initial={initial} />;
  return <div className="loading-screen"><span className="brand-icon"><Wrench size={26}/></span><h1>AutoFix Workshop</h1>
    {loadError ? <><p role="alert">{loadError}</p><button className="button primary" onClick={() => setRetry(value => value + 1)}>Try again</button></> : <p role="status">Loading your workshop…</p>}
  </div>;
}
