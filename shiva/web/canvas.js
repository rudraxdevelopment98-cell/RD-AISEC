/* ============================================================
   Shiva Portal — Project Map
   Auto-laid-out, filterable, collapsible, searchable linked map
   with a minimap, path-to-root highlighting and live task data.
   ============================================================ */
(function(){
const DOC="https://github.com/rudraxdevelopment98-cell/shiva/blob/claude/dazzling-galileo-j9yt04/docs/";
const CLR={root:"#8b5cf6",phase:"#6d5efc",build:"#22d3ee",hosted:"#34d399",threat:"#fb7185",platform:"#a855f7"};
const COLW=320, ROWH=104, CX=120;

/* ---- the project as a tree (+ cross-links) ---- */
const SHIVA_TREE={id:"root",t:"SHIVA",s:"MCP security",ic:"☩",cat:"root",status:"Active",
  d:["Own the detection + policy layer where AI agents meet their tools.","Open-source first, hosted product later."],doc:"overview/",
  ch:[
  {id:"journey",t:"Journey",s:"4 phases · 18 mo",ic:"◎",cat:"phase",collapsible:1,status:"On track",doc:"roadmap/",
    d:["The phased plan with decision gates between each."],ch:[
    {id:"p0",t:"Phase 0",s:"Learn + Break",ic:"🧪",cat:"phase",phase:"P0",current:1,status:"Active",doc:"roadmap/",
      d:["Stand up MCP; reproduce the 3 core attacks.","Publish a write-up per attack."],tags:["Weeks 0-6"]},
    {id:"p1",t:"Phase 1",s:"OSS Scanner",ic:"🔍",cat:"phase",phase:"P1",status:"Planned",doc:"roadmap/",
      d:["Static analysis of MCP manifests → risk report.","CLI + CI check."],tags:["Months 1-4"]},
    {id:"p2",t:"Phase 2",s:"Runtime Gateway",ic:"🚦",cat:"phase",phase:"P2",status:"Planned",doc:"architecture/",
      d:["Proxy: log, allowlist, block drift in real time."],tags:["Months 4-10"]},
    {id:"p3",t:"Phase 3",s:"Hosted Layer",ic:"🏛",cat:"phase",phase:"P3",status:"Planned",doc:"roadmap/",
      d:["Registry, central policy, compliance — the paid layer."],tags:["Months 10-18"]}]},
  {id:"build",t:"What we build",s:"the product",ic:"🏗",cat:"build",collapsible:1,status:"Designing",doc:"architecture/",
    d:["Open-source funnel feeds the paid hosted layer."],ch:[
    {id:"range",t:"Attack Range",s:"benchmark · OSS",ic:"🎯",cat:"build",status:"In progress",doc:"improvements/",
      d:["Library of malicious servers.","Hero give-first asset + public leaderboard."],tags:["3 attacks live"]},
    {id:"scanner",t:"Scanner",s:"static · OSS",ic:"🔍",cat:"build",status:"Planned",doc:"architecture/",d:["Catches poisoning before trust."]},
    {id:"gateway",t:"Gateway",s:"runtime · OSS",ic:"🚦",cat:"build",status:"Planned",doc:"architecture/",d:["Logs, allowlists, blocks at runtime."]},
    {id:"registry",t:"Registry",s:"reputation",ic:"📒",cat:"hosted",status:"Hosted",doc:"architecture/",d:["Server reputation scoring."]},
    {id:"policy",t:"Central Policy",s:"multi-team",ic:"⚙",cat:"hosted",status:"Hosted",doc:"architecture/",d:["Policy across many agents/teams."]},
    {id:"comp",t:"Compliance",s:"NIST · EU AI Act",ic:"📑",cat:"hosted",status:"Hosted",doc:"architecture/",d:["Reporting mapped to regulation = forced buyers."]}]},
  {id:"threats",t:"Threats",s:"what we defend",ic:"🛡",cat:"threat",collapsible:1,status:"Modelled",doc:"threat-model/",
    d:["The MCP attack surface we exist to neutralise."],ch:[
    {id:"poison",t:"Tool Poisoning",s:"attack #1",ic:"①",cat:"threat",status:"Reproducing",doc:"threat-model/",
      d:["Hidden instructions inside tool metadata."],tags:["Phase 0"]},
    {id:"drift",t:"Drift / Rug-pull",s:"attack #2",ic:"②",cat:"threat",status:"Reproducing",doc:"threat-model/",
      d:["Description changes after trust is granted."],tags:["Phase 0"]},
    {id:"cross",t:"Cross-tool Esc.",s:"attack #3",ic:"③",cat:"threat",status:"Reproducing",doc:"threat-model/",
      d:["One tool's output steers the next call."],tags:["Phase 0"]},
    {id:"cred",t:"Credential Theft",s:"attack #5",ic:"⑤",cat:"threat",status:"Backlog",doc:"threat-model/",
      d:["Servers holding OAuth tokens get drained."]}]},
  {id:"platform",t:"Platform",s:"this portal",ic:"🖥",cat:"platform",collapsible:1,status:"Live (local)",doc:"platform/",
    d:["Internal command-center: accounts, roles, tasks, docs."],ch:[
    {id:"auth",t:"Auth",s:"sign in",ic:"🔐",cat:"platform",status:"Done",doc:"platform/",d:["Username + password login."]},
    {id:"rbac",t:"Access Control",s:"roles + grants",ic:"🛡",cat:"platform",status:"Done",doc:"platform/",
      d:["Owner · Admin · Manager · Member · Viewer.","Per-section access."]},
    {id:"admin",t:"Admin",s:"users + audit",ic:"⚙",cat:"platform",status:"Done",doc:"platform/",d:["Create users, assign roles."]}]}
  ]};
const SHIVA_REL=[["range","scanner"],["range","gateway"],["scanner","registry"],["gateway","policy"],["registry","policy"],["policy","comp"]];

/* ---- project-aware tree ---- */
let TREE=SHIVA_TREE, REL=SHIVA_REL, ALL={};
function buildIndex(){ALL={};
  (function index(n,parent){n.parent=parent;ALL[n.id]=n;(n.ch||[]).forEach(c=>index(c,n));})(TREE,null);
  TREE.branch=null;(TREE.ch||[]).forEach(b=>(function mark(n){n.branch=b.id;(n.ch||[]).forEach(mark)})(b));}
function genericTree(){const info=(window.activeProjectInfo&&window.activeProjectInfo())||{name:"Project",key:"P"};
  return {id:"root",t:info.name,s:"project",ic:info.key||"◆",cat:"root",status:"Active",
    d:["Phases and milestones for "+info.name+"."],ch:[
    {id:"journey",t:"Journey",s:"phases",ic:"◎",cat:"phase",collapsible:1,ch:[
      {id:"p0",t:"Phase 1",s:"Planning",ic:"①",cat:"phase",phase:"P0",current:1,status:"Active",d:["Scope, plan, set up."]},
      {id:"p1",t:"Phase 2",s:"Build",ic:"②",cat:"phase",phase:"P1",status:"Planned",d:["Core build."]},
      {id:"p2",t:"Phase 3",s:"Test",ic:"③",cat:"phase",phase:"P2",status:"Planned",d:["Test + harden."]},
      {id:"p3",t:"Phase 4",s:"Launch",ic:"④",cat:"phase",phase:"P3",status:"Planned",d:["Ship + iterate."]}]}]};}

let cam={x:0,y:0,z:1}, sel=null, collapsed=new Set(), hidden=new Set(), placed=[];

window.initCanvas=function(){const pid=(window.activeProject&&window.activeProject())||"shiva";
  if(pid==="shiva"){TREE=SHIVA_TREE;REL=SHIVA_REL;}else{TREE=genericTree();REL=[];}
  buildIndex();collapsed=new Set();hidden=new Set();cam={x:0,y:0,z:1};sel=null;render();fit();bindVP();};

function visibleChildren(n){return (collapsed.has(n.id)?[]:(n.ch||[])).filter(c=>!hidden.has(c.branch))}
function layout(){let yc=0;placed=[];
  function rec(n,depth){n.x=depth*COLW+CX;const kids=visibleChildren(n);
    if(!kids.length){n.y=yc;yc+=ROWH;}else{kids.forEach(c=>rec(c,depth+1));n.y=(kids[0].y+kids[kids.length-1].y)/2;}
    placed.push(n);}
  rec(TREE,0);}

function render(){
  const stage=document.getElementById("cvstage"),svg=document.getElementById("cvedges");if(!stage)return;
  layout();const set=new Set(placed.map(n=>n.id));
  stage.querySelectorAll(".cv-node").forEach(n=>n.remove());svg.innerHTML="";
  // edges: parent→child
  placed.forEach(n=>{if(n.parent&&set.has(n.parent.id))edge(svg,n.parent,n,"")});
  // cross-links
  REL.forEach(([a,b])=>{if(set.has(a)&&set.has(b))edge(svg,ALL[a],ALL[b],"rel")});
  // nodes
  const tasks=(window.shivaTasks?window.shivaTasks():[])||[];
  placed.forEach(n=>{
    const d=document.createElement("div");d.className="cv-node cat-"+n.cat+(n.id==="root"?" big":"")+(n.current?" current":"")+(n.collapsible?" coll":"");
    d.style.setProperty("--clr",CLR[n.cat]);d.style.left=n.x+"px";d.style.top=n.y+"px";d.dataset.id=n.id;
    const caret=n.collapsible?`<span class="cv-caret">${collapsed.has(n.id)?"▸":"▾"}</span>`:"";
    let live="";
    if(n.phase){const list=tasks.filter(t=>(t.phase||"P0")===n.phase);const done=list.filter(t=>t.status==="Done").length;
      const pct=list.length?Math.round(done/list.length*100):0;
      live=`<div class="cv-live"><div class="cv-live-bar"><i style="width:${pct}%"></i></div><span>${list.length?done+"/"+list.length+" tasks":"no tasks"}</span></div>`;}
    d.innerHTML=`<div class="t"><span class="ic">${n.ic}</span><span class="nm">${n.t}</span>${caret}</div>
      <div class="s">${n.s||""}</div>${n.status?`<span class="cv-st">${n.status}</span>`:""}${live}`;
    d.onmouseenter=()=>focus(n.id);d.onmouseleave=()=>{sel?focusPath(sel):unfocus()};
    d.onclick=e=>{e.stopPropagation();if(n.collapsible){toggle(n.id)}else{openDetail(n)}};
    stage.appendChild(d);});
  apply();miniRender();if(sel&&ALL[sel])focusPath(sel);
}
function edge(svg,a,b,cls){const p=document.createElementNS("http://www.w3.org/2000/svg","path");
  const mx=(a.x+b.x)/2;p.setAttribute("d",`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`);
  p.setAttribute("class","cv-edge "+cls);p.dataset.a=a.id;p.dataset.b=b.id;svg.appendChild(p);}

function toggle(id){if(collapsed.has(id))collapsed.delete(id);else collapsed.add(id);render();}
window.cvCollapseAll=function(){TREE.ch.forEach(b=>{if(b.collapsible)collapsed.add(b.id)});render();fit();};
window.cvExpandAll=function(){collapsed.clear();render();fit();};
window.cvToggleBranch=function(b,el){if(hidden.has(b)){hidden.delete(b);el.classList.add("active")}else{hidden.add(b);el.classList.remove("active")}
  if(sel&&ALL[sel]&&ALL[sel].branch===b)closeDetail();render();};
window.cvSearch=function(q){q=q.trim().toLowerCase();
  document.querySelectorAll(".cv-node").forEach(el=>{const n=ALL[el.dataset.id];
    const hit=!q||((n.t+" "+(n.s||"")+" "+(n.d||[]).join(" ")).toLowerCase().includes(q));
    el.classList.toggle("search-hit",!!q&&hit);el.classList.toggle("search-miss",!!q&&!hit);});};

/* ---- camera ---- */
function apply(){const s=document.getElementById("cvstage");if(s)s.style.transform=`translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;miniView();}
function fit(){const vp=document.getElementById("cvvp");if(!vp||!placed.length)return;
  let a=1e9,b=1e9,c=-1e9,d=-1e9;placed.forEach(n=>{a=Math.min(a,n.x);b=Math.min(b,n.y);c=Math.max(c,n.x);d=Math.max(d,n.y)});
  const pad=150;a-=pad;b-=pad;c+=pad;d+=pad;const w=c-a,h=d-b,W=vp.clientWidth,H=vp.clientHeight;
  cam.z=Math.min(W/w,H/h,1.05);cam.x=(W-w*cam.z)/2-a*cam.z;cam.y=(H-h*cam.z)/2-b*cam.z;apply();}
window.cvFit=fit;
window.cvZoom=function(f){const vp=document.getElementById("cvvp");const W=vp.clientWidth/2,H=vp.clientHeight/2;
  const wx=(W-cam.x)/cam.z,wy=(H-cam.y)/cam.z;cam.z=Math.max(.25,Math.min(2,cam.z*f));cam.x=W-wx*cam.z;cam.y=H-wy*cam.z;apply();};
let drag=false,sx,sy,c0;
function bindVP(){const vp=document.getElementById("cvvp");if(!vp||vp._bound)return;vp._bound=1;
  vp.addEventListener("mousedown",e=>{drag=true;vp.classList.add("grab");sx=e.clientX;sy=e.clientY;c0={...cam}});
  window.addEventListener("mousemove",e=>{if(!drag)return;cam.x=c0.x+(e.clientX-sx);cam.y=c0.y+(e.clientY-sy);apply()});
  window.addEventListener("mouseup",()=>{drag=false;vp.classList.remove("grab")});
  vp.addEventListener("click",e=>{if(e.target===vp||e.target.tagName==="svg"||e.target.id==="cvstage")closeDetail()});
  vp.addEventListener("wheel",e=>{e.preventDefault();const r=vp.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
    const wx=(mx-cam.x)/cam.z,wy=(my-cam.y)/cam.z;cam.z=Math.max(.25,Math.min(2,cam.z*(e.deltaY<0?1.12:.89)));
    cam.x=mx-wx*cam.z;cam.y=my-wy*cam.z;apply();},{passive:false});}

/* ---- focus / path ---- */
function neighbors(id){const s=new Set([id]);placed.forEach(n=>{if(n.parent&&(n.id===id||n.parent.id===id)){s.add(n.id);s.add(n.parent.id)}});
  REL.forEach(([a,b])=>{if(a===id)s.add(b);if(b===id)s.add(a)});return s;}
function focus(id){const ns=neighbors(id);
  document.querySelectorAll(".cv-node").forEach(el=>el.classList.toggle("dim",!ns.has(el.dataset.id)));
  document.querySelectorAll(".cv-edge").forEach(e=>{const on=e.dataset.a===id||e.dataset.b===id;e.classList.toggle("hl",on);e.classList.toggle("dim",!on)});}
function focusPath(id){const path=new Set();let n=ALL[id];while(n){path.add(n.id);n=n.parent;}
  document.querySelectorAll(".cv-node").forEach(el=>el.classList.toggle("dim",!path.has(el.dataset.id)));
  document.querySelectorAll(".cv-edge").forEach(e=>{const on=path.has(e.dataset.a)&&path.has(e.dataset.b);e.classList.toggle("hl",on);e.classList.toggle("dim",!on)});}
function unfocus(){document.querySelectorAll(".cv-node").forEach(el=>el.classList.remove("dim"));
  document.querySelectorAll(".cv-edge").forEach(e=>e.classList.remove("hl","dim"));}

/* ---- detail panel ---- */
function openDetail(n){sel=n.id;focusPath(n.id);
  document.querySelectorAll(".cv-node").forEach(e=>e.classList.toggle("sel",e.dataset.id===n.id));
  const tasks=(window.shivaTasks?window.shivaTasks():[])||[];let liveHtml="";
  if(n.phase){const list=tasks.filter(t=>(t.phase||"P0")===n.phase);const done=list.filter(t=>t.status==="Done").length;
    const pct=list.length?Math.round(done/list.length*100):0;
    liveHtml=`<div class="cvp-live"><div class="cvp-live-top"><span>Tasks</span><b>${done}/${list.length} · ${pct}%</b></div>
      <div class="cv-live-bar"><i style="width:${pct}%"></i></div>
      <button class="btn sm" style="margin-top:10px;width:100%;justify-content:center" onclick="cvViewTasks()">View tasks →</button></div>`;}
  const p=document.getElementById("cvpanel");p.style.setProperty("--clr",CLR[n.cat]);
  p.innerHTML=`<div class="cvp-x" onclick="cvCloseDetail()">✕</div>
    <div class="cvp-h"><span class="cvp-ic" style="background:${CLR[n.cat]}">${n.ic}</span>
      <div><b>${n.t}</b><div class="cvp-s">${n.s||""}</div></div></div>
    <div class="cvp-meta">${n.status?`<span class="cvp-tag">${n.status}</span>`:""}${(n.tags||[]).map(t=>`<span class="cvp-tag ghost">${t}</span>`).join("")}</div>
    ${n.d?`<ul>${n.d.map(x=>`<li>${x}</li>`).join("")}</ul>`:""}
    ${liveHtml}
    ${n.doc?`<a href="${DOC}${n.doc.replace(/\/$/,'')}.md" target="_blank">Open full write-up ↗</a>`:""}`;
  p.classList.add("open");}
function closeDetail(){sel=null;unfocus();const p=document.getElementById("cvpanel");if(p)p.classList.remove("open");
  document.querySelectorAll(".cv-node").forEach(e=>e.classList.remove("sel"));}
window.cvCloseDetail=closeDetail;
window.cvViewTasks=function(){if(window.go)window.go("tasks")};

/* ---- minimap ---- */
let mmB=null;
function miniRender(){const mm=document.getElementById("cvmini");if(!mm||!placed.length)return;
  let a=1e9,b=1e9,c=-1e9,d=-1e9;placed.forEach(n=>{a=Math.min(a,n.x);b=Math.min(b,n.y);c=Math.max(c,n.x);d=Math.max(d,n.y)});
  const pad=150;a-=pad;b-=pad;c+=pad;d+=pad;mmB={a,b,w:c-a,h:d-b};const sx=180/(c-a),sy=120/(d-b);
  let s="";placed.forEach(n=>{if(n.parent)s+=`<line x1="${(n.parent.x-a)*sx}" y1="${(n.parent.y-b)*sy}" x2="${(n.x-a)*sx}" y2="${(n.y-b)*sy}" stroke="rgba(120,140,220,.35)" stroke-width="1"/>`;});
  placed.forEach(n=>{s+=`<circle cx="${(n.x-a)*sx}" cy="${(n.y-b)*sy}" r="2.4" fill="${CLR[n.cat]}"/>`;});
  s+=`<rect id="cvmv" fill="rgba(109,94,252,.16)" stroke="#6d5efc" stroke-width="1"/>`;mm.innerHTML=s;miniView();}
function miniView(){const mm=document.getElementById("cvmini"),vp=document.getElementById("cvvp"),rect=document.getElementById("cvmv");
  if(!mm||!vp||!rect||!mmB)return;const sx=180/mmB.w,sy=120/mmB.h;const vw=vp.clientWidth/cam.z,vh=vp.clientHeight/cam.z;
  const vx=-cam.x/cam.z,vy=-cam.y/cam.z;rect.setAttribute("x",(vx-mmB.a)*sx);rect.setAttribute("y",(vy-mmB.b)*sy);
  rect.setAttribute("width",Math.max(4,vw*sx));rect.setAttribute("height",Math.max(4,vh*sy));}
window.cvMiniClick=function(e){const mm=document.getElementById("cvmini");if(!mmB)return;const r=mm.getBoundingClientRect();
  const px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;const wx=mmB.a+px*mmB.w,wy=mmB.b+py*mmB.h;
  const vp=document.getElementById("cvvp");cam.x=vp.clientWidth/2-wx*cam.z;cam.y=vp.clientHeight/2-wy*cam.z;apply();};

window.addEventListener("keydown",e=>{if(document.getElementById("cvwrap")){if(e.key==="Escape")closeDetail();else if(e.key==="f"||e.key==="F"){if(document.activeElement.id!=="cvsearch")fit()}}});
})();
