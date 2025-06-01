/* eslint-disable react-hooks/exhaustive-deps */
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

/*---------- Firebase config ---------- */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};
/* (Replace every YOUR_* placeholder ↑ with real keys) */

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

/* ---------- CSV helpers ---------- */
const toCSV = (rows) => {
  const head = ['company', 'position', 'date', 'status', 'notes'];
  const escape = (v) => `${v}`.replaceAll('"', '""');
  return head.join(',') + '\n' +
    rows.map(r => head.map(h => `"${escape(r[h] ?? '')}"`).join(',')).join('\n');
};

const fromCSV = (text) => {
  const [headerLine, ...lines] = text.trim().split(/\\r?\\n/);
  const headers = headerLine.split(',');
  return lines.map(line => {
    const cols = line.match(/\\"(?:[^\"]|\\"\\")*\\"|[^,]+/g)
      .map(c => c.replace(/^\"|\"$/g, '').replace(/\\"\\\"/g, '"'));
    const obj  = {};
    headers.forEach((h, i) => (obj[h] = cols[i] || ''));
    obj.id = Date.now() + Math.random();
    return obj;
  });
};

export default function App() {
  const blank = { company: '', position: '', date: '', status: 'Applied', notes: '', id: null };

  const [apps,  setApps]  = useState([]);
  const [form,  setForm]  = useState(blank);
  const [edit,  setEdit]  = useState(false);
  const [user,  setUser]  = useState(null);
  const fileRef           = useRef();

  const LS_KEY = 'jobApplications';

  /* ---------- Auth ---------- */
  const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
  const doSignOut = () => signOut(auth);

  /* ---------- Cloud helpers ---------- */
  const saveCloud = (uid, data) => setDoc(doc(db, 'applications', uid), { items: data });
  const loadCloud = async (uid) => {
    const snap = await getDoc(doc(db, 'applications', uid));
    return snap.exists() ? snap.data().items : [];
  };

  /* ---------- Initial load ---------- */
  useEffect(() => {
    onAuthStateChanged(auth, async (u) => {
      setUser(u);
      const storedLocal = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      if (u) {
        const cloud = await loadCloud(u.uid);
        setApps(cloud.length ? cloud : storedLocal);
      } else {
        setApps(storedLocal);
      }
    });
  }, []);

  /* ---------- Persist ---------- */
  useEffect(() => {
    if (user) saveCloud(user.uid, apps);
    else      localStorage.setItem(LS_KEY, JSON.stringify(apps));
  }, [apps, user]);

  /* ---------- PWA ---------- */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(console.error);
    }
  }, []);

  /* ---------- Form handlers ---------- */
  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.company || !form.position) return;

    if (edit) {
      setApps(apps.map(a => (a.id === form.id ? form : a)));
      setEdit(false);
    } else {
      setApps([...apps, { ...form, id: Date.now() }]);
    }
    setForm(blank);
  };
  const handleEdit   = (app) => { setForm(app); setEdit(true); };
  const handleDelete = (id) => {
    setApps(apps.filter(a => a.id !== id));
    if (edit && id === form.id) { setForm(blank); setEdit(false); }
  };
  const handleClear  = () => {
    if (confirm('Clear all applications?')) {
      setApps([]);
      if (user) saveCloud(user.uid, []);
      localStorage.removeItem(LS_KEY);
    }
  };

  /* ---------- CSV ---------- */
  const exportCSV = () => {
    const csv  = toCSV(apps);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'applications.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  const importCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setApps(prev => [...prev, ...fromCSV(ev.target.result)]);
    reader.readAsText(file);
    e.target.value = null;
  };

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">
      {/* Header */}
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold">Job Application Tracker</h1>
        {user ? (
          <div className="flex items-center gap-2">
            <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full" />
            <button onClick={doSignOut} className="bg-gray-600 text-white px-3 py-1 rounded-xl text-sm">
              Sign out
            </button>
          </div>
        ) : (
          <button onClick={signIn} className="bg-blue-600 text-white px-4 py-2 rounded-xl">
            Sign in
          </button>
        )}
      </header>

      {/* Form */}
      <form onSubmit={handleSubmit} className="grid gap-3 bg-white shadow rounded-2xl p-4 max-w-2xl mx-auto">
        <input type="text" name="company" placeholder="Company"
          className="border p-2 rounded-xl" value={form.company} onChange={handleChange} required />
        <input type="text" name="position" placeholder="Position"
          className="border p-2 rounded-xl" value={form.position} onChange={handleChange} required />
        <input type="date" name="date"
          className="border p-2 rounded-xl" value={form.date} onChange={handleChange} />
        <select name="status" className="border p-2 rounded-xl" value={form.status} onChange={handleChange}>
          <option value="Applied">Applied</option>
          <option value="Interviewing">Interviewing</option>
          <option value="Offer">Offer</option>
          <option value="Rejected">Rejected</option>
        </select>
        <textarea name="notes" rows="3" placeholder="Notes"
          className="border p-2 rounded-xl" value={form.notes} onChange={handleChange} />
        <button type="submit" className="bg-blue-600 text-white rounded-xl py-2 hover:bg-blue-700 transition">
          {edit ? 'Update Application' : 'Add Application'}
        </button>
        {edit && (
          <button type="button" onClick={() => { setForm(blank); setEdit(false); }}
            className="bg-gray-400 text-white rounded-xl py-2 hover:bg-gray-500 transition">
            Cancel
          </button>
        )}
      </form>

      {/* CSV controls */}
      <div className="flex justify-center gap-4 mt-6">
        <button onClick={exportCSV}
          className="bg-green-600 text-white px-4 py-2 rounded-xl hover:bg-green-700 transition">
          Export CSV
        </button>
        <button onClick={() => fileRef.current.click()}
          className="bg-yellow-600 text-white px-4 py-2 rounded-xl hover:bg-yellow-700 transition">
          Import CSV
        </button>
        <input type="file" accept=".csv" ref={fileRef} onChange={importCSV} className="hidden" />
      </div>

      {/* List */}
      <div className="max-w-5xl mx-auto mt-8">
        {apps.length === 0 ? (
          <p className="text-center text-gray-500">No applications yet.</p>
        ) : (
          <div className="grid gap-4">
            {apps.map(app => (
              <div key={app.id}
                className="bg-white rounded-2xl shadow p-4 flex flex-col md:flex-row justify-between items-start md:items-center">
                <div>
                  <h2 className="text-xl font-semibold">{app.position} @ {app.company}</h2>
                  <p className="text-sm text-gray-500">
                    Applied: {app.date || '—'} | Status: {app.status}
                  </p>
                  {app.notes && <p className="mt-2 whitespace-pre-wrap">{app.notes}</p>}
                </div>
                <div className="flex gap-2 mt-3 md:mt-0">
                  <button onClick={() => handleEdit(app)}
                    className="bg-yellow-500 text-white rounded-xl px-4 py-2 hover:bg-yellow-600 transition">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(app.id)}
                    className="bg-red-600 text-white rounded-xl px-4 py-2 hover:bg-red-700 transition">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {apps.length > 0 && (
          <button onClick={handleClear}
            className="mt-6 bg-red-700 text-white rounded-xl px-6 py-2 block mx-auto hover:bg-red-800 transition">
            Clear All
          </button>
        )}
      </div>
    </div>
  );
}

