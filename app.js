import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc,
         addDoc, deleteDoc, collection, query, where, onSnapshot, arrayUnion, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ---------- Constants & helpers ---------- */
const MIN = 6e4;
const DAYS = ['Lun','Mar','Mie','Joi','Vin','Sâm','Dum'];
const DAYS_LONG = ['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
const MONTHS_LONG = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
const MONTHS = ['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'];
const COLOR = { a:'var(--a)', b:'var(--b)' };
const STATUS = { seen:['👀','A văzut'], leaving:['🚶','A plecat'], arrived:['✅','A ajuns'] };
const MIN_OPTS = [0,5,10,15,20,30,45,60,90];
const REPEAT = { daily:'Zilnic', weekdays:'În zilele lucrătoare', weekly:'Săptămânal', biweekly:'La 2 săptămâni', monthly:'Lunar', yearly:'Anual' };
const NUDGES = ['Nu uita! 💛','Ai tot ce-ți trebuie? 🎒','E timpul să pleci 🚶','Succes! 🍀'];
const EMOJI = [[/dentist|stomatolog/,'🦷'],[/doctor|medic|analize|clinic|psiholog|terapie/,'🩺'],[/sala|gym|antrenament|fitness|alergat/,'🏋️'],
  [/film|cinema/,'🎬'],[/cina|pranz|restaurant|masa/,'🍽️'],[/cafea/,'☕'],[/coafor|frizer|tuns|manichiura/,'💇'],[/yoga|meditatie/,'🧘'],
  [/banca|factura|plata|plateste/,'💳'],[/ziua|aniversare|petrecere/,'🎂'],[/zbor|aeroport|avion/,'✈️'],[/sedinta|meeting|call|interviu|munca/,'💼'],
  [/cumparaturi|magazin|mall|piata/,'🛒'],[/parinti|mama|tata|bunica/,'👪'],[/cadou/,'🎁'],[/plimbare|parc/,'🌳'],[/curatenie|spalat/,'🧹'],
  [/scoala|curs|examen|facultate/,'📚'],[/masina|service|itp/,'🚗'],[/pisica|caine|vet/,'🐾'],[/suna|telefon/,'📞'],[/medicament|pastil/,'💊']];
const DOW = { luni:1, marti:2, miercuri:3, joi:4, vineri:5, sambata:6, duminica:0 };

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay()+6)%7)); };
const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const minToHm = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const evStart = e => new Date(`${e.date}T${e.start}`);
const evEnd = e => new Date(`${e.date}T${e.end}`);
const byStart = (x,y) => evStart(x) - evStart(y);
const clamp = (v,a=0,b=1) => Math.max(a, Math.min(b, v));
const guessEmoji = t => (EMOJI.find(([r]) => r.test(norm(t))) || [])[1] || '📌';
const lsGet = (k,d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k,v) => { try { localStorage.setItem(k,v); } catch {} };
const dayLabel = d => `${DAYS[(d.getDay()+6)%7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
function relDay(dateIso){
  const n = new Date();
  if (dateIso === iso(n)) return 'azi';
  if (dateIso === iso(addDays(n,1))) return 'mâine';
  if (dateIso === iso(addDays(n,-1))) return 'ieri';
  return dayLabel(new Date(dateIso + 'T00:00'));
}
function fmtDur(ms){
  let m = Math.max(0, Math.round(ms / MIN));
  if (m < 1) return 'sub 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); m %= 60;
  if (h < 24) return `${h}h${m ? ` ${m}min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'zi' : 'zile'}${h % 24 ? ` ${h % 24}h` : ''}`;
}

/* ---------- Recurrence ---------- */
// A recurring event is stored once (repeat, until, exdates, statuses per date);
// its occurrences are computed for whatever dates are on screen.
const dkey = date => date.replaceAll('-', '');
function* repeatDates(e, toIso){
  const first = new Date(e.date + 'T00:00'), day = first.getDate();
  const last = e.until && e.until < toIso ? e.until : toIso;
  const step = { daily:1, weekdays:1, weekly:7, biweekly:14 }[e.repeat] || 1;
  for (let i = 0; i < 20000; i++){
    let d;
    if (e.repeat === 'monthly'){ d = new Date(first.getFullYear(), first.getMonth() + i, day); if (d.getDate() !== day) continue; }
    else if (e.repeat === 'yearly'){ d = new Date(first.getFullYear() + i, first.getMonth(), day); if (d.getDate() !== day) continue; }
    else d = addDays(first, i * step);
    const di = iso(d);
    if (di > last) return;
    if (e.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
    yield di;
  }
}
const occurrence = (e, date) => ({ ...e, date, status:e.statuses?.[dkey(date)] ?? null, series:e });
function expand(list, fromIso, toIso){
  const out = [];
  for (const e of list){
    if (!e.repeat){ if (e.date >= fromIso && e.date <= toIso) out.push(e); continue; }
    for (const d of repeatDates(e, toIso)) if (d >= fromIso && !(e.exdates || []).includes(d)) out.push(occurrence(e, d));
  }
  return out.sort(byStart);
}

/* ---------- Firebase ---------- */
const main = $('#main');
if (String(firebaseConfig.apiKey).startsWith('PASTE')){
  main.innerHTML = `<div class="hero"><div class="logo">🛠️</div><h1>Aproape gata</h1>
    <p>Aplicația nu e încă legată de Firebase. Completează <code>firebase-config.js</code> după pașii din <code>README.md</code>.</p></div>`;
  throw new Error('firebase-config.js not filled in');
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = getFirestore(app); }

/* ---------- State ---------- */
const st = { user:null, sid:null, space:null, mine:[], shared:[], nudgesIn:[], nudgesOut:[], inbox:[], birthdays:[], view:lsGet('cal.view','now'), unsub:[], loaded:{}, denied:new Set() };
let weekStart = mondayOf(new Date());
// The "Calendar" tab shows a month grid, a week strip or a day timeline, all around one selected day.
let calView = lsGet('cal.calview', 'week');
let selDate = iso(new Date());
const sel = () => new Date(selDate + 'T00:00');
const me = () => st.user.uid;
const partner = () => st.space?.members.find(u => u !== me()) || null;
const keyOf = uid => st.space?.members.indexOf(uid) === 1 ? 'b' : 'a';
const nm = uid => (uid && st.space?.names?.[uid]) || 'Partenerul';
const events = () => { const m = new Map(); for (const e of [...st.mine, ...st.shared]) m.set(e.id, e); return [...m.values()]; };
const col = (...p) => collection(db, 'spaces', st.sid, ...p);
const inviteLink = () => `${location.origin}${location.pathname}?join=${st.sid}`;
const fail = err => { console.error(err); toast({ html:`⚠️ ${esc(err.message || err)}` }); };

/* ---------- Auth & onboarding ---------- */
onAuthStateChanged(auth, async user => {
  stopListeners();
  st.user = user; st.sid = null; st.space = null;
  $('#header').hidden = true;
  if (!user) return showLogin();
  try {
    const joinId = new URLSearchParams(location.search).get('join');
    const prof = (await getDoc(doc(db, 'users', user.uid))).data();
    if (joinId && prof?.spaceId !== joinId) return showJoin(joinId, prof);
    if (joinId) history.replaceState(null, '', location.pathname);
    if (!prof?.spaceId) return showOnboarding();
    enterSpace(prof.spaceId);
  } catch (err) { fail(err); }
});

function showLogin(){
  main.innerHTML = `<div class="hero"><div class="logo">📅</div><h1>Calendar Comun</h1>
    <p class="meta">Un calendar pentru doi. Tu alegi ce partajezi.</p>
    <button class="btn primary big" id="loginBtn">Intră cu Google</button></div>`;
  $('#loginBtn').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')
      return signInWithRedirect(auth, new GoogleAuthProvider());
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') fail(err);
  });
}

const firstName = () => (st.user.displayName || '').split(' ')[0];

function showOnboarding(){
  main.innerHTML = `<div class="hero"><div class="logo">👋</div><h1>Bun venit!</h1>
    <label class="meta" style="display:grid;gap:6px;text-align:left">Cum vrei să apari în calendar?
      <input id="name" value="${esc(firstName())}" maxlength="30"></label>
    <button class="btn primary big" id="createBtn">Creează calendarul nostru</button>
    <p class="meta">Ai primit un link de invitație? Deschide-l pe acest telefon și te alături direct.</p>
    <button class="btn" id="outBtn">Ieși din cont</button></div>`;
  $('#outBtn').onclick = () => signOut(auth);
  $('#createBtn').onclick = async () => {
    const name = $('#name').value.trim() || firstName() || 'Eu';
    $('#createBtn').disabled = true;
    try {
      const ref = doc(collection(db, 'spaces'));
      await setDoc(ref, { members:[me()], names:{ [me()]:name }, createdAt:serverTimestamp() });
      await setDoc(doc(db, 'users', me()), { spaceId:ref.id });
      enterSpace(ref.id);
    } catch (err) { $('#createBtn').disabled = false; fail(err); }
  };
}

async function showJoin(sid, prof){
  let space;
  try { space = (await getDoc(doc(db, 'spaces', sid))).data(); } catch (err) { return fail(err); }
  const clearUrl = () => history.replaceState(null, '', location.pathname);
  if (!space){
    main.innerHTML = `<div class="hero"><div class="logo">🤔</div><h1>Link invalid</h1><p class="meta">Cere un link nou.</p><button class="btn" id="okBtn">Continuă</button></div>`;
    $('#okBtn').onclick = () => { clearUrl(); location.reload(); };
    return;
  }
  if (space.members.includes(me())){
    await setDoc(doc(db, 'users', me()), { spaceId:sid });
    clearUrl(); return enterSpace(sid);
  }
  if (space.members.length >= 2){
    main.innerHTML = `<div class="hero"><div class="logo">🔒</div><h1>Calendarul e complet</h1><p class="meta">Are deja doi membri.</p><button class="btn" id="okBtn">Continuă</button></div>`;
    $('#okBtn').onclick = () => { clearUrl(); location.reload(); };
    return;
  }
  const inviter = space.names?.[space.members[0]] || 'Partenerul tău';
  main.innerHTML = `<div class="hero"><div class="logo">💌</div><h1>${esc(inviter)} te invită</h1>
    <p class="meta">În calendarul comun vedeți fiecare evenimentele partajate ale celuilalt.</p>
    ${prof?.spaceId ? '<div class="warn">Ești deja într-un alt calendar. Dacă te alături, îl părăsești pe acela.</div>' : ''}
    <label class="meta" style="display:grid;gap:6px;text-align:left">Cum vrei să apari?
      <input id="name" value="${esc(firstName())}" maxlength="30"></label>
    <button class="btn primary big" id="joinBtn">Mă alătur</button>
    <button class="btn" id="outBtn">Nu acum</button></div>`;
  $('#outBtn').onclick = () => { clearUrl(); location.reload(); };
  $('#joinBtn').onclick = async () => {
    const name = $('#name').value.trim() || firstName() || 'Eu';
    $('#joinBtn').disabled = true;
    try {
      await updateDoc(doc(db, 'spaces', sid), { members:arrayUnion(me()), [`names.${me()}`]:name });
      await setDoc(doc(db, 'users', me()), { spaceId:sid });
      clearUrl(); enterSpace(sid);
    } catch (err) { $('#joinBtn').disabled = false; fail(err); }
  };
}

/* ---------- Live data ---------- */
function stopListeners(){ st.unsub.forEach(u => u()); st.unsub = []; }
// A failed listener (e.g. permission denied before the Firestore rules were published) would otherwise
// stay dead until a full reload; retry with backoff, and right away when the app comes back to the front.
const retries = new Set();
const listen = (ref, fn, key) => {
  let unsub = null, tries = 0;
  const stop = () => { unsub?.(); retries.delete(start); };
  const start = () => {
    retries.delete(start);
    unsub = onSnapshot(ref, snap => { tries = 0; if (key) st.denied.delete(key); fn(snap); }, err => {
      if (tries++ === 0) fail(err);
      if (key){ st.denied.add(key); scheduleRender(); }
      if (!st.unsub.includes(stop)) return;
      retries.add(start);
      setTimeout(() => { if (retries.has(start)) start(); }, Math.min(60e3, 5e3 * tries));
    });
  };
  st.unsub.push(stop); start();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) [...retries].forEach(f => f()); });
const docs = s => s.docs.map(d => ({ id:d.id, ...d.data() }));
const shownNudges = new Set();

function enterSpace(sid){
  st.sid = sid; st.loaded = {};
  $('#header').hidden = false;
  main.innerHTML = '<div class="center meta">Se încarcă…</div>';
  const uid = me();
  listen(doc(db, 'spaces', sid), s => { st.space = s.data(); scheduleRender(); });
  listen(query(col('events'), where('owner', '==', uid)), s => { st.mine = docs(s); st.loaded.mine = true; announceNudges(); scheduleRender(); });
  listen(query(col('events'), where('shared', '==', true)), s => { st.shared = docs(s); st.loaded.shared = true; announceNudges(); scheduleRender(); });
  listen(query(col('nudges'), where('to', '==', uid)), s => { st.nudgesIn = docs(s); announceNudges(); scheduleRender(); });
  listen(query(col('nudges'), where('from', '==', uid)), s => { st.nudgesOut = docs(s); scheduleRender(); });
  listen(query(col('inbox'), where('owner', '==', uid)), s => { st.inbox = docs(s); scheduleRender(); });
  listen(col('birthdays'), s => { st.birthdays = docs(s); scheduleRender(); }, 'birthdays');
}

// A nudge is shown once: closing it (× or 👍) marks it read for good.
// Nudges about an event that was deleted or has already ended are marked read silently.
function announceNudges(){
  if (!st.loaded.mine || !st.loaded.shared) return;
  const now = new Date();
  for (const x of st.nudgesIn){
    if (x.read || shownNudges.has(x.id)) continue;
    shownNudges.add(x.id);
    const e = events().find(e => e.id === x.eventId);
    if (!e || evEnd({ ...e, date:x.date || e.date }) < now){ markRead(x); continue; }
    const about = `despre ${e.emoji || ''} ${e.title}`;
    toast({ id:'n' + x.id, sticky:true, kind:'nud', html:`💌 <b>${esc(nm(x.from))}</b>: ${esc(x.text)}`, sub:esc(about),
            actions:[['👍 Mulțumesc', () => markRead(x)]], onClose:() => markRead(x) });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
      navigator.serviceWorker?.ready.then(r => r.showNotification(`💌 ${nm(x.from)}`, { body:`${x.text}${about ? '\n' + about : ''}`, icon:'icons/icon-192.png', tag:x.id }));
  }
}

/* ---------- Writes ---------- */
const saveEvent = (data, id) => (id
  ? updateDoc(doc(col('events'), id), { ...data, updatedAt:serverTimestamp() })
  : addDoc(col('events'), { ...data, owner:me(), status:null, createdAt:serverTimestamp(), updatedAt:serverTimestamp() })).catch(fail);
const setStatus = (e, s) => {
  const next = e.status === s ? null : s;
  updateDoc(doc(col('events'), e.id), e.repeat ? { [`statuses.${dkey(e.date)}`]:next } : { status:next }).catch(fail);
};
const markRead = x => { document.querySelector(`[data-tid="n${x.id}"]`)?.remove(); updateDoc(doc(col('nudges'), x.id), { read:true }).catch(fail); };
const sendNudge = (e, text) => addDoc(col('nudges'), { from:me(), to:e.owner, eventId:e.id, date:e.date, text, at:serverTimestamp(), read:false }).catch(fail);
const addInbox = text => addDoc(col('inbox'), { owner:me(), text, at:serverTimestamp() }).catch(fail);
const delInbox = id => deleteDoc(doc(col('inbox'), id)).catch(fail);

/* ---------- Quick capture parser ---------- */
function parseQuick(text){
  const toks = text.trim().split(/\s+/).filter(Boolean), keep = [], base = new Date();
  let date = null, sh = null, sm = 0, eh = null, em = 0, dur = 60, shared = true, repeat = null;
  for (let i = 0; i < toks.length; i++){
    const raw = toks[i], t = norm(raw).replace(/[,;!?]+$/,''), prev = norm(toks[i-1] || '');
    let m;
    if (t === 'azi' || t === 'astazi') date = iso(base);
    else if (t === 'maine') date = iso(addDays(base,1));
    else if (t === 'poimaine') date = iso(addDays(base,2));
    else if (t in DOW) date = iso(addDays(base, (DOW[t] - base.getDay() + 7) % 7));
    else if ((m = t.match(/^(\d{1,2})[./](\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12){
      const d = new Date(base.getFullYear(), +m[2]-1, +m[1]);
      if (d < new Date(base.getFullYear(), base.getMonth(), base.getDate())) d.setFullYear(d.getFullYear()+1);
      date = iso(d);
    }
    else if (sh === null && (m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(?:-(\d{1,2})(?:[:.](\d{2}))?)?$/)) && +m[1] < 24
             && (m[2] || m[3] || /^(la|ora|de)$/.test(prev) || +m[1] >= 7)){
      sh = +m[1]; sm = +(m[2] || 0);
      if (m[3]){ eh = +m[3]; em = +(m[4] || 0); }
    }
    else if ((m = t.match(/^(\d+(?:[.,]\d+)?)(h|ore|ora|min|m)$/))){
      const v = parseFloat(m[1].replace(',','.')); dur = /^(h|or)/.test(m[2]) ? v*60 : v;
    }
    else if (t === 'privat') shared = false;
    else if ((m = { zilnic:'daily', saptamanal:'weekly', lunar:'monthly', anual:'yearly' }[t])) repeat = m;
    else if (t === 'fiecare' && toks[i+1]){
      const nx = norm(toks[i+1]).replace(/[,;!?]+$/,'');
      if (nx === 'zi') repeat = 'daily';
      else if (nx in DOW){ repeat = 'weekly'; date = iso(addDays(base, (DOW[nx] - base.getDay() + 7) % 7)); }
      else if (nx === 'saptamana') repeat = 'weekly';
      else if (nx === 'luna') repeat = 'monthly';
      else { keep.push(raw); continue; }
      i++;
    }
    else { keep.push(raw); continue; }
    if (keep.length && /^(la|ora|pe|de|in|din|pentru)$/.test(norm(keep[keep.length-1]))) keep.pop();
  }
  let title = keep.join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (repeat && !date && sh === null) date = iso(base);
  if (sh !== null && !date){
    const c = new Date(base); c.setHours(sh, sm, 0, 0);
    date = iso(c < base ? addDays(c,1) : c);
  }
  let start = null, end = null;
  if (sh !== null){
    start = minToHm(sh*60 + sm);
    end = minToHm(eh !== null ? eh*60 + em : Math.min(sh*60 + sm + dur, 23*60 + 59));
  }
  return { p:{ title, emoji:guessEmoji(title), date, start, end, shared, repeat }, complete:!!(title && date && start), empty:!date && sh === null };
}

/* ---------- Rendering ---------- */
let renderQueued = false;
function scheduleRender(){
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 16);
}
const typing = () => main.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
// Updates that arrive while you type are held back and applied once you leave the form. Never re-render
// when focus just moves to another control in main (e.g. the "Adaugă" button on mousedown): replacing the
// button between mousedown and mouseup swallows the click on desktop.
let renderPending = false;
main.addEventListener('focusout', ev => {
  if (!renderPending || main.contains(ev.relatedTarget)) return;
  setTimeout(() => { if (!typing()){ renderPending = false; scheduleRender(); } }, 0);
});

function render(){
  if (!st.sid) return;
  if (!st.space){ main.innerHTML = '<div class="center meta">Se încarcă…</div>'; return; }
  renderHeader();
  if (typing()){ renderPending = true; return; }
  renderPending = false;
  ({ now:renderNow, week:renderCalendar, agenda:renderAgenda, inbox:renderInbox, bday:renderBirthdays }[st.view] || renderNow)();
}

function renderHeader(){
  $('#meChip').innerHTML = `<span class="dot" style="background:${COLOR[keyOf(me())]}"></span>${esc(nm(me()))}`
    + (partner() ? ` &amp; <span class="dot" style="background:${COLOR[keyOf(partner())]}"></span>${esc(nm(partner()))}` : '');
  const nudN = st.nudgesIn.filter(x => !x.read).length;
  const tabs = [['now','⏱ Acum',nudN],['week','🗓 Calendar'],['agenda','📋 Agendă'],['inbox','📥 Inbox',st.inbox.length],['bday','🎂 Zile de naștere']];
  $('#tabs').innerHTML = tabs.map(([k,l,c]) =>
    `<button data-act="tab" data-arg="${k}" class="${st.view === k ? 'on' : ''}">${l}${c ? ` <span class="count">${c}</span>` : ''}</button>`).join('');
}

function toolbar(){
  const cal = st.view === 'week', p = partner(), s = sel();
  const span = (a, b) => `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  const range = !cal ? span(weekStart, addDays(weekStart, 6))
    : calView === 'month' ? `${MONTHS_LONG[s.getMonth()]} ${s.getFullYear()}`
    : calView === 'week' ? span(mondayOf(s), addDays(mondayOf(s), 6))
    : `${DAYS_LONG[(s.getDay()+6)%7]}, ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  return `<div class="toolbar">
    <button class="btn" data-act="wk" data-arg="-1" aria-label="Înapoi">‹</button>
    <button class="btn" data-act="wk" data-arg="0">Azi</button>
    <button class="btn" data-act="wk" data-arg="1" aria-label="Înainte">›</button>
    <span class="range">${range}</span>
    <span class="spacer"></span>
    ${cal ? `<div class="seg">${[['month','Lună'],['week','Săptămână'],['day','Zi']].map(([k,l]) =>
      `<button data-act="calview" data-arg="${k}" class="${calView === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <span class="legend">
      <span><i class="sw" style="background:${COLOR[keyOf(me())]}"></i>${esc(nm(me()))}</span>
      ${p ? `<span><i class="sw" style="background:${COLOR[keyOf(p)]}"></i>${esc(nm(p))}</span>` : ''}
      <span><i class="sw hatch"></i>Privat</span>
    </span></div>`;
}

const inviteCard = () => `<section class="card"><h2>💌 Invită-ți partenerul</h2>
  <div class="meta" style="margin-bottom:8px">Trimite-i linkul. Îl deschide pe telefon, intră cu Google și vă vedeți evenimentele partajate.</div>
  <div class="copy"><input readonly value="${esc(inviteLink())}" class="grow" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--bg)">
  <button class="btn primary" data-act="share">Trimite</button></div></section>`;

/* ----- Now ----- */
function renderNow(){
  const n = new Date(), today = iso(n), p = partner();
  const greet = n.getHours() < 12 ? '☀️ Bună dimineața' : n.getHours() < 18 ? '🌤 Bună ziua' : '🌙 Bună seara';
  const all = events();
  const todayAll = expand(all, today, today);
  const mineToday = todayAll.filter(e => e.owner === me());
  let h = `<div class="stack"><section class="card"><div class="greet">${greet}, ${esc(nm(me()))}</div>
    <div class="meta">Azi ai ${mineToday.length} ${mineToday.length === 1 ? 'lucru' : 'lucruri'}${p ? ` · ${esc(nm(p))} are ${todayAll.length - mineToday.length} partajate` : ''}.</div></section>`;
  if (!p) h += inviteCard();
  const bdToday = birthdaysIn(today, today), bdSoon = birthdaysIn(iso(addDays(n, 1)), iso(addDays(n, 7)));
  if (bdToday.length) h += `<section class="card ants bdcard" data-act="tab" data-arg="bday">${bdToday.map(x =>
    `<div class="bdbig">🎂 Azi: ${bdLine(x)}! 🎉</div>`).join('')}</section>`;
  if (bdSoon.length) h += `<div class="after" data-act="tab" data-arg="bday" style="cursor:pointer">🎂 În curând: ${bdSoon.map(x =>
    `${esc(x.b.name)} ${relDay(x.date)}${daysUntil(x.date) > 1 ? ` (peste ${deTxt(daysUntil(x.date), 'zile')})` : ''}`).join(' · ')}</div>`;

  const nud = st.nudgesIn.filter(x => !x.read);
  if (nud.length) h += `<section class="card"><h2>💌 De la ${esc(nm(p))}</h2>${nud.map(x => {
      const e = all.find(e => e.id === x.eventId);
      return `<div class="nudge"><div><b>${esc(x.text)}</b><div class="meta">${e ? `despre ${e.emoji || ''} ${esc(e.title)}` : ''}</div></div>
              <button class="chip" data-act="nudgeRead" data-arg="${x.id}">👍 Mulțumesc</button></div>`;
    }).join('')}</section>`;

  const upcoming = expand(st.mine, today, iso(addDays(n, 400))).filter(e => evEnd(e) > n);
  if (upcoming[0]){
    h += nextCard(upcoming[0], n);
    if (upcoming[1]) h += `<div class="after">Apoi: ${upcoming[1].emoji || ''} ${esc(upcoming[1].title)} · ${relDay(upcoming[1].date)} la ${upcoming[1].start}</div>`;
  } else h += `<section class="card"><div class="big-msg">🌿 Nimic programat. Respiră.</div></section>`;

  const item = e => `<div class="item ${evEnd(e) <= n ? 'past' : ''}" data-act="open" data-id="${e.id}" data-date="${e.date}">
      <span class="em">${e.emoji || '📌'}</span><span class="bar" style="background:${COLOR[keyOf(e.owner)]}"></span>
      <div class="grow"><div>${esc(e.title)}${e.shared ? '' : ' 🔒'}</div>
      <div class="meta">${e.start}–${e.end}${e.owner !== me() ? ' · ' + esc(nm(e.owner)) : ''}${e.status ? ' · ' + STATUS[e.status].join(' ') : ''}</div></div></div>`;
  h += `<section class="card today-list"><h2>📍 Azi</h2>${todayAll.length ? todayAll.map(item).join('') : '<div class="meta">Zi liberă. 🌿</div>'}</section>`;
  main.innerHTML = h + '</div>';
}

function nextCard(e, n){
  const st0 = evStart(e), en = evEnd(e), inProg = st0 <= n;
  const prepAt = new Date(st0 - ((e.prep || 0) + (e.travel || 0)) * MIN), leaveAt = new Date(st0 - (e.travel || 0) * MIN);
  const steps = [];
  if (e.prep) steps.push(['🧴','Pregătire',prepAt]);
  if (e.travel) steps.push(['🚶','Plecare',leaveAt]);
  steps.push([e.emoji || '📌','Început',st0], ['🏁','Final',en]);
  const cur = steps.findIndex(s => s[2] > n) - 1;
  let big, sub, frac, low = false;
  if (inProg){ big = 'acum'; sub = `Mai sunt ${fmtDur(en - n)} până la final`; frac = (en - n) / (en - st0); }
  else {
    big = `în ${fmtDur(st0 - n)}`;
    if (e.travel && leaveAt <= n){ sub = '🚶 E timpul să pleci!'; low = true; }
    else if (e.prep && prepAt <= n){ sub = `🧴 Pregătește-te. ${e.travel ? `Pleci în ${fmtDur(leaveAt - n)} (la ${fmtTime(leaveAt)})` : `Începe la ${e.start}`}`; low = true; }
    else if (e.prep || e.travel) sub = `${e.prep ? '🧴 Pregătirea' : '🚶 Plecarea'} începe în ${fmtDur(prepAt - n)}, la <b>${fmtTime(prepAt)}</b>`;
    else sub = `${relDay(e.date)}, la ${e.start}`;
    frac = clamp((((e.prep || e.travel) ? prepAt : st0) - n) / (3 * 3600e3));
    low = low || frac < .15;
  }
  const p = partner();
  return `<section class="card next">
    <div class="meta">Următorul</div>
    <div class="title">${e.emoji || '📌'} ${esc(e.title)}${e.shared ? '' : ' <span class="tag">🔒 privat</span>'}</div>
    <div class="countdown">${big}</div>
    <div class="sub">${sub}</div>
    <div class="meter ${low ? 'low' : ''}"><i style="width:${Math.round(frac * 100)}%"></i></div>
    <div class="steps">${steps.map(([ic,l,at],i) =>
      `<span class="step ${at <= n && i !== cur ? 'past' : ''} ${i === cur ? 'cur' : ''}">${ic} ${l} ${fmtTime(at)}</span>`).join('')}</div>
    ${e.note ? `<div class="meta" style="margin-bottom:10px">📝 ${esc(e.note)}</div>` : ''}
    <div class="chips">
      ${Object.entries(STATUS).map(([k,[ic]]) => `<button class="chip ${e.status === k ? 'on' : ''}" data-act="status" data-id="${e.id}" data-date="${e.date}" data-arg="${k}">${ic} ${({seen:'Am văzut',leaving:'Plec acum',arrived:'Am ajuns'})[k]}</button>`).join('')}
      <button class="chip" data-act="open" data-id="${e.id}" data-date="${e.date}">✏️ Detalii</button>
    </div>
    ${e.shared && p ? `<div class="meta" style="margin-top:8px">${esc(nm(p))} vede statusul tău${e.allowNudge ? ' și îți poate trimite mementouri' : ''}.</div>` : ''}
  </section>`;
}

/* ----- Week ----- */
/* ----- Birthdays ----- */
// Stored once as month-day (md: "MM-DD") with an optional birth year; shown every year.
// Romanian: 20+ (and round hundreds) take "de": 19 ani, 20 de ani.
const deTxt = (n, w) => (n % 100 >= 1 && n % 100 <= 19) ? `${n} ${w}` : `${n} de ${w}`;
const ageTxt = n => n === 1 ? '1 an' : deTxt(n, 'ani');
const bdDate = (b, y) => `${y}-${b.md === '02-29' && new Date(y, 1, 29).getMonth() !== 1 ? '02-28' : b.md}`;
function birthdaysIn(fromIso, toIso){
  const out = [];
  for (let y = +fromIso.slice(0, 4); y <= +toIso.slice(0, 4); y++)
    for (const b of st.birthdays){
      const date = bdDate(b, y);
      if (date >= fromIso && date <= toIso) out.push({ b, date, age:b.year ? y - b.year : null });
    }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.b.name.localeCompare(y.b.name));
}
// Next occurrence on or after today.
const nextBirthday = b => { const t = iso(new Date()), y = new Date().getFullYear(); const d = bdDate(b, y); return d >= t ? d : bdDate(b, y + 1); };
const daysUntil = date => Math.round((new Date(date + 'T00:00') - new Date(iso(new Date()) + 'T00:00')) / 864e5);
const bdLine = x => `${esc(x.b.name)}${x.age ? ` împlinește ${ageTxt(x.age)}` : ''}`;
const bdChip = x => `<span class="cchip bday"><span class="ce">🎂</span><span class="ct">${esc(x.b.name)}</span></span>`;
const bdRows = list => list.map(x => `<div class="row bdrow ants" data-act="tab" data-arg="bday">
    <span class="time">🎂</span><span class="grow"><b>Zi de naștere: ${bdLine(x)}</b><div class="meta">toată ziua</div></span></div>`).join('');

/* ----- Calendar: month / week / day ----- */
const evTags = e => `${e.repeat ? `<span class="tag">🔁 ${REPEAT[e.repeat]}</span>` : ''}${e.shared ? '' : '<span class="tag">🔒 privat</span>'}${e.status ? `<span class="tag">${STATUS[e.status].join(' ')}</span>` : ''}`;
const unread = e => st.nudgesIn.some(x => x.eventId === e.id && (!x.date || x.date === e.date) && !x.read) ? ' 💌' : '';
const byDate = list => { const m = {}; for (const e of list) (m[e.date] ||= []).push(e); return m; };
const cchip = e => `<span class="cchip ${keyOf(e.owner)}${e.shared ? '' : ' private'}"><span class="ce">${e.emoji || '📌'}</span><span class="ct">${e.start} ${esc(e.title)}</span></span>`;

function dayCell(d, map, bmap, cls = ''){
  const di = iso(d), bd = bmap[di] || [], chips = [...bd.map(bdChip), ...(map[di] || []).map(cchip)], max = 3;
  return `<button class="dcell ${cls}${di === iso(new Date()) ? ' today' : ''}${di === selDate ? ' sel' : ''}${bd.length ? ' ants' : ''}" data-act="pick" data-arg="${di}">
    <span class="dnum">${d.getDate()}</span>
    <span class="cchips">${chips.slice(0, max).join('')}${chips.length > max ? `<span class="more">+${chips.length - max}</span>` : ''}</span></button>`;
}

const dayCards = (list, bd = []) => list.length || bd.length ? `<div class="dlist">${bdRows(bd)}${list.map(e => {
  const lv = e.travel ? ` · pleacă la ${minToHm(Math.max(0, toMin(e.start) - e.travel))}` : '';
  return `<div class="row" data-act="open" data-id="${e.id}" data-date="${e.date}">
    <span class="bar" style="background:${COLOR[keyOf(e.owner)]}"></span><span class="time">${e.start}<span class="meta"> – ${e.end}</span></span>
    <span class="grow"><b>${e.emoji || ''} ${esc(e.title)}${unread(e)}</b>${evTags(e)}
    <div class="meta">${e.owner === me() ? 'Al meu' : esc(nm(e.owner))}${lv}${e.note ? ' · ' + esc(e.note) : ''}</div></span></div>`;
}).join('')}</div>` : '<div class="empty-day">🌿 Nimic planificat</div>';

// The day as a timeline of blocks with the free time between them, instead of an hour grid.
// Your own events start at their prep/leave time, since that's when the time is really taken.
function dayTimeline(list, bd = []){
  const n = new Date(), today = iso(n), nowM = n.getHours()*60 + n.getMinutes();
  const banner = bd.length ? `<div class="dlist">${bdRows(bd)}</div>` : '';
  const items = list.map(e => ({ e, from:toMin(e.start) - (e.owner === me() ? (e.prep || 0) + (e.travel || 0) : 0), to:toMin(e.end) }));
  const live = selDate === today && items.find(i => toMin(i.e.start) <= nowM && nowM < i.to);
  if (selDate === today && !live) items.push({ now:true, from:nowM, to:nowM });
  if (!items.length) return banner + (bd.length ? '' : '<div class="empty-day">🌿 Zi liberă</div>');
  items.sort((a,b) => a.from - b.from || (a.now ? -1 : 1));
  let h = banner + '<div class="tl">', cursor = null;
  for (const it of items){
    if (cursor !== null && it.from - cursor >= 15) h += `<div class="tl-gap">liber ${fmtDur((it.from - cursor) * MIN)}</div>`;
    else if (cursor !== null && it.from < cursor && !it.now) h += '<div class="tl-warn">⏰ Prea strâns: se suprapune cu cel de dinainte</div>';
    if (it.now) h += `<div class="tl-now">acum · ${fmtTime(n)}</div>`;
    else {
      const e = it.e, st0 = toMin(e.start), mine = e.owner === me(), steps = [];
      if (mine && e.prep) steps.push(`🧴 ${minToHm(Math.max(0, it.from))}`);
      if (mine && e.travel) steps.push(`🚶 ${minToHm(Math.max(0, st0 - e.travel))}`);
      const past = selDate < today || (selDate === today && it.to <= nowM);
      h += `<div class="tl-ev ${keyOf(e.owner)}${live === it ? ' live' : ''}${past ? ' past' : ''}" data-act="open" data-id="${e.id}" data-date="${e.date}">
        <div class="tl-time">${e.start}<span>${e.end}</span></div>
        <div class="tl-card"><b>${e.emoji || '📌'} ${esc(e.title)}${unread(e)}</b>${evTags(e)}
          <div class="meta">${mine ? '' : esc(nm(e.owner)) + ' · '}${fmtDur((it.to - st0) * MIN)}${steps.length ? ' · ' + steps.join(' · ') : ''}${live === it ? ' · <b>acum</b>' : ''}</div></div></div>`;
    }
    cursor = Math.max(cursor ?? -1, it.to);
  }
  return h + '</div>';
}

function renderCalendar(){
  const s = sel(), all = events(), head = DAYS.map(d => `<div class="wd">${d}</div>`).join('');
  let top = '';
  if (calView === 'month'){
    const start = mondayOf(new Date(s.getFullYear(), s.getMonth(), 1));
    const end = addDays(mondayOf(new Date(s.getFullYear(), s.getMonth() + 1, 0)), 6);
    const days = Math.round((end - start) / 864e5) + 1, map = byDate(expand(all, iso(start), iso(end)));
    const bmap = byDate(birthdaysIn(iso(start), iso(end)));
    top = `<div class="mgrid">${head}${[...Array(days)].map((_,i) => {
      const d = addDays(start, i); return dayCell(d, map, bmap, d.getMonth() === s.getMonth() ? '' : 'out');
    }).join('')}</div>`;
  } else if (calView === 'week'){
    const start = mondayOf(s), map = byDate(expand(all, iso(start), iso(addDays(start, 6))));
    const bmap = byDate(birthdaysIn(iso(start), iso(addDays(start, 6))));
    top = `<div class="wstrip">${head}${[...Array(7)].map((_,i) => dayCell(addDays(start, i), map, bmap)).join('')}</div>`;
  }
  const list = expand(all, selDate, selDate), bd = birthdaysIn(selDate, selDate), rel = relDay(selDate);
  main.innerHTML = toolbar() + `<div class="cal">${top}
    ${calView !== 'day' ? `<div class="dayhead"><b>${s.getDate()}</b> ${DAYS_LONG[(s.getDay()+6)%7]}${['azi','mâine','ieri'].includes(rel) ? ` · ${rel}` : ''}</div>` : ''}
    ${calView === 'day' ? dayTimeline(list, bd) : dayCards(list, bd)}</div>
    <button class="addpill" data-act="addOn">＋ Adaugă pe ${dayLabel(s)}</button>`;
}

/* ----- Agenda ----- */
function renderAgenda(){
  const todayIso = iso(new Date()), all = expand(events(), iso(weekStart), iso(addDays(weekStart, 6)));
  let h = toolbar() + '<div class="stack">';
  for (let i = 0; i < 7; i++){
    const d = addDays(weekStart,i), di = iso(d);
    const list = all.filter(e => e.date === di).sort(byStart), bd = birthdaysIn(di, di);
    h += `<div class="day ${di === todayIso ? 'today' : ''}"><h3>${DAYS_LONG[i]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</h3>${bdRows(bd)}`;
    h += list.length ? list.map(e => {
      const lv = e.travel ? ` · pleacă la ${minToHm(Math.max(0, toMin(e.start) - e.travel))}` : '';
      return `<div class="row" data-act="open" data-id="${e.id}" data-date="${e.date}">
        <span class="bar" style="background:${COLOR[keyOf(e.owner)]}"></span><span class="time">${e.start} – ${e.end}</span>
        <span class="grow"><b>${e.emoji || ''} ${esc(e.title)}</b>${e.repeat ? `<span class="tag">🔁 ${REPEAT[e.repeat]}</span>` : ''}${e.shared ? '' : '<span class="tag">🔒 privat</span>'}${e.status ? `<span class="tag">${STATUS[e.status].join(' ')}</span>` : ''}
        <div class="meta">${e.owner === me() ? 'Al meu' : esc(nm(e.owner))}${lv}${e.note ? ' · ' + esc(e.note) : ''}</div></span></div>`;
    }).join('') : bd.length ? '' : '<div class="empty">Nimic planificat</div>';
    h += '</div>';
  }
  main.innerHTML = h + '</div>';
}

/* ----- Birthdays tab ----- */
let bdEditing = null;
const bdLabel = b => `${+b.md.slice(3)} ${MONTHS_LONG[+b.md.slice(0, 2) - 1].toLowerCase()}${b.year ? ` ${b.year}` : ''}`;
const bdInputs = (b = {}) => `<input name="name" maxlength="60" placeholder="Nume" value="${esc(b.name || '')}" aria-label="Nume">
  <input type="date" name="date" value="${b.md ? `${b.year || 2000}-${b.md}` : ''}" aria-label="Data nașterii">
  <label class="noyear"><input type="checkbox" name="noyear" ${b.md && !b.year ? 'checked' : ''}> fără an</label>`;
// Reads one add/edit row; returns null (and says why) if it isn't valid.
function bdRead(form){
  const name = form.elements.name.value.trim(), date = form.elements.date.value;
  if (!name || !date){ toast({ html:'Completează numele și data.' }); return null; }
  return { name, md:date.slice(5), year:form.elements.noyear.checked ? null : +date.slice(0, 4) };
}

function renderBirthdays(){
  const list = [...st.birthdays].sort((a, b) => nextBirthday(a).localeCompare(nextBirthday(b)) || a.name.localeCompare(b.name));
  const row = b => {
    if (bdEditing === b.id) return `<tr><td colspan="3"><form class="bdform" data-id="${b.id}">${bdInputs(b)}
      <span class="btns"><button class="btn primary">Salvează</button><button type="button" class="btn" data-act="bdCancel">Renunță</button></span></form></td></tr>`;
    const next = nextBirthday(b), days = daysUntil(next), age = b.year ? +next.slice(0, 4) - b.year : null;
    return `<tr class="${days === 0 ? 'ants' : ''}">
      <td><b>${esc(b.name)}</b><div class="meta">${days === 0 ? '🎉 azi' : days === 1 ? 'mâine' : `peste ${deTxt(days, 'zile')}`}${age ? ` · împlinește ${ageTxt(age)}` : ''}</div></td>
      <td>${bdLabel(b)}</td>
      <td class="bdact"><button class="chip" data-act="bdEdit" data-arg="${b.id}" aria-label="Modifică">✏️</button>
        <button class="chip" data-act="bdDel" data-arg="${b.id}" aria-label="Șterge">🗑</button></td></tr>`;
  };
  main.innerHTML = `<div class="stack">
    <section class="card"><h2>🎂 Zile de naștere</h2>
      <div class="meta" style="margin-bottom:10px">Le vedeți amândoi și apar automat în calendar, în fiecare an.</div>
      <form class="bdform" id="bdAdd">${bdInputs()}<button class="btn primary">Adaugă</button></form>
    </section>
    ${st.denied.has('birthdays') ? `<div class="warn">⚠️ Firebase nu dă acces la zilele de naștere. Verifică dacă regulile publicate în
      Firestore → Rules conțin secțiunea <b>birthdays</b> din firestore.rules. Reîncerc automat.</div>` : ''}
    <section class="card">${list.length ? `<table class="bdt"><thead><tr><th>Nume</th><th>Ziua de naștere</th><th></th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table>` : '<div class="big-msg">Nicio zi de naștere încă.</div>'}</section>
  </div>`;
  main.querySelectorAll('.bdform').forEach(f => f.onsubmit = ev => {
    ev.preventDefault();
    const v = bdRead(f); if (!v) return;
    if (f.dataset.id){ updateDoc(doc(col('birthdays'), f.dataset.id), v).catch(fail); bdEditing = null; }
    else { addDoc(col('birthdays'), { ...v, createdBy:me(), createdAt:serverTimestamp() }).catch(fail); f.reset(); }
    document.activeElement?.blur(); render();
    toast({ html:`🎂 Salvat: ${esc(v.name)}` });
  });
}

/* ----- Inbox ----- */
function renderInbox(){
  const items = [...st.inbox].sort((a,b) => (b.at?.seconds || 9e9) - (a.at?.seconds || 9e9));
  main.innerHTML = `<div class="stack">
    <section class="card"><h2>📥 Inbox</h2>
      <div class="meta" style="margin-bottom:10px">Lucruri fără dată, ca să nu se piardă. Doar tu le vezi.</div>
      <form id="inboxForm" class="titlerow"><input id="inboxTxt" class="grow" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--bg);font-size:16px" placeholder="ex. Sună la bancă">
      <button class="btn primary">Adaugă</button></form>
    </section>
    <section class="card">${items.length ? items.map(i => `<div class="rev"><span>${guessEmoji(i.text)} ${esc(i.text)}</span>
      <span class="btns"><button class="chip" data-act="inSched" data-arg="${i.id}">📅 Programează</button>
      <button class="chip" data-act="inDone" data-arg="${i.id}">✓ Gata</button></span></div>`).join('') : '<div class="big-msg">✨ Inbox gol</div>'}</section>
  </div>`;
  $('#inboxForm').onsubmit = ev => {
    ev.preventDefault();
    const t = $('#inboxTxt').value.trim();
    if (!t) return;
    $('#inboxTxt').value = '';
    addInbox(t);
  };
}

/* ---------- Dialogs ---------- */
const dlg = $('#dlg'), body = $('#dlgBody');
const minOpts = v => [...new Set([...MIN_OPTS, +v || 0])].sort((a,b) => a-b)
  .map(m => `<option value="${m}" ${m === (+v || 0) ? 'selected' : ''}>${m ? m + ' min' : '—'}</option>`).join('');

function openEvent(e, preset = {}){
  if (e && e.owner !== me()) return openReadOnly(e);
  const fromInbox = preset._fromInbox, series = e?.repeat ? (e.series || e) : null;
  let scope = 'all';
  const clean = Object.fromEntries(Object.entries(preset).filter(([k,v]) => v != null && !k.startsWith('_')));
  const d = { emoji:'', title:'', date:iso(new Date()), start:'18:00', end:'19:00', shared:true, note:'', prep:0, travel:0, allowNudge:true, repeat:null, until:null, ...(e || {}), ...clean };
  const p = partner();
  body.innerHTML = `<form class="f" id="frm">
    <h2>${e ? 'Editează eveniment' : 'Eveniment nou'}</h2>
    ${series ? `<div class="seg scope"><button type="button" data-scope="one">Doar ${relDay(d.date)}</button><button type="button" data-scope="all" class="on">Toată seria</button></div>` : ''}
    <div class="titlerow"><input name="emoji" class="emo" maxlength="8" value="${esc(d.emoji)}" placeholder="📌" aria-label="Emoji">
      <input name="title" required placeholder="ex. Dentist" value="${esc(d.title)}" aria-label="Titlu"></div>
    <div class="three">
      <label>Data<input type="date" name="date" required value="${d.date}"></label>
      <label>Început<input type="time" name="start" required value="${d.start}"></label>
      <label>Sfârșit<input type="time" name="end" required value="${d.end}"></label>
    </div>
    <div class="two">
      <label>🧴 Timp de pregătire<select name="prep">${minOpts(d.prep)}</select></label>
      <label>🚶 Timp de drum<select name="travel">${minOpts(d.travel)}</select></label>
    </div>
    <div class="hint" id="leaveHint"></div>
    <div class="two" id="repRow">
      <label>🔁 Se repetă<select name="repeat"><option value="">Nu</option>${Object.entries(REPEAT).map(([k,l]) =>
        `<option value="${k}" ${d.repeat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label id="untilLbl">Până la (opțional)<input type="date" name="until" value="${d.until || ''}"></label>
    </div>
    <label class="switch"><span>👥 Partajat${p ? ` cu ${esc(nm(p))}` : ''}<small>Dacă e oprit, doar tu îl vezi.</small></span><input type="checkbox" name="shared" ${d.shared ? 'checked' : ''}></label>
    <label class="switch" id="nudgeRow"><span>💌 ${p ? esc(nm(p)) : 'Partenerul'} îmi poate trimite mementouri<small>Alegi pentru fiecare eveniment.</small></span><input type="checkbox" name="allowNudge" ${d.allowNudge ? 'checked' : ''}></label>
    <label>📝 Notă<textarea name="note" rows="2" placeholder="opțional">${esc(d.note)}</textarea></label>
    <div id="warn"></div>
    <div class="actions">
      ${e ? `<button type="button" class="btn del" id="delBtn">${series ? 'Șterge seria' : 'Șterge'}</button>` : ''}
      <button type="button" class="btn" id="cancel">Închide</button>
      <button class="btn primary">Salvează</button>
    </div></form>`;
  const frm = $('#frm'), F = k => frm.elements[k];
  let autoEmoji = !d.emoji;
  const read = () => ({
    title:F('title').value.trim(), emoji:F('emoji').value.trim() || guessEmoji(F('title').value),
    date:F('date').value, start:F('start').value, end:F('end').value,
    prep:+F('prep').value, travel:+F('travel').value, shared:F('shared').checked, allowNudge:F('allowNudge').checked, note:F('note').value.trim(),
    repeat:(scope === 'all' && F('repeat').value) || null, until:(scope === 'all' && F('repeat').value && F('until').value) || null,
  });
  const update = () => {
    const v = read();
    $('#nudgeRow').hidden = !v.shared;
    $('#repRow').hidden = scope === 'one';
    $('#untilLbl').hidden = !v.repeat;
    const s = v.start && toMin(v.start);
    $('#leaveHint').textContent = (v.prep || v.travel) && v.start
      ? `→ ${v.prep ? `începi pregătirea la ${minToHm(Math.max(0, s - v.prep - v.travel))}` : ''}${v.prep && v.travel ? ' · ' : ''}${v.travel ? `pleci la ${minToHm(Math.max(0, s - v.travel))}` : ''}` : '';
    const w = [];
    if (v.start && v.end && toMin(v.end) <= toMin(v.start)) w.push('Sfârșitul trebuie să fie după început.');
    if (v.until && v.until < v.date) w.push('„Până la” trebuie să fie după data de început.');
    if (v.start && v.end) for (const x of expand(st.mine, v.date, v.date).filter(x => x.id !== e?.id))
      if (toMin(x.start) < toMin(v.end) && toMin(v.start) < toMin(x.end)) w.push(`⏰ Se suprapune cu ${x.emoji || ''} ${esc(x.title)} (${x.start}–${x.end}).`);
    $('#warn').innerHTML = w.map(t => `<div class="warn">${t}</div>`).join('');
  };
  update();
  body.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => {
    scope = b.dataset.scope;
    body.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b));
    $('#delBtn').textContent = scope === 'one' ? `Șterge doar ${relDay(e.date)}` : 'Șterge seria';
    update();
  });
  frm.addEventListener('input', ev => {
    if (ev.target.name === 'emoji') autoEmoji = !ev.target.value.trim();
    if (ev.target.name === 'title' && autoEmoji) F('emoji').value = guessEmoji(ev.target.value);
    update();
  });
  $('#cancel').onclick = () => dlg.close();
  $('#delBtn')?.addEventListener('click', () => {
    const target = series || e;
    if (series && scope === 'one'){
      if (!confirm(`Ștergi doar evenimentul din ${relDay(e.date)}? Restul seriei rămâne.`)) return;
      updateDoc(doc(col('events'), target.id), { exdates:arrayUnion(e.date) }).catch(fail);
    } else {
      if (!confirm(series ? 'Ștergi toată seria?' : 'Ștergi evenimentul?')) return;
      deleteDoc(doc(col('events'), target.id)).catch(fail);
    }
    dlg.close();
  });
  frm.onsubmit = ev => {
    ev.preventDefault();
    const v = read();
    if (toMin(v.end) <= toMin(v.start) || (v.until && v.until < v.date)) return update();
    if (!series) saveEvent(v, e?.id);
    else if (scope === 'one'){
      // Detach this occurrence: a standalone copy, and the series skips that date.
      saveEvent({ ...v, repeat:null, until:null });
      updateDoc(doc(col('events'), series.id), { exdates:arrayUnion(e.date) }).catch(fail);
    } else {
      // The dialog shows the clicked occurrence's date; moving it moves the whole series by the same amount.
      const shift = Math.round((new Date(v.date + 'T00:00') - new Date(e.date + 'T00:00')) / 864e5);
      saveEvent({ ...v, date:iso(addDays(new Date(series.date + 'T00:00'), shift)) }, series.id);
    }
    if (fromInbox) delInbox(fromInbox);
    dlg.close();
    toast({ html:`✅ Salvat: ${v.emoji} ${esc(v.title)} · ${relDay(v.date)}, ${v.start}` });
  };
  dlg.showModal();
}

function openReadOnly(e){
  const o = e.owner, leaveAt = e.travel ? minToHm(Math.max(0, toMin(e.start) - e.travel)) : null;
  const sent = st.nudgesOut.filter(x => x.eventId === e.id && (!x.date || x.date === e.date));
  body.innerHTML = `<div class="f">
    <h2>${e.emoji || ''} ${esc(e.title)}</h2>
    <div class="ro">De la <b>${esc(nm(o))}</b> · ${relDay(e.date)}, ${e.start}–${e.end}${leaveAt ? ` · pleacă la ${leaveAt}` : ''}
      ${e.repeat ? `<div style="margin-top:4px">🔁 ${REPEAT[e.repeat]}${e.until ? `, până la ${relDay(e.until)}` : ''}</div>` : ''}
      ${e.status ? `<div style="margin-top:4px">${STATUS[e.status][0]} <b>${STATUS[e.status][1]}</b></div>` : ''}
      ${e.note ? `<div style="margin-top:4px">📝 ${esc(e.note)}</div>` : ''}</div>
    ${e.allowNudge ? `<div class="lbl">💌 Trimite un memento</div>
      <div class="chips">${NUDGES.map(t => `<button type="button" class="chip" data-nudge="${esc(t)}">${t}</button>`).join('')}</div>
      <div class="titlerow"><input id="nudgeTxt" class="grow" placeholder="Sau scrie tu…" maxlength="120"><button type="button" class="btn" id="nudgeSend">Trimite</button></div>
      ${sent.length ? `<div class="meta">Trimise: ${sent.map(x => esc(x.text) + (x.read ? ' 👍' : '')).join(' · ')}</div>` : ''}`
      : `<div class="meta">💌 ${esc(nm(o))} nu a activat mementourile pentru acest eveniment.</div>`}
    <div class="actions"><button type="button" class="btn" id="cancel">Închide</button></div></div>`;
  const send = text => { if (!text) return; sendNudge(e, text); dlg.close(); toast({ html:`💌 Trimis către ${esc(nm(o))}: ${esc(text)}` }); };
  body.querySelectorAll('[data-nudge]').forEach(b => b.onclick = () => send(b.dataset.nudge));
  $('#nudgeSend')?.addEventListener('click', () => send($('#nudgeTxt').value.trim()));
  $('#cancel').onclick = () => dlg.close();
  dlg.showModal();
}

function openSettings(){
  const p = partner(), notif = 'Notification' in window ? Notification.permission : 'unsupported';
  body.innerHTML = `<form class="f" id="sf"><h2>⚙️ Setări</h2>
    <label>Numele tău în calendar<input name="name" value="${esc(nm(me()))}" maxlength="30"></label>
    ${p ? `<div class="meta">Calendar comun cu <b>${esc(nm(p))}</b>.</div>`
        : `<div class="lbl">Link de invitație</div><div class="copy"><input readonly value="${esc(inviteLink())}"><button type="button" class="btn" data-act="share">Trimite</button></div>`}
    ${notif === 'default' ? '<button type="button" class="btn" id="notifBtn">🔔 Activează notificările pentru mementouri</button>'
      : notif === 'granted' ? '<div class="meta">🔔 Notificările sunt active (cât timp aplicația e deschisă în fundal).</div>' : ''}
    <div class="meta">Cont: ${esc(st.user.email || '')}</div>
    <div class="actions"><button type="button" class="btn del" id="outBtn">Ieși din cont</button>
      <button type="button" class="btn" id="cancel">Închide</button><button class="btn primary">Salvează</button></div></form>`;
  const sf = $('#sf');
  $('#cancel').onclick = () => dlg.close();
  $('#outBtn').onclick = () => { dlg.close(); signOut(auth); };
  $('#notifBtn')?.addEventListener('click', async () => { await Notification.requestPermission(); openSettings(); });
  sf.querySelector('[data-act="share"]')?.addEventListener('click', shareInvite);
  sf.onsubmit = ev => {
    ev.preventDefault();
    const name = sf.elements.name.value.trim();
    if (name) updateDoc(doc(db, 'spaces', st.sid), { [`names.${me()}`]:name }).catch(fail);
    dlg.close();
  };
  if (!dlg.open) dlg.showModal();
}
dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); });
$('#settingsBtn').onclick = openSettings;

async function shareInvite(){
  const url = inviteLink();
  try {
    if (navigator.share) return await navigator.share({ title:'Calendar Comun', text:'Hai în calendarul nostru comun 💛', url });
    await navigator.clipboard.writeText(url);
    toast({ html:'📋 Link copiat. Trimite-l pe WhatsApp sau unde vorbiți.' });
  } catch {}
}

/* ---------- Toasts ---------- */
function toast({ id, html, sub, actions = [], sticky = false, kind = '', onClose }){
  const box = $('#toasts');
  if (id && box.querySelector(`[data-tid="${id}"]`)) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  if (id) el.dataset.tid = id;
  el.innerHTML = `<div class="tbody"><div>${html}</div>${sub ? `<div class="meta">${sub}</div>` : ''}${actions.length ? '<div class="tact"></div>' : ''}</div><button class="tx" aria-label="Închide">×</button>`;
  actions.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label;
    b.onclick = () => { el.remove(); fn(); };
    el.querySelector('.tact').appendChild(b);
  });
  el.querySelector('.tx').onclick = () => { el.remove(); onClose?.(); };
  box.appendChild(el);
  if (!sticky) setTimeout(() => el.remove(), 5000);
}

/* ---------- Actions ---------- */
const findEv = (id, date) => { const e = events().find(x => x.id === id); return e?.repeat && date ? occurrence(e, date) : e; };
const ACT = {
  tab: v => { st.view = v; lsSet('cal.view', v); render(); window.scrollTo(0,0); },
  wk: a => {
    if (st.view === 'week'){
      const s = sel(), today = new Date();
      if (a === '0') selDate = iso(today);
      else if (calView === 'month'){
        const m = new Date(s.getFullYear(), s.getMonth() + +a, 1);
        selDate = iso(m.getMonth() === today.getMonth() && m.getFullYear() === today.getFullYear() ? today : m);
      } else selDate = iso(addDays(s, (calView === 'week' ? 7 : 1) * +a));
    } else weekStart = a === '0' ? mondayOf(new Date()) : addDays(weekStart, 7 * +a);
    render();
  },
  calview: v => { calView = v; lsSet('cal.calview', v); render(); },
  // Tapping the already selected day opens its timeline.
  pick: d => { if (d === selDate){ calView = 'day'; lsSet('cal.calview', 'day'); } else selDate = d; render(); },
  addOn: () => openEvent(null, { date:selDate }),
  bdEdit: id => { bdEditing = id; render(); },
  bdCancel: () => { bdEditing = null; render(); },
  bdDel: id => {
    const b = st.birthdays.find(x => x.id === id);
    if (b && confirm(`Ștergi ziua de naștere: ${b.name}?`)) deleteDoc(doc(col('birthdays'), id)).catch(fail);
  },
  open: (_, id, date) => { const e = findEv(id, date); if (e) openEvent(e); },
  status: (s, id, date) => { const e = findEv(id, date); if (e) setStatus(e, s); },
  nudgeRead: id => { const x = st.nudgesIn.find(x => x.id === id); if (x) markRead(x); },
  share: () => shareInvite(),
  inSched: id => {
    const it = st.inbox.find(x => x.id === id); if (!it) return;
    const { p } = parseQuick(it.text);
    openEvent(null, { ...p, title:p.title || it.text, _fromInbox:id });
  },
  inDone: id => { delInbox(id); toast({ html:'✓ Bravo! 🎉' }); },
};
document.addEventListener('click', ev => {
  if (ev.target.closest('dialog, #toasts')) return;
  const b = ev.target.closest('[data-act]');
  if (b) ACT[b.dataset.act]?.(b.dataset.arg, b.dataset.id, b.dataset.date);
});

// Swipe left/right on the calendar or agenda to move to the next/previous period.
let touch = null;
main.addEventListener('touchstart', ev => { touch = ev.touches.length === 1 ? [ev.touches[0].clientX, ev.touches[0].clientY] : null; }, { passive:true });
main.addEventListener('touchend', ev => {
  if (!touch || !['week','agenda'].includes(st.view) || dlg.open) return;
  const dx = ev.changedTouches[0].clientX - touch[0], dy = ev.changedTouches[0].clientY - touch[1];
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) ACT.wk(dx < 0 ? '1' : '-1');
});

/* ---------- Quick capture ---------- */
const qc = $('#qc'), qcPrev = $('#qcPrev');
qc.addEventListener('input', () => {
  const text = qc.value.trim();
  if (!text){ qcPrev.textContent = ''; return; }
  const { p, complete, empty } = parseQuick(text);
  qcPrev.textContent = empty
    ? '📥 Fără dată sau oră, merge în Inbox. Enter ca să-l salvezi.'
    : `${p.emoji} ${p.title || '…'} · ${p.date ? relDay(p.date) : 'dată?'}${p.start ? `, ${p.start}–${p.end}` : ', oră?'}${p.repeat ? ` · 🔁 ${REPEAT[p.repeat].toLowerCase()}` : ''}${p.shared ? '' : ' · 🔒 privat'} · Enter ${complete ? 'adaugă' : 'deschide formularul'}`;
});
qc.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const text = qc.value.trim(); if (!text) return;
  const { p, complete, empty } = parseQuick(text);
  qc.value = ''; qcPrev.textContent = '';
  if (empty){ addInbox(text); toast({ html:`📥 În Inbox: ${esc(text)}` }); }
  else if (complete){
    saveEvent({ ...p, until:null, note:'', prep:0, travel:0, allowNudge:true });
    toast({ html:`✅ Adăugat: ${p.emoji} ${esc(p.title)} · ${relDay(p.date)}, ${p.start}`,
            sub: p.shared ? (partner() ? `Vizibil pentru ${esc(nm(partner()))}` : 'Partajat') : '🔒 Privat' });
  } else openEvent(null, p);
});

/* ---------- Start ---------- */
setInterval(() => { if (st.view === 'now' && !dlg.open) render(); }, 30000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache:'none' }).catch(() => {});

/* ---------- Auto-update ---------- */
// An open (or installed) app keeps running the code it started with. Compare the files' ETag/Last-Modified
// with the ones seen at startup; when they change, reload — but only when nothing is being typed or edited.
const APP_FILES = ['index.html', 'app.js', 'style.css', 'firebase-config.js'];
let bootVersion = null, updateReady = false;
const remoteVersion = () => Promise.all(APP_FILES.map(f => fetch(f, { method:'HEAD', cache:'no-store' })
  .then(r => r.headers.get('etag') || r.headers.get('last-modified') || String(r.status)))).then(v => v.join('|'));
async function checkForUpdate(){
  if (updateReady || !navigator.onLine) return;
  try {
    const v = await remoteVersion();
    if (bootVersion === null) bootVersion = v;
    else if (v !== bootVersion){ updateReady = true; applyUpdate(); }
  } catch {}
}
function applyUpdate(){
  if (!updateReady || dlg.open || typing() || qc.value.trim()) return;
  try { sessionStorage.setItem('cal.updated', '1'); } catch {}
  location.reload();
}
checkForUpdate();
setInterval(checkForUpdate, 10 * 60e3);
setInterval(applyUpdate, 15e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden){ checkForUpdate(); applyUpdate(); } });
dlg.addEventListener('close', () => setTimeout(applyUpdate, 500));
try { if (sessionStorage.getItem('cal.updated')){ sessionStorage.removeItem('cal.updated'); toast({ html:'✨ Aplicația s-a actualizat' }); } } catch {}
