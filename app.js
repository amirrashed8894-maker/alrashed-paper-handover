/* تسليم أصول ورق — v1.0.0
   كل حاجة بتتحفظ فورًا على الجهاز (IndexedDB: ho_db → rec + blob، ونسخة من المسودة في localStorage)،
   وبعد الحفظ بتترفع للسحابة (Supabase عبر paper-handover). مفيش مسح نهائي: أرشفة بس. */
'use strict';
const CFG = window.HO_CONFIG, BR = CFG.brands[CFG.brand] || CFG.brands.alrashed;
const $ = (s, el) => (el || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const TZ = 'Africa/Cairo';
function cairoParts(d) { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(d)).forEach(p => o[p.type] = p.value); if (o.hour === '24') o.hour = '00'; return o; }
const fDate = d => { const p = cairoParts(d); return `${p.day}/${p.month}/${p.year}`; };
const fTime = d => { const p = cairoParts(d); const h = +p.hour, ap = h < 12 ? 'ص' : 'م', h12 = (h % 12) || 12; return `${String(h12).padStart(2, '0')}:${p.minute} ${ap}`; };
const fDT = d => `${fDate(d)} ${fTime(d)}`;
function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 2600); }
function dialog(msg, btns) {
  return new Promise(ok => { const d = document.createElement('div'); d.className = 'dlg';
    d.innerHTML = `<div class="box"><p>${msg}</p><div class="row">${btns.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.t)}</button>`).join('')}</div></div>`;
    d.querySelectorAll('button').forEach(b => b.onclick = () => { d.remove(); ok(btns[+b.dataset.i].v); }); document.body.appendChild(d); });
}
const confirmDlg = (msg, yes, cls) => dialog(msg, [{ t: yes || 'تأكيد', v: true, cls: cls || '' }, { t: 'رجوع', v: false, cls: 'gh' }]);

/* ---------- التخزين المحلي ---------- */
const HAS_IDB = (() => { try { return typeof indexedDB !== 'undefined' && !!indexedDB && typeof indexedDB.open === 'function'; } catch (e) { return false; } })();
let dbP = null;
function db() {
  if (!HAS_IDB) return Promise.reject(new Error('NO_IDB'));
  if (dbP) return dbP;
  dbP = new Promise((ok, no) => { let r; try { r = indexedDB.open('ho_db', 1); } catch (e) { dbP = null; return no(e); }
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('rec')) d.createObjectStore('rec', { keyPath: 'id' }); if (!d.objectStoreNames.contains('blob')) d.createObjectStore('blob', { keyPath: 'key' }); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbP = null; }; d.onclose = () => { dbP = null; }; ok(d); };
    r.onerror = () => { dbP = null; no(r.error); }; r.onblocked = () => {}; });
  return dbP;
}
async function tx(store, mode, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const d = await db(); return await new Promise((ok, no) => { const t = d.transaction(store, mode), s = t.objectStore(store); let res; const rq = fn(s); if (rq) rq.onsuccess = () => res = rq.result; t.oncomplete = () => ok(res); t.onerror = () => no(t.error); t.onabort = () => no(t.error || new Error('abort')); }); }
    catch (e) { dbP = null; if (attempt) throw e; }
  }
}
const MEM = { rec: new Map(), blob: new Map() };
async function putRec(r) { r.updatedAt = new Date().toISOString(); MEM.rec.set(r.id, r); if (r.status === 'draft') { try { localStorage.setItem('ho_draft_' + r.id, JSON.stringify(r)); } catch (e) {} } else { try { localStorage.removeItem('ho_draft_' + r.id); } catch (e) {} }
  if (HAS_IDB) { try { await tx('rec', 'readwrite', s => s.put(JSON.parse(JSON.stringify(r)))); } catch (e) { warnStore('تعذر الحفظ على الجهاز: ' + ((e && e.name) || e)); } } }
async function allRecs() { let arr = []; if (HAS_IDB) { try { arr = await tx('rec', 'readonly', s => s.getAll()) || []; } catch (e) {} }
  const m = new Map(arr.map(r => [r.id, r])); MEM.rec.forEach((r, id) => { if (!m.has(id) || (m.get(id).updatedAt || '') < (r.updatedAt || '')) m.set(id, r); });
  // مسودات localStorage (لو الصفحة اتقفلت قبل ما IndexedDB يخلص)
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ho_draft_')) { const r = JSON.parse(localStorage.getItem(k)); if (r && r.id && (!m.has(r.id) || (m.get(r.id).updatedAt || '') < (r.updatedAt || ''))) m.set(r.id, r); } } } catch (e) {}
  return [...m.values()]; }
async function getRec(id) { return (await allRecs()).find(r => r.id === id) || null; }
// الصور بتتخزن ArrayBuffer (مش Blob) عشان بعض نسخ سفاري بتفشل في تخزين Blob جوه IndexedDB
async function putBlob(key, blob) { MEM.blob.set(key, blob); if (HAS_IDB) { try { const buf = await blob.arrayBuffer(); await tx('blob', 'readwrite', s => s.put({ key, buf, type: blob.type || 'image/jpeg', at: Date.now() })); } catch (e) { warnStore('تعذر حفظ الصورة على الجهاز: ' + ((e && e.name) || e)); } } }
async function getBlob(key) { if (MEM.blob.has(key)) return MEM.blob.get(key); if (!HAS_IDB) return null; try { const v = await tx('blob', 'readonly', s => s.get(key)); const b = v ? (v.buf ? new Blob([v.buf], { type: v.type || 'image/jpeg' }) : v.blob) : null; if (b) { MEM.blob.set(key, b); return b; } } catch (e) {} return null; }
function warnStore(m) { const w = $('#storeWarn'); w.textContent = m + ' — الصور بتترفع للسحابة أول ما تحفظ.'; w.hidden = false; }
const urlCache = new Map();
async function blobUrl(key) { if (urlCache.has(key)) return urlCache.get(key); const b = await getBlob(key); if (!b) return ''; const u = URL.createObjectURL(b); urlCache.set(key, u); return u; }

/* ---------- السحابة ---------- */
const testKey = (() => { try { return localStorage.getItem('ho_test_key') || ''; } catch (e) { return ''; } })();
function token() { try { return localStorage.getItem('alola_auth_token') || ''; } catch (e) { return ''; } }
function who() { try { const u = JSON.parse(localStorage.getItem('alola_auth_user') || 'null'); return u ? { username: u.username, label: u.label } : null; } catch (e) { return null; } }
function deviceTag() { let d = ''; try { d = localStorage.getItem('ho_dev') || ''; if (!d) { d = uuid().slice(0, 8); localStorage.setItem('ho_dev', d); } } catch (e) { d = 'x'; } return d; }
async function api(a, opt = {}) {
  const h = Object.assign({}, opt.headers || {}); if (testKey) h['x-ho-test-key'] = testKey; else h.Authorization = 'Bearer ' + token();
  let body = opt.body; if (body && !(body instanceof Blob) && typeof body === 'object') { body = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), opt.timeout || 60000);
  try { const r = await fetch(CFG.api + '?a=' + a + (opt.qs || ''), { method: opt.method || (body ? 'POST' : 'GET'), headers: h, body, signal: ctl.signal, cache: 'no-store' });
    const d = await r.json().catch(() => ({ ok: false, error: 'رد غير مفهوم من السحابة' })); if (!r.ok || !d.ok) { const e = new Error(d.error || ('HTTP ' + r.status)); e.code = d.code; e.status = r.status; throw e; } return d; }
  finally { clearTimeout(tm); }
}
function fileList(r) { const f = r.docs.map(d => ({ name: d.file, key: r.id + '/' + d.file })); if (r.selfie && r.selfie.file) f.push({ name: r.selfie.file, key: r.id + '/' + r.selfie.file }); return f; }
const cloudRecord = r => { const c = JSON.parse(JSON.stringify(r)); delete c.sync; delete c.step; return c; };
let syncing = false;
async function syncAll() {
  if (syncing || !navigator.onLine) return updBadge(); syncing = true;
  try { const rs = (await allRecs()).filter(r => r.status === 'saved' && (!r.sync || r.sync.state !== 'ok' || r.sync.dirty));
    for (const r of rs) await syncOne(r).catch(() => {}); }
  finally { syncing = false; updBadge(); }
}
async function syncOne(r) {
  r.sync = r.sync || { state: 'pending', files: {} }; r.sync.files = r.sync.files || {};
  try {
    for (const f of fileList(r)) { if (r.sync.files[f.name]) continue; const b = await getBlob(f.key); if (!b) throw new Error('صورة ناقصة على الجهاز: ' + f.name);
      await api('file', { method: 'PUT', qs: '&rid=' + r.id + '&name=' + encodeURIComponent(f.name), body: b, headers: { 'Content-Type': b.type || 'image/jpeg' }, timeout: 90000 }); r.sync.files[f.name] = true; await putRec(r); }
    await api('save', { body: { record: cloudRecord(r), device: deviceTag() } });
    r.sync.state = 'ok'; r.sync.dirty = false; r.sync.at = new Date().toISOString(); r.sync.err = ''; await putRec(r); return true;
  } catch (e) { r.sync.state = 'err'; r.sync.err = String(e.message || e); await putRec(r); throw e; }
}
async function updBadge() { const b = $('#syncBadge'); if (!b) return; const rs = (await allRecs()).filter(r => r.status === 'saved'); const pend = rs.filter(r => !r.sync || r.sync.state !== 'ok' || r.sync.dirty).length;
  if (!navigator.onLine) { b.className = 'badge warn'; b.textContent = pend ? `أوفلاين · ${pend} مستني رفع` : 'أوفلاين'; }
  else if (pend) { b.className = 'badge warn'; b.textContent = `${pend} مستني رفع`; } else { b.className = 'badge ok'; b.textContent = '☁︎ متزامن'; } }

/* ---------- الاسم الثلاثي ---------- */
const PREFIX = new Set(['عبد', 'ابو', 'أبو', 'ام', 'أم', 'abd', 'abdel', 'abdul', 'abu', 'el', 'al']);
const SUFFIX = new Set(['الدين', 'الله', 'الاسلام', 'الإسلام', 'الرحمن', 'الرحيم']);
const LINK = new Set(['بن', 'ابن', 'bin', 'ibn', 'bint', 'بنت']);
function checkName(raw) {
  let s = String(raw || '').normalize('NFC').replace(/[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E]/g, '').replace(/[.,،؛;_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, clean: '', parts: [], err: 'اكتب اسم السواق الثلاثي' };
  if (/[0-9\u0660-\u0669\u06F0-\u06F9]/.test(s)) return { ok: false, clean: s, parts: [], err: 'الاسم ما ينفعش يكون فيه أرقام' };
  const toks = s.split(' ');
  for (const t of toks) if (!/^[\p{Script=Arabic}A-Za-z']+$/u.test(t)) return { ok: false, clean: s, parts: [], err: 'الاسم لازم يكون حروف عربي أو إنجليزي بس' };
  const parts = []; let carry = '';
  for (const t of toks) { const lt = t.toLowerCase();
    if (LINK.has(lt)) continue;
    if (PREFIX.has(lt)) { carry = carry ? carry + ' ' + t : t; continue; }
    if (carry) { parts.push(carry + ' ' + t); carry = ''; continue; }
    if (SUFFIX.has(lt) && parts.length) { parts[parts.length - 1] += ' ' + t; continue; }
    parts.push(t); }
  if (carry) parts.push(carry);
  if (parts.some(p => p.replace(/\s/g, '').length < 2)) return { ok: false, clean: s, parts, err: 'اكتب كل اسم كامل من غير اختصار (مش حرف واحد)' };
  if (parts.length < 3) return { ok: false, clean: s, parts, err: `لازم الاسم الثلاثي: اسم السواق + اسم الأب + اسم الجد. اللي مكتوب ${parts.length === 1 ? 'اسم واحد بس' : 'اسمين بس'}` };
  return { ok: true, clean: s, parts, err: '' };
}
function checkPhone(p) { const d = String(p || '').replace(/[\u0660-\u0669]/g, c => c.charCodeAt(0) - 0x660).replace(/[^\d+]/g, ''); return { clean: d, ok: /^\+?\d{8,15}$/.test(d) }; }
function checkContainer(c) { const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return { clean: s, iso: /^[A-Z]{4}\d{7}$/.test(s) }; }

/* ---------- الحالة ---------- */
let cur = null; // السجل المفتوح في الويزارد
const STEPS = ['بيانات الشحنة', 'تصوير الورق', 'توقيع السواق', 'سيلفي السواق', 'مراجعة وحفظ'];
function newRec() { const now = new Date().toISOString(); return { id: uuid(), v: 1, status: 'draft', step: 0, createdAt: now, updatedAt: now, fields: { container: '', plate: '', phone: '', ref: '', destination: '', notes: '' }, docs: [], driverName: '', nameParts: [], ack: false, selfie: null, by: who(), device: deviceTag(), archived: false, brand: CFG.brand }; }
let saveT = null;
function autosave() { if (!cur) return; try { localStorage.setItem('ho_draft_' + cur.id, JSON.stringify(Object.assign({}, cur, { updatedAt: new Date().toISOString() }))); localStorage.setItem('ho_cur', cur.id); } catch (e) {} clearTimeout(saveT); saveT = setTimeout(() => putRec(cur), 250); }
window.addEventListener('pagehide', () => { if (cur && cur.status === 'draft') putRec(cur); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && cur && cur.status === 'draft') putRec(cur); });

/* ---------- الشاشات ---------- */
const app = () => $('#app');
function nav(html) { let n = $('.navbar'); if (n) n.remove(); if (!html) return; n = document.createElement('div'); n.className = 'navbar'; n.innerHTML = html; document.body.appendChild(n); return n; }
async function showHome() {
  cur = null; try { localStorage.removeItem('ho_cur'); } catch (e) {}
  const rs = (await allRecs()).filter(r => !r.archived);
  const drafts = rs.filter(r => r.status === 'draft').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const saved = rs.filter(r => r.status === 'saved').sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).slice(0, 5);
  app().innerHTML = `<div class="card"><h2>تسليم أصول ورق لسواق حاوية</h2><div class="hint">صوّر الورق اللي السواق مستلمه، واكتب اسمه الثلاثي، وخد له سيلفي واضحة، وفي الآخر بيطلع إيصال PDF.</div>
    <div style="margin-top:12px"><button class="btn blk" id="bNew">➕ تسليم جديد</button></div></div>
    ${drafts.length ? `<div class="sec">مسودات لسه ما خلصتش (محفوظة تلقائي)</div><div class="list">${drafts.map(itemHtml).join('')}</div>` : ''}
    <div class="sec">آخر الإيصالات</div><div class="list">${saved.length ? saved.map(itemHtml).join('') : '<div class="empty">لسه مفيش إيصالات</div>'}</div>
    <button class="btn ol blk" id="bHist">📂 كل الإيصالات والبحث</button>`;
  $('#bNew').onclick = () => { cur = newRec(); autosave(); putRec(cur); showStep(0); };
  $('#bHist').onclick = showHistory;
  bindItems(); nav(''); window.scrollTo(0, 0);
}
function itemHtml(r) {
  const f = r.fields || {}, st = r.status === 'draft' ? `<span class="st wt">مسودة · ${esc(STEPS[r.step || 0])}</span>` : (r.cloudOnly ? '<span class="st">☁︎ على السحابة</span>' : (r.sync && r.sync.state === 'ok' && !r.sync.dirty ? '<span class="st okt">☁︎ مرفوع</span>' : '<span class="st wt">مستني رفع</span>'));
  return `<button class="it" data-id="${r.id}"><div class="l1"><span>${esc(r.serial || 'بدون رقم')} ${r.archived ? '· مؤرشف' : ''}</span>${st}</div>
   <div class="l2">حاوية: <span dir="ltr">${esc(f.container || r.container_no || '—')}</span> · ${esc(r.driverName || r.driver_name || '—')}</div>
   <div class="l2">${esc(fDT(r.savedAt || r.saved_at || r.updatedAt))} · ${(r.docs ? r.docs.length : r.pages) || 0} ورقة</div></button>`;
}
function bindItems() { document.querySelectorAll('.list .it').forEach(b => b.onclick = async () => { const id = b.dataset.id; const r = await getRec(id);
  if (r && r.status === 'draft') { cur = r; localStorage.setItem('ho_cur', r.id); return showStep(r.step || 0); }
  showRecord(id); }); }

function stepHead(i) { return `<div class="stepT">خطوة ${i + 1} من ${STEPS.length}</div><div class="steps">${STEPS.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div><h2>${STEPS[i]}</h2>`; }
function showStep(i) {
  if (!cur) return showHome(); cur.step = i; autosave(); window.scrollTo(0, 0);
  [stepData, stepScan, stepSign, stepSelfie, stepReview][i]();
}
function navStd(i, nextLbl) { const n = nav(`<button class="btn gh" id="bBack">${i ? '→ رجوع' : 'الرئيسية'}</button><button class="btn" id="bNext">${nextLbl || 'التالي ←'}</button>`);
  $('#bBack', n).onclick = () => i ? showStep(i - 1) : showHome(); return n; }

/* 1) بيانات الشحنة */
function stepData() {
  const f = cur.fields, now = new Date();
  app().innerHTML = stepHead(0) + `<div class="card">
   <div class="hint">التاريخ والوقت بيتسجلوا تلقائي وقت الحفظ (توقيت القاهرة) — دلوقتي: <b>${fDT(now)}</b></div>
   <label class="f">رقم الحاوية</label><input class="t ltr" id="iCont" autocapitalize="characters" autocomplete="off" placeholder="MSCU1234567" value="${esc(f.container)}"><div class="err" id="eCont"></div>
   <label class="f">رقم العربية / اللوحة</label><input class="t" id="iPlate" autocomplete="off" value="${esc(f.plate)}"><div class="err" id="ePlate"></div>
   <label class="f">موبايل السواق</label><input class="t ltr" id="iPhone" inputmode="tel" autocomplete="off" placeholder="01xxxxxxxxx" value="${esc(f.phone)}"><div class="err" id="ePhone"></div>
   <label class="f">رقم الشحنة / الفاتورة <span class="opt">(اختياري)</span></label><input class="t" id="iRef" autocomplete="off" value="${esc(f.ref)}">
   <label class="f">الجهة / الميناء <span class="opt">(اختياري)</span></label><input class="t" id="iDest" autocomplete="off" value="${esc(f.destination)}">
   <label class="f">ملاحظات <span class="opt">(اختياري)</span></label><textarea class="t" id="iNotes">${esc(f.notes)}</textarea></div>`;
  const bind = (id, k, fx) => { const el = $(id); el.oninput = () => { cur.fields[k] = fx ? fx(el.value) : el.value; const er = el.nextElementSibling; if (er && er.classList.contains('err')) er.textContent = ''; autosave(); }; };
  bind('#iCont', 'container', v => v.toUpperCase()); bind('#iPlate', 'plate'); bind('#iPhone', 'phone'); bind('#iRef', 'ref'); bind('#iDest', 'destination'); bind('#iNotes', 'notes');
  $('#iCont').addEventListener('blur', () => { const c = checkContainer($('#iCont').value); if (c.clean) { $('#iCont').value = c.clean; cur.fields.container = c.clean; autosave(); } $('#eCont').innerHTML = c.clean && !c.iso ? '<span class="wt">تنبيه: رقم الحاوية عادة 4 حروف + 7 أرقام. اتأكد منه.</span>' : ''; });
  navStd(0).querySelector('#bNext').onclick = () => {
    let bad = false; const c = checkContainer(cur.fields.container), p = checkPhone(cur.fields.phone);
    $('#eCont').textContent = c.clean ? '' : 'اكتب رقم الحاوية'; if (!c.clean) bad = true; else { cur.fields.container = c.clean; }
    $('#ePlate').textContent = cur.fields.plate.trim() ? '' : 'اكتب رقم العربية'; if (!cur.fields.plate.trim()) bad = true;
    $('#ePhone').textContent = p.ok ? '' : 'اكتب رقم موبايل صحيح'; if (!p.ok) bad = true; else cur.fields.phone = p.clean;
    autosave(); if (bad) return toast('كمّل البيانات المطلوبة'); showStep(1);
  };
}

/* 2) تصوير الورق */
let camTarget = null; // null = صفحة جديدة، أو id ورقة للإعادة
async function stepScan() {
  app().innerHTML = stepHead(1) + `<div class="card"><div class="hint">صوّر كل ورقة لوحدها على سطح غامق لو أمكن. البرنامج بيقص حدود الورقة ويعدّل الميل ويحسّن الوضوح، وتقدر تعدّل الأركان بإيدك.</div>
   <div class="row" style="margin-top:10px"><button class="btn" id="bCam">📷 صوّر ورقة</button><button class="btn ol" id="bGal">🖼 من الصور</button></div></div>
   <div class="docs" id="docs"></div>`;
  $('#bCam').onclick = () => { camTarget = null; $('#fCam').value = ''; $('#fCam').click(); };
  $('#bGal').onclick = () => { camTarget = null; $('#fGal').value = ''; $('#fGal').click(); };
  await renderDocs();
  navStd(1).querySelector('#bNext').onclick = () => { if (!cur.docs.length) return toast('صوّر ورقة واحدة على الأقل'); showStep(2); };
}
async function renderDocs() {
  const box = $('#docs'); if (!box) return; const n = cur.docs.length;
  if (!n) { box.innerHTML = '<div class="empty">لسه ما صورتش أي ورقة</div>'; return; }
  box.innerHTML = cur.docs.map((d, i) => `<div class="doc" data-i="${i}"><img data-k="${cur.id}/${d.file}" alt="">
    <div class="b"><div class="n">ورقة ${i + 1} من ${n}</div>
     <select class="t" data-lbl="${i}" style="min-height:42px;margin-top:4px"><option value="">نوع الورقة (اختياري)</option>${CFG.docTypes.map(t => `<option ${d.label === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
     ${d.label === 'أخرى' ? `<input class="t" data-oth="${i}" placeholder="اكتب نوع الورقة" value="${esc(d.other || '')}" style="min-height:42px;margin-top:6px">` : ''}
     <div class="acts"><button class="btn gh" data-a="up" ${i ? '' : 'disabled'}>↑</button><button class="btn gh" data-a="dn" ${i < n - 1 ? '' : 'disabled'}>↓</button><button class="btn gh" data-a="rot">↻ تدوير</button><button class="btn gh" data-a="re">📷 إعادة</button><button class="btn bad" data-a="del">حذف</button></div></div></div>`).join('');
  box.querySelectorAll('img[data-k]').forEach(async im => im.src = await blobUrl(im.dataset.k));
  box.querySelectorAll('select[data-lbl]').forEach(s => s.onchange = () => { const d = cur.docs[+s.dataset.lbl]; d.label = s.value; autosave(); renderDocs(); });
  box.querySelectorAll('input[data-oth]').forEach(s => s.oninput = () => { cur.docs[+s.dataset.oth].other = s.value; autosave(); });
  box.querySelectorAll('.doc').forEach(el => el.querySelectorAll('button[data-a]').forEach(b => b.onclick = async () => {
    const i = +el.dataset.i, a = b.dataset.a, D = cur.docs;
    if (a === 'up' && i) { [D[i - 1], D[i]] = [D[i], D[i - 1]]; }
    else if (a === 'dn' && i < D.length - 1) { [D[i + 1], D[i]] = [D[i], D[i + 1]]; }
    else if (a === 'del') { if (!(await confirmDlg(`حذف الورقة ${i + 1} من القائمة؟`, 'حذف', 'bad'))) return; cur.removed = (cur.removed || []).concat([Object.assign({ at: new Date().toISOString() }, D[i])]); D.splice(i, 1); toast('اتشالت من القائمة'); }
    else if (a === 're') { camTarget = D[i].id; $('#fCam').value = ''; $('#fCam').click(); return; }
    else if (a === 'rot') { b.disabled = true; const blob = await getBlob(cur.id + '/' + D[i].file); const c = HOImg.rotate(await HOImg.fileToCanvas(blob, 2400), 90); const nb = await HOImg.toBlob(c, 0.72);
      const file = 'p-' + uuid().slice(0, 8) + '.jpg'; await putBlob(cur.id + '/' + file, nb); D[i].file = file; D[i].w = c.width; D[i].h = c.height; D[i].size = nb.size; }
    autosave(); renderDocs();
  }));
}
async function onPaperFiles(files) {
  for (const file of files) {
    let src; try { src = await HOImg.fileToCanvas(file, 2400); } catch (e) { toast('تعذر فتح الصورة'); continue; }
    const res = await cropEditor(src); if (!res) continue;
    const blob = await HOImg.toBlob(res.canvas, res.mode === 'color' ? 0.7 : 0.68);
    const file2 = 'p-' + uuid().slice(0, 8) + '.jpg'; await putBlob(cur.id + '/' + file2, blob);
    const meta = { file: file2, w: res.canvas.width, h: res.canvas.height, size: blob.size, mode: res.mode, auto: res.auto, at: new Date().toISOString() };
    if (camTarget) { const d = cur.docs.find(x => x.id === camTarget); if (d) Object.assign(d, meta); camTarget = null; }
    else cur.docs.push(Object.assign({ id: uuid().slice(0, 8), label: '' }, meta));
    autosave(); await putRec(cur); await renderDocs();
  }
}
$('#fCam').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onPaperFiles(f); };
$('#fGal').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onPaperFiles(f); };

/* محرر القص: 4 أركان قابلة للسحب + وضع التحسين + تدوير */
function cropEditor(src0) {
  return new Promise(resolve => {
    const M = $('#modal'); let src = src0, det = HOImg.detectQuad(src), quad = det.quad, mode = 'gray', drag = -1;
    M.innerHTML = `<div class="ed-top">${det.auto ? 'اتحددت حدود الورقة تلقائي — اسحب الأركان لو محتاجة تعديل' : 'ما اتعرفتش حدود الورقة — اسحب الأركان الأربعة على أطراف الورقة'}</div>
     <div class="ed-wrap" id="edW"><canvas id="edC"></canvas></div>
     <div class="ed-bar"><div class="seg" id="edMode"><button data-m="gray" class="on">سكان رمادي</button><button data-m="bw">أبيض وأسود</button><button data-m="color">ألوان</button></div>
      <div class="row"><button class="btn gh" id="edRe">📷 إعادة</button><button class="btn gh" id="edRot">↻ تدوير</button><button class="btn gh" id="edFull">الصورة كاملة</button></div>
      <div class="row"><button class="btn gh" id="edCancel">إلغاء</button><button class="btn" id="edOk" style="flex:2;background:#fff;color:#111;border-color:#fff">✔ اعتماد الورقة</button></div></div>`;
    M.hidden = false;
    const W = $('#edW'), C = $('#edC'), x = C.getContext('2d'); let k = 1;
    function layout() { const bw = W.clientWidth - 24, bh = W.clientHeight - 24; k = Math.min(bw / src.width, bh / src.height); C.width = Math.round(src.width * k); C.height = Math.round(src.height * k); draw(); }
    function draw() { x.clearRect(0, 0, C.width, C.height); x.drawImage(src, 0, 0, C.width, C.height); x.fillStyle = '#0008'; x.beginPath(); x.rect(0, 0, C.width, C.height);
      x.moveTo(quad[0][0] * k, quad[0][1] * k); for (let i = 3; i >= 0; i--) x.lineTo(quad[i][0] * k, quad[i][1] * k); x.closePath(); x.fill('evenodd');
      x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); quad.forEach((p, i) => i ? x.lineTo(p[0] * k, p[1] * k) : x.moveTo(p[0] * k, p[1] * k)); x.closePath(); x.stroke();
      quad.forEach(p => { x.beginPath(); x.arc(p[0] * k, p[1] * k, 13, 0, 7); x.fillStyle = '#fffc'; x.fill(); x.strokeStyle = '#1b2a4a'; x.lineWidth = 3; x.stroke(); }); }
    const pt = e => { const r = C.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return [(t.clientX - r.left) / k, (t.clientY - r.top) / k]; };
    const down = e => { const p = pt(e); let best = -1, bd = 1e9; quad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } }); if (bd * k < 48) { drag = best; e.preventDefault(); } };
    const move = e => { if (drag < 0) return; e.preventDefault(); const p = pt(e); quad[drag] = [Math.max(0, Math.min(src.width, p[0])), Math.max(0, Math.min(src.height, p[1]))]; draw(); };
    const up = () => { drag = -1; };
    C.addEventListener('pointerdown', down); window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up);
    const close = v => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('resize', layout); M.hidden = true; M.innerHTML = ''; resolve(v); };
    window.addEventListener('resize', layout); requestAnimationFrame(layout);
    $('#edMode').querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m; $('#edMode').querySelectorAll('button').forEach(z => z.classList.toggle('on', z === b)); });
    $('#edRot').onclick = () => { const w = src.width, h = src.height; src = HOImg.rotate(src, 90); quad = quad.map(p => [h - p[1], p[0]]); quad = [quad[3], quad[0], quad[1], quad[2]]; layout(); };
    $('#edFull').onclick = () => { quad = HOImg.fullQuad(src); draw(); };
    $('#edCancel').onclick = () => close(null);
    $('#edRe').onclick = () => { close(null); $('#fCam').value = ''; $('#fCam').click(); };
    $('#edOk').onclick = () => { $('#edOk').disabled = true; $('#edOk').textContent = '⏳ بيتحسّن…'; setTimeout(() => { let out = HOImg.warp(src, quad, 1700); out = HOImg.enhance(out, mode); close({ canvas: out, mode, auto: det.auto }); }, 30); };
  });
}

/* 3) توقيع السواق = الاسم الثلاثي + إقرار */
function stepSign() {
  const n = cur.docs.length;
  app().innerHTML = stepHead(2) + `<div class="card"><label class="f">اسم السواق الثلاثي (كما في البطاقة)</label>
    <input class="t" id="iName" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="مثال: محمد أحمد علي" value="${esc(cur.driverName)}">
    <div class="err" id="eName"></div><div class="chips" id="nChips"></div>
    <div class="hint">لازم 3 أسماء على الأقل (الاسم + الأب + الجد). «عبد الله» و«أبو بكر» بيتحسبوا اسم واحد.</div></div>
    <label class="chk"><input type="checkbox" id="iAck" ${cur.ack ? 'checked' : ''}><span>أقر بأنني استلمت أصول الأوراق الموضحة (عدد ${n} ${n === 1 ? 'ورقة' : 'ورقات'}) بحالة سليمة، وأتعهد بتسليمها للجهة المختصة.</span></label>`;
  const show = () => { const c = checkName($('#iName').value); $('#nChips').innerHTML = c.parts.map(p => `<span>${esc(p)}</span>`).join('') + (c.parts.length ? `<span class="${c.ok ? 'okt' : 'wt'}">${c.parts.length} ${c.parts.length > 2 ? 'أسماء ✔' : 'أسماء'}</span>` : ''); return c; };
  $('#iName').oninput = () => { cur.driverName = $('#iName').value; autosave(); show(); $('#eName').textContent = ''; };
  $('#iName').onblur = () => { const c = show(); if (c.clean && !c.ok) $('#eName').textContent = c.err; };
  $('#iAck').onchange = () => { cur.ack = $('#iAck').checked; autosave(); };
  show();
  navStd(2).querySelector('#bNext').onclick = () => { const c = checkName($('#iName').value); if (!c.ok) { $('#eName').textContent = c.err; $('#iName').focus(); return toast(c.err, 3500); }
    cur.driverName = c.clean; cur.nameParts = c.parts; if (!cur.ack) return toast('لازم السواق يأكد الإقرار بالاستلام'); autosave(); showStep(3); };
}

/* 4) سيلفي السواق */
async function stepSelfie() {
  const s = cur.selfie;
  app().innerHTML = stepHead(3) + `<div class="card"><div class="hint">الكاميرا الأمامية: الوش كله باين، في نور كويس، من غير نضارة شمس أو كمامة. الموبايل ثابت.</div>
   ${s ? `<img class="selfie" id="sImg" alt="">` : '<div class="empty">لسه مفيش صورة</div>'}
   <ul class="qc" id="qc">${s ? qcHtml(s.checks) : ''}</ul>
   <button class="btn ${s ? 'ol' : ''} blk" id="bSelfie">🤳 ${s ? 'إعادة السيلفي' : 'صوّر سيلفي للسواق'}</button></div>`;
  if (s) $('#sImg').src = await blobUrl(cur.id + '/' + s.file);
  $('#bSelfie').onclick = () => { $('#fSelfie').value = ''; $('#fSelfie').click(); };
  navStd(3).querySelector('#bNext').onclick = () => { const v = selfieVerdict(cur.selfie); if (!cur.selfie) return toast('لازم سيلفي للسواق');
    if (v.block) return toast(v.msg, 3500); showStep(4); };
}
function qcHtml(c) { if (!c) return ''; const L = [];
  L.push(c.dark ? '<li class="wt">⚠ الصورة ضلمة — قرّب من النور</li>' : (c.over ? '<li class="wt">⚠ الصورة منورة زيادة</li>' : '<li class="okt">✔ الإضاءة كويسة</li>'));
  L.push(c.blur ? '<li class="wt">⚠ الصورة مهزوزة أو مش واضحة</li>' : '<li class="okt">✔ الصورة واضحة</li>');
  if (c.face === 'ok') L.push('<li class="okt">✔ الوش ظاهر</li>'); else if (c.face === 'none') L.push('<li class="wt">⚠ مش لاقي وش واضح في الصورة</li>'); else if (c.face === 'many') L.push('<li class="wt">⚠ في أكتر من وش — صوّر السواق لوحده</li>'); else if (c.face === 'small') L.push('<li class="wt">⚠ الوش صغير — قرّب الموبايل</li>'); else L.push('<li class="hint">• كشف الوش مش متاح على الجهاز ده — اتأكد بعينك إن الوش واضح</li>');
  if (c.override) L.push('<li class="hint">• اتقبلت رغم التحذير بعد أكتر من محاولة</li>');
  return L.join(''); }
function selfieVerdict(s) { if (!s) return { block: true, msg: 'لازم سيلفي' }; const c = s.checks || {};
  const hard = c.dark || c.blur || c.face === 'none' || c.face === 'many'; if (hard && !c.override) return { block: true, msg: 'الصورة مش واضحة — اعمل إعادة السيلفي' }; return { block: false }; }
$('#fSelfie').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !cur) return; toast('⏳ بفحص الصورة…');
  let c; try { c = await HOImg.fileToCanvas(file, 960); } catch (er) { return toast('تعذر فتح الصورة'); }
  const q = HOImg.quality(c); const fr = await HOImg.detectFaces(c);
  const checks = { mean: q.mean, sharp: q.sharp, dark: q.mean < 70 || q.darkFrac > 0.55, over: q.mean > 230 || q.brightFrac > 0.5, blur: q.sharp < 40, faceMethod: fr.method };
  if (!fr.faces) checks.face = 'unsupported'; else if (!fr.faces.length) checks.face = 'none'; else if (fr.faces.length > 1) checks.face = 'many';
  else { const f = fr.faces[0]; checks.face = (f.w / c.width < 0.18 && f.h / c.height < 0.18) ? 'small' : 'ok'; checks.faceBox = f; }
  const blob = await HOImg.toBlob(HOImg.scaled(c, 720), 0.78); const fname = 's-' + uuid().slice(0, 8) + '.jpg'; await putBlob(cur.id + '/' + fname, blob);
  const attempts = ((cur.selfie && cur.selfie.attempts) || 0) + 1;
  const bad = checks.dark || checks.blur || checks.face === 'none' || checks.face === 'many';
  if (bad && attempts >= 3) { const ov = await dialog('الصورة لسه عليها تحذير بعد ' + attempts + ' محاولات. تعيد تاني ولا تعتمدها؟ (هيتسجل في الإيصال إنها اتقبلت رغم التحذير)', [{ t: 'إعادة السيلفي', v: false }, { t: 'اعتمادها', v: true, cls: 'gh' }]); if (ov) checks.override = true; }
  if (cur.selfie && cur.selfie.file) cur.oldSelfies = (cur.oldSelfies || []).concat([cur.selfie.file]);
  cur.selfie = { file: fname, w: c.width, h: c.height, size: blob.size, at: new Date().toISOString(), checks, attempts };
  autosave(); await putRec(cur); stepSelfie(); toast(bad && !checks.override ? 'الصورة مش واضحة — اعمل إعادة' : (checks.face === 'small' || checks.over ? 'اتحفظت مع تحذير' : 'تمام ✔'), 3000);
};

/* 5) مراجعة وحفظ */
async function stepReview() {
  const f = cur.fields;
  app().innerHTML = stepHead(4) + `<div class="card"><div class="kv"><b>الحاوية</b><span dir="ltr" style="text-align:right">${esc(f.container)}</span><b>العربية</b><span>${esc(f.plate)}</span><b>موبايل السواق</b><span dir="ltr" style="text-align:right">${esc(f.phone)}</span>
    ${f.ref ? `<b>الشحنة/الفاتورة</b><span>${esc(f.ref)}</span>` : ''}${f.destination ? `<b>الجهة/الميناء</b><span>${esc(f.destination)}</span>` : ''}${f.notes ? `<b>ملاحظات</b><span>${esc(f.notes)}</span>` : ''}
    <b>السواق</b><span>${esc(cur.driverName)}</span><b>عدد الورق</b><span>${cur.docs.length}</span></div></div>
    <div class="card"><div class="sec" style="margin-top:0">الورق</div><div class="thumbs" id="th"></div></div>
    <div class="card"><div class="sec" style="margin-top:0">السيلفي</div><img class="selfie" id="sImg" style="max-width:180px" alt=""></div>
    <div class="hint">بعد الحفظ الإيصال بياخد رقم مسلسل وما يتعدلش، وبيترفع للسحابة.</div>`;
  $('#th').innerHTML = cur.docs.map(d => `<img data-k="${cur.id}/${d.file}" alt="">`).join(''); $('#th').querySelectorAll('img').forEach(async im => im.src = await blobUrl(im.dataset.k));
  $('#sImg').src = await blobUrl(cur.id + '/' + cur.selfie.file);
  const n = navStd(4, '✔ حفظ وإصدار الإيصال'); $('#bNext', n).onclick = async () => {
    const pr = [checkName(cur.driverName).ok, cur.ack, cur.docs.length > 0, !selfieVerdict(cur.selfie).block]; if (pr.includes(false)) return toast('في خطوة ناقصة — راجع البيانات');
    $('#bNext', n).disabled = true; $('#bNext', n).textContent = '⏳ بيتحفظ…'; await saveFinal(); };
}
async function saveFinal() {
  const r = cur; let serial = '', offline = false;
  try { if (!navigator.onLine) throw new Error('offline'); serial = (await api('serial', { method: 'POST', timeout: 15000 })).serial; }
  catch (e) { const p = cairoParts(new Date()); serial = `TA-${p.year}-L${p.day}${p.month}${p.hour}${p.minute}-${deviceTag().slice(0, 3).toUpperCase()}`; offline = true; }
  r.serial = serial; r.serialOffline = offline; r.status = 'saved'; r.savedAt = new Date().toISOString(); r.by = r.by || who(); r.sync = { state: 'pending', files: {} };
  await putRec(r); try { localStorage.removeItem('ho_cur'); } catch (e) {}
  cur = null; toast(offline ? 'اتحفظ على الجهاز — هيترفع أول ما النت يرجع' : 'اتحفظ ✔ بيترفع للسحابة…', 3000);
  showRecord(r.id); syncOne(r).then(() => { updBadge(); if ($('#recSync')) $('#recSync').innerHTML = '<span class="okt">☁︎ مرفوع على السحابة</span>'; }).catch(e => { updBadge(); if ($('#recSync')) $('#recSync').innerHTML = `<span class="wt">مستني رفع: ${esc(e.message)}</span>`; });
}

/* ---------- عرض إيصال ---------- */
async function showRecord(id) {
  let r = await getRec(id);
  if (!r || r.cloudOnly) { app().innerHTML = '<div class="empty">⏳ بجيب الإيصال من السحابة…</div>'; nav(''); try { r = await fetchCloud(id); } catch (e) { app().innerHTML = `<div class="empty">تعذر فتح الإيصال: ${esc(e.message)}</div>`; nav('<button class="btn gh" id="bH">الرئيسية</button>'); $('#bH').onclick = showHome; return; } }
  const f = r.fields || {};
  const syncTxt = r.sync && r.sync.state === 'ok' && !r.sync.dirty ? '<span class="okt">☁︎ مرفوع على السحابة</span>' : `<span class="wt">مستني رفع${r.sync && r.sync.err ? ': ' + esc(r.sync.err) : ''}</span>`;
  app().innerHTML = `<div class="card"><h2 style="margin-bottom:2px">إيصال ${esc(r.serial)}</h2><div class="hint">${esc(fDT(r.savedAt))}${r.serialOffline ? ' · رقم اتعمل أوفلاين' : ''}${r.archived ? ' · مؤرشف' : ''}</div><div id="recSync" class="hint">${syncTxt}</div>
   <div class="kv" style="margin-top:10px"><b>الحاوية</b><span dir="ltr" style="text-align:right">${esc(f.container)}</span><b>العربية</b><span>${esc(f.plate)}</span><b>السواق</b><span>${esc(r.driverName)}</span><b>الموبايل</b><span dir="ltr" style="text-align:right">${esc(f.phone)}</span>${f.ref ? `<b>الشحنة/الفاتورة</b><span>${esc(f.ref)}</span>` : ''}${f.destination ? `<b>الجهة</b><span>${esc(f.destination)}</span>` : ''}<b>عدد الورق</b><span>${r.docs.length}</span>${r.by ? `<b>سجّله</b><span>${esc(r.by.label || r.by.username)}</span>` : ''}</div></div>
   <div class="card"><div class="thumbs" id="th"></div></div>
   <div class="card"><div class="row"><button class="btn" id="bShare">📤 مشاركة PDF</button><button class="btn ol" id="bDl">⬇ تحميل PDF</button></div>
    <div class="row" style="margin-top:8px"><button class="btn gh" id="bSync">☁︎ رفع الآن</button><button class="btn gh" id="bArch">${r.archived ? 'إلغاء الأرشفة' : '🗄 أرشفة'}</button></div></div>`;
  $('#th').innerHTML = r.docs.map(d => `<img data-k="${r.id}/${d.file}" alt="">`).join('') + (r.selfie ? `<img data-k="${r.id}/${r.selfie.file}" alt="">` : ''); $('#th').querySelectorAll('img').forEach(async im => im.src = await blobUrl(im.dataset.k));
  $('#bShare').onclick = () => sharePdf(r); $('#bDl').onclick = () => downloadPdf(r);
  $('#bSync').onclick = async () => { toast('⏳ بيرفع…'); try { await syncOne(r); toast('☁︎ اترفع'); showRecord(r.id); } catch (e) { toast('تعذر الرفع: ' + e.message, 4000); } updBadge(); };
  $('#bArch').onclick = async () => { const on = !r.archived; if (!(await confirmDlg(on ? 'أرشفة الإيصال؟ (مش هيتمسح، هيتنقل للأرشيف وتقدر ترجّعه)' : 'إرجاع الإيصال من الأرشيف؟', on ? 'أرشفة' : 'إرجاع'))) return;
    r.archived = on; r.archivedAt = on ? new Date().toISOString() : null; await putRec(r); try { await api('archive', { body: { id: r.id, archived: on } }); } catch (e) { r.sync = r.sync || {}; r.sync.dirty = true; await putRec(r); } toast(on ? 'اتأرشف' : 'رجع'); showRecord(r.id); };
  nav('<button class="btn gh" id="bH">الرئيسية</button><button class="btn ol" id="bL">📂 الإيصالات</button>'); $('#bH').onclick = showHome; $('#bL').onclick = showHistory;
  pdfFor(r).catch(() => {});
}
async function fetchCloud(id) {
  const d = await api('get', { qs: '&id=' + id }); const r = d.row.data; r.archived = d.row.archived; r.sync = { state: 'ok', files: {} };
  for (const f of fileList(r)) { if (await getBlob(f.key)) { r.sync.files[f.name] = true; continue; } const u = d.files[f.name]; if (!u) continue; const b = await (await fetch(u)).blob(); await putBlob(f.key, b); r.sync.files[f.name] = true; }
  await putRec(r); return r;
}

/* ---------- السجل والبحث ---------- */
let H = { q: '', from: '', to: '', arch: false };
function parseDMY(s) { const m = String(s || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (!m) return null; return { d: +m[1], m: +m[2], y: +m[3] }; }
function dmyToIso(p, end) { // منتصف الليل بتوقيت القاهرة تقريبًا (UTC+2/+3) — بنستخدم حدود واسعة ساعتين
  const t = Date.UTC(p.y, p.m - 1, p.d) + (end ? 86400000 : 0) - 2 * 3600000; return new Date(t).toISOString(); }
async function showHistory() {
  cur = null;
  app().innerHTML = `<h2>كل الإيصالات</h2><div class="card"><div class="srch"><input class="t" id="hq" placeholder="ابحث: حاوية، سواق، رقم إيصال، موبايل" value="${esc(H.q)}"></div>
   <div class="dates"><input class="t" id="hf" inputmode="numeric" placeholder="من يوم/شهر/سنة" value="${esc(H.from)}"><input class="t" id="ht" inputmode="numeric" placeholder="إلى يوم/شهر/سنة" value="${esc(H.to)}"></div>
   <label class="chk" style="margin-top:8px;padding:6px 10px"><input type="checkbox" id="ha" ${H.arch ? 'checked' : ''}><span>عرض المؤرشف</span></label><div class="err" id="he"></div></div>
   <div class="list" id="hl"><div class="empty">⏳</div></div>`;
  let t; const go = () => { clearTimeout(t); t = setTimeout(loadHist, 300); };
  $('#hq').oninput = () => { H.q = $('#hq').value; go(); }; $('#hf').oninput = () => { H.from = $('#hf').value; go(); }; $('#ht').oninput = () => { H.to = $('#ht').value; go(); }; $('#ha').onchange = () => { H.arch = $('#ha').checked; go(); };
  nav('<button class="btn gh" id="bH">الرئيسية</button><button class="btn" id="bN">➕ تسليم جديد</button>'); $('#bH').onclick = showHome; $('#bN').onclick = () => { cur = newRec(); autosave(); putRec(cur); showStep(0); };
  loadHist();
}
async function loadHist() {
  const pf = H.from ? parseDMY(H.from) : null, pt = H.to ? parseDMY(H.to) : null;
  $('#he').textContent = (H.from && !pf) || (H.to && !pt) ? 'اكتب التاريخ كده: 18/11/2026' : '';
  const fromI = pf ? dmyToIso(pf) : '', toI = pt ? dmyToIso(pt, true) : '';
  const q = H.q.trim().toLowerCase();
  const local = (await allRecs()).filter(r => r.status === 'saved' && !!r.archived === H.arch);
  const match = r => { const f = r.fields || {}; const hay = [r.serial, f.container, f.plate, f.phone, f.ref, r.driverName].join(' ').toLowerCase(); if (q && !hay.includes(q)) return false; if (fromI && (r.savedAt || '') < fromI) return false; if (toI && (r.savedAt || '') > toI) return false; return true; };
  const m = new Map(local.filter(match).map(r => [r.id, r]));
  const paint = () => { const arr = [...m.values()].sort((a, b) => (b.savedAt || b.saved_at || '').localeCompare(a.savedAt || a.saved_at || '')); $('#hl').innerHTML = arr.length ? arr.map(itemHtml).join('') : '<div class="empty">مفيش نتايج</div>'; bindItems(); };
  paint();
  if (!navigator.onLine) return;
  try { const d = await api('list', { qs: '&q=' + encodeURIComponent(H.q.trim()) + (fromI ? '&from=' + fromI : '') + (toI ? '&to=' + toI : '') + (H.arch ? '&archived=1' : '') });
    d.rows.forEach(row => { if (!m.has(row.id) && !local.find(r => r.id === row.id)) m.set(row.id, Object.assign({ cloudOnly: true, savedAt: row.saved_at, fields: { container: row.container_no }, driverName: row.driver_name }, row)); }); paint(); }
  catch (e) { $('#he').textContent = 'السحابة مش متاحة دلوقتي — بيظهر اللي على الجهاز بس'; }
}

/* ---------- PDF الإيصال (يترسم على canvas عشان الحروف العربي تتشكل صح) ---------- */
const PDFC = new Map();
function pdfFor(r) { const k = r.id + ':' + r.updatedAt; if (!PDFC.has(k)) { const p = buildPdf(r); PDFC.set(k, p); p.catch(() => PDFC.delete(k)); } return PDFC.get(k); }
const imgCache = {};
async function brandImg(src) { if (!src) return null; if (!imgCache[src]) imgCache[src] = HOImg.loadImg(src).catch(() => null); return imgCache[src]; }
async function recImg(r, file) { const u = await blobUrl(r.id + '/' + file); return u ? HOImg.loadImg(u).catch(() => null) : null; }
async function renderPages(r) {
  try { await Promise.all(['400', '700', '800'].map(w => document.fonts.load(w + ' 24px Cairo', 'أبجد 123'))); } catch (e) {}
  const B = CFG.brands[r.brand] || BR, HDR = await brandImg(B.header), FTR = await brandImg(B.footer);
  const W = 1240, Hh = 1754, M = 64, RX = W - M, CW = W - 2 * M, FF = 'Cairo,"Geeza Pro","Noto Naskh Arabic",Tahoma,sans-serif';
  const HD = HDR ? Math.round(HDR.naturalHeight / HDR.naturalWidth * W) : 120, FT = FTR ? Math.round(FTR.naturalHeight / FTR.naturalWidth * W) : 80;
  const pages = []; let x;
  const newPage = () => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, Hh); if (HDR) x.drawImage(HDR, 0, 0, W, HD); if (FTR) x.drawImage(FTR, 0, Hh - FT, W, FT); pages.push(c); return c; };
  const font = (s, w) => { x.font = `${w || 400} ${s}px ${FF}`; };
  const T = (s, px, py, o = {}) => { font(o.s || 22, o.w); x.fillStyle = o.c || '#000'; x.textAlign = o.a || 'right'; x.direction = o.d || 'rtl'; x.textBaseline = 'alphabetic'; x.fillText(String(s == null ? '' : s), px, py, o.max || undefined); };
  const wrap = (s, maxW, sz, w) => { font(sz, w); const out = []; let line = ''; String(s).split(/\s+/).forEach(wd => { const t = line ? line + ' ' + wd : wd; if (x.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t; }); if (line) out.push(line); return out; };
  const contain = (img, bx, by, bw, bh) => { const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; x.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h); return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h }; };
  const f = r.fields || {}, n = r.docs.length, by = r.by ? (r.by.label || r.by.username) : '';
  // صفحة 1
  newPage(); let y = HD + 54;
  T('إيصال تسليم أصول ورق', RX, y, { s: 40, w: 800, c: B.ink }); T(r.serial, M, y - 14, { s: 24, w: 700, a: 'left', d: 'ltr' }); T(fDT(r.savedAt), M, y + 16, { s: 20, a: 'left', d: 'rtl', c: '#333' });
  y += 34; x.fillStyle = B.ink; x.fillRect(M, y, CW, 3); y += 22;
  const rows = [['رقم الحاوية', f.container, 'ltr'], ['رقم العربية / اللوحة', f.plate], ['اسم السواق', r.driverName], ['موبايل السواق', f.phone, 'ltr'], ['رقم الشحنة / الفاتورة', f.ref], ['الجهة / الميناء', f.destination], ['تاريخ ووقت التسليم', fDT(r.savedAt) + ' (توقيت القاهرة)'], ['عدد الأوراق المسلّمة', String(n)], ['سجّله', by]].filter(rw => rw[1]);
  const LW = 300, rh = 46; rows.forEach((rw, i) => { if (i % 2 === 0) { x.fillStyle = '#f5f6f8'; x.fillRect(M, y, CW, rh); } T(rw[0], RX - 14, y + 31, { s: 21, w: 700, c: '#444' }); if (rw[2] === 'ltr') T(rw[1], RX - LW, y + 31, { s: 22, w: 700, d: 'ltr', a: 'right', max: CW - LW - 20 }); else T(rw[1], RX - LW, y + 31, { s: 22, w: 600, max: CW - LW - 20 }); y += rh; });
  x.strokeStyle = '#ccc'; x.lineWidth = 1; x.strokeRect(M, y - rh * rows.length, CW, rh * rows.length); y += 14;
  if (f.notes) { const L = wrap('ملاحظات: ' + f.notes, CW - 20, 20); L.slice(0, 3).forEach(l => { T(l, RX - 10, y + 24, { s: 20, c: '#333' }); y += 30; }); y += 6; }
  // جدول الأوراق
  T('الأوراق المسلّمة', RX, y + 30, { s: 26, w: 800, c: B.ink }); y += 44;
  const cols = [{ t: 'م', w: 70 }, { t: 'نوع الورقة', w: 640 }, { t: 'رقم الصفحة في الإيصال', w: CW - 710 }];
  x.fillStyle = '#e9ebf0'; x.fillRect(M, y, CW, 40); let cx = RX; cols.forEach(c => { T(c.t, cx - 12, y + 28, { s: 19, w: 700 }); cx -= c.w; }); y += 40;
  const maxRows = Math.min(n, 12); for (let i = 0; i < maxRows; i++) { const d = r.docs[i]; cx = RX; [String(i + 1), d.label === 'أخرى' ? (d.other || 'أخرى') : (d.label || 'ورقة'), String(i + 2)].forEach((v, k) => { T(v, cx - 12, y + 29, { s: 20, max: cols[k].w - 20 }); cx -= cols[k].w; }); x.fillStyle = '#ddd'; x.fillRect(M, y + 40, CW, 1); y += 41; }
  if (n > maxRows) { T(`… و${n - maxRows} ورقات أخرى (مرفقة بالصفحات التالية)`, RX - 12, y + 28, { s: 19, c: '#555' }); y += 40; }
  x.strokeStyle = '#ccc'; x.strokeRect(M, y - 41 * maxRows - 40 - (n > maxRows ? 40 : 0), CW, 41 * maxRows + 40 + (n > maxRows ? 40 : 0)); y += 20;
  // الإقرار والتوقيع
  const avail = Hh - FT - 30 - y, sigH = Math.max(300, Math.min(430, avail));
  x.strokeStyle = '#999'; x.lineWidth = 1.5; x.strokeRect(M, y, CW, sigH);
  const selfie = r.selfie ? await recImg(r, r.selfie.file) : null, SW = Math.round((sigH - 40) * 0.75);
  if (selfie) { x.save(); const bx = M + 20, byy = y + 20, bh = sigH - 40; x.beginPath(); x.rect(bx, byy, SW, bh); x.clip(); const k = Math.max(SW / selfie.naturalWidth, bh / selfie.naturalHeight); x.drawImage(selfie, bx + (SW - selfie.naturalWidth * k) / 2, byy + (bh - selfie.naturalHeight * k) / 2, selfie.naturalWidth * k, selfie.naturalHeight * k); x.restore(); x.strokeStyle = '#bbb'; x.strokeRect(M + 20, y + 20, SW, sigH - 40); }
  const tx0 = RX - 24, tw = CW - SW - 70; let ty = y + 46;
  T('إقرار استلام', tx0, ty, { s: 24, w: 800, c: B.ink }); ty += 40;
  wrap(`أقر أنا / ${r.driverName} بأنني استلمت أصول الأوراق الموضحة أعلاه وعددها (${n}) ${n === 1 ? 'ورقة' : 'ورقات'} بحالة سليمة، وأتعهد بتسليمها للجهة المختصة.`, tw, 21).forEach(l => { T(l, tx0, ty, { s: 21 }); ty += 34; });
  ty += 14; T('توقيع السواق (الاسم الثلاثي):', tx0, ty, { s: 19, c: '#555' }); ty += 50; T(r.driverName, tx0, ty, { s: 34, w: 800, max: tw }); ty += 14; x.fillStyle = '#333'; x.fillRect(tx0 - tw, ty, tw, 1.5); ty += 34;
  T(`التاريخ والوقت: ${fDT(r.savedAt)}`, tx0, ty, { s: 19, c: '#444' }); ty += 30; T('صورة السواق وقت الاستلام', M + 20 + SW / 2, y + sigH - 4, { s: 15, a: 'center', c: '#666' });
  if (r.selfie && r.selfie.checks && r.selfie.checks.override) { T('(صورة السواق اتقبلت رغم تحذير الوضوح)', tx0, ty, { s: 16, c: '#8a5a00' }); }
  T(`${r.serial} · صفحة 1 من ${n + 1}`, W / 2, Hh - FT - 10, { s: 15, a: 'center', c: '#777', d: 'ltr' });
  // صفحات الورق المصوّر
  for (let i = 0; i < n; i++) { const d = r.docs[i]; newPage(); const img = await recImg(r, d.file); const top = HD + 20, bot = Hh - FT - 44;
    T(`ورقة ${i + 1} من ${n}${d.label ? ' — ' + (d.label === 'أخرى' ? (d.other || 'أخرى') : d.label) : ''}`, RX, top + 26, { s: 22, w: 700, c: B.ink }); T(r.serial + ' · ' + f.container, M, top + 26, { s: 18, a: 'left', d: 'ltr', c: '#555' });
    if (img) { const b = contain(img, M, top + 42, CW, bot - top - 50); x.strokeStyle = '#bbb'; x.lineWidth = 1; x.strokeRect(b.x, b.y, b.w, b.h); } else T('الصورة مش موجودة على الجهاز', W / 2, Hh / 2, { s: 24, a: 'center', c: '#b42318' });
    T(`${r.serial} · صفحة ${i + 2} من ${n + 1}`, W / 2, Hh - FT - 10, { s: 15, a: 'center', c: '#777', d: 'ltr' }); }
  return pages;
}
async function buildPdf(r) { const pages = await renderPages(r), jp = [];
  for (const c of pages) { const b = await HOImg.toBlob(c, 0.82); jp.push({ bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }); }
  return { blob: makePdf(jp, 'إيصال تسليم أصول ورق ' + r.serial), pages, name: 'ايصال_تسليم_' + String(r.serial).replace(/[^\w-]/g, '_') + '.pdf' }; }
function pdfStr(s) { let h = 'FEFF'; for (const ch of String(s)) { const c = ch.codePointAt(0); if (c > 0xffff) { const v = c - 0x10000; h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 1023)).toString(16).padStart(4, '0'); } else h += c.toString(16).padStart(4, '0'); } return '<' + h.toUpperCase() + '>'; }
function makePdf(imgs, title) { const enc = new TextEncoder(), parts = [], off = []; let len = 0; const push = b => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
  const PW = 595.28, PHt = 841.89, info = 3 + imgs.length * 3, cnt = info; push('%PDF-1.4\n%\u00ff\u00ff\n');
  const obj = (i, body) => { off[i] = len; push(i + ' 0 obj\n'); body(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Count ' + imgs.length + ' /Kids [' + imgs.map((_, k) => (3 + k * 3) + ' 0 R').join(' ') + '] >>'));
  imgs.forEach((im, k) => { const p = 3 + k * 3, cs = 'q ' + PW + ' 0 0 ' + PHt + ' 0 0 cm /Im0 Do Q';
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PHt}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`));
    obj(p + 1, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); push(im.bytes); push('\nendstream'); });
    obj(p + 2, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`)); });
  obj(info, () => push(`<< /Title ${pdfStr(title || '')} /Producer (paper-handover) >>`));
  const xref = len; let xr = 'xref\n0 ' + (cnt + 1) + '\n0000000000 65535 f \n'; for (let i = 1; i <= cnt; i++) xr += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  push(xr + `trailer\n<< /Size ${cnt + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`); return new Blob(parts, { type: 'application/pdf' }); }
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
async function downloadPdf(r) { toast('⏳ بجهّز الـ PDF…'); try { const o = await pdfFor(r); dl(o.blob, o.name); } catch (e) { toast('تعذر تجهيز الـ PDF: ' + (e.message || e)); } }
async function sharePdf(r) { let o; toast('⏳ بجهّز الـ PDF…'); try { o = await pdfFor(r); } catch (e) { return toast('تعذر تجهيز الـ PDF'); }
  const file = new File([o.blob], o.name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'إيصال ' + r.serial }); return; } catch (e) { if (e.name === 'AbortError') return; if (e.name === 'NotAllowedError') return toast('الـ PDF جاهز — دوس «مشاركة PDF» تاني', 4000); } }
  dl(o.blob, o.name); }
window.HO = { checkName, pdfFor, renderPages, getRec, allRecs, syncAll, showRecord };

/* ---------- تشغيل ---------- */
async function boot() {
  $('#brandLogo').src = BR.logo; $('#brandName').textContent = BR.name;
  if (testKey) $('#testBanner').hidden = false;
  if (!HAS_IDB) warnStore('التخزين المحلي (IndexedDB) مقفول على المتصفح ده');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  let resumeId = ''; try { resumeId = localStorage.getItem('ho_cur') || ''; } catch (e) {}
  const r = resumeId ? await getRec(resumeId) : null;
  if (r && r.status === 'draft' && !r.archived) { cur = r; showStep(r.step || 0); toast('رجعتلك المسودة اللي كنت شغال عليها'); } else showHome();
  updBadge(); syncAll(); setInterval(syncAll, 60000); window.addEventListener('online', syncAll); window.addEventListener('offline', updBadge);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
