import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY || 'VITE_API_KEY',
  authDomain: import.meta.env.VITE_AUTH_DOMAIN || 'VITE_AUTH_DOMAIN',
  projectId: import.meta.env.VITE_PROJECT_ID || 'VITE_PROJECT_ID',
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET || 'VITE_STORAGE_BUCKET',
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID || 'VITE_MSG_SENDER_ID',
  appId: import.meta.env.VITE_APP_ID || 'VITE_APP_ID',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const LS = 'jobApplications';
const USER_LS = uid => `jobTracker:${uid}`;
const STATUSES = ['Interested', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'];
const STAGES = ['Recruiter screen', 'Hiring manager', 'Technical interview', 'Assessment', 'Second interview', 'Final interview', 'Other'];
const CSV_HEADERS = ['company','position','date','location','agent','status','requirements','optionalRequirements','benefits','fullDescription','notes'];
const blankApplication = { company:'', position:'', date:'', location:'remote', agent:'Company', status:'Applied', requirements:'', optionalRequirements:'', benefits:'', fullDescription:'', notes:'', id:null, interviews:[], statusHistory:[] };
const blankInterview = { appId:'', stage:'Recruiter screen', start:'', end:'', location:'', notes:'' };
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const safeJson = (value, fallback=[]) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const localDateTime = value => value ? new Date(value).toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' }) : '—';
const dateKey = value => value ? value.slice(0, 10) : '';
const normalize = app => ({ ...blankApplication, ...app, id:app.id || uid(), interviews:Array.isArray(app.interviews) ? app.interviews : [], statusHistory:Array.isArray(app.statusHistory) ? app.statusHistory : [] });
const mergeApps = (...groups) => {
  const map = new Map();
  groups.flat().filter(Boolean).forEach(raw => {
    const app = normalize(raw);
    const key = String(app.id);
    map.set(key, map.has(key) ? { ...map.get(key), ...app, interviews:app.interviews.length ? app.interviews : map.get(key).interviews, statusHistory:app.statusHistory.length ? app.statusHistory : map.get(key).statusHistory } : app);
  });
  return [...map.values()];
};
const attachLegacyEvents = (apps, events=[]) => apps.map(app => {
  const linked = events.filter(event => String(event.appId) === String(app.id));
  if (!linked.length) return app;
  const known = new Set(app.interviews.map(event => String(event.id)));
  const migrated = linked.filter(event => !known.has(String(event.id))).map(event => ({
    id:event.id || uid(),
    stage:(event.title || '').replace(/^.*?\s[–-]\s/,'') || 'Interview',
    start:typeof event.start === 'string' ? event.start : new Date(event.start).toISOString().slice(0,16),
    end:event.end ? (typeof event.end === 'string' ? event.end : new Date(event.end).toISOString().slice(0,16)) : '',
    location:event.location || '',
    notes:event.notes || '',
  }));
  return { ...app, interviews:[...app.interviews,...migrated] };
});
const readCloudDoc = async reference => {
  try {
    const snapshot = await getDoc(reference);
    return snapshot.exists() ? snapshot.data() : {};
  } catch (error) {
    console.warn('One cloud storage location could not be read', error);
    return {};
  }
};
const esc = value => String(value ?? '').replace(/"/g,'""').replace(/\n/g,'\\n');
const toCsv = rows => CSV_HEADERS.join(',')+'\n'+rows.map(r => CSV_HEADERS.map(c => `"${esc(r[c])}"`).join(',')).join('\n');
const parseCsv = str => {
  const [header='', ...lines] = str.trim().split(/\r?\n/);
  const headers = header.split(',');
  return lines.filter(Boolean).map(line => {
    const cells = line.match(/"(?:[^"]|"{2})*"|[^,]+/g) || [];
    const item = {};
    headers.forEach((key,index) => item[key] = (cells[index] || '').replace(/^"|"$/g,'').replace(/""/g,'"').replace(/\\n/g,'\n'));
    return normalize({ ...item, id:uid(), statusHistory:item.status ? [{ id:uid(), status:item.status, at:new Date().toISOString() }] : [] });
  });
};

export default function App(){
  const [apps,setApps] = useState([]);
  const [form,setForm] = useState(blankApplication);
  const [interview,setInterview] = useState(blankInterview);
  const [editingInterview,setEditingInterview] = useState(null);
  const [edit,setEdit] = useState(false);
  const [user,setUser] = useState(null);
  const [expanded,setExpanded] = useState(null);
  const [tab,setTab] = useState('applications');
  const [month,setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [saveState,setSaveState] = useState('Loading saved data…');
  const fileInput = useRef();
  const hydrated = useRef(false);

  useEffect(() => onAuthStateChanged(auth, async currentUser => {
    hydrated.current = false;
    setUser(currentUser);
    setSaveState('Loading saved data…');
    const guest = safeJson(localStorage.getItem(LS));
    if (!currentUser) {
      setApps(guest.map(normalize));
      hydrated.current = true;
      setSaveState('Saved on this device');
      return;
    }
    const cached = safeJson(localStorage.getItem(USER_LS(currentUser.uid)));
    try {
      const [currentData, legacyData] = await Promise.all([
        readCloudDoc(doc(db,'applications',currentUser.uid)),
        readCloudDoc(doc(db,'data',currentUser.uid)),
      ]);
      const current = currentData.items || currentData.apps || [];
      const legacy = legacyData.apps || legacyData.items || [];
      const merged = attachLegacyEvents(mergeApps(guest, cached, legacy, current), [...(legacyData.events || []),...(currentData.events || [])]);
      setApps(merged);
      localStorage.setItem(USER_LS(currentUser.uid), JSON.stringify(merged));
      if (merged.length && legacy.length !== merged.length) {
        await setDoc(doc(db,'data',currentUser.uid), { apps:merged, updatedAt:new Date().toISOString(), schemaVersion:3 }, { merge:true });
      }
      setSaveState('Saved to cloud and this device');
    } catch (error) {
      console.error('Unable to load cloud data', error);
      setApps(mergeApps(guest, cached));
      setSaveState('Offline — saved on this device');
    } finally { hydrated.current = true; }
  }), []);

  useEffect(() => {
    if (!hydrated.current) return;
    const key = user ? USER_LS(user.uid) : LS;
    localStorage.setItem(key, JSON.stringify(apps));
    if (!user) { setSaveState('Saved on this device'); return; }
    setSaveState('Saving…');
    const timer = setTimeout(async () => {
      try {
        await setDoc(doc(db,'data',user.uid), { apps, updatedAt:new Date().toISOString(), schemaVersion:3 }, { merge:true });
        setSaveState('Saved to cloud and this device');
      } catch (error) {
        console.error('Unable to save cloud data', error);
        setSaveState('Cloud save failed — backed up on this device');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [apps,user]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(console.error);
  }, []);

  const allInterviews = useMemo(() => apps.flatMap(app => app.interviews.map(event => ({ ...event, appId:app.id, company:app.company, position:app.position }))).sort((a,b) => new Date(a.start)-new Date(b.start)), [apps]);
  const handleChange = e => setForm(current => ({ ...current, [e.target.name]:e.target.value }));
  const handleSubmit = e => {
    e.preventDefault();
    if (!form.company.trim() || !form.position.trim()) return;
    if (edit) {
      setApps(current => current.map(app => app.id === form.id ? { ...form, statusHistory: app.status !== form.status ? [...app.statusHistory,{ id:uid(), status:form.status, at:new Date().toISOString() }] : app.statusHistory } : app));
    } else {
      const id = uid();
      setApps(current => [...current, normalize({ ...form, id, statusHistory:[{ id:uid(), status:form.status, at:new Date().toISOString() }] })]);
    }
    setForm(blankApplication); setEdit(false);
  };
  const startEdit = app => { setForm(normalize(app)); setEdit(true); window.scrollTo({top:0,behavior:'smooth'}); };
  const removeApp = id => { if (confirm('Delete this application and its interviews?')) setApps(current => current.filter(app => app.id !== id)); };
  const addOrUpdateInterview = e => {
    e.preventDefault();
    if (!interview.appId || !interview.start) return;
    setApps(current => current.map(app => {
      if (String(app.id) !== String(interview.appId)) return app;
      const event = { ...interview, id:editingInterview || uid() };
      const interviews = editingInterview ? app.interviews.map(item => item.id === editingInterview ? event : item) : [...app.interviews,event];
      const history = app.status === 'Interviewing' ? app.statusHistory : [...app.statusHistory,{ id:uid(), status:'Interviewing', at:new Date().toISOString() }];
      return { ...app, status:'Interviewing', interviews, statusHistory:history };
    }));
    setInterview(blankInterview); setEditingInterview(null);
  };
  const editInterview = event => { setInterview({ appId:event.appId, stage:event.stage, start:event.start, end:event.end || '', location:event.location || '', notes:event.notes || '' }); setEditingInterview(event.id); setTab('calendar'); window.scrollTo({top:0,behavior:'smooth'}); };
  const deleteInterview = event => { if (confirm('Delete this interview event?')) setApps(current => current.map(app => app.id === event.appId ? { ...app, interviews:app.interviews.filter(item => item.id !== event.id) } : app)); };
  const exportCsv = () => { const blob=new Blob([toCsv(apps)],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='applications.csv'; a.click(); URL.revokeObjectURL(url); };
  const importCsv = e => { const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=event=>setApps(current=>mergeApps(current,parseCsv(event.target.result))); reader.readAsText(file); e.target.value=''; };

  const accent='#5c2439', dark='#321221', card='rgba(255,255,255,0.72)';
  return <div style={{backgroundColor:'#f7f3f5',color:accent}} className="min-h-screen pb-12">
    <header style={{backgroundColor:dark}} className="text-[#f6e8ec] sticky top-0 z-20 shadow-md">
      <div className="max-w-5xl mx-auto flex justify-between items-center p-4">
        <div><h1 className="text-xl font-bold">Job Tracker</h1><p className="text-xs text-[#e8cad8]">{saveState}</p></div>
        {user ? <button onClick={()=>signOut(auth)} className="px-3 py-1 rounded bg-[#d7b7c8] text-[#321221]">Sign out</button> : <button onClick={()=>signInWithPopup(auth,new GoogleAuthProvider())} className="px-3 py-1 rounded bg-[#d7b7c8] text-[#321221]">Sign in</button>}
      </div>
      <nav className="max-w-5xl mx-auto flex">
        {['applications','calendar'].map(value => <button key={value} onClick={()=>setTab(value)} className={`flex-1 py-3 capitalize ${tab===value?'bg-[#5c2439] font-semibold':'bg-[#321221]'}`}>{value}</button>)}
      </nav>
    </header>

    {tab === 'applications' ? <>
      <form onSubmit={handleSubmit} style={{backgroundColor:card}} className="max-w-2xl mx-auto mt-6 p-5 rounded-2xl shadow-lg">
        <h2 className="font-semibold mb-3">{edit?'Edit':'Add'} Application</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input required name="company" placeholder="Company" className="border p-2 rounded" value={form.company} onChange={handleChange}/>
          <input required name="position" placeholder="Position" className="border p-2 rounded" value={form.position} onChange={handleChange}/>
          <input type="date" name="date" className="border p-2 rounded" value={form.date} onChange={handleChange}/>
          <select name="status" className="border p-2 rounded" value={form.status} onChange={handleChange}>{STATUSES.map(item=><option key={item}>{item}</option>)}</select>
          <select name="location" className="border p-2 rounded" value={form.location} onChange={handleChange}><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="office">Office</option></select>
          <select name="agent" className="border p-2 rounded" value={form.agent} onChange={handleChange}><option value="Company">Direct</option><option value="Agent">Agent</option></select>
        </div>
        <textarea name="requirements" rows="2" placeholder="Requirements (one per line)" className="border p-2 rounded w-full mt-3" value={form.requirements} onChange={handleChange}/>
        <textarea name="optionalRequirements" rows="2" placeholder="Optional requirements" className="border p-2 rounded w-full mt-3" value={form.optionalRequirements} onChange={handleChange}/>
        <textarea name="benefits" rows="2" placeholder="Benefits" className="border p-2 rounded w-full mt-3" value={form.benefits} onChange={handleChange}/>
        <textarea name="fullDescription" rows="3" placeholder="Full description" className="border p-2 rounded w-full mt-3" value={form.fullDescription} onChange={handleChange}/>
        <textarea name="notes" rows="2" placeholder="Notes" className="border p-2 rounded w-full mt-3" value={form.notes} onChange={handleChange}/>
        <div className="flex gap-3 mt-4"><button type="submit" style={{backgroundColor:accent}} className="flex-1 text-white py-2 rounded">{edit?'Update':'Add'}</button>{edit&&<button type="button" onClick={()=>{setForm(blankApplication);setEdit(false);}} className="flex-1 bg-gray-400 py-2 rounded text-white">Cancel</button>}</div>
      </form>
      <div className="flex justify-center gap-3 mt-6"><button onClick={exportCsv} className="bg-[#5c2439] text-white px-4 py-2 rounded">Export CSV</button><button onClick={()=>fileInput.current.click()} className="bg-[#5c2439] text-white px-4 py-2 rounded">Import CSV</button><input type="file" accept=".csv" ref={fileInput} onChange={importCsv} className="hidden"/></div>
      <div className="max-w-5xl mx-auto mt-7 px-2">
        {!apps.length && <p className="text-center py-12">No applications saved yet.</p>}
        {apps.map(app => <div key={app.id} className="mb-4 border rounded-xl shadow bg-white/70 border-[#e0cdd7]">
          <button onClick={()=>setExpanded(value=>value===app.id?null:app.id)} className="grid grid-cols-4 w-full text-left gap-2 p-4 hover:bg-[#f3e6ec]"><span className="font-medium truncate">{app.position}</span><span className="truncate">{app.company}</span><span className="text-right">{app.date||'—'}</span><span className="text-right">{app.status}</span></button>
          {expanded===app.id && <DetailsCard app={app} onEdit={()=>startEdit(app)} onDelete={()=>removeApp(app.id)} onAddInterview={()=>{setInterview({...blankInterview,appId:String(app.id)});setTab('calendar');window.scrollTo({top:0});}}/>}
        </div>)}
      </div>
    </> : <CalendarView apps={apps} interview={interview} setInterview={setInterview} editingInterview={editingInterview} cancelEdit={()=>{setInterview(blankInterview);setEditingInterview(null);}} submit={addOrUpdateInterview} month={month} setMonth={setMonth} events={allInterviews} onEdit={editInterview} onDelete={deleteInterview}/>}
  </div>;
}

function DetailsCard({app,onEdit,onDelete,onAddInterview}){
  const [open,setOpen]=useState({req:true,opt:false,ben:false,desc:false,notes:false,timeline:true});
  const Section=({name,label,children}) => <div><button onClick={()=>setOpen(value=>({...value,[name]:!value[name]}))} className="w-full text-left font-semibold text-[#5c2439]">{label}<span className="float-right">{open[name]?'-':'+'}</span></button>{open[name]&&children}</div>;
  const bullets = text => text ? <ul className="list-disc list-inside mt-1">{text.split(/\r?\n/).filter(Boolean).map((item,index)=><li key={index}>{item.trim()}</li>)}</ul> : <p className="text-gray-500 mt-1">None entered</p>;
  const timeline = [...app.statusHistory.map(item=>({...item,label:item.status,type:'status'})),...app.interviews.map(item=>({...item,at:item.start,label:item.stage,type:'interview'}))].sort((a,b)=>new Date(a.at)-new Date(b.at));
  return <div className="border-t px-4 py-3 space-y-3 text-sm border-[#e0cdd7]">
    <p><strong>Location:</strong> {app.location} · <strong>Source:</strong> {app.agent}</p>
    <Section name="req" label="Requirements">{bullets(app.requirements)}</Section>
    {app.optionalRequirements&&<Section name="opt" label="Optional Requirements">{bullets(app.optionalRequirements)}</Section>}
    {app.benefits&&<Section name="ben" label="Benefits"><p className="whitespace-pre-wrap mt-1">{app.benefits}</p></Section>}
    {app.fullDescription&&<Section name="desc" label="Full Description"><p className="whitespace-pre-wrap mt-1">{app.fullDescription}</p></Section>}
    {app.notes&&<Section name="notes" label="Notes"><p className="whitespace-pre-wrap mt-1">{app.notes}</p></Section>}
    <Section name="timeline" label="Application Timeline"><ol className="border-l-2 border-[#d7b7c8] ml-2 mt-2 pl-4 space-y-3">{timeline.length?timeline.map(item=><li key={`${item.type}-${item.id}`}><span className="font-medium">{item.label}</span><br/><span className="text-gray-600">{localDateTime(item.at)}</span></li>):<li className="text-gray-500">No timeline events yet</li>}</ol></Section>
    <div className="grid sm:grid-cols-3 gap-2 pt-1"><button onClick={onAddInterview} className="py-2 rounded bg-[#d7b7c8] text-[#321221]">Add interview</button><button onClick={onEdit} className="py-2 rounded bg-[#e3cada] text-[#321221]">Edit application</button><button onClick={onDelete} className="py-2 rounded bg-[#5c2439] text-white">Delete</button></div>
  </div>;
}

function CalendarView({apps,interview,setInterview,editingInterview,cancelEdit,submit,month,setMonth,events,onEdit,onDelete}){
  const year=month.getFullYear(), monthIndex=month.getMonth();
  const firstDay=(new Date(year,monthIndex,1).getDay()+6)%7;
  const days=new Date(year,monthIndex+1,0).getDate();
  const cells=[...Array(firstDay).fill(null),...Array.from({length:days},(_,i)=>i+1)];
  while(cells.length%7) cells.push(null);
  const upcoming=events.filter(event=>new Date(event.start)>=new Date()).slice(0,8);
  return <main className="max-w-6xl mx-auto px-3">
    <form onSubmit={submit} className="mt-6 p-5 rounded-2xl shadow-lg bg-white/70">
      <h2 className="font-semibold mb-3">{editingInterview?'Edit':'Add'} Interview</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <select required value={interview.appId} onChange={e=>setInterview({...interview,appId:e.target.value})} className="border p-2 rounded"><option value="">Choose application</option>{apps.map(app=><option key={app.id} value={app.id}>{app.position} — {app.company}</option>)}</select>
        <select value={interview.stage} onChange={e=>setInterview({...interview,stage:e.target.value})} className="border p-2 rounded">{STAGES.map(stage=><option key={stage}>{stage}</option>)}</select>
        <label className="text-xs">Start<input required type="datetime-local" value={interview.start} onChange={e=>setInterview({...interview,start:e.target.value})} className="border p-2 rounded w-full mt-1"/></label>
        <label className="text-xs">End (optional)<input type="datetime-local" value={interview.end} onChange={e=>setInterview({...interview,end:e.target.value})} className="border p-2 rounded w-full mt-1"/></label>
        <input placeholder="Location or video link" value={interview.location} onChange={e=>setInterview({...interview,location:e.target.value})} className="border p-2 rounded self-end"/>
        <input placeholder="Preparation notes" value={interview.notes} onChange={e=>setInterview({...interview,notes:e.target.value})} className="border p-2 rounded self-end"/>
      </div>
      <div className="flex gap-2 mt-4"><button className="px-5 py-2 rounded bg-[#5c2439] text-white">{editingInterview?'Update interview':'Save interview'}</button>{editingInterview&&<button type="button" onClick={cancelEdit} className="px-5 py-2 rounded bg-gray-400 text-white">Cancel</button>}</div>
    </form>
    <section className="mt-6 bg-white/70 rounded-2xl shadow p-3 sm:p-5 overflow-x-auto">
      <div className="flex justify-between items-center mb-4"><button onClick={()=>setMonth(new Date(year,monthIndex-1,1))} className="px-3 py-2 rounded bg-[#e9dce3]">‹</button><h2 className="font-semibold text-lg">{month.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</h2><button onClick={()=>setMonth(new Date(year,monthIndex+1,1))} className="px-3 py-2 rounded bg-[#e9dce3]">›</button></div>
      <div className="grid grid-cols-7 min-w-[700px]">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><div key={day} className="p-2 font-semibold text-center bg-[#e9dce3]">{day}</div>)}{cells.map((day,index)=>{const key=day?`${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';const dayEvents=events.filter(event=>dateKey(event.start)===key);return <div key={index} className="min-h-28 border border-[#eadce3] p-1 bg-white/60"><span className="text-xs">{day}</span>{dayEvents.map(event=><button key={event.id} onClick={()=>onEdit(event)} className="block w-full text-left mt-1 p-1 rounded bg-[#5c2439] text-white text-xs"><span className="font-semibold">{event.start.slice(11,16)} {event.stage}</span><br/>{event.company}</button>)}</div>;})}</div>
    </section>
    <section className="mt-6 bg-white/70 rounded-2xl shadow p-5"><h2 className="font-semibold mb-3">Upcoming interviews</h2>{upcoming.length?upcoming.map(event=><div key={event.id} className="border-b border-[#eadce3] py-3 flex flex-col sm:flex-row sm:items-center gap-2"><div className="flex-1"><strong>{event.stage}</strong> · {event.position} at {event.company}<br/><span className="text-sm">{localDateTime(event.start)}{event.location?` · ${event.location}`:''}</span>{event.notes&&<p className="text-sm mt-1">{event.notes}</p>}</div><button onClick={()=>onEdit(event)} className="px-3 py-1 rounded bg-[#e3cada]">Edit</button><button onClick={()=>onDelete(event)} className="px-3 py-1 rounded bg-[#5c2439] text-white">Delete</button></div>):<p className="text-gray-500">No upcoming interviews saved.</p>}</section>
  </main>;
}
