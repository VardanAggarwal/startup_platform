// Shared code for the AI in Business pages (ai-founder.html, ai-admin.html).
// Own surface: no GTM. Reuses the same backend, roster and shim.js as the GTM app.
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function setStatus(el,msg,cls){if(el){el.textContent=msg;el.className="status"+(cls?" "+cls:"");}}

// Field renderer, copied from the GTM app so inputs/selects look identical.
const NUMR={int:'min="0" step="1" inputmode="numeric"',pct:'min="0" max="100" step="any" inputmode="decimal"',money:'min="0" step="any" inputmode="decimal"',pos:'min="1" step="1" inputmode="numeric"'};
const ymd=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const dateRange=r=>{const t=new Date(),e=new Date();e.setDate(e.getDate()+7);return r==="start"?`min="${ymd(t)}" max="${ymd(e)}"`:`min="${ymd(t)}"`;};
function fx(c,v,attr){
  const isNum=c[2]==="num",isDate=c[2]==="date",r=c[4]||(isNum?"int":"");
  const hint=!isNum&&!isDate&&typeof c[4]==="string"?`<span class="hint">${esc(c[4])}</span>`:"";
  let ctl;
  if(c[2]==="sel")ctl=`<select ${attr}="${c[0]}"><option value="">Choose</option>${c[4].map(o=>`<option${v===o?" selected":""}>${esc(o)}</option>`).join("")}</select>`;
  else if(isNum)ctl=`<input type="number" data-rule="${r}" ${NUMR[r]||NUMR.int} enterkeyhint="next" ${attr}="${c[0]}" value="${esc(v)}">`;
  else if(isDate)ctl=`<input type="date" data-rule="${r}" ${dateRange(r)} ${attr}="${c[0]}" value="${/^\d{4}-\d{2}-\d{2}$/.test(v)?esc(v):""}">`;
  else if(c[2]==="in")ctl=`<input type="text" maxlength="200" autocomplete="off" ${attr}="${c[0]}" value="${esc(v)}">`;
  else ctl=`<textarea maxlength="1500" ${attr}="${c[0]}" style="min-height:64px">${esc(v)}</textarea>`;
  return `<label class="f"${c[3]?` data-path="${c[3]}"`:""}>${esc(c[1])}${hint}${ctl}<span class="verr" role="alert" hidden></span></label>`;
}

// The seven themes. A founder's #1 theme decides their group; #2 is the fallback.
const AI_THEMES=["GTM, sales & partnerships","Marketing & brand","Finance & unit economics","Tech, AI & product","Operations","Hiring, team & founder leadership","Customer success"];

// Worksheet A (solo). Saved to cards/{founderId}.ai. Eligible for grouping = ai_t1 AND ai_t2 set.
const CARD_AI=[
  ["ai_tools","Which AI tools do I use today? (e.g. Claude Code, Codex, ChatGPT, Cursor)","in"],
  ["ai_comfort","How comfortable am I with AI? 1 = barely used it, 3 = use it weekly for a few tasks, 5 = build workflows/agents with it","sel",null,["1","2","3","4","5"]],
  ["ai_t1","My #1 priority theme (decides my group)","sel",null,AI_THEMES],
  ["ai_t2","My #2 priority theme (backup if #1 is too small)","sel",null,AI_THEMES]
];

// Worksheet B (Phase 3). Per founder, private, saved to plans/ai__{founderId}.
// Each founder fills their own; the group decides among themselves who pitches.
const RATE15=["1","2","3","4","5"];
const AIB=[
  {h:"1 · One problem or process in my business",f:[
    ["ai_ps","The problem or process that eats my time or money","ta"],
    ["ai_who","Who feels it most (me, my team, customers…)","in"],
    ["ai_cost","Roughly what it costs me now (hrs/week or ₹)","in"]
  ]},
  {h:"2 · Two ways AI could help",f:[
    ["ai_s1","Option A — how AI could help","ta"],
    ["ai_s1_imp","Option A — impact (1 low … 5 high)","sel",null,RATE15],
    ["ai_s1_eff","Option A — effort (1 easy … 5 hard)","sel",null,RATE15],
    ["ai_s2","Option B — how AI could help","ta"],
    ["ai_s2_imp","Option B — impact (1 low … 5 high)","sel",null,RATE15],
    ["ai_s2_eff","Option B — effort (1 easy … 5 hard)","sel",null,RATE15]
  ]},
  {h:"3 · The one I'll try",f:[
    ["ai_pick","The one I'll try","sel",null,["Option A","Option B"]],
    ["ai_step","My first step","ta"],
    ["ai_delta","What changes in 30 days if it works","ta"]
  ]}
];
const BKEYS=AIB.reduce((a,s)=>a.concat(s.f.map(c=>c[0])),[]);
// impact ÷ effort, higher is a better bet. Returns "" when either side is missing.
const aiBet=(imp,eff)=>{const i=+imp,e=+eff;return i&&e?(i/e).toFixed(2):"";};
// Which option the founder is going with (explicit pick, else the better bet, else A).
function aiPickText(vb){
  if(vb.ai_pick==="Option A")return vb.ai_s1||"";
  if(vb.ai_pick==="Option B")return vb.ai_s2||"";
  const a=aiBet(vb.ai_s1_imp,vb.ai_s1_eff),b=aiBet(vb.ai_s2_imp,vb.ai_s2_eff);
  if(a&&b)return(+a>=+b)?(vb.ai_s1||""):(vb.ai_s2||"");
  return vb.ai_s1||vb.ai_s2||"";
}
// Build the whole ~1-minute pitch from the founder's own B answers, as spoken
// sentences in three short paragraphs (problem, AI move, plan). No filler.
// Skips empty fields; returns "" if there is nothing to say yet.
function buildAiPitch(vb){
  vb=vb||{};
  const t=s=>String(s||"").trim().replace(/\s+/g," ").replace(/[.!\s]+$/,"");
  // lower-case the first letter when it sits mid-sentence, but keep acronyms/"I" (AI, GTM, CRM, I…)
  const lc=s=>/^[A-Z][a-z]/.test(s)?s[0].toLowerCase()+s.slice(1):s;
  const ps=t(vb.ai_ps),who=t(vb.ai_who).replace(/^it hits /i,""),cost=t(vb.ai_cost).replace(/^(it )?costs?( me| us)?( about)? /i,"");
  const pick=t(aiPickText(vb)),step=t(vb.ai_step),delta=t(vb.ai_delta).replace(/^in 30 days,? /i,"");
  const P=[];

  // 1. The problem
  let p1="";
  if(ps)p1="The problem I keep running into is "+lc(ps)+".";
  if(who&&cost)p1+=(p1?" ":"")+"It hits "+who+" hardest, and right now it costs about "+cost+".";
  else if(who)p1+=(p1?" ":"")+"It hits "+who+" hardest.";
  else if(cost)p1+=(p1?" ":"")+"Right now it costs about "+cost+".";
  if(p1)P.push(p1);

  // 2. The AI move
  if(pick){
    const both=t(vb.ai_s1)&&t(vb.ai_s2);
    P.push((P.length?"So here's":"Here's")+" my AI move: "+pick+"."
      +(both?" I weighed two ideas and went with this one because it gives the most impact for the effort.":""));
  }

  // 3. The plan
  let p3="";
  if(step)p3="My first step is simple: "+lc(step)+".";
  if(delta)p3+=(p3?" ":"")+"If it works, in 30 days "+lc(delta)+".";
  if(p3)P.push(p3);

  return P.join("\n\n");
}

// --- Grouping (Phase 2) -----------------------------------------------------
// Deterministic: same answers in -> same groups out. Tie-break by founder id.
const AI_MAX=5; // hard cap per group
// Split one theme's people into balanced chunks of <= AI_MAX (no chunk of 1).
function aiSplit(arr){
  const n=arr.length;
  if(n<=AI_MAX)return[arr.slice()];
  const k=Math.ceil(n/AI_MAX),base=Math.floor(n/k),extra=n%k,out=[];
  let i=0;for(let c=0;c<k;c++){const size=base+(c<extra?1:0);out.push(arr.slice(i,i+size));i+=size;}
  return out;
}
// people: [{id,name,t1,t2}]. Returns [{n,theme,members:[{id,name}]}].
function buildAiGroups(people){
  const ppl=people.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const buckets=new Map();AI_THEMES.forEach(t=>buckets.set(t,[]));
  ppl.forEach(p=>{if(!buckets.has(p.t1))buckets.set(p.t1,[]);buckets.get(p.t1).push(p);});
  // Singletons overflow to their #2 theme if that bucket has company.
  buckets.forEach(arr=>{if(arr.length===1){const p=arr[0],dest=buckets.get(p.t2);if(dest&&dest!==arr&&dest.length>=1){dest.push(p);arr.length=0;}}});
  // Whatever is still alone becomes a floating leftover.
  const leftovers=[];
  buckets.forEach(arr=>{if(arr.length===1){leftovers.push(arr[0]);arr.length=0;}});
  // Emit theme groups (split oversized), following AI_THEMES order then extras.
  const groups=[],themeOrder=AI_THEMES.concat([...buckets.keys()].filter(t=>AI_THEMES.indexOf(t)<0));
  themeOrder.forEach(theme=>{const arr=buckets.get(theme);if(arr&&arr.length)aiSplit(arr).forEach(ch=>groups.push({theme,members:ch}));});
  // Seat leftovers in any group with room, else start a mixed group.
  leftovers.sort((a,b)=>a.id<b.id?-1:1).forEach(p=>{
    const g=groups.find(g=>g.members.length<AI_MAX);
    if(g)g.members.push(p);else groups.push({theme:"Mixed themes",members:[p]});});
  // No group of 1: merge any solo into another group (prefer one with room).
  for(let guard=0;guard<ppl.length+2;guard++){
    const i=groups.findIndex(g=>g.members.length===1);if(i<0)break;
    let host=groups.find((g,j)=>j!==i&&g.members.length<AI_MAX)
      ||groups.filter((g,j)=>j!==i).sort((a,b)=>a.members.length-b.members.length)[0];
    if(!host)break;host.members.push(groups[i].members[0]);groups.splice(i,1);}
  return groups.map((g,i)=>({n:i+1,theme:g.theme,members:g.members.map(m=>({id:m.id,name:m.name}))}));
}
