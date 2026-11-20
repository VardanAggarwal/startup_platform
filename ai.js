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
