/* ============================================================
   Shiva Portal — data layer (MULTI-PROJECT)
   One identity per user; role + access are per PROJECT (membership).
   LocalStore (prototype) + SupabaseStore (real), same async API.
   ============================================================ */
const SECTIONS=[
  {id:"dashboard",label:"Dashboard",ic:"▦"},
  {id:"project",label:"Project Roadmap",ic:"◎"},
  {id:"canvas",label:"Project Map",ic:"⬡"},
  {id:"tasks",label:"Tasks",ic:"✓"},
  {id:"documents",label:"Documents",ic:"▤"},
  {id:"research",label:"Research",ic:"⌕"},
  {id:"activity",label:"Activity",ic:"≣"},
  {id:"members",label:"Members & Roles",ic:"⚙"},
  {id:"profile",label:"My Profile",ic:"◍"},
];
const ALLSEC=SECTIONS.map(s=>s.id);
const ROLES={
  Owner:{all:true},
  Admin:{access:["dashboard","project","canvas","tasks","documents","research","activity","members","profile"]},
  Manager:{access:["dashboard","project","canvas","tasks","documents","research","activity","profile"]},
  Member:{access:["dashboard","project","canvas","tasks","documents","research","profile"]},
  Viewer:{access:["dashboard","project","canvas","documents","research","profile"]},
};
const PCOLORS=["#6d5efc","#22d3ee","#34d399","#f59e0b","#ec4899","#a855f7","#0ea5e9","#ef4444"];
function _uid(){return Math.random().toString(36).slice(2,10)}
function _date(off){const d=new Date();d.setDate(d.getDate()+(off||0));return d.toISOString().slice(0,10)}

/* ---------------- LOCAL ---------------- */
const LocalStore={
  mode:"local", KEY:"shiva_portal_v5", db:null,
  _load(){try{this.db=JSON.parse(localStorage.getItem(this.KEY))}catch(e){this.db=null}if(!this.db)this._seed();return this.db},
  _save(){localStorage.setItem(this.KEY,JSON.stringify(this.db))},
  _seed(){const now=Date.now();
    this.db={firstRun:true,session:null,active:"shiva",
      users:[{id:_uid(),name:"Kuldeep",username:"kuldeep",password:"Shiva@2026",status:"Active",platformAdmin:true,created:now}],
      projects:[{id:"shiva",name:"Shiva",key:"SHV",color:"#6d5efc",desc:"MCP / agent-tool security",created:now}],
      members:[{id:_uid(),username:"kuldeep",projectId:"shiva",role:"Owner",access:ALLSEC.slice(),created:now}],
      tasks:[
        ["Day 1 · Install the MCP SDK","pip install + Claude Desktop as the client",1,"High"],
        ["Day 2 · Run benign_server.py","mcp dev — learn the tool call flow",2,"High"],
        ["Day 3 · Reproduce tool poisoning (attack #1)","The key demo — screen-record it",3,"Critical"],
        ["Day 4 · Write up attack #1 + push","docs/attacks/01-tool-poisoning.md",4,"High"],
        ["Day 5 · Read sources + run attacks #2 & #3","drift + escalation; log in evidence.md",5,"Medium"],
        ["Day 6 · Sketch the scanner's 3 checks","hidden instructions · perms · hashing",6,"Medium"],
        ["Day 7 · Decision gate 0","In for Phase 1? Log in improvements.md",7,"Medium"],
      ].map(t=>({id:_uid(),projectId:"shiva",title:t[0],desc:t[1],assignee:"kuldeep",due:_date(t[2]),priority:t[3],status:"To do",phase:"P0",created:now})),
      docs:[],
      research:[{id:_uid(),projectId:"shiva",title:"Simon Willison — MCP prompt injection",url:"https://simonwillison.net/tags/model-context-protocol/",category:"Reference",note:"Core read on why MCP has injection problems.",by:"kuldeep",date:now}],
      activity:[{id:_uid(),projectId:"shiva",user:"system",action:"Project created",time:now}]};
    this._save()},
  async init(){this._load()},
  firstRun(){return !!this.db.firstRun},
  async login(u,p){const f=this.db.users.find(x=>x.username===u&&x.password===p);
    if(!f)return{error:"Invalid username or password."};if(f.status!=="Active")return{error:"This account is deactivated."};
    this.db.session=u;this.db.firstRun=false;
    // pick an active project the user belongs to
    const mine=this.db.members.filter(m=>m.username===u).map(m=>m.projectId);
    if(mine.length&&!mine.includes(this.db.active))this.db.active=mine[0];
    this._save();return{user:f}},
  async logout(){this.db.session=null;this._save()},
  sessionUser(){return this.db.session},
  activeProject(){return this.db.active},
  async setActive(id){this.db.active=id;this._save()},
  async fetchAll(){return{users:this.db.users,projects:this.db.projects,members:this.db.members,
    tasks:this.db.tasks,docs:this.db.docs,research:this.db.research,activity:this.db.activity}},
  async addActivity(action,projectId){this.db.activity.unshift({id:_uid(),projectId:projectId||this.db.active,user:this.db.session||"system",action,time:Date.now()});
    this.db.activity=this.db.activity.slice(0,300);this._save()},
  // projects
  async createProject(o){const p={id:_uid(),created:Date.now(),...o};this.db.projects.push(p);
    this.db.members.push({id:_uid(),username:this.db.session,projectId:p.id,role:"Owner",access:ALLSEC.slice(),created:Date.now()});this._save();return p},
  async updateProject(id,patch){const p=this.db.projects.find(x=>x.id===id);if(p)Object.assign(p,patch);this._save()},
  async deleteProject(id){this.db.projects=this.db.projects.filter(p=>p.id!==id);this.db.members=this.db.members.filter(m=>m.projectId!==id);
    this.db.tasks=this.db.tasks.filter(t=>t.projectId!==id);this.db.docs=this.db.docs.filter(d=>d.projectId!==id);
    this.db.research=this.db.research.filter(r=>r.projectId!==id);if(this.db.active===id)this.db.active=(this.db.projects[0]||{}).id||null;this._save()},
  // accounts + membership
  async createAccount(o){const u={id:_uid(),created:Date.now(),status:"Active",platformAdmin:false,...o};this.db.users.push(u);this._save();return u},
  async addMember(o){const m={id:_uid(),created:Date.now(),...o};this.db.members.push(m);this._save();return m},
  async updateMember(id,patch){const m=this.db.members.find(x=>x.id===id);if(m)Object.assign(m,patch);this._save()},
  async removeMember(id){this.db.members=this.db.members.filter(m=>m.id!==id);this._save()},
  async updateSelf(patch){const u=this.db.users.find(x=>x.username===this.db.session);if(u)Object.assign(u,patch);this._save();return u},
  // tasks/docs/research
  async createTask(o){const t={id:_uid(),created:Date.now(),status:"To do",projectId:this.db.active,...o};this.db.tasks.push(t);this._save();return t},
  async updateTask(id,patch){const t=this.db.tasks.find(x=>x.id===id);if(t)Object.assign(t,patch);this._save()},
  async deleteTask(id){this.db.tasks=this.db.tasks.filter(x=>x.id!==id);this._save()},
  async createDoc(o){const d={id:_uid(),date:Date.now(),projectId:this.db.active,...o};this.db.docs.unshift(d);this._save();return d},
  async deleteDoc(id){this.db.docs=this.db.docs.filter(x=>x.id!==id);this._save()},
  async createResearch(o){const r={id:_uid(),date:Date.now(),projectId:this.db.active,...o};this.db.research.unshift(r);this._save();return r},
  async resetAll(){localStorage.removeItem(this.KEY);this._seed()},
};

/* ---------------- SUPABASE ---------------- */
function SupabaseStore(url,key){
  const sb=window.supabase.createClient(url,key);
  const EMAIL=u=>`${u}@shiva.local`;let _session=null,_profile=null,_active=null;
  const rU=p=>({id:p.id,name:p.name,username:p.username,status:p.status,platformAdmin:p.platform_admin,created:Date.parse(p.created_at)});
  return {
    mode:"cloud", sb,
    async init(){const {data}=await sb.auth.getSession();_session=data.session;
      if(_session){const {data:p}=await sb.from("profiles").select("*").eq("id",_session.user.id).single();_profile=p;
        const {data:m}=await sb.from("members").select("project_id").eq("username",p.username).limit(1);_active=m&&m[0]?m[0].project_id:null;}},
    firstRun(){return false},
    async login(u,p){const {data,error}=await sb.auth.signInWithPassword({email:EMAIL(u),password:p});
      if(error)return{error:"Invalid username or password."};
      const {data:prof}=await sb.from("profiles").select("*").eq("id",data.user.id).single();
      if(prof&&prof.status!=="Active"){await sb.auth.signOut();return{error:"This account is deactivated."}}
      _profile=prof;_session=data.session;
      const {data:m}=await sb.from("members").select("project_id").eq("username",prof.username).limit(1);_active=m&&m[0]?m[0].project_id:null;
      return{user:rU(prof)}},
    async logout(){await sb.auth.signOut();_session=null;_profile=null},
    sessionUser(){return _profile?_profile.username:null},
    activeProject(){return _active},
    async setActive(id){_active=id},
    async fetchAll(){const [u,pr,m,t,d,r,a]=await Promise.all([
        sb.from("profiles").select("*"),sb.from("projects").select("*").order("created_at"),
        sb.from("members").select("*"),sb.from("tasks").select("*").order("due"),
        sb.from("documents").select("*").order("created_at",{ascending:false}),
        sb.from("research").select("*").order("created_at",{ascending:false}),
        sb.from("activity").select("*").order("created_at",{ascending:false}).limit(300)]);
      return{users:(u.data||[]).map(rU),
        projects:(pr.data||[]).map(x=>({id:x.id,name:x.name,key:x.key,color:x.color,desc:x.descr,created:Date.parse(x.created_at)})),
        members:(m.data||[]).map(x=>({id:x.id,username:x.username,projectId:x.project_id,role:x.role,access:x.access||[]})),
        tasks:(t.data||[]).map(x=>({id:x.id,projectId:x.project_id,title:x.title,desc:x.descr,assignee:x.assignee,due:x.due,priority:x.priority,status:x.status,phase:x.phase||"P0"})),
        docs:(d.data||[]).map(x=>({id:x.id,projectId:x.project_id,name:x.name,category:x.category,size:x.size,data:x.url,by:x.uploaded_by,date:Date.parse(x.created_at)})),
        research:(r.data||[]).map(x=>({id:x.id,projectId:x.project_id,title:x.title,url:x.url,category:x.category,note:x.note,by:x.created_by,date:Date.parse(x.created_at)})),
        activity:(a.data||[]).map(x=>({id:x.id,projectId:x.project_id,user:x.actor,action:x.action,time:Date.parse(x.created_at)}))};},
    async addActivity(action,projectId){await sb.from("activity").insert({actor:this.sessionUser()||"system",action,project_id:projectId||_active})},
    async createProject(o){const id=o.key.toLowerCase().replace(/[^a-z0-9]/g,"")||_uid();
      await sb.from("projects").insert({id,name:o.name,key:o.key,color:o.color,descr:o.desc});
      await sb.from("members").insert({username:this.sessionUser(),project_id:id,role:"Owner",access:ALLSEC});return{id,...o}},
    async updateProject(id,patch){const p={};if(patch.name)p.name=patch.name;if(patch.desc)p.descr=patch.desc;await sb.from("projects").update(p).eq("id",id)},
    async deleteProject(id){await sb.from("projects").delete().eq("id",id)},
    async createAccount(o){const {data,error}=await sb.functions.invoke("admin-create-user",{body:{name:o.name,username:o.username,password:o.password}});
      if(error)throw error;return o},
    async addMember(o){await sb.from("members").insert({username:o.username,project_id:o.projectId,role:o.role,access:o.access})},
    async updateMember(id,patch){await sb.from("members").update(patch).eq("id",id)},
    async removeMember(id){await sb.from("members").delete().eq("id",id)},
    async updateSelf(patch){if(patch.name)await sb.from("profiles").update({name:patch.name}).eq("id",_session.user.id);
      if(patch.password)await sb.auth.updateUser({password:patch.password});if(patch.name&&_profile)_profile.name=patch.name;return _profile},
    async createTask(o){await sb.from("tasks").insert({title:o.title,descr:o.desc,assignee:o.assignee,due:o.due,priority:o.priority,status:"To do",phase:o.phase||"P0",project_id:_active})},
    async updateTask(id,patch){const p={};["status","priority","due"].forEach(k=>{if(patch[k]!=null)p[k]=patch[k]});await sb.from("tasks").update(p).eq("id",id)},
    async deleteTask(id){await sb.from("tasks").delete().eq("id",id)},
    async createDoc(o){let url=o.data;if(o.file){const path=`${_active}/${Date.now()}_${o.file.name}`;const up=await sb.storage.from("documents").upload(path,o.file);
        if(!up.error)url=sb.storage.from("documents").getPublicUrl(path).data.publicUrl;}
      await sb.from("documents").insert({name:o.name,category:o.category,size:o.size,url,uploaded_by:this.sessionUser(),project_id:_active})},
    async deleteDoc(id){await sb.from("documents").delete().eq("id",id)},
    async createResearch(o){await sb.from("research").insert({title:o.title,url:o.url,category:o.category,note:o.note,created_by:this.sessionUser(),project_id:_active})},
    async resetAll(){alert("Reset is only available in local mode.")},
  };
}

/* ---------------- pick backend ---------------- */
let Store;
(function(){const c=window.SHIVA_CONFIG||{};
  if(c.SUPABASE_URL&&c.SUPABASE_ANON_KEY&&window.supabase){try{Store=SupabaseStore(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);}catch(e){console.error(e);Store=LocalStore;}}
  else Store=LocalStore;window.Store=Store;})();
