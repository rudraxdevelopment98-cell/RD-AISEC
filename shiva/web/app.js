/* ============================================================
   Shiva Portal — UI layer (MULTI-PROJECT, backend-agnostic)
   ============================================================ */
const AV=["#6d5efc","#22d3ee","#8b5cf6","#ec4899","#f97316","#34d399","#60a5fa","#a855f7"];
let state={users:[],projects:[],members:[],tasks:[],docs:[],research:[],activity:[],sessionUser:null};
let route="dashboard";

/* helpers */
function uid(){return Math.random().toString(36).slice(2,10)}
function date(off){const d=new Date();d.setDate(d.getDate()+(off||0));return d.toISOString().slice(0,10)}
function fmt(ts){const d=new Date(ts);return d.toLocaleDateString(undefined,{day:"numeric",month:"short"})+" "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}
function esc(s){return(s==null?"":String(s)).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function avatarColor(name){let h=0;for(const c of (name||"?"))h=(h*31+c.charCodeAt(0))%AV.length;return AV[h]}
function initials(name){return (name||"?").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase()}
function me(){return state.users.find(u=>u.username===state.sessionUser)}
function active(){return Store.activeProject()}
function proj(){return state.projects.find(p=>p.id===active())}
function myMember(){return state.members.find(m=>m.username===state.sessionUser&&m.projectId===active())}
function myRole(){const m=myMember();return m?m.role:null}
function myAccess(){const m=myMember();return m?m.access:[]}
function isPlatformAdmin(){const u=me();return u&&u.platformAdmin}
function isManager(){return ["Owner","Admin","Manager"].includes(myRole())}
function isProjAdmin(){return ["Owner","Admin"].includes(myRole())}
function can(sec){if(sec==="profile")return true;if(sec==="projects")return isPlatformAdmin();return myAccess().includes(sec)}
function myProjects(){const ids=new Set(state.members.filter(m=>m.username===state.sessionUser).map(m=>m.projectId));
  let ps=state.projects.filter(p=>ids.has(p.id));if(isPlatformAdmin())ps=state.projects;return ps}
function inProj(arr){const a=active();return arr.filter(x=>x.projectId===a)}
function assigneeName(un){const u=state.users.find(x=>x.username===un);return u?u.name:un}
function val(id){const e=document.getElementById(id);return e?e.value:""}
function emptyState(ic,msg){return `<div class="empty"><div class="ic">${ic}</div>${esc(msg)}</div>`}

window.shivaTasks=()=>inProj(state.tasks);
window.activeProject=()=>active();
window.activeProjectInfo=()=>proj();

/* theme */
function applyTheme(){const t=localStorage.getItem("shiva_theme");if(t==="light")document.documentElement.setAttribute("data-theme","light");else document.documentElement.removeAttribute("data-theme")}
function toggleTheme(){const cur=localStorage.getItem("shiva_theme")==="light"?"":"light";localStorage.setItem("shiva_theme",cur||"dark");applyTheme();const b=document.getElementById("themebtn");if(b)b.textContent=cur==="light"?"☾":"☀"}

/* data */
async function refresh(){const d=await Store.fetchAll();Object.assign(state,d);state.sessionUser=Store.sessionUser()}
async function reload(){await refresh();renderShell();renderRoute()}

/* boot / auth */
async function boot(){applyTheme();await Store.init();state.sessionUser=Store.sessionUser();
  if(!state.sessionUser){showLogin();return}await refresh();showApp()}
function showLogin(){document.getElementById("app").style.display="none";
  const lg=document.getElementById("login");lg.classList.remove("hidden");
  const m=document.getElementById("li-mode");m.textContent=Store.mode==="cloud"?"● CLOUD":"● LOCAL";m.className="mode "+(Store.mode==="cloud"?"cloud":"local");
  document.getElementById("li-hint").style.display=Store.firstRun()?"block":"none"}
function showApp(){document.getElementById("login").classList.add("hidden");document.getElementById("app").style.display="block";
  if(!can(route))route="dashboard";renderShell();renderRoute()}
async function doLogin(){const u=document.getElementById("li-user").value.trim(),p=document.getElementById("li-pass").value;
  const err=document.getElementById("li-err");err.textContent="Signing in…";const r=await Store.login(u,p);
  if(r.error){err.textContent=r.error;return}await Store.addActivity("Signed in");await refresh();showApp()}
async function logout(){await Store.addActivity("Signed out");await Store.logout();state.sessionUser=null;showLogin()}

function go(r){if(!can(r))return;route=r;renderRoute();document.querySelectorAll(".side a.nav").forEach(a=>a.classList.toggle("active",a.dataset.r===r))}
window.go=go;
async function switchProject(id){await Store.setActive(id);route=can(route)?route:"dashboard";await reload()}

/* shell */
function renderShell(){
  const u=me();if(!u)return;const ps=myProjects();const a=active();
  const nav=SECTIONS.filter(s=>can(s.id)&&s.id!=="profile");
  const main=nav.filter(s=>!["members"].includes(s.id));
  const sys=nav.filter(s=>s.id==="members");
  const myTasks=inProj(state.tasks).filter(t=>t.assignee===u.username&&t.status!=="Done").length;
  const item=s=>`<a class="nav ${s.id===route?'active':''}" data-r="${s.id}" onclick="go('${s.id}')">
     <span class="ic">${s.ic}</span>${s.label}${s.id==='tasks'&&myTasks?`<span class="count">${myTasks}</span>`:''}</a>`;
  const dark=localStorage.getItem("shiva_theme")!=="light";
  const switcher=`<select class="projsel" onchange="switchProject(this.value)">
    ${ps.map(p=>`<option value="${p.id}" ${p.id===a?'selected':''}>${esc(p.name)}</option>`).join("")}</select>`;
  document.getElementById("app").innerHTML=`<div class="shell">
   <aside class="side">
     <div class="brand"><div class="l">☩</div><div><b>SHIVA</b><small>PROJECT PORTAL</small></div></div>
     <div class="projbar">${ps.length?switcher:'<span class="nomem">No projects</span>'}</div>
     <nav><div class="navlbl">WORKSPACE</div>${main.map(item).join("")}
       ${sys.length?`<div class="navlbl">MANAGE</div>${sys.map(item).join("")}`:""}
       <div class="navlbl">ACCOUNT</div>
       <a class="nav ${route==='profile'?'active':''}" data-r="profile" onclick="go('profile')"><span class="ic">◍</span>My Profile</a>
       ${isPlatformAdmin()?`<a class="nav ${route==='projects'?'active':''}" data-r="projects" onclick="go('projects')"><span class="ic">⊞</span>All Projects</a>`:""}
     </nav>
     <div class="me"><div class="av" style="background:${avatarColor(u.name)}">${initials(u.name)}</div>
       <div style="flex:1;min-width:0"><div class="nm">${esc(u.name)}</div><div class="rl">${myRole()||(u.platformAdmin?'Platform admin':'—')}</div></div>
       <button class="btn ghost sm" title="Sign out" onclick="logout()" style="color:var(--faint)">⎋</button></div>
   </aside>
   <main class="main">
     <div class="topbar"><div class="crumb">${esc((proj()||{}).name||'Portal')} / <b id="crumb">Dashboard</b></div>
       <div class="search"><input placeholder="Search…" oninput="quickSearch(this.value)"></div>
       <div class="iconbtn" id="themebtn" title="Toggle theme" onclick="toggleTheme()">${dark?'☀':'☾'}</div>
       <div class="iconbtn" title="Reset demo data" onclick="reseedConfirm()">⟳</div>
     </div><div class="content" id="content"></div>
   </main></div>`;
}
function renderRoute(){
  const map={dashboard:viewDashboard,project:viewProject,canvas:viewCanvas,tasks:viewTasks,documents:viewDocuments,
    research:viewResearch,activity:viewActivity,members:viewMembers,projects:viewProjects,profile:viewProfile};
  const sec=SECTIONS.find(s=>s.id===route);const cb=document.getElementById("crumb");
  if(cb)cb.textContent=route==='projects'?'All Projects':(sec?sec.label:'Dashboard');
  if(!can(route))route="dashboard";
  document.getElementById("content").innerHTML=(map[route]||viewDashboard)();
  if(route==="canvas"&&window.initCanvas)setTimeout(window.initCanvas,0)}
function quickSearch(q){if(!["tasks","documents","members","projects"].includes(route))return;const t=q.toLowerCase();
  document.querySelectorAll("[data-srch]").forEach(el=>{el.style.display=el.dataset.srch.toLowerCase().includes(t)?"":"none"})}

/* ============ VIEWS ============ */
function noProject(){return `<div class="page-h"><div><h1>No project selected</h1><p>You're not a member of any project yet.</p></div></div>
  ${isPlatformAdmin()?`<div class="card"><div class="bd">${emptyState("⊞","Create your first project from <b>All Projects</b>.")}<div style="text-align:center"><button class="btn primary" onclick="go('projects')">Go to All Projects</button></div></div></div>`:emptyState("🔒","Ask an admin to add you to a project.")}`}

function viewDashboard(){
  if(!proj())return noProject();
  const u=me();const T=inProj(state.tasks);const myTasks=T.filter(t=>t.assignee===u.username);
  const myDone=myTasks.filter(t=>t.status==="Done").length;const allDone=T.filter(t=>t.status==="Done").length;
  const prog=T.length?Math.round(allDone/T.length*100):0;const memberCount=state.members.filter(m=>m.projectId===active()).length;
  const stat=(ic,bg,c,v,l,sub,sc)=>`<div class="stat"><div class="ic" style="background:${bg};color:${c}">${ic}</div>
    <div class="v">${v}</div><div class="l">${l}</div>${sub?`<div class="sub" style="color:${sc||'var(--muted)'}">${sub}</div>`:''}</div>`;
  const todays=myTasks.filter(t=>t.status!=="Done").slice(0,5);
  return `<div class="page-h"><div><h1>Welcome back, ${esc(u.name.split(" ")[0])}</h1>
     <p>${esc(proj().name)} · your role: <b>${myRole()}</b></p></div></div>
   <div class="grid c4" style="margin-bottom:16px">
     ${stat("✓","var(--primary-soft)","var(--primary)",myDone+"/"+myTasks.length,"My tasks done")}
     ${stat("◷","var(--amber-soft)","var(--amber)",myTasks.length-myDone,"My open tasks")}
     ${stat("◭","var(--green-soft)","var(--green)",prog+"%","Project progress")}
     ${stat("◍","var(--blue-soft)","var(--blue)",memberCount,"Members")}
   </div>
   <div class="grid c3">
     <div class="card" style="grid-column:span 2"><div class="hd"><h3>My tasks</h3>
       <div class="actions">${can('tasks')?`<button class="btn sm" onclick="go('tasks')">View all</button>`:''}</div></div>
       <div class="bd">${todays.length?`<div class="tlist">${todays.map(taskRow).join("")}</div>`:emptyState("✓","No open tasks. You're all caught up.")}</div></div>
     <div class="card"><div class="hd"><h3>Project progress</h3></div><div class="bd">
       <div style="font-size:30px;font-weight:700">${prog}%</div>
       <div class="l" style="color:var(--muted);margin:2px 0 12px">${allDone} of ${T.length} tasks complete</div>
       <div class="pbar"><i style="width:${prog}%"></i></div></div></div>
   </div>
   <div class="card" style="margin-top:16px"><div class="hd"><h3>Recent activity</h3>
     ${can('activity')?`<div class="actions"><button class="btn sm" onclick="go('activity')">All activity</button></div>`:''}</div>
     <div class="bd" style="padding-top:6px">${activityList(inProj(state.activity).slice(0,6))}</div></div>`;
}
function taskRow(t){const done=t.status==="Done";const pr={Critical:"red",High:"amber",Medium:"blue",Low:"grey"}[t.priority]||"grey";
  return `<div class="titem ${done?'done':''}"><div class="cb ${done?'on':''}" onclick="toggleTask('${t.id}')">${done?'✓':''}</div>
    <div style="flex:1;min-width:0"><div class="tt">${esc(t.title)}</div>
      <div class="meta">Due ${t.due} · <span class="badge ${pr}" style="padding:1px 7px">${t.priority}</span></div></div>
    <div class="avatar" style="width:26px;height:26px;background:${avatarColor(assigneeName(t.assignee))}">${initials(assigneeName(t.assignee))}</div></div>`}

function viewProject(){
  if(!proj())return noProject();const p=proj();const shiva=p.id==="shiva";
  const steps=shiva?[["1","Phase 0","Learn + Break","active"],["2","Phase 1","OSS Scanner",""],["3","Phase 2","Runtime Gateway",""],["4","Phase 3","Hosted Layer",""]]
    :[["1","Phase 1","Planning","active"],["2","Phase 2","Build",""],["3","Phase 3","Test",""],["4","Phase 4","Launch",""]];
  const DOC="https://github.com/rudraxdevelopment98-cell/shiva/blob/claude/dazzling-galileo-j9yt04/docs/";
  const docs=[["▶ Getting started","getting-started/"],["Roadmap","roadmap/"],["Architecture","architecture/"],["Threat model","threat-model/"],["Platform / RBAC","platform/"]];
  return `<div class="page-h"><div><h1>${esc(p.name)} · Roadmap</h1><p>${esc(p.desc||"Project phases and milestones.")}</p></div></div>
   <div class="card"><div class="bd" style="padding:30px 26px"><div class="stepper">${steps.map(s=>`<div class="step ${s[3]}">
     <div class="dot">${s[0]}</div><div class="t">${s[1]}</div><div class="s">${s[2]}</div></div>`).join("")}</div></div></div>
   ${shiva?`<div class="card" style="margin-top:16px"><div class="hd"><h3>Reference documents</h3></div><div class="bd"><div class="tlist">
     ${docs.map(d=>`<div class="titem"><div style="flex:1"><div class="tt">${d[0]}</div><div class="meta">Markdown · GitHub</div></div>
       <a class="btn sm" href="${DOC}${d[1].replace(/\/$/,'')}.md" target="_blank">Open ↗</a></div>`).join("")}</div></div></div>`:
     `<div class="card" style="margin-top:16px"><div class="bd">${emptyState("▤","Add this project's documents under <b>Documents</b>.")}</div></div>`}`;
}
function viewCanvas(){if(!proj())return noProject();
  const branches=[["journey","Journey","#6d5efc"],["build","Build","#22d3ee"],["threats","Threats","#fb7185"],["platform","Platform","#a855f7"]];
  return `<div class="page-h"><div><h1>Project Map</h1><p>${esc(proj().name)} as a living, linked structure — pan, zoom, search, filter, click.</p></div>
     <div class="actions"><input id="cvsearch" placeholder="Search the map…" oninput="cvSearch(this.value)" style="width:180px">
       <button class="btn sm" onclick="cvCollapseAll()">⊟</button><button class="btn sm" onclick="cvExpandAll()">⊞</button></div></div>
   <div class="cv-wrap" id="cvwrap">
     <div class="cv-legend" id="cvlegend">${branches.map(b=>`<span class="cv-chip active" data-b="${b[0]}" onclick="cvToggleBranch('${b[0]}',this)"><i style="background:${b[2]}"></i>${b[1]}</span>`).join("")}
       <span class="cv-chip static"><i style="background:#34d399"></i>Hosted</span></div>
     <div class="cv-vp" id="cvvp"><div class="cv-stage" id="cvstage"><svg id="cvedges" style="position:absolute;overflow:visible"></svg></div></div>
     <svg class="cv-mini" id="cvmini" viewBox="0 0 180 120" preserveAspectRatio="none" onclick="cvMiniClick(event)"></svg>
     <div class="cv-tools"><div class="btn sm" onclick="cvZoom(1.2)">+</div><div class="btn sm" onclick="cvZoom(.83)">−</div><div class="btn sm" onclick="cvFit()">⛶ Fit</div></div>
     <div class="cv-panel" id="cvpanel"></div></div>`;
}
function viewTasks(){if(!proj())return noProject();
  const canAssign=isManager();const cols=[["To do","grey"],["In progress","blue"],["Done","green"]];
  const T=inProj(state.tasks);const list=T.slice().sort((a,b)=>(a.due||"").localeCompare(b.due||""));
  return `<div class="page-h"><div><h1>Tasks</h1><p>Daily task allocation for ${esc(proj().name)}.</p></div>
     <div class="actions">${canAssign?`<button class="btn primary" onclick="openTaskModal()">+ New task</button>`:''}</div></div>
   <div class="grid c3" style="margin-bottom:16px">${cols.map(c=>{const n=T.filter(t=>t.status===c[0]).length;
     return `<div class="stat"><div class="v">${n}</div><div class="l">${c[0]}</div>
       <div class="pbar" style="margin-top:10px"><i style="width:${T.length?n/T.length*100:0}%"></i></div></div>`}).join("")}</div>
   <div class="card"><table class="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Status</th><th></th></tr></thead>
   <tbody>${list.map(t=>{const pr={Critical:"red",High:"amber",Medium:"blue",Low:"grey"}[t.priority]||"grey";const st={["To do"]:"grey",["In progress"]:"blue",Done:"green"}[t.status];
     return `<tr data-srch="${esc(t.title)} ${esc(assigneeName(t.assignee))}">
       <td><div style="font-weight:600">${esc(t.title)}</div><div class="meta" style="color:var(--muted);font-size:12px">${esc(t.desc||"")}</div></td>
       <td><div class="userc"><div class="avatar" style="background:${avatarColor(assigneeName(t.assignee))}">${initials(assigneeName(t.assignee))}</div><span class="nm">${esc(assigneeName(t.assignee))}</span></div></td>
       <td>${t.due}</td><td><span class="badge ${pr}">${t.priority}</span></td>
       <td><span class="badge ${st}"><span class="dot" style="background:currentColor"></span>${t.status}</span></td>
       <td style="text-align:right"><select onchange="setTaskStatus('${t.id}',this.value)" style="width:auto;padding:6px 8px;font-size:12px">
         ${["To do","In progress","Done"].map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join("")}</select></td></tr>`}).join("")}
   </tbody></table>${list.length?'':emptyState("✓","No tasks yet.")}</div>`;
}
function viewDocuments(){if(!proj())return noProject();const canUp=["Owner","Admin","Manager","Member"].includes(myRole());
  const D=inProj(state.docs);
  return `<div class="page-h"><div><h1>Documents</h1><p>Files for ${esc(proj().name)}.</p></div>
     <div class="actions">${canUp?`<label class="btn primary">+ Upload<input type="file" style="display:none" onchange="uploadDoc(this)"></label>`:''}</div></div>
   <div class="card"><table class="tbl"><thead><tr><th>Name</th><th>Category</th><th>Size</th><th>By</th><th>Date</th><th></th></tr></thead>
   <tbody>${D.map(d=>`<tr data-srch="${esc(d.name)}"><td><div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">▤</span><b>${esc(d.name)}</b></div></td>
     <td><span class="badge indigo">${d.category}</span></td><td>${d.size}</td><td>${esc(assigneeName(d.by))}</td><td>${fmt(d.date)}</td>
     <td style="text-align:right">${d.data?`<a class="btn sm" href="${d.data}" target="_blank" download="${esc(d.name)}">Open</a> `:''}<button class="btn sm danger" onclick="delDoc('${d.id}')">Delete</button></td></tr>`).join("")}
   </tbody></table>${D.length?'':emptyState("▤","No documents yet.")}</div>`;
}
function viewResearch(){if(!proj())return noProject();const canAdd=["Owner","Admin","Manager","Member"].includes(myRole());
  const R=inProj(state.research);
  return `<div class="page-h"><div><h1>Research</h1><p>Sources &amp; notes for ${esc(proj().name)}.</p></div>
     <div class="actions">${canAdd?`<button class="btn primary" onclick="openResearchModal()">+ Add entry</button>`:''}</div></div>
   <div class="grid c2">${R.map(r=>`<div class="card"><div class="bd">
     <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="badge indigo">${r.category}</span>
       <span style="margin-left:auto;font-size:11.5px;color:var(--muted)">${fmt(r.date)}</span></div>
     <div style="font-weight:700;font-size:15px;margin-bottom:6px">${esc(r.title)}</div>
     <div style="color:var(--muted);font-size:13px;line-height:1.55">${esc(r.note||"")}</div>
     ${r.url?`<a class="btn sm" style="margin-top:12px" href="${esc(r.url)}" target="_blank">Open source ↗</a>`:''}</div></div>`).join("")||emptyState("⌕","No research entries yet.")}</div>`;
}
function viewActivity(){if(!proj())return noProject();
  return `<div class="page-h"><div><h1>Activity</h1><p>Audit trail for ${esc(proj().name)}.</p></div></div>
   <div class="card"><div class="bd">${activityList(inProj(state.activity))}</div></div>`}
function activityList(items){if(!items.length)return emptyState("≣","No activity yet.");
  return `<div class="tlist">${items.map(a=>`<div class="titem">
    <div class="avatar" style="background:${avatarColor(a.user)}">${a.user==='system'?'◆':initials(assigneeName(a.user))}</div>
    <div style="flex:1"><div class="tt" style="font-weight:500">${esc(a.user==='system'?'System':assigneeName(a.user))} — ${esc(a.action)}</div>
      <div class="meta">${fmt(a.time)}</div></div></div>`).join("")}</div>`}

function viewMembers(){
  if(!proj())return noProject();if(!isProjAdmin())return emptyState("🔒","Only the project Owner/Admin can manage members.");
  const M=state.members.filter(m=>m.projectId===active());
  return `<div class="page-h"><div><h1>Members &amp; Roles</h1><p>Who's on ${esc(proj().name)} and what they can do.</p></div>
     <div class="actions"><button class="btn primary" onclick="openMemberModal()">+ Add member</button></div></div>
   <div class="card"><table class="tbl"><thead><tr><th>Member</th><th>Role</th><th>Access</th><th></th></tr></thead>
   <tbody>${M.map(m=>{const u=state.users.find(x=>x.username===m.username)||{name:m.username};
     return `<tr data-srch="${esc(u.name)} ${esc(m.username)} ${m.role}">
       <td><div class="userc"><div class="avatar" style="background:${avatarColor(u.name)}">${initials(u.name)}</div>
         <div><div class="nm">${esc(u.name)}</div><div class="un">@${esc(m.username)}</div></div></div></td>
       <td><select onchange="changeRole('${m.id}',this.value)" style="width:auto;padding:6px 8px;font-size:12px">
         ${Object.keys(ROLES).map(r=>`<option ${r===m.role?'selected':''}>${r}</option>`).join("")}</select></td>
       <td><span style="font-size:12px;color:var(--muted)">${m.access.length} sections</span></td>
       <td style="text-align:right">${m.username!==state.sessionUser?`<button class="btn sm danger" onclick="removeMember('${m.id}')">Remove</button>`:'<span style="color:var(--faint);font-size:12px">you</span>'}</td></tr>`}).join("")}
   </tbody></table></div>
   <div class="foot">${Store.mode==='cloud'?'Cloud mode — real members via Supabase.':'Prototype — data lives in this browser. Connect Supabase for real cross-device login.'}</div>`;
}
function viewProjects(){
  if(!isPlatformAdmin())return emptyState("🔒","Platform admin only.");
  return `<div class="page-h"><div><h1>All Projects</h1><p>Create and manage every project + accounts.</p></div>
     <div class="actions"><button class="btn primary" onclick="openProjectModal()">+ New project</button></div></div>
   <div class="grid c3" style="margin-bottom:18px">${state.projects.map(p=>{const mc=state.members.filter(m=>m.projectId===p.id).length;const tc=state.tasks.filter(t=>t.projectId===p.id).length;
     return `<div class="stat" data-srch="${esc(p.name)} ${esc(p.key)}" style="border-left:3px solid ${p.color}">
       <div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="background:${p.color}">${esc(p.key||initials(p.name))}</div>
         <div><div style="font-weight:700">${esc(p.name)}</div><div class="l">${mc} members · ${tc} tasks</div></div></div>
       <div style="margin-top:12px;display:flex;gap:8px">${p.id===active()?'<span class="badge green">active</span>':`<button class="btn sm" onclick="switchProject('${p.id}')">Open</button>`}
         ${p.id!=='shiva'?`<button class="btn sm danger" onclick="delProject('${p.id}')">Delete</button>`:''}</div></div>`}).join("")}</div>
   <div class="card"><div class="hd"><h3>People (accounts)</h3><div class="actions"><button class="btn sm" onclick="openAccountModal()">+ New account</button></div></div>
     <table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Projects</th><th>Platform</th></tr></thead>
     <tbody>${state.users.map(u=>{const pc=state.members.filter(m=>m.username===u.username).length;
       return `<tr data-srch="${esc(u.name)} ${esc(u.username)}"><td><div class="userc"><div class="avatar" style="background:${avatarColor(u.name)}">${initials(u.name)}</div><span class="nm">${esc(u.name)}</span></div></td>
         <td>@${esc(u.username)}</td><td>${pc}</td><td>${u.platformAdmin?'<span class="badge indigo">admin</span>':'<span style="color:var(--faint)">—</span>'}</td></tr>`}).join("")}
     </tbody></table></div>`;
}
function viewProfile(){const u=me();
  return `<div class="page-h"><div><h1>My Profile</h1><p>Your account, across all projects.</p></div></div>
   <div class="grid c2">
     <div class="card"><div class="hd"><h3>Account</h3></div><div class="bd">
       <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
         <div class="avatar" style="width:56px;height:56px;font-size:20px;background:${avatarColor(u.name)}">${initials(u.name)}</div>
         <div><div style="font-weight:700;font-size:17px">${esc(u.name)}</div><div style="color:var(--muted)">@${esc(u.username)}${u.platformAdmin?' · Platform admin':''}</div></div></div>
       <label class="field"><span>Display name</span><input id="pf-name" value="${esc(u.name)}"></label>
       <button class="btn primary" onclick="saveProfile()">Save changes</button></div></div>
     <div class="card"><div class="hd"><h3>Change password</h3></div><div class="bd">
       <label class="field"><span>Current password</span><input id="pf-cur" type="password" placeholder="••••••••"></label>
       <label class="field"><span>New password</span><input id="pf-new" type="password" placeholder="At least 6 characters"></label>
       <div id="pf-msg" style="font-size:12.5px;margin-bottom:10px;min-height:16px"></div>
       <button class="btn primary" onclick="changePassword()">Update password</button></div></div>
   </div>
   <div class="card" style="margin-top:16px"><div class="hd"><h3>My projects &amp; roles</h3></div>
     <table class="tbl"><thead><tr><th>Project</th><th>Role</th><th></th></tr></thead><tbody>
     ${state.members.filter(m=>m.username===u.username).map(m=>{const p=state.projects.find(x=>x.id===m.projectId)||{name:m.projectId};
       return `<tr><td><div class="userc"><div class="avatar" style="background:${p.color||'#64748b'}">${esc(p.key||initials(p.name))}</div><span class="nm">${esc(p.name)}</span></div></td>
         <td><span class="badge indigo">${m.role}</span></td><td style="text-align:right">${m.projectId===active()?'<span class="badge green">active</span>':`<button class="btn sm" onclick="switchProject('${m.projectId}')">Open</button>`}</td></tr>`}).join("")||`<tr><td colspan="3">${emptyState("⊞","Not a member of any project yet.")}</td></tr>`}
     </tbody></table></div>`;
}

/* ============ ACTIONS ============ */
async function toggleTask(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;const ns=t.status==="Done"?"To do":"Done";
  await Store.updateTask(id,{status:ns});await Store.addActivity((ns==="Done"?"Completed":"Reopened")+" task: "+t.title);reload()}
async function setTaskStatus(id,s){const t=state.tasks.find(x=>x.id===id);if(!t)return;await Store.updateTask(id,{status:s});await Store.addActivity("Set '"+t.title+"' → "+s);reload()}
function openTaskModal(){const opts=state.members.filter(m=>m.projectId===active()).map(m=>{const u=state.users.find(x=>x.username===m.username)||{name:m.username};return `<option value="${m.username}">${esc(u.name)}</option>`}).join("");
  modal("New task",`<label class="field"><span>Title</span><input id="t-title" placeholder="e.g. Build login screen"></label>
    <label class="field"><span>Description</span><input id="t-desc" placeholder="Short detail"></label>
    <div class="row"><label class="field"><span>Assign to</span><select id="t-assignee">${opts}</select></label>
      <label class="field"><span>Due date</span><input id="t-due" type="date" value="${date(1)}"></label></div>
    <div class="row"><label class="field"><span>Priority</span><select id="t-pri"><option>Critical</option><option selected>High</option><option>Medium</option><option>Low</option></select></label>
      <label class="field"><span>Phase</span><select id="t-phase"><option value="P0" selected>Phase 1</option><option value="P1">Phase 2</option><option value="P2">Phase 3</option><option value="P3">Phase 4</option></select></label></div>`,
    "Create task",async()=>{const title=val("t-title");if(!title)return alert("Title required");
      await Store.createTask({title,desc:val("t-desc"),assignee:val("t-assignee"),due:val("t-due"),priority:val("t-pri"),phase:val("t-phase")});
      await Store.addActivity("Created task: "+title);closeModal();reload()})}
function openResearchModal(){modal("Add research entry",`<label class="field"><span>Title</span><input id="r-title"></label>
    <label class="field"><span>URL (optional)</span><input id="r-url" placeholder="https://…"></label>
    <label class="field"><span>Category</span><select id="r-cat"><option>Reference</option><option>Paper</option><option>Disclosure</option><option>Competitor</option><option>Note</option></select></label>
    <label class="field"><span>Note</span><textarea id="r-note" rows="3"></textarea></label>`,
    "Add entry",async()=>{const title=val("r-title");if(!title)return alert("Title required");
      await Store.createResearch({title,url:val("r-url"),category:val("r-cat"),note:val("r-note")});await Store.addActivity("Added research: "+title);closeModal();reload()})}

/* projects + accounts + members */
function openProjectModal(){const colors=PCOLORS.map((c,i)=>`<label style="display:inline-flex;align-items:center;gap:5px;margin-right:8px"><input type="radio" name="pc" value="${c}" ${i===0?'checked':''} style="width:auto"><span style="width:16px;height:16px;border-radius:4px;background:${c};display:inline-block"></span></label>`).join("");
  modal("New project",`<label class="field"><span>Project name</span><input id="p-name" placeholder="e.g. My App"></label>
    <label class="field"><span>Short key (2-4 letters)</span><input id="p-key" placeholder="APP" maxlength="4"></label>
    <label class="field"><span>Description</span><input id="p-desc" placeholder="One line"></label>
    <div class="field"><span>Colour</span><div>${colors}</div></div>`,
    "Create project",async()=>{const name=val("p-name");if(!name)return alert("Name required");
      const key=(val("p-key")||name.slice(0,3)).toUpperCase();const color=(document.querySelector('input[name=pc]:checked')||{}).value||PCOLORS[0];
      const p=await Store.createProject({name,key,color,desc:val("p-desc")});await Store.setActive(p.id);await Store.addActivity("Created project: "+name,p.id);closeModal();route="dashboard";reload()})}
async function delProject(id){const p=state.projects.find(x=>x.id===id);if(!p||!confirm("Delete project '"+p.name+"' and all its tasks/docs? This cannot be undone."))return;
  await Store.deleteProject(id);await reload()}
function genUsername(name){let base=(name.trim().split(/\s+/)[0]||"user").toLowerCase().replace(/[^a-z]/g,"")||"user";let u=base,n=1;while(state.users.some(x=>x.username===u)){u=base+n;n++}return u}
function genPassword(){const U="ABCDEFGHJKLMNPQRSTUVWXYZ",l="abcdefghijkmnpqrstuvwxyz",d="23456789",s="!@#$%&*";
  const pk=z=>z[Math.floor(Math.random()*z.length)];let p=[pk(U),pk(U),pk(l),pk(l),pk(l),pk(d),pk(d),pk(d),pk(s),pk(s)];
  for(let i=p.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[p[i],p[j]]=[p[j],p[i]]}return p.join("")}
function openAccountModal(){modal("New account",`<label class="field"><span>Full name</span><input id="a-name" placeholder="e.g. Asha Patel"></label>
    <p style="font-size:12px;color:var(--muted);margin:0">Creates a login. Add them to projects from <b>Members &amp; Roles</b>.</p>`,
    "Create account",async()=>{const name=val("a-name");if(!name)return alert("Name required");
      const username=genUsername(name),password=genPassword();
      try{await Store.createAccount({name,username,password});}catch(e){return alert("Could not create: "+(e.message||e))}
      await Store.addActivity("Created account for "+name);closeModal();showCreds(name,username,password)})}
function openMemberModal(){
  const existing=state.users.filter(u=>!state.members.some(m=>m.projectId===active()&&m.username===u.username));
  const checks=SECTIONS.map(s=>`<label><input type="checkbox" class="acc" value="${s.id}" checked> ${s.label}</label>`).join("");
  modal("Add member",`<label class="field"><span>Person</span><select id="m-user" onchange="memUserChange(this.value)">
      <option value="__new">➕ Create new account…</option>${existing.map(u=>`<option value="${u.username}">${esc(u.name)} (@${u.username})</option>`).join("")}</select></label>
    <label class="field" id="m-newname"><span>New person's full name</span><input id="m-name" placeholder="e.g. Asha Patel"></label>
    <label class="field"><span>Role in ${esc((proj()||{}).name||'project')}</span><select id="m-role" onchange="applyRoleAccess(this.value)">
      ${Object.keys(ROLES).filter(r=>r!=="Owner").map(r=>`<option ${r==='Member'?'selected':''}>${r}</option>`).join("")}</select></label>
    <div class="field"><span>Section access</span><div class="checks">${checks}</div></div>`,
    "Add to project",async()=>{const sel=val("m-user");const access=[...document.querySelectorAll(".acc:checked")].map(c=>c.value);const role=val("m-role");
      if(sel==="__new"){const name=val("m-name");if(!name)return alert("Name required");const username=genUsername(name),password=genPassword();
        try{await Store.createAccount({name,username,password});}catch(e){return alert("Could not create: "+(e.message||e))}
        await Store.addMember({username,projectId:active(),role,access});await Store.addActivity("Added "+name+" to project");closeModal();showCreds(name,username,password);}
      else{await Store.addMember({username:sel,projectId:active(),role,access});await Store.addActivity("Added @"+sel+" to project");closeModal();reload();}});
  setTimeout(()=>{applyRoleAccess("Member");memUserChange(document.getElementById("m-user").value)},0)}
function memUserChange(v){const el=document.getElementById("m-newname");if(el)el.style.display=v==="__new"?"block":"none"}
function applyRoleAccess(role){const def=ROLES[role];const set=def.all?ALLSEC:def.access;document.querySelectorAll(".acc").forEach(c=>c.checked=set.includes(c.value))}
async function changeRole(id,role){const m=state.members.find(x=>x.id===id);if(!m)return;await Store.updateMember(id,{role,access:(ROLES[role].all?ALLSEC:ROLES[role].access).slice()});
  await Store.addActivity("Set @"+m.username+" → "+role);reload()}
async function removeMember(id){const m=state.members.find(x=>x.id===id);if(!m||!confirm("Remove @"+m.username+" from this project?"))return;
  await Store.removeMember(id);await Store.addActivity("Removed @"+m.username+" from project");reload()}
function showCreds(name,username,password){modal("Account ready ✓",`<p style="margin:0 0 4px;color:var(--muted)">Share with <b style="color:var(--ink)">${esc(name)}</b>. Shown once — copy it now.</p>
    <div class="cred"><div><span>Username</span><b>${esc(username)}</b></div><div><span>Password</span><b>${esc(password)}</b></div></div>
    <button class="btn" style="margin-top:12px" onclick="navigator.clipboard&&navigator.clipboard.writeText('Shiva Portal\\nUser: ${username}\\nPass: ${password}');this.textContent='Copied ✓'">Copy credentials</button>`,
    "Done",async()=>{closeModal();await reload()},true)}

async function uploadDoc(input){const f=input.files[0];if(!f)return;const size=(f.size/1024).toFixed(0)+" KB";
  const cat=f.type.includes("pdf")?"PDF":f.type.includes("image")?"Image":"File";
  if(Store.mode==="cloud"){await Store.createDoc({name:f.name,category:cat,size,file:f});await Store.addActivity("Uploaded: "+f.name);return reload()}
  const finish=async data=>{await Store.createDoc({name:f.name,category:cat,size,data,by:state.sessionUser});await Store.addActivity("Uploaded: "+f.name);reload()};
  if(f.size<=1500000){const r=new FileReader();r.onload=()=>finish(r.result);r.readAsDataURL(f)}else{alert("File over 1.5 MB — stored as reference only.");finish(null)}}
async function delDoc(id){if(!confirm("Delete this document?"))return;await Store.deleteDoc(id);await Store.addActivity("Deleted a document");reload()}
async function saveProfile(){const n=val("pf-name").trim();if(!n)return;await Store.updateSelf({name:n});await Store.addActivity("Updated profile");reload()}
async function changePassword(){const u=me();const cur=val("pf-cur"),nw=val("pf-new");const msg=document.getElementById("pf-msg");
  if(Store.mode==="local"&&cur!==u.password){msg.style.color="var(--red)";msg.textContent="Current password is incorrect.";return}
  if(nw.length<6){msg.style.color="var(--red)";msg.textContent="New password must be at least 6 characters.";return}
  try{await Store.updateSelf({password:nw});}catch(e){msg.style.color="var(--red)";msg.textContent="Could not update: "+(e.message||e);return}
  await Store.addActivity("Changed password");msg.style.color="var(--green)";msg.textContent="Password updated ✓";document.getElementById("pf-cur").value="";document.getElementById("pf-new").value=""}
async function reseedConfirm(){if(Store.mode!=="local")return alert("Reset is only available in local mode.");
  if(confirm("Reset ALL local portal data (projects, users, tasks)? This cannot be undone.")){await Store.resetAll();await refresh();showApp()}}

/* modal util */
function modal(title,body,okLabel,onOk,hideCancel){const bg=document.createElement("div");bg.className="modal-bg";bg.id="modal";
  bg.innerHTML=`<div class="modal"><div class="mh"><h3>${title}</h3><span class="x" onclick="closeModal()">✕</span></div>
    <div class="mb">${body}</div><div class="mf">${hideCancel?'':'<button class="btn" onclick="closeModal()">Cancel</button>'}<button class="btn primary" id="modal-ok">${okLabel}</button></div></div>`;
  document.body.appendChild(bg);document.getElementById("modal-ok").onclick=onOk;bg.addEventListener("mousedown",e=>{if(e.target===bg)closeModal()})}
function closeModal(){const m=document.getElementById("modal");if(m)m.remove()}

window.addEventListener("keydown",e=>{if(e.key==="Enter"){const lg=document.getElementById("login");if(lg&&!lg.classList.contains("hidden"))doLogin()}});
boot();
