const paths = {
  leaf:'<path d="M19 4C7 2 3 10 7 16c7 4 14-1 12-12Z"/><path d="m5 21 11-13"/>',
  desk:'<path d="M3 12h18M5 12v8m14-8v8M8 12V5h8v7M10 9h4"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  chart:'<path d="M4 4v16h17M8 15l4-5 4 2 5-7"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  sliders:'<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  flask:'<path d="M9 3h6m-5 0v7L4 20h16l-6-10V3M7 15h10"/><path d="M10 17h.01M14 18h.01"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  posture:'<circle cx="12" cy="4.5" r="2"/><path d="m5 10 7-2 7 2M12 8v7m0 0-4 6m4-6 4 6"/>',
  distance:'<path d="M3 5v14m18-14v14M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  sound:'<path d="M5 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  temperature:'<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z"/><path d="M12 8v10"/><circle cx="12" cy="18" r="1"/>',
  droplet:'<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  camera:'<path d="M8 5 6 8H3v12h18V8h-3l-2-3H8Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  lamp:'<path d="m8 3 8 0 5 8H3l5-8ZM12 11v10m-5 0h10"/>',
  fan:'<circle cx="12" cy="12" r="2"/><path d="M11 10C5 2 15 0 15 5c0 2-1 4-2 5m1 2c9-3 10 7 5 6-2 0-4-2-5-4m-3 0c-2 9-11 5-8 1 1-2 4-2 7-2"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  coffee:'<path d="M4 9h12v10H4V9Zm12 1h2a3 3 0 1 1 0 6h-2M2 22h16M7 3v2m5-2v2"/>',
  eye:'<path d="M2 12S6 5 12 5s10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  wifi:'<path d="M2 7a16 16 0 0 1 20 0M5 11a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 5h.01"/>',
  'wifi-off':'<path d="m3 3 18 18M8.5 4.5A16 16 0 0 1 22 7M2 7a16 16 0 0 1 3-2m0 6a11 11 0 0 1 6-2m5 1a11 11 0 0 1 3 1m-11 4a6 6 0 0 1 8 0m-4 5h.01"/>',
  user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  warning:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM21 2v4m-2-2h4"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
};
const icon = (name, cls='') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${paths[name] || paths.info}</svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const number = (v, digits=0) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(digits);
const clamp = (v,min=0,max=100) => Math.max(min,Math.min(max,Number(v)||0));
const duration = seconds => { const n=Math.max(0,Math.floor(seconds||0)); return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; };
const shortDuration = seconds => {const n=Math.max(0,Math.floor(seconds||0));return n>=3600?`${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`:`${Math.floor(n/60)}m ${n%60}s`;};
const time = v => v ? new Date(v).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';
const date = v => v ? new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
const nice = v => String(v??'Unknown').toLowerCase().replaceAll('_',' ').replace(/^\w/, c=>c.toUpperCase());
const goodPosture = v => ({GOOD:'Upright',SLOUCH:'Slouching',LEAN_FORWARD:'Leaning in',LEAN_LEFT_RIGHT:'Side lean',NO_PERSON:'Away',UNKNOWN:'Unavailable'}[v] || 'Unavailable');
const pages = {
  overview:['YOUR SPACE. YOUR PACE.','A good space for good work.','A little awareness goes a long way. Here’s how your desk is doing.','Overview'],
  sessions:['SMALL HABITS. LASTING CHANGE.','Every session tells a story.','Look back at your time, your conditions, and the habits you’re building.','Session history'],
  analytics:['THE BIGGER PICTURE','Make room for better habits.','Explore the patterns in your environment and your study sessions.','Analytics'],
  devices:['CONNECTED, THOUGHTFULLY','Meet your desk’s little helpers.','Two sensor nodes, one local gateway, and a connected view of your space.','Devices & network'],
  settings:['MAKE IT YOUR OWN','A desk that works your way.','Tune the rules, reminders, and privacy choices for your study space.','Rules & settings'],
};
const scenarios = [
  ['normal','In balance','Upright, quiet & comfortable','check'],['slouch','A little slouch','Sustained posture warning','posture'],
  ['too_close','Leaning too close','Distance + vision fusion','distance'],['dark','Lights down','Watch the desk lamp adapt','moon'],
  ['noisy','A noisy room','Relative sound level rises','sound'],['hot','Feeling the heat','Automatic fan control','temperature'],
  ['away','Step away','Occupancy pauses the session','coffee'],['camera_offline','Camera disconnected','Other sensors keep working','camera'],
  ['occluded','An uncertain pose','Low-confidence vision case','eye'],['network_offline','Sensor network offline','Stale readings become unknown','wifi-off'],
];
let state=null, history=[], sessions=[], events=[], metrics={}, currentPage='overview', chartMetric='score', historyMinutes=60, busy=false, settingsRendered=false, lastHistory=0, lastSecondary=0, toastTimer;
const content=$('#page-content');

function hydrate(root=document){ $$('[data-icon]',root).forEach(el=>{el.innerHTML=icon(el.dataset.icon);el.removeAttribute('data-icon');}); }
hydrate();
$('#today').textContent=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
$('#scenario-list').innerHTML=scenarios.map(([id,title,desc,ico])=>`<button class="scenario-button" data-scenario="${id}"><span>${icon(ico)}</span><strong>${title}</strong><small>${desc}</small></button>`).join('');

async function api(path, options={}){
  const response=await fetch(`/api${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
  if(!response.ok){let error;try{error=await response.json();}catch{error={detail:`Request failed (${response.status})`};}throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail||error));}
  return response.status===204?null:response.json();
}
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
function toast(message,error=false){const box=$('#toast');clearTimeout(toastTimer);box.textContent=message;box.classList.toggle('error',error);box.hidden=false;toastTimer=setTimeout(()=>box.hidden=true,5000);}
function listValue(v){return Array.isArray(v)?v:(v?.items||v?.data||v?.history||v?.sessions||v?.events||[]);}
function pill(text,cls=''){return `<span class="pill ${cls}">${esc(text)}</span>`;}
function scoreStatus(n){return n==null?'Not enough data':n>=80?'In a good place':n>=60?'Room to improve':'A little attention needed';}
function stat(label,value,caption,ico='chart'){return `<div class="card stat-card"><div class="stat-label">${icon(ico)}${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-caption">${esc(caption)}</div></div>`;}
function placeholder(title,description){return `<div class="empty-state"><h2>${esc(title)}</h2><p>${esc(description)}</p></div>`;}
function numericComponents(){return state?.score?.components||{};}
function ruleStatus(){
 const rules=(state?.rules||[]).filter(r=>r.active||r.cooldown_remaining_seconds>0);
 if(!rules.length)return '<div class="rule-status-heading">A little patience, by design</div><p>FocusGuard waits for a sustained condition before reminding you. A single uncertain frame won’t trigger a warning.</p>';
 return `<div class="rule-status-heading">What your desk is noticing</div>${rules.map(r=>`<div class="rule-status-row"><span>${esc(nice(r.id))}</span><strong>${r.cooldown_remaining_seconds>0?`${Math.ceil(r.cooldown_remaining_seconds)}s cooldown`:`${number(r.elapsed_seconds,1)}s / ${number(r.threshold_seconds)}s`}</strong></div>`).join('')}`;
}
function historyForMode(){return history.filter(p=>p.mode===state?.mode);}
function renderedEvents(){return (events.length?events:state?.events||[]).filter(ev=>ev.mode===state?.mode);}
function renderEvents(limit=4, all=false){
 const rows=renderedEvents().slice(0,limit);
 if(!rows.length)return `<div class="empty-state" style="padding:35px 10px"><p>All quiet here.<br>Desk activity and reminders will appear here.</p></div>`;
 return `<div class="${all?'event-log':'event-list'}">${rows.map(ev=>{const type=ev.event_type||ev.type||'',isWarn=/WARNING|REMINDER|OFFLINE/.test(type), severity=ev.severity||'info';const ico=type.includes('POSTURE')?'posture':(type.includes('CLOSE')||type.includes('DISTANCE'))?'distance':type.includes('BREAK')?'coffee':type.includes('LAMP')?'lamp':type.includes('SESSION')?'clock':type.includes('NOISE')?'sound':isWarn?'warning':'check';return `<div class="event-row"><div class="event-icon ${esc(severity)}">${icon(ico)}</div><div class="event-copy"><strong>${esc(nice(type))}</strong><p>${esc(ev.message||nice(type))}</p></div><span class="event-time">${time(ev.timestamp)}</span></div>`;}).join('')}</div>`;
}

function deskArt(){
 const s=state.sensors, absent=!s.person_detected||!s.vision_available;
 const poseClass=s.posture==='SLOUCH'?'slouch-art':s.posture==='LEAN_FORWARD'?'lean-art':s.posture==='LEAN_LEFT_RIGHT'?'side-art':'';
 return `<svg class="desk-art ${absent?'offline-art':''} ${poseClass} ${s.confidence<.6?'uncertain-art':''}" viewBox="0 0 280 185" role="img" aria-label="Illustrative posture diagram, ${esc(goodPosture(s.posture))}. Not a camera feed.">
 <ellipse class="desk-shadow" cx="139" cy="164" rx="105" ry="10"/>
 <path class="pose-guideline" d="M132 30v120M80 95h104"/>
 ${state.actuators.lamp_percent>0?'<path class="lamp-light" d="m218 72-32 46h67l-26-46Z"/>':''}
 <path class="desk-solid" d="m49 113 113-16 79 17-114 20-78-21Z"/>
 <path d="M57 117v43m172-43v43m-100-25v35" stroke="#b7c0aa" stroke-width="4"/>
 <path class="device-fill" d="M169 58h44v39h-44z"/><path class="screen-fill" d="M173 62h36v30h-36z"/>
 <path d="M191 97v10m-8 1h17" stroke="#a0b18c" stroke-width="2"/>
 <path class="device-fill" d="m158 113 29-4 13 4-29 5-13-5Z"/>
 <path d="m226 110-3-24 14-15-12-14M217 72l19-5 6 8-22 5-3-8Z" stroke="#95a67e"/>
 <path d="M91 124v31m30-22v24M81 160h48" stroke="#b2bfa0" stroke-width="3"/>
 <path class="device-fill" d="M81 116q19-9 47 2l-3 13q-28-7-43-3Z"/>
 <g class="upper-body"><circle class="person-dot" cx="121" cy="55" r="12"/><path class="person-line" d="m120 69-5 24 8 19m-6-39 22 17 16 3m-36-13-21 12 1 20"/><circle class="person-dot" cx="118" cy="76" r="3"/><circle class="person-dot" cx="137" cy="89" r="3"/><circle class="person-dot" cx="116" cy="94" r="3"/></g>
 <path class="person-line" d="m121 110 12 17 12 23m-25-34-16 17-2 24"/><circle class="person-dot" cx="132" cy="128" r="3"/><circle class="person-dot" cx="104" cy="133" r="3"/>
 <path d="m174 129 3 2m7-3 3 1m7-3 3 1" stroke="#c6ceba"/>
 </svg>`;
}

function overview(){
 const s=state.sensors,a=state.actuators,se=state.session,c=state.score,active=se?.state==='ACTIVE',onBreak=se?.state==='BREAK',breakInterval=state.settings.break_interval_minutes*60*(state.settings.adaptive_reminders&&c.total!=null&&c.total<60 ? .8 : 1),sitting=se?.continuous_sitting_seconds??se?.sitting_seconds??0,remaining=Math.max(0,se?.break_due_in_seconds??(breakInterval-sitting));
 const score=c.total, valid=s.vision_available&&s.person_detected&&s.confidence>=state.settings.confidence_min;
 const sensor=(name,ico,value,unit,status,warn=false,cls='')=>`<div class="card sensor-card"><div class="sensor-head">${icon(ico)}${name}</div><div class="sensor-value ${cls}">${esc(value)}${unit?`<span class="unit">${esc(unit)}</span>`:''}</div><div class="sensor-status ${warn?'warning-text':''} ${value==='—'?'muted-text':''}"><span class="tiny-dot"></span>${esc(status)}</div></div>`;
 return `<div class="section-heading" style="margin-top:0"><h2>Your desk, at a glance</h2><span class="live-label"><span class="tiny-dot"></span>${state.mode==='demo'?'LIVE SIMULATION':'LIVE MONITORING'}</span></div>
 <div class="overview-grid">
  <section class="card score-card"><div class="card-label"><span>Study Condition Score</span><span class="info-icon" title="A configurable engineering score of posture, distance, lighting, noise and comfort. It does not measure mental focus.">${icon('info')}</span></div><div class="score-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="ring-track" cx="100" cy="100" r="78" fill="none" stroke-dasharray="390 490" transform="rotate(127 100 100)"/><circle class="ring-value" cx="100" cy="100" r="78" fill="none" stroke-dasharray="${clamp(score)/100*390} 490" transform="rotate(127 100 100)"/></svg><div class="score-number">${number(score)}<small>OUT OF 100</small></div></div><div class="score-status">${icon(score>=80?'check':'info')}${scoreStatus(score)}</div><p class="score-note">${score>=80?'Your desk conditions are looking good.':'Small adjustments can make a difference.'}</p><div class="score-footer"><span>${icon('shield')}Conditions, not concentration</span><span>${number(c.coverage_percent??100)}% coverage</span></div></section>
  <section class="card desk-card"><div class="card-label"><span>Your study space</span>${pill(state.occupancy==='USER_PRESENT'?'Desk occupied':state.occupancy==='TEMPORARILY_AWAY'?'Temporarily away':'Desk empty',state.occupancy==='USER_PRESENT'?'':'off')}</div><div class="desk-illustration">${deskArt()}<span class="scene-badge distance">${icon('distance')}${number(s.distance_cm)} cm</span><span class="scene-badge posture">${icon(valid?'check':'info')}${esc(goodPosture(s.posture))}</span></div><div class="desk-foot"><span>${icon('shield')}Illustrative pose · not a camera feed</span><span class="vision-fps">${s.vision_available?`${number(s.fps,1)} FPS`:'Vision offline'}</span></div></section>
  <section class="card session-card"><div class="card-label"><span>${icon('clock')}Current session</span>${pill(onBreak?'On a break':active?'In progress':se?'Paused':'Ready',active?'':onBreak?'warn':'off')}</div><div class="session-clock">${duration(se?.elapsed_seconds)}</div><div class="session-subtitle">${se?`Started at ${time(se.started_at)} · ${state.mode==='demo'?'Demo session':'Study session'}`:'Sessions start when your desk is occupied'}</div><div class="break-info"><span>${onBreak?'Enjoy your break':'Next movement break'}</span><strong>${onBreak?shortDuration(se.break_remaining_seconds):se?`${Math.ceil(remaining/60)} min`:'—'}</strong></div><div class="progress-bar"><span style="width:${clamp(sitting/breakInterval*100)}%"></span></div><div class="session-buttons">${!se?`<button class="button" data-control="start">${icon('play')}Start session</button>`:onBreak?`<button class="button" data-control="finish_break">${icon('play')}Back to desk</button>`:`<button class="button secondary" data-control="${active?'pause':'resume'}">${icon(active?'pause':'play')}${active?'Pause':'Resume'}</button>${active?`<button class="button" data-control="break">${icon('coffee')}Take a break</button>`:''}`}</div><div class="session-bottom"><span>${se?`${se.breaks||0} breaks taken`:'Your time, at your pace'}</span>${se?'<button class="button ghost" data-control="end" style="font-size:8px;min-height:0;padding:0">End session ↗</button>':''}</div></section>
 </div>
 <div class="section-heading"><h2>The little things that matter</h2><span class="subtle-text">Updated every second</span></div>
 <div class="sensors-grid">
 ${sensor('Posture','posture',goodPosture(s.posture),'',valid?`${number(s.confidence*100)}% confidence`:s.vision_available?'Low confidence':'Vision offline',valid&&s.posture!=='GOOD','posture-value')}
 ${sensor('Viewing distance','distance',number(s.distance_cm),'cm',s.distance_cm==null?'Sensor unavailable':s.distance_cm<state.settings.distance_min_cm?'A little too close':'Comfortable distance',s.distance_cm!=null&&s.distance_cm<state.settings.distance_min_cm)}
 ${sensor('Ambient light','sun',number(s.lux),'lux',s.lux==null?'Sensor unavailable':s.lux<250?'Lamp lends a hand':'Well lit',false)}
 ${sensor('Noise level','sound',s.noise_level==null?'—':number(s.noise_level*100),'%',s.noise_level==null?'Sensor unavailable':`${nice(s.noise_state)} · relative level`,s.noise_level>=state.settings.noise_threshold)}
 ${sensor('Temperature','temperature',number(s.temperature_c,1),'°C',s.temperature_c==null?'Sensor unavailable':s.temperature_c>=state.settings.temperature_fan_c?'Getting a little warm':'Comfortable',s.temperature_c>=state.settings.temperature_fan_c)}
 ${sensor('Humidity','droplet',number(s.humidity_percent),'%',s.humidity_percent==null?'Sensor unavailable':s.humidity_percent<30?'A little dry':s.humidity_percent>70?'A little humid':'In a comfortable range',s.humidity_percent!=null&&(s.humidity_percent<30||s.humidity_percent>70))}
 </div>
 <div class="actuator-strip"><span class="actuator-strip-label">${icon('bolt')}${state.mode==='demo'?'Your desk is adapting':'Requested desk controls'}</span><span class="actuator-item">${icon('lamp')}Lamp <strong>${number(a.lamp_percent)}%</strong>${pill(a.lamp_mode==='auto'?'Auto':'Manual')}</span><span class="actuator-item">${icon('fan')}Fan <strong>${a.fan?'On':'Off'}</strong>${pill(a.fan_mode==='auto'?'Auto':'Manual')}</span><span class="actuator-item ${a.buzzer?'buzzer-pulse':''}">${icon('bell')}Reminders <strong>${a.buzzer?'Beeping':state.settings.buzzer_enabled?'Enabled':'Muted'}</strong></span><a class="card-link" href="#settings">Adjust controls ${icon('arrow-right')}</a></div>
 <div class="lower-grid"><section class="card chart-card"><div class="card-heading"><div><h2>A little perspective</h2><p>Your conditions over the last hour</p></div><div class="chart-controls"><select id="chart-metric" class="select" aria-label="History metric">${[['score','Study score'],['distance_cm','Distance'],['lux','Light'],['noise_level','Noise'],['temperature_c','Temperature'],['humidity_percent','Humidity']].map(([v,l])=>`<option value="${v}" ${chartMetric===v?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="chart-wrap">${chart(historyForMode(),chartMetric)}</div><div class="chart-legend"><span><i></i>${esc(metricLabel(chartMetric))}</span><span class="chart-explanation">${state.mode==='demo'?'Simulated readings · stored locally':'Sensor readings · stored locally'}</span><a class="card-link" style="margin-left:auto" href="#analytics">Explore ${icon('arrow-right')}</a></div></section>
 <section class="card events-card"><div class="card-heading"><h2>Around your desk</h2><button class="button ghost" data-action="events" style="font-size:9px;min-height:0">View all ${icon('arrow-right')}</button></div>${renderEvents()}</section></div>`;
}

function metricLabel(metric){return {score:'Study Condition Score',distance_cm:'Viewing distance (cm)',lux:'Ambient light (lux)',noise_level:'Relative noise level',temperature_c:'Temperature (°C)',humidity_percent:'Humidity (%)'}[metric]||metric;}
function chart(points,metric,height=166){
 const valid=points.filter(p=>p[metric]!=null&&Number.isFinite(Number(p[metric])));
 if(valid.length<2)return '<div class="chart-empty">Your story is just starting.<br>Live readings will build this chart in a few seconds.</div>';
 let min=0,max=metric==='score'||metric==='humidity_percent'?100:metric==='noise_level'?1:Math.ceil(Math.max(...valid.map(p=>Number(p[metric])))*1.15/10)*10||10;
 const W=600,H=height,L=33,R=7,T=12,B=25,first=new Date(points[0].timestamp).getTime(),last=new Date(points.at(-1).timestamp).getTime();
 const runs=[],maxGap=Math.max(3000,(state?.settings?.sensor_stale_seconds||15)*1000);let current=[];
 // Missing readings and stopped sampling remain gaps, even after downsampling.
 for(const point of points){
  const usable=point[metric]!=null&&Number.isFinite(Number(point[metric]));
  const separated=current.length&&new Date(point.timestamp)-new Date(current.at(-1).timestamp)>maxGap;
  if(!usable||separated){if(current.length)runs.push(current);current=[];}
  if(usable)current.push(point);
 }
 if(current.length)runs.push(current);
 const stride=Math.max(1,Math.ceil(valid.length/150));
 const marks=runs.map(run=>{
  const reduced=run.filter((_,i)=>i===0||i%stride===0||i===run.length-1);
  const pts=reduced.map(p=>[L+(new Date(p.timestamp).getTime()-first)/(last-first||1)*(W-L-R),T+(1-(Number(p[metric])-min)/(max-min))*(H-T-B)]);
  if(pts.length===1)return `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="2" class="chart-line"/>`;
  const poly=pts.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ');
  return `<polygon points="${pts[0][0].toFixed(1)},${H-B} ${poly} ${pts.at(-1)[0].toFixed(1)},${H-B}" class="chart-area"/><polyline points="${poly}" class="chart-line"/>`;
 }).join('');
 return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(metricLabel(metric))} history, ${valid.length} stored samples; missing readings are gaps">${[0,.25,.5,.75,1].map(f=>{const y=T+f*(H-T-B);return `<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" class="chart-grid-line"/><text x="${L-8}" y="${y+3}" text-anchor="end" class="chart-text">${number(max-f*(max-min),max<=1?1:0)}</text>`;}).join('')}${marks}${[0,.25,.5,.75,1].map(f=>`<text x="${L+f*(W-L-R)}" y="${H-5}" text-anchor="${f===0?'start':f===1?'end':'middle'}" class="chart-text">${time(first+f*(last-first))}</text>`).join('')}</svg>`;
}

function sessionsPage(){
 const rows=sessions.filter(s=>s.mode===state.mode), total=rows.reduce((a,s)=>a+(s.elapsed_seconds??s.duration_seconds??0),0), observedAverage=key=>{const values=rows.map(s=>s[key]).filter(v=>v!=null&&Number.isFinite(Number(v)));return values.length?values.reduce((sum,v)=>sum+Number(v),0)/values.length:null;}, good=observedAverage('good_posture_percent'), avg=observedAverage('average_score');
 return `<div class="stats-grid">${stat('Sessions',rows.length,'In this workspace','clock')}${stat('Time at your desk',shortDuration(total),'Across completed and saved sessions','coffee')}${stat('Upright posture',good!=null?`${number(good)}%`:'—','Average across sessions','posture')}${stat('Average conditions',avg!=null?`${number(avg)}/100`:'—','A project-defined environment score','leaf')}</div><section class="card table-card"><div class="filter-row"><h2>Your session journal</h2><span class="pill">${state.mode==='demo'?'Demo data':'Hardware data'}</span></div>${rows.length?`<table><thead><tr><th>SESSION</th><th>TIME AT DESK</th><th>CONDITIONS</th><th>UPRIGHT</th><th>BREAKS</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><strong>${date(s.started_at)}</strong><small style="margin-top:5px;font-size:9px">${time(s.started_at)} – ${s.ended_at?time(s.ended_at):nice(s.state)}</small></td><td>${shortDuration(s.elapsed_seconds||s.duration_seconds)}</td><td>${pill(`${number(s.average_score)} / 100`,s.average_score!=null&&s.average_score<60?'warn':'')}</td><td>${number(s.good_posture_percent)}%</td><td>${number(s.breaks||0)}</td><td><button class="table-link" data-session="${esc(s.id)}">View session ↗</button></td></tr>`).join('')}</tbody></table>`:placeholder('Your first chapter is ahead.','End a session from the overview to save its conditions, events, and summary here.')}<p class="table-note">${state.mode==='demo'?'These are sessions from the simulator. They are kept separate from hardware sessions.':'Sessions use derived sensor metadata. Camera frames and audio are never saved.'}</p></section><div class="inline-note" style="margin-top:20px"><span>${icon('sparkles')}</span><p>Open a session for a local summary. You can enable AWS Bedrock in privacy settings to generate an AI interpretation from aggregate statistics only.</p></div>`;
}

function analyticsPage(){
 const pts=historyForMode(),warns=renderedEvents().filter(e=>/WARNING|REMINDER/.test(e.event_type)),average=key=>{const vs=pts.filter(p=>p[key]!=null);return vs.length?vs.reduce((a,p)=>a+p[key],0)/vs.length:null;};
 const colors={GOOD:'#a9c88d',SLOUCH:'#ddba7d',LEAN_FORWARD:'#d39e79',LEAN_LEFT_RIGHT:'#c6b59b',NO_PERSON:'#e5e9df',UNKNOWN:'#e5e9df'};
 const components=numericComponents();
 const hourly=Array.from({length:24},(_,hour)=>warns.filter(e=>new Date(e.timestamp).getHours()===hour).length),max=Math.max(1,...hourly);
 const measuredFPS=metrics.fps??metrics.vision_fps??state.sensors.fps;
 return `<div class="stats-grid">${stat('Average conditions',average('score')==null?'—':`${number(average('score'))}/100`,'Within the selected window','leaf')}${stat('Distance',`${number(average('distance_cm'))} cm`,'Average measured distance','distance')}${stat('Reminders & warnings',warns.length,'Recorded events in this workspace','bell')}${stat('Stored readings',pts.length,`${historyMinutes<60?historyMinutes+' minutes':historyMinutes/60+' hour'+(historyMinutes>60?'s':'')} of history selected`,'database')}</div><div class="filter-row"><h2>Your environment over time</h2><div class="segmented" aria-label="History window">${[15,60,360,1440].map(m=>`<button data-range="${m}" class="${historyMinutes===m?'active':''}">${m===15?'15 min':m===60?'1 hour':m===360?'6 hours':'24 hours'}</button>`).join('')}</div></div><div class="analytics-grid">
 ${[['score','Study conditions'],['distance_cm','Viewing distance'],['lux','Ambient lighting'],['noise_level','Relative noise'],['temperature_c','Temperature'],['humidity_percent','Humidity']].map(([key,title])=>`<section class="card chart-card"><div class="card-heading"><div><h2>${title}</h2><p>${metricLabel(key)}</p></div>${pill(state.mode==='demo'?'Simulated':'Measured')}</div><div class="chart-wrap">${chart(pts,key)}</div></section>`).join('')}
 <section class="card card-pad wide"><div class="card-heading"><div><h2>A posture timeline</h2><p>How your posture changed across stored samples</p></div></div>${pts.length?`<div class="timeline-track" role="img" aria-label="Posture timeline">${pts.map(p=>`<span style="flex:1;background:${colors[p.posture]||colors.UNKNOWN}" title="${esc(time(p.timestamp)+' · '+goodPosture(p.posture))}"></span>`).join('')}</div><div class="timeline-labels"><span>${time(pts[0].timestamp)}</span><span>${time(pts.at(-1).timestamp)}</span></div>`:'<p class="subtle-text" style="margin:25px 0">Live samples will build your posture timeline.</p>'}<div class="chart-legend">${[['GOOD','Upright'],['SLOUCH','Slouch'],['LEAN_FORWARD','Forward lean'],['LEAN_LEFT_RIGHT','Side lean'],['NO_PERSON','Away / unknown']].map(([k,l])=>`<span><i style="background:${colors[k]}"></i>${l}</span>`).join('')}</div></section>
 <section class="card card-pad"><div class="card-heading"><div><h2>When reminders happen</h2><p>Warning count by local hour · recorded events</p></div></div><div class="heatmap">${hourly.map((v,h)=>`<div class="heat-cell" data-level="${v===0?0:Math.max(1,Math.ceil(v/max*3))}" title="${String(h).padStart(2,'0')}:00 · ${v} warnings">${v||'·'}</div>`).join('')}</div><div class="heat-hours"><span>00:00</span><span>11:00</span></div><div class="heat-hours"><span>12:00</span><span>23:00</span></div></section>
 <section class="card card-pad"><h2>What goes into your score</h2><p class="subtle-text" style="margin-top:7px">Current suitability, weighted by your rules</p><div class="component-bars">${Object.entries(components).map(([key,value])=>`<div class="component-bar"><span>${esc(nice(key))}</span><div><span style="width:${clamp(value)}%"></span></div><b>${number(value)}</b></div>`).join('')}</div><p class="subtle-text">Unknown inputs reduce coverage; this is an engineering score, not a measure of concentration.</p></section>
 <section class="card card-pad wide"><div class="card-heading"><div><h2>Measure what matters</h2><p>Evaluation tools are included with your prototype</p></div>${pill(state.mode==='demo'?'Demo · not a benchmark':'Live diagnostics')}</div><div class="evaluation-grid"><div class="evaluation-item"><span>Vision throughput</span><strong>${number(measuredFPS,1)} <span style="display:inline">FPS</span></strong><small>${state.mode==='demo'?'Simulated value; run Pi vision for a measurement.':'Reported by the gateway; measure on your target Pi.'}</small></div><div class="evaluation-item"><span>Posture accuracy / F1</span><strong>Awaiting trials</strong><small>Collect labeled posture samples and run evaluation/evaluate.py.</small></div><div class="evaluation-item"><span>Distance MAE & response latency</span><strong>Awaiting trials</strong><small>Compare reference distances and physical actuator timestamps.</small></div></div><div class="inline-note"><span>${icon('info')}</span><p>Use the included evaluation protocol for good posture, slouching, low light, occlusion, and multiple-person cases. No accuracy or physical latency result is assumed from simulated data.</p></div></section></div>`;
}

function healthLabel(v){if(v===true)return 'Connected';if(v===false)return 'Offline';if(typeof v==='object'&&v)return nice(v.status||v.connected||'Unknown');return nice(v||'Not configured');}
function devicesPage(){
 const health=state.health||{}, sensors=state.sensors;
 const deviceDefs=[['nodeA','User interaction node','ESP32 · ToF + seat pressure','distance','focusguard/nodeA/user',`${number(sensors.distance_cm)} cm`,sensors.seat_occupied==null?'Seat state unknown':(sensors.seat_occupied?'Seat occupied':'Seat unoccupied')+' · '+number(sensors.seat_pressure)+' ADC'],['nodeB','Environment node','ESP32 · motion + relative sound','sound','focusguard/nodeB/environment',sensors.noise_state?nice(sensors.noise_state):'Unavailable',sensors.motion==null?'Motion state unknown':sensors.motion?'Motion detected':'No motion'],['gateway_environment','Environment gateway','Raspberry Pi · BME280 + BH1750','sun','focusguard/gateway/environment',`${number(sensors.lux)} lux`,`${number(sensors.temperature_c,1)} °C · ${number(sensors.humidity_percent)}% RH · ${number(sensors.pressure_hpa)} hPa`],['vision','Local vision pipeline','Raspberry Pi · OpenCV + MediaPipe','camera','focusguard/gateway/vision',goodPosture(sensors.posture),`${number(sensors.confidence==null?null:sensors.confidence*100)}% confidence · ${number(sensors.fps,1)} FPS`]];
 return `<div class="mode-control"><div><strong>Data source</strong><p>${state.mode==='demo'?'The simulator feeds the same decision engine used by hardware.':'Waiting for your local MQTT sensor nodes. No demo values are substituted.'}</p></div><select class="select" id="data-mode" aria-label="Data source"><option value="demo" ${state.mode==='demo'?'selected':''}>Demo workspace</option><option value="hardware" ${state.mode==='hardware'?'selected':''}>Real hardware</option></select></div><div class="service-strip">${[['mqtt','MQTT broker','wifi'],['influxdb','InfluxDB','database'],['ai','AWS Bedrock','sparkles']].map(([key,label,ico])=>`<div class="service-chip">${icon(ico)}<strong>${label}</strong>${esc(healthLabel(health[key]))}</div>`).join('')}<div class="service-chip">${icon('database')}<strong>Local journal</strong>SQLite</div></div><div class="device-grid">${deviceDefs.map(([id,title,subtitle,ico,topic,v1,v2])=>{const dev=(state.devices||[]).find(d=>d.id===id||d.topic===topic);const connected=dev?(state.mode==='demo'?(dev.status==='online'?'Simulated':'Simulated · offline'):nice(dev.status)):'Awaiting data';return `<section class="card device-card"><div class="device-title"><div class="device-icon">${icon(ico)}</div><div><h3>${title}</h3><p>${subtitle}</p></div>${pill(connected,/offline/i.test(connected)||connected==='Awaiting data'?'off':'')}</div><div class="device-details"><div>Latest reading<strong>${esc(v1)}</strong></div><div>Derived state<strong>${esc(v2)}</strong></div><div>Last received<strong>${dev?.last_seen?time(dev.last_seen):state.mode==='demo'?'Live simulation':'No packets yet'}</strong></div><div>Transport<strong>${state.mode==='demo'?'Internal simulator':'MQTT · local network'}</strong></div></div><code class="topic-code">${topic}</code></section>`;}).join('')}</div><div class="section-heading"><h2>One small, connected ecosystem</h2><span class="subtle-text">Edge first. Cloud optional.</span></div><section class="card card-pad"><div class="network-flow"><div class="network-box">ESP32 nodes<small>Sensor metadata</small></div>${icon('arrow-right')}<div class="network-box">Local gateway<small>Vision + rules + actuators</small></div>${icon('arrow-right')}<div class="network-box">MQTT + FastAPI<small>Local messaging</small></div>${icon('arrow-right')}<div class="network-box">InfluxDB + Grafana<small>Time-series analytics</small></div></div><div class="inline-note"><span>${icon('shield')}</span><p>Video is processed on the Raspberry Pi. MQTT carries numeric or categorical metadata. Actuators listen on <code>focusguard/actuator</code>, and configuration uses <code>focusguard/config</code>. Cloud AI receives session statistics only when you opt in.</p></div></section>`;
}

const field=(key,label,unit,min,max,step=1)=>`<label class="field">${esc(label)}${unit?` (${esc(unit)})`:''}<input type="number" name="${key}" value="${state.settings[key]}" min="${min}" max="${max}" step="${step}" required></label>`;
const toggle=(key,title,description)=>`<div class="toggle-row"><div><strong>${title}</strong><p>${description}</p></div><label class="toggle"><input type="checkbox" name="${key}" ${state.settings[key]?'checked':''} aria-label="${title}"><span></span></label></div>`;
function settingsPage(){
 const s=state.settings,a=state.actuators, weights=s.weights,colors=['#779b59','#a4bf84','#c2d4a6','#d7b780','#9cad85'];
 return `<form id="settings-form"><div class="settings-layout"><div class="settings-stack"><section class="card settings-card"><h2>Your ergonomic boundaries</h2><p>Starting points for your prototype. Calibrate for the person and camera position at your desk.</p><div class="form-grid">${field('distance_min_cm','Minimum viewing distance','cm',10,150)}${field('distance_max_cm','Maximum viewing distance','cm',20,250)}${field('posture_warning_seconds','Sustained posture warning','sec',1,600)}${field('distance_warning_seconds','Distance warning delay','sec',1,300)}${field('confidence_min','Minimum pose confidence','0–1',.1,1,.05)}${field('warning_cooldown_seconds','Reminder cooldown','sec',1,3600)}</div></section><section class="card settings-card"><h2>Make time to step away</h2><p>Reminders that fit your rhythm. A full movement break resets continuous sitting time.</p><div class="form-grid">${field('break_interval_minutes','Movement break every','min',.1,180,.1)}${field('eye_break_interval_minutes','Look-away reminder every','min',.1,120,.01)}${field('break_duration_seconds','Movement break duration','sec',5,1800)}${field('occupancy_pause_seconds','Pause when away after','sec',1,300)}${field('occupancy_end_minutes','End inactive session after','min',.5,240,.1)}${field('sensor_stale_seconds','Sensor freshness limit','sec',2,300)}</div>${toggle('auto_session','Automatic session detection','Start and pause using seat, vision, and motion signals.')}${toggle('adaptive_reminders','Adaptive reminders','Shorten the movement reminder interval by 20% while the condition score is below 60.')}</section><section class="card settings-card"><h2>A comfortable environment</h2><p>Lighting, noise, and temperature rules are configurable engineering parameters.</p><div class="form-grid">${field('light_target_lux','Target lighting','lux',50,2000)}${field('temperature_fan_c','Turn fan on above','°C',18,40,.5)}${field('noise_threshold','Relative noise threshold','0–1',.05,1,.05)}${field('noise_warning_seconds','Sustained noise warning','sec',1,600)}</div>${toggle('buzzer_enabled','Gentle audible reminders','Allow short buzzer pulses, with a cooldown between warnings.')}</section><section class="card settings-card"><h2>Your score, explained</h2><p>Five suitability values, one weighted score. Weights must add up to 1.</p><div class="form-grid">${Object.entries(weights).map(([key,v])=>`<label class="field">${nice(key)} weight<input type="number" name="weight_${key}" value="${v}" min="0" max="1" step=".01" required></label>`).join('')}</div><div class="weights">${Object.entries(weights).map(([,v],i)=>`<span class="weight-segment" style="flex:${v};background:${colors[i]}"></span>`).join('')}</div><p class="subtle-text" style="margin-top:15px">This measures observable study conditions. It does not infer mental focus or clinical health.</p></section></div><div class="settings-stack"><section class="card settings-card"><h2>Keep it close. Keep it private.</h2><p>Privacy is the default behavior of your desk.</p><div class="privacy-flow"><span>Local camera</span>${icon('arrow-right')}<span>Pose metadata</span></div><div class="toggle-row"><div><strong>Local camera processing</strong><p>Raw frames stay on the Raspberry Pi. No video upload or audio recording.</p></div>${pill('Always on')}</div>${toggle('cloud_ai_consent','Optional AI session summaries','Allow aggregate session statistics to be sent to AWS Bedrock. Off by default. Requires server credentials.') }<p class="subtle-text">Without cloud AI, your session statistics and local rule-based summaries remain available.</p></section><section class="card settings-card"><h2>Desk controls</h2><p>Let your desk adapt, or take the controls for a moment.</p><div class="actuator-control"><div class="actuator-title"><span>${icon('lamp')}Desk lamp</span><strong id="lamp-output">${number(a.lamp_percent)}%</strong></div><div class="control-row"><select class="select" id="lamp-mode" aria-label="Lamp mode"><option value="auto" ${a.lamp_mode==='auto'?'selected':''}>Automatic</option><option value="manual" ${a.lamp_mode==='manual'?'selected':''}>Manual</option></select><input type="range" id="lamp-level" min="0" max="100" step="5" value="${a.lamp_percent}" aria-label="Lamp brightness" ${a.lamp_mode==='auto'?'disabled':''}></div></div><div class="actuator-control"><div class="actuator-title"><span>${icon('fan')}Desk fan</span><strong id="fan-output">${a.fan?'On':'Off'}</strong></div><div class="control-row"><select class="select" id="fan-mode" aria-label="Fan mode"><option value="auto" ${a.fan_mode==='auto'?'selected':''}>Automatic</option><option value="manual" ${a.fan_mode==='manual'?'selected':''}>Manual</option></select><label class="toggle"><input type="checkbox" id="fan-power" aria-label="Fan power" ${a.fan?'checked':''} ${a.fan_mode==='auto'?'disabled':''}><span></span></label></div></div><p class="subtle-text" style="margin-top:15px">Actuator changes apply immediately. Demo controls affect the simulated desk.</p></section><section class="card settings-card"><h2>Camera calibration</h2><p>Sit upright at your usual distance, with your shoulders and hips visible. The Pi calibration command records your neutral geometry locally.</p><code class="topic-code">python -m raspberry_pi.gateway --calibrate --preview</code><p class="subtle-text" style="margin-top:14px">Moving the camera changes pose geometry. Recalibrate after changing its position.</p></section><section class="inline-note"><span>${icon('shield')}</span><p>These settings are stored locally and applied by the same decision engine in both demo and hardware modes.</p></section></div></div><div class="settings-save"><span>Small adjustments. A more comfortable workspace.</span><button type="submit" class="button">${icon('check')}Save preferences</button></div></form>`;
}

function render(force=false){
 if(!state)return;
 if(currentPage==='settings'&&settingsRendered&&!force)return;
 const active=document.activeElement, activeId=active?.id, activeName=active?.name;
 content.innerHTML=currentPage==='overview'?overview():currentPage==='sessions'?sessionsPage():currentPage==='analytics'?analyticsPage():currentPage==='devices'?devicesPage():settingsPage();
 if(currentPage==='settings')settingsRendered=true;
 if(activeId){const next=document.getElementById(activeId);if(next&&content.contains(next))next.focus({preventScroll:true});}
 else if(activeName){const next=$(`[name="${CSS.escape(activeName)}"]`,content);if(next)next.focus({preventScroll:true});}
}

async function refreshSecondary(){
 const results=await Promise.allSettled([api(`/history?minutes=${historyMinutes}&mode=${state.mode}`),api(`/sessions?mode=${state.mode}`),api(`/events?mode=${state.mode}`),api('/metrics')]);
 if(results[0].status==='fulfilled')history=listValue(results[0].value);
 if(results[1].status==='fulfilled')sessions=listValue(results[1].value);
 if(results[2].status==='fulfilled')events=listValue(results[2].value);
 if(results[3].status==='fulfilled')metrics=results[3].value;
 lastSecondary=Date.now();
}
async function poll(force=false){
 if(busy)return;busy=true;
 try{
  state=await api('/state');
  $('#connection-banner').hidden=true;
  $('#demo-banner').hidden=state.mode!=='demo';
  $('#footer-status').textContent=state.mode==='demo'?'Demo workspace · all data stored locally':'Local monitoring · metadata only';
  $('#notification-dot').hidden=!(state.events||[]).some(e=>e.severity==='warning'||e.severity==='critical');
  if(force||Date.now()-lastSecondary>7000)await refreshSecondary();
  $$('.scenario-button').forEach(b=>b.classList.toggle('active',b.dataset.scenario===state.scenario));
  $('#demo-rule-status').innerHTML=ruleStatus();
  if(force||['overview','devices'].includes(currentPage)||Date.now()-lastHistory>7000){render();lastHistory=Date.now();}
 }catch(error){$('#connection-banner').hidden=false;$('#footer-status').textContent='Local service disconnected';if(!state)content.innerHTML=placeholder('Your desk is a moment away.','Start the FocusGuard service with .\\start.ps1, then this page will reconnect automatically.');}
 finally{busy=false;}
}

async function navigate(){
 const page=location.hash.slice(1)||'overview';currentPage=pages[page]?page:'overview';settingsRendered=false;
 const [eyebrow,title,description,label]=pages[currentPage];$('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-description').textContent=description;$('#breadcrumb-page').textContent=label;
 $$('nav [data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===currentPage);if(a.dataset.page===currentPage)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 $('#sidebar').classList.remove('open');document.title=`${label} · FocusGuard`;
 if(state){if(currentPage!=='overview')await refreshSecondary();render(true);}window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',navigate);

async function runControl(action){
 try{const ended=state.session?.id;await post('/control',{action});await poll(true);toast({start:'Your session is ready.',pause:'Session paused. Take your time.',resume:'Welcome back. Your session is continuing.',end:'Session saved to your journal.',break:'Step away, stretch, and take a breath.',finish_break:'Welcome back to your desk.'}[action]||'Updated.');if(action==='end'&&ended){await refreshSecondary();openSession(ended);}}
 catch(error){toast(error.message,true);}
}

function openEvents(){
 $('#detail-content').innerHTML=`<form method="dialog" class="dialog-heading"><div><div class="eyebrow">THE LATEST FROM YOUR WORKSPACE</div><h2>Around your desk</h2></div><button class="icon-button" aria-label="Close event log">${icon('x')}</button></form>${renderEvents(200,true)}<p class="subtle-text" style="margin-top:15px">Events are stored locally. Simulated events are labeled by workspace mode.</p>`;$('#detail-dialog').showModal();
}
function openPrivacy(){
 $('#detail-content').innerHTML=`<form method="dialog" class="dialog-heading"><div><div class="eyebrow">PRIVACY, BY DESIGN</div><h2>Your camera stays at your desk.</h2></div><button class="icon-button" aria-label="Close privacy details">${icon('x')}</button></form><p>FocusGuard processes video on your Raspberry Pi. The model extracts posture features, then shares only derived values such as posture, confidence, and frame rate.</p><div class="privacy-flow"><span>Camera · local only</span>${icon('arrow-right')}<span>Pose metadata</span>${icon('arrow-right')}<span>Your dashboard</span></div><h3>No conversation recording</h3><p>The sound module provides a relative amplitude level. It does not record conversations or transcribe speech.</p><h3>A choice about cloud AI</h3><p>AI summaries are off by default. When enabled, AWS Bedrock receives aggregate session statistics. It never receives raw camera frames or audio. Local rules and controls continue when the Internet is unavailable.</p><h3>Honest about what we know</h3><p>The Study Condition Score describes observable desk conditions. It does not measure mental focus, diagnose health, or replace professional advice.</p><a class="button secondary" href="#settings" style="margin-top:22px" id="privacy-settings-link">Review privacy settings ${icon('arrow-right')}</a>`;$('#detail-dialog').showModal();
}

function openSession(id){
 const session=sessions.find(s=>String(s.id)===String(id));if(!session){toast('Session is still being saved. Check the session journal in a moment.');return;}
 const summary=typeof session.summary==='object'?session.summary?.text:session.summary;
 $('#detail-content').innerHTML=`<form method="dialog" class="dialog-heading"><div><div class="eyebrow">YOUR SESSION JOURNAL</div><h2>${date(session.started_at)} · ${time(session.started_at)}</h2></div><button class="icon-button" aria-label="Close session">${icon('x')}</button></form><div class="badge-line">${pill(session.mode==='demo'?'Demo session':'Study session')}${pill(session.ended_at?'Completed':nice(session.state),'off')}</div><div class="stats-grid">${stat('Time at desk',shortDuration(session.elapsed_seconds||session.duration_seconds),'Active sitting time','clock')}${stat('Average score',number(session.average_score),'Out of 100','leaf')}${stat('Upright posture',`${number(session.good_posture_percent)}%`,'Of observed posture time','posture')}</div><div class="form-grid"><div class="subtle-text">Breaks taken <strong>${session.breaks||0}</strong></div><div class="subtle-text">Posture warnings <strong>${session.slouch_events||0}</strong></div><div class="subtle-text">Average light <strong>${number(session.average_lux)} lux</strong></div><div class="subtle-text">Average temperature <strong>${number(session.average_temperature,1)} °C</strong></div></div><div class="summary-box"><div class="summary-label">${icon('sparkles')}SESSION REFLECTION</div><p id="session-summary-text">${summary?esc(summary):'A small moment to reflect. Generate a summary of your session conditions and habits.'}</p><div class="summary-actions"><button class="button secondary" data-summary="${esc(id)}">${icon('sparkles')}${summary?'Refresh summary':'Generate summary'}</button><span id="summary-source">${esc(session.summary_source?nice(session.summary_source):state.settings.cloud_ai_consent?'Cloud AI enabled · statistics only':'Local insights · cloud AI off')}</span></div></div><p class="subtle-text" style="margin-top:16px">${session.mode==='demo'?'This session uses simulated sensor readings.':'Only derived sensor data is saved. No camera or audio recording.'}</p>`;
 if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
}

document.addEventListener('click',async event=>{
 const target=event.target.closest('button,a');if(!target)return;
 if(target.dataset.control){await runControl(target.dataset.control);return;}
 if(target.dataset.scenario){
  try{if(state.mode!=='demo'){await post('/mode',{mode:'demo'});toast('Switched to the demo workspace.');}await post('/demo',{scenario:target.dataset.scenario});await poll(true);toast(`${scenarios.find(s=>s[0]===target.dataset.scenario)[1]} scenario is running.`);}catch(error){toast(error.message,true);}return;
 }
 if(target.dataset.action==='events'){openEvents();return;}
 if(target.dataset.session){openSession(target.dataset.session);return;}
 if(target.dataset.range){historyMinutes=Number(target.dataset.range);await refreshSecondary();render(true);return;}
 if(target.dataset.summary){
  target.disabled=true;target.textContent='Writing your reflection…';
  try{const result=await post(`/sessions/${encodeURIComponent(target.dataset.summary)}/summary`,{});const value=result.summary||result.text||result;$('#session-summary-text').textContent=typeof value==='object'?value.text||JSON.stringify(value):value;$('#summary-source').textContent=nice(result.source||result.summary_source||'local');await refreshSecondary();toast('Your session reflection is ready.');}
  catch(error){toast(error.message,true);}finally{target.disabled=false;target.innerHTML=`${icon('sparkles')}Refresh summary`;}return;
 }
 if(target.id==='privacy-settings-link')$('#detail-dialog').close();
});

document.addEventListener('change',async event=>{
 const el=event.target;
 if(el.id==='chart-metric'){chartMetric=el.value;render();return;}
 if(el.id==='data-mode'){
  try{await post('/mode',{mode:el.value});history=[];events=[];await poll(true);toast(el.value==='hardware'?'Listening for real sensor data.':'Your demo workspace is ready.');}catch(error){toast(error.message,true);}return;
 }
 if(['lamp-mode','lamp-level','fan-mode','fan-power'].includes(el.id)){
  const payload={lamp_mode:$('#lamp-mode').value,fan_mode:$('#fan-mode').value};
  if(el.id==='lamp-level'){payload.lamp_percent=Number(el.value);payload.lamp_mode='manual';}
  if(el.id==='fan-power'){payload.fan=el.checked;payload.fan_mode='manual';}
  try{await post('/actuators',payload);state=await api('/state');$('#lamp-level').disabled=state.actuators.lamp_mode==='auto';$('#lamp-mode').value=state.actuators.lamp_mode;$('#lamp-output').textContent=`${state.actuators.lamp_percent}%`;$('#fan-power').disabled=state.actuators.fan_mode==='auto';$('#fan-power').checked=state.actuators.fan;$('#fan-output').textContent=state.actuators.fan?'On':'Off';toast('Desk controls updated.');}catch(error){toast(error.message,true);}return;
 }
});
document.addEventListener('input',event=>{if(event.target.id==='lamp-level')$('#lamp-output').textContent=`${event.target.value}%`;});
document.addEventListener('submit',async event=>{
 if(event.target.id!=='settings-form')return;event.preventDefault();const form=event.target,button=$('button[type="submit"]',form),data=new FormData(form),payload={weights:{}};
 for(const el of $$('input[name]',form)){if(el.name.startsWith('weight_'))payload.weights[el.name.slice(7)]=Number(el.value);else payload[el.name]=el.type==='checkbox'?el.checked:Number(el.value);}
 const sum=Object.values(payload.weights).reduce((a,v)=>a+v,0);if(Math.abs(sum-1)>.001){toast(`Score weights add up to ${sum.toFixed(2)}. Adjust them to total 1.00.`,true);return;}
 button.disabled=true;
 try{await api('/settings',{method:'PATCH',body:JSON.stringify(payload)});state=await api('/state');toast('Preferences saved. Your desk is up to date.');}catch(error){toast(error.message,true);}finally{button.disabled=false;}
});

$('#demo-lab-button').addEventListener('click',()=>$('#demo-dialog').showModal());
$('#notifications-button').addEventListener('click',openEvents);
$('#privacy-button').addEventListener('click',openPrivacy);
$('#menu-button').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#export-button').addEventListener('click',()=>{const kind=currentPage==='sessions'?'sessions':'history';const link=document.createElement('a');link.href=`/api/export?kind=${kind}&mode=${state.mode}&minutes=${historyMinutes}`;link.download=`focusguard-${kind}.csv`;document.body.appendChild(link);link.click();link.remove();toast('Your local data export is downloading.');});
$('#fast-demo-button').addEventListener('click',async()=>{
 try{await api('/settings',{method:'PATCH',body:JSON.stringify({posture_warning_seconds:3,distance_warning_seconds:2,noise_warning_seconds:3,warning_cooldown_seconds:10,break_interval_minutes:.5,eye_break_interval_minutes:.33,break_duration_seconds:20,occupancy_pause_seconds:3,occupancy_end_minutes:1})});settingsRendered=false;await poll(true);$('#fast-demo-button').textContent='Fast rules enabled';toast('Presentation timing enabled. Normal thresholds can be restored in settings.');}catch(error){toast(error.message,true);}
});
for(const dialog of $$('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(true);});
await navigate();await poll(true);setInterval(()=>{if(!document.hidden)poll();},1000);
