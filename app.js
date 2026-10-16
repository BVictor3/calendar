import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc,
         addDoc, deleteDoc, collection, query, where, onSnapshot, arrayUnion, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ---------- Constants & helpers ---------- */
const H_START = 6, H_END = 24, MIN = 6e4;
let ROW = 48;
const DAYS = ['Lun','Mar','Mie','Joi','Vin','Sâm','Dum'];
const DAYS_LONG = ['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
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
const st = { user:null, sid:null, space:null, mine:[], shared:[], nudgesIn:[], nudgesOut:[], inbox:[], view:lsGet('cal.view','now'), unsub:[] };
let weekStart = mondayOf(new Date());
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isPhone = () => innerWidth <= 600;
// The "Săptămână" tab shows 7, 3 or 1 day(s); phones default to 3 so text stays readable.
let span = +lsGet('cal.span', isPhone() ? '3' : '7');
const spanStart = anchor => span === 7 ? mondayOf(anchor) : startOfDay(anchor);
let gridStart = spanStart(new Date());
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
const listen = (ref, fn) => st.unsub.push(onSnapshot(ref, fn, fail));
const docs = s => s.docs.map(d => ({ id:d.id, ...d.data() }));
const shownNudges = new Set();

function enterSpace(sid){
  st.sid = sid;
  $('#header').hidden = false;
  main.innerHTML = '<div class="center meta">Se încarcă…</div>';
  const uid = me();
  listen(doc(db, 'spaces', sid), s => { st.space = s.data(); scheduleRender(); });
  listen(query(col('events'), where('owner', '==', uid)), s => { st.mine = docs(s); scheduleRender(); });
  listen(query(col('events'), where('shared', '==', true)), s => { st.shared = docs(s); scheduleRender(); });
  listen(query(col('nudges'), where('to', '==', uid)), s => { st.nudgesIn = docs(s); announceNudges(); scheduleRender(); });
  listen(query(col('nudges'), where('from', '==', uid)), s => { st.nudgesOut = docs(s); scheduleRender(); });
  listen(query(col('inbox'), where('owner', '==', uid)), s => { st.inbox = docs(s); scheduleRender(); });
}

function announceNudges(){
  for (const x of st.nudgesIn){
    if (x.read || shownNudges.has(x.id)) continue;
    shownNudges.add(x.id);
    const e = events().find(e => e.id === x.eventId);
    const about = e ? `despre ${e.emoji || ''} ${e.title}` : '';
    toast({ id:'n' + x.id, sticky:true, kind:'nud', html:`💌 <b>${esc(nm(x.from))}</b>: ${esc(x.text)}`, sub:esc(about),
            actions:[['👍 Mulțumesc', () => markRead(x)]] });
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
main.addEventListener('focusout', () => setTimeout(() => { if (!typing()) scheduleRender(); }, 0));

function render(){
  if (!st.sid) return;
  if (!st.space){ main.innerHTML = '<div class="center meta">Se încarcă…</div>'; return; }
  renderHeader();
  if (typing()) return;
  ({ now:renderNow, week:renderWeek, agenda:renderAgenda, inbox:renderInbox }[st.view] || renderNow)();
}

function renderHeader(){
  $('#meChip').innerHTML = `<span class="dot" style="background:${COLOR[keyOf(me())]}"></span>${esc(nm(me()))}`
    + (partner() ? ` &amp; <span class="dot" style="background:${COLOR[keyOf(partner())]}"></span>${esc(nm(partner()))}` : '');
  const nudN = st.nudgesIn.filter(x => !x.read).length;
  const tabs = [['now','⏱ Acum',nudN],['week','🗓 Săptămână'],['agenda','📋 Agendă'],['inbox','📥 Inbox',st.inbox.length]];
  $('#tabs').innerHTML = tabs.map(([k,l,c]) =>
    `<button data-act="tab" data-arg="${k}" class="${st.view === k ? 'on' : ''}">${l}${c ? ` <span class="count">${c}</span>` : ''}</button>`).join('');
}

function toolbar(){
  const grid = st.view === 'week', start = grid ? gridStart : weekStart, n = grid ? span : 7;
  const end = addDays(start, n - 1), p = partner();
  const range = n === 1 ? `${DAYS_LONG[(start.getDay()+6)%7]}, ${start.getDate()} ${MONTHS[start.getMonth()]}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  return `<div class="toolbar">
    <button class="btn" data-act="wk" data-arg="-1" aria-label="Săptămâna trecută">‹</button>
    <button class="btn" data-act="wk" data-arg="0">Azi</button>
    <button class="btn" data-act="wk" data-arg="1" aria-label="Săptămâna viitoare">›</button>
    <span class="range">${range}</span>
    <span class="spacer"></span>
    ${grid ? `<div class="seg">${[[7,'7 zile'],[3,'3 zile'],[1,'Zi']].map(([k,l]) =>
      `<button data-act="span" data-arg="${k}" class="${span === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
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
function layoutDay(list){
  list.sort(byStart);
  const lanes = [], pos = new Map();
  for (const e of list){
    let i = lanes.findIndex(end => end <= toMin(e.start));
    if (i < 0){ i = lanes.length; lanes.push(0); }
    lanes[i] = toMin(e.end); pos.set(e.id, i);
  }
  return list.map(e => ({ e, lane:pos.get(e.id), lanes:lanes.length }));
}

let lastWeekKey = null;
function renderWeek(){
  ROW = isPhone() ? 40 : 48;
  const n = new Date(), todayIso = iso(n), days = [...Array(span)].map((_,i) => addDays(gridStart,i));
  const weekKey = iso(gridStart) + span, prevScroll = lastWeekKey === weekKey ? main.querySelector('.grid')?.scrollTop : null;
  lastWeekKey = weekKey;
  let head = '<div></div>';
  days.forEach(d => {
    const wd = (d.getDay()+6)%7;
    head += `<div class="${iso(d) === todayIso ? 'is-today' : ''}" ${span > 1 ? `data-act="day" data-arg="${iso(d)}" title="Vezi doar ziua asta"` : ''}>${span === 1 ? DAYS_LONG[wd] : DAYS[wd]}<b>${d.getDate()}</b></div>`;
  });
  let hours = '';
  for (let h = H_START; h < H_END; h++) hours += `<div>${h === H_START ? '' : pad(h) + ':00'}</div>`;
  main.innerHTML = toolbar() + `<div class="grid c${span}" style="--h:${ROW}px;--cols:${span}">
    <div class="head">${head}</div>
    <div class="body"><div class="hours">${hours}</div>${days.map(d =>
      `<div class="col ${iso(d) === todayIso ? 'today' : ''}" data-date="${iso(d)}" style="height:${(H_END-H_START)*ROW}px"></div>`).join('')}</div></div>`;
  const y = m => (m - H_START*60) / 60 * ROW, all = expand(events(), iso(days[0]), iso(days[days.length - 1]));
  main.querySelectorAll('.col').forEach(c => {
    const di = c.dataset.date;
    let html = '';
    for (const { e, lane, lanes } of layoutDay(all.filter(e => e.date === di))){
      const top = y(toMin(e.start)), h = Math.max(22, (toMin(e.end) - toMin(e.start)) / 60 * ROW - 2), w = 100 / lanes;
      const unread = st.nudgesIn.some(x => x.eventId === e.id && (!x.date || x.date === e.date) && !x.read);
      html += `<div class="ev ${keyOf(e.owner)}${e.shared ? '' : ' private'}${e.status === 'arrived' ? ' done' : ''}${lanes > 1 ? ' narrow' : ''}" data-act="open" data-id="${e.id}" data-date="${e.date}"
        style="top:${top}px;height:${h}px;left:calc(${w*lane}% + 2px);width:calc(${w}% - 4px)" title="${esc(e.title)}">
        <div class="t">${e.emoji || ''} <span class="tt">${esc(e.title)}</span>${unread ? ' 💌' : ''}</div>
        <div class="m">${e.owner !== me() ? esc(nm(e.owner)) + ' · ' : ''}${e.start}–${e.end}${e.repeat ? ' · 🔁' : ''}${e.shared ? '' : ' · 🔒'}${e.status ? ' · ' + STATUS[e.status][0] : ''}</div></div>`;
    }
    if (di === todayIso){
      const m = n.getHours()*60 + n.getMinutes();
      if (m >= H_START*60) html += `<div class="nowline" style="top:${y(m)}px"></div>`;
    }
    c.innerHTML = html;
  });
  const isThisWeek = days.some(d => iso(d) === todayIso);
  main.querySelector('.grid').scrollTop = prevScroll ?? ((isThisWeek ? Math.max(H_START, n.getHours() - 2) : 8) - H_START) * ROW;
}

/* ----- Agenda ----- */
function renderAgenda(){
  const todayIso = iso(new Date()), all = expand(events(), iso(weekStart), iso(addDays(weekStart, 6)));
  let h = toolbar() + '<div class="stack">';
  for (let i = 0; i < 7; i++){
    const d = addDays(weekStart,i), di = iso(d);
    const list = all.filter(e => e.date === di).sort(byStart);
    h += `<div class="day ${di === todayIso ? 'today' : ''}"><h3>${DAYS_LONG[i]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</h3>`;
    h += list.length ? list.map(e => {
      const lv = e.travel ? ` · pleacă la ${minToHm(Math.max(0, toMin(e.start) - e.travel))}` : '';
      return `<div class="row" data-act="open" data-id="${e.id}" data-date="${e.date}">
        <span class="bar" style="background:${COLOR[keyOf(e.owner)]}"></span><span class="time">${e.start} – ${e.end}</span>
        <span class="grow"><b>${e.emoji || ''} ${esc(e.title)}</b>${e.repeat ? `<span class="tag">🔁 ${REPEAT[e.repeat]}</span>` : ''}${e.shared ? '' : '<span class="tag">🔒 privat</span>'}${e.status ? `<span class="tag">${STATUS[e.status].join(' ')}</span>` : ''}
        <div class="meta">${e.owner === me() ? 'Al meu' : esc(nm(e.owner))}${lv}${e.note ? ' · ' + esc(e.note) : ''}</div></span></div>`;
    }).join('') : '<div class="empty">Nimic planificat</div>';
    h += '</div>';
  }
  main.innerHTML = h + '</div>';
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
function toast({ id, html, sub, actions = [], sticky = false, kind = '' }){
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
  el.querySelector('.tx').onclick = () => el.remove();
  box.appendChild(el);
  if (!sticky) setTimeout(() => el.remove(), 5000);
}

/* ---------- Actions ---------- */
const findEv = (id, date) => { const e = events().find(x => x.id === id); return e?.repeat && date ? occurrence(e, date) : e; };
const ACT = {
  tab: v => { st.view = v; lsSet('cal.view', v); render(); window.scrollTo(0,0); },
  wk: a => {
    if (st.view === 'week') gridStart = a === '0' ? spanStart(new Date()) : addDays(gridStart, span * +a);
    else weekStart = a === '0' ? mondayOf(new Date()) : addDays(weekStart, 7 * +a);
    render();
  },
  span: k => {
    const today = startOfDay(new Date());
    const anchor = today >= gridStart && today < addDays(gridStart, span) ? today : gridStart;
    span = +k; lsSet('cal.span', k); gridStart = spanStart(anchor); render();
  },
  day: d => { span = 1; lsSet('cal.span', '1'); gridStart = new Date(d + 'T00:00'); render(); },
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
  if (b){ ACT[b.dataset.act]?.(b.dataset.arg, b.dataset.id, b.dataset.date); return; }
  const c = ev.target.closest('.col');
  if (c){
    const m = H_START*60 + Math.floor((ev.clientY - c.getBoundingClientRect().top) / ROW * 2) * 30;
    openEvent(null, { date:c.dataset.date, start:minToHm(m), end:minToHm(Math.min(m + 60, 23*60 + 59)) });
  }
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
