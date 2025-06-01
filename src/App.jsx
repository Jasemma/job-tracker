import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'firebase/firestore';

/* ------------------------------------------------------------------
   Firebase config – replace placeholders or inject via .env
-------------------------------------------------------------------*/
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY || 'VITE_API_KEY',
  authDomain: import.meta.env.VITE_AUTH_DOMAIN || 'VITE_AUTH_DOMAIN',
  projectId: import.meta.env.VITE_PROJECT_ID || 'VITE_PROJECT_ID',
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET || 'VITE_STORAGE_BUCKET',
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID || 'VITE_MSG_SENDER_ID',
  appId: import.meta.env.VITE_APP_ID || 'VITE_APP_ID'
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

/* ------------------------------------------------------------------
   CSV helpers
-------------------------------------------------------------------*/
const CSV_HEADERS = [
  'company',
  'position',
  'date',
  'location',
  'agent',
  'status',
  'requirements',
  'optionalRequirements',
  'benefits',
  'fullDescription',
  'notes',
];
const esc  = (v)=>String(v).replace(/"/g,'""').replace(/\n/g,'\\n');
const toCsv = rows => CSV_HEADERS.join(',')+'\n'+rows.map(r=>CSV_HEADERS.map(c=>`"${esc(r[c]??'')}"`).join(',')).join('\n');
const parseCsv = str => {const [h,...ls]=str.trim().split(/\r?\n/);const head=h.split(',');return ls.map(l=>{const cells=l.match(/"(?:[^"]|"{2})*"|[^,]+/g).map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"').replace(/\\n/g,'\n'));const o={};head.forEach((k,i)=>o[k]=cells[i]||'');o.id=Date.now()+Math.random();return o;});};

export default function App(){
  // state
  const blank={company:'',position:'',date:'',location:'remote',agent:'no',status:'Applied',requirements:'',optionalRequirements:'',benefits:'',fullDescription:'',notes:'',id:null};
  const[apps,setApps]=useState([]);
  const[form,setForm]=useState(blank);
  const[edit,setEdit]=useState(false);
  const[user,setUser]=useState(null);
  const[expanded,setExpanded]=useState(null);
  const fileInput=useRef();
  const ready=useRef(false);
  const LS='jobApplications';

  // auth load
  useEffect(()=>{const unsub=onAuthStateChanged(auth,async u=>{setUser(u);const local=JSON.parse(localStorage.getItem(LS)||'[]');const cloud=u?await getDoc(doc(db,'applications',u.uid)).then(s=>s.exists()?s.data().items:[]):[];setApps(cloud.length?cloud:local);ready.current=true;});return unsub;},[]);
  useEffect(()=>{if(!ready.current) return;user?setDoc(doc(db,'applications',user.uid),{items:apps}):localStorage.setItem(LS,JSON.stringify(apps));},[apps,user]);

  // service worker
  useEffect(()=>{'serviceWorker' in navigator && navigator.serviceWorker.register('/service-worker.js').catch(console.error);},[]);

  // handlers
  const handleChange=e=>setForm({...form,[e.target.name]:e.target.value});
  const handleSubmit=e=>{e.preventDefault();if(!form.company||!form.position) return;edit?setApps(apps.map(a=>a.id===form.id?form:a)):setApps([...apps,{...form,id:Date.now()}]);setForm(blank);setEdit(false);};
  const startEdit=a=>{setForm(a);setEdit(true);window.scrollTo({top:0,behavior:'smooth'});} ;
  const del=id=>{setApps(apps.filter(a=>a.id!==id));if(edit&&id===form.id){setForm(blank);setEdit(false);}}
  const clearAll=()=>{if(confirm('Clear all?')){setApps([]);user&&setDoc(doc(db,'applications',user.uid),{items:[]});localStorage.removeItem(LS);}};
  const exportCsv=()=>{const blob=new Blob([toCsv(apps)],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='applications.csv';a.click();URL.revokeObjectURL(url);} ;
  const importCsv=e=>{const f=e.target.files[0];if(!f) return;const r=new FileReader();r.onload=ev=>setApps(p=>[...p,...parseCsv(ev.target.result)]);r.readAsText(f);e.target.value=null;};

  // helpers
  const bulletList=txt=>txt&&<ul className="list-disc list-inside mt-1 text-sm text-[#4e1d2e]">{txt.split(/\r?\n/).filter(Boolean).map((l,i)=><li key={i}>{l.trim()}</li>)}</ul>;

  // palette from reference image
  const bgLight="#f7f3f5"; // near-cream
  const bgDark="#321221"; // deep burgundy
  const accent="#5c2439"; // mid burgundy
  const softCard="rgba(255,255,255,0.6)";

  return(
    <div style={{backgroundColor:bgLight,color:accent}} className="min-h-screen">
      {/* navbar */}
      <header style={{backgroundColor:bgDark}} className="text-[#f6e8ec] flex justify-between items-center p-4 shadow-md sticky top-0 z-10">
        <h1 className="text-xl font-bold tracking-wide">Job Tracker</h1>
        {user?(
          <button onClick={()=>signOut(auth)} style={{backgroundColor:'#d7b7c8'}} className="px-3 py-1 rounded text-[#321221]">Sign out</button>
        ):(
          <button onClick={()=>signInWithPopup(auth,new GoogleAuthProvider())} style={{backgroundColor:'#d7b7c8'}} className="px-3 py-1 rounded text-[#321221]">Sign in</button>
        )}
      </header>

      {/* form */}
      <form onSubmit={handleSubmit} style={{backgroundColor:softCard}} className="backdrop-blur-md max-w-2xl mx-auto mt-6 p-5 rounded-2xl shadow-lg">
        <h2 className="font-semibold mb-3">{edit?'Edit':'Add'} Application</h2>
        <div className="grid sm:grid-CSV_HEADERS-2 gap-3">
          <input name="company" placeholder="Company" className="border p-2 rounded" value={form.company} onChange={handleChange}/>
          <input name="position" placeholder="Position" className="border p-2 rounded" value={form.position} onChange={handleChange}/>
          <input type="date" name="date" className="border p-2 rounded" value={form.date} onChange={handleChange}/>
          <select name="status" className="border p-2 rounded" value={form.status} onChange={handleChange}><option>Applied</option><option>Interviewing</option><option>Offer</option><option>Rejected</option></select>
          <select name="location" className="border p-2 rounded" value={form.location} onChange={handleChange}><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="office">Office</option></select>
          <select name="agent" className="border p-2 rounded" value={form.agent} onChange={handleChange}><option value="Company">Direct</option><option value="Name">Agent</option></select>
        </div>
        <textarea name="requirements" rows="2" placeholder="Requirements (one per line)" className="border p-2 rounded w-full mt-3" value={form.requirements} onChange={handleChange}/>
        <textarea name="optionalRequirements" rows="2" placeholder="Optional requirements" className="border p-2 rounded w-full mt-3" value={form.optionalRequirements} onChange={handleChange}/>
        <textarea name="benefits" rows="2" placeholder="Benefits" className="border p-2 rounded w-full mt-3" value={form.benefits} onChange={handleChange}/>
        <textarea name="fullDescription" rows="3" placeholder="Full description" className="border p-2 rounded w-full mt-3" value={form.fullDescription} onChange={handleChange}/>
        <textarea name="notes" rows="2" placeholder="Notes" className="border p-2 rounded w-full mt-3" value={form.notes} onChange={handleChange}/>
        <div className="flex gap-3 mt-4">
          <button type="submit" style={{backgroundColor:accent}} className="flex-1 text-[#f7f3f5] py-2 rounded">{edit?'Update':'Add'}</button>
          {edit&&<button type="button" onClick={()=>{setForm(blank);setEdit(false);}} className="flex-1 bg-gray-400 py-2 rounded text-white">Cancel</button>}
        </div>
      </form>

      {/* tools */}
      {apps.length>0&&<div className="flex justify-center gap-4 mt-6"><button onClick={exportCsv} style={{backgroundColor:accent}} className="text-[#f7f3f5] px-4 py-2 rounded">Export CSV</button><button onClick={()=>fileInput.current.click()} style={{backgroundColor:accent}} className="text-[#f7f3f5] px-4 py-2 rounded">Import CSV</button><input type="file" accept=".csv" ref={fileInput} onChange={importCsv} className="hidden"/></div>}

      {/* headings */}
      {apps.length > 0 && (
        <div
          className="max-w-5xl mx-auto mt-8 px-4 py-2 font-semibold flex w-full"
          style={{ backgroundColor: '#e9dce3', color: accent, position: 'sticky', top: '56px', zIndex: 5 }}>
          <span className="flex-1 whitespace-nowrap">Position</span>
          <span className="flex-1 whitespace-nowrap">Company</span>
          <span className="flex-1 whitespace-nowrap text-right">Date</span>
          <span className="flex-1 whitespace-nowrap text-right">Status</span>
        </div>
      )}

      {/* list */}
      <div className="max-w-5xl mx-auto mt-2 px-2">
        {apps.map(app=>{
          const isOpen=expanded===app.id;
          const toggleSectionKey=id=>{setExpanded(p=>p===id?null:id);} ;
          return(
            <div key={app.id} className="mb-4 border rounded-xl shadow" style={{backgroundColor:softCard,borderColor:'#e0cdd7'}}>
              {/* row */}
              <button onClick={() => setExpanded(p => p === app.id ? null : app.id)} className="flex w-full text-left gap-2 p-4 hover:bg-[#f3e6ec]">
                <span className="flex-1 font-medium truncate whitespace-nowrap">{app.position}</span>
                <span className="flex-1 truncate whitespace-nowrap">{app.company}</span>
                <span className="flex-1 whitespace-nowrap text-right">{app.date || '—'}</span>
                <span className="flex-1 text-right whitespace-nowrap">{app.status}</span>
              </button>
              {/* details */}
              {isOpen&&<DetailsCard app={app} accent={accent} bullets={bulletList} onEdit={()=>startEdit(app)} onDelete={()=>del(app.id)}/>}
            </div>
          );
        })}
        {apps.length>0&&<button onClick={clearAll} style={{backgroundColor:bgDark}} className="mt-4 mx-auto block rounded px-6 py-2 text-[#f7f3f5]">Clear All</button>}
      </div>
    </div>
  );
}

// collapsible inner headings component
function DetailsCard({app,accent,bullets,onEdit,onDelete}){
  const [sections,setSections]=useState({req:true,opt:false,ben:false,desc:false,notes:false});
  const toggle=k=>setSections(s=>({...s,[k]:!s[k]}));
  const H=({k,label})=>(
    <button onClick={()=>toggle(k)} className="w-full text-left font-semibold" style={{color:accent}}>{label}<span className="float-right">{sections[k]?'-':'+'}</span></button>
  );
  return(
    <div className="border-t px-4 py-3 space-y-3 text-sm" style={{borderColor:'#e0cdd7'}}>
      <p><strong>Location:</strong> {app.location} | <strong>Agent:</strong> {app.agent}</p>
      <div>
        <H k="req" label="Requirements"/>
        {sections.req&&bullets(app.requirements)}
      </div>
      {app.optionalRequirements&&<div><H k="opt" label="Optional Requirements"/>{sections.opt&&bullets(app.optionalRequirements)}</div>}
      {app.benefits&&<div><H k="ben" label="Benefits"/>{sections.ben&&<p className="whitespace-pre-wrap mt-1">{app.benefits}</p>}</div>}
      {app.fullDescription&&<div><H k="desc" label="Full Description"/>{sections.desc&&<p className="whitespace-pre-wrap mt-1">{app.fullDescription}</p>}</div>}
      {app.notes&&<div><H k="notes" label="Notes"/>{sections.notes&&<p className="italic whitespace-pre-wrap mt-1">{app.notes}</p>}</div>}
      <div className="flex gap-2 pt-1">
        <button onClick={onEdit} className="flex-1 py-1 rounded" style={{backgroundColor:'#e3cada',color:'#321221'}}>Edit</button>
        <button onClick={onDelete} className="flex-1 py-1 rounded" style={{backgroundColor:accent,color:'#f7f3f5'}}>Delete</button>
      </div>
    </div>
  );
}
