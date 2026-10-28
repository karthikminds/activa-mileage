'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_PRICE = { value: 116.15, date: '2026-10-24', source: 'goodreturns' };
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const SERIES = { petrol: '#6d5dfc', service: '#14b8a6', other: '#f59e0b' };
const SERVICE_ITEMS = ['General service', 'Engine oil', 'Air filter', 'Spark plug', 'Brake shoes', 'Tyres', 'Battery', 'Drive belt', 'Other'];
const EXPENSE_CATS = [['Parking', '🅿️'], ['Washing', '🧽'], ['Repair', '🛠️'], ['Accessories', '🎒'], ['Insurance', '🛡️'], ['PUC', '🌿'], ['Toll', '🛣️'], ['Other', '🧾']];
const LOG_PURPOSES = [['Office', '💼'], ['Personal', '🙂'], ['Shopping', '🛍️'], ['Family', '👨‍👩‍👧'], ['Travel', '🧭'], ['Delivery', '📦'], ['Other', '📝']];
const DOC_TYPES = [['insurance', '🛡️', 'Insurance'], ['puc', '🌿', 'PUC certificate'], ['rc', '📄', 'RC (registration)'], ['licence', '🪪', 'Driving licence']];

/* ---------- small helpers ---------- */
const inr = (n, dec = 0) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const inrShort = n => n >= 1000 ? '₹' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '₹' + Math.round(n);
const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const todayStr = () => localISO(new Date()).slice(0, 10);
const monthKey = d => d.slice(0, 7);
const monthName = (key, long) => new Date(key + '-01T00:00').toLocaleDateString('en-IN', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined });
const fmtDate = ts => new Date(ts.length === 10 ? ts + 'T00:00' : ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const avgOf = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The toast lives inside whichever sheet is open, otherwise the open sheet would cover it.
function toast(msg, bad) {
  const t = $('toast');
  (document.querySelector('dialog[open]') || document.body).appendChild(t);
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 2600);
}
window.addEventListener('error', e => toast('Something went wrong: ' + e.message, true));
window.addEventListener('unhandledrejection', e => toast('Something went wrong: ' + ((e.reason && e.reason.message) || e.reason), true));

const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('activa-settings')) || {}; } catch (e) {}
  return {
    get: (k, d) => (k in s ? s[k] : d),
    set: (k, v) => { s[k] = v; try { localStorage.setItem('activa-settings', JSON.stringify(s)); } catch (e) {} }
  };
})();
const profile = () => Object.assign({
  name: settings.get('vehicle', 'My Activa'), model: '', reg: '', buy: '',
  tank: 5.3, svcKm: 3000, svcMonths: 4, oilKm: 3000
}, settings.get('profile', {}));

/* ---------- theme ---------- */
function applyTheme() {
  const t = settings.get('theme', 'light');
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelector('meta[name=theme-color]').content = css('--bg');
  try { drawCharts(); } catch (e) { /* first call runs before the data is loaded */ }
}
applyTheme();

/* ---------- storage (IndexedDB) ---------- */
let db;
const STORES = [['entries', { keyPath: 'id' }], ['photos'], ['services', { keyPath: 'id' }], ['expenses', { keyPath: 'id' }], ['docs', { keyPath: 'id' }], ['logs', { keyPath: 'id' }]];
const DATA_STORES = ['entries', 'services', 'expenses', 'docs', 'logs', 'photos'];
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('activa-mileage', 3);
    r.onupgradeneeded = () => STORES.forEach(([n, o]) => { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, o); });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const req = fn(...[].concat(stores).map(s => t.objectStore(s)));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('storage was blocked'));
  });
}
const getAll = store => tx(store, 'readonly', s => s.getAll());
const getPhoto = id => tx('photos', 'readonly', s => s.get(id));
// Save a record and (optionally) its photo in one go.
function saveRecord(store, rec, slot) {
  return tx([store, 'photos'], 'readwrite', (s, ps) => {
    s.put(rec);
    if (slot && slot.changed) slot.blob ? ps.put(slot.blob, rec.id) : ps.delete(rec.id);
  });
}
const deleteRecord = (store, id) => tx([store, 'photos'], 'readwrite', (s, ps) => { s.delete(id); ps.delete(id); });

/* ---------- maths ---------- */
// Full-tank method: km since the previous full fill ÷ all litres added since then.
// baseId remembers which fill-up's petrol was burned, for the bunk comparison.
function compute(list0) {
  const list = [...list0].sort((a, b) => a.odo - b.odo || a.ts.localeCompare(b.ts));
  let base = null, baseId = null, acc = 0, segKm = 0, segL = 0;
  for (const e of list) {
    e.kmpl = null; e.baseId = null;
    if (base === null) { if (e.full) { base = e.odo; baseId = e.id; } continue; }
    acc += e.litres;
    if (e.full) {
      const km = e.odo - base;
      if (km > 0 && acc > 0) { e.kmpl = km / acc; e.segKm = km; e.segL = acc; e.baseId = baseId; segKm += km; segL += acc; }
      base = e.odo; baseId = e.id; acc = 0;
    }
  }
  return { list, avg: segL ? segKm / segL : null };
}

let entries = [], services = [], expenses = [], docs = [], logs = [], S = null;
function summarize() {
  const { list, avg } = compute(entries);
  const first = list[0], last = list[list.length - 1];
  const km = list.length > 1 ? last.odo - first.odo : 0;
  const petrolAfterFirst = list.slice(1).reduce((s, e) => s + e.amount, 0);
  const days = list.length > 1 ? Math.max(1, daysBetween(first.ts, last.ts)) : 0;
  const curOdo = Math.max(0, ...list.map(e => e.odo), ...services.map(s => s.odo), ...logs.map(l => l.odo));
  return { list, avg, withM: list.filter(e => e.kmpl), first, last, km, petrolAfterFirst, days, curOdo };
}

// Km ridden since the last fill-up and an estimate of petrol left. Starts from the last
// full tank, adds each later fill-up and burns (km ÷ average mileage) in between.
function fuelState() {
  if (!S.list.length) return null;
  const list = S.list, last = list[list.length - 1], tank = profile().tank;
  const km = Math.max(0, S.curOdo - last.odo);
  let left = null;
  let i = list.length - 1;
  while (i > 0 && !list[i].full) i--;
  if (S.avg && list[i].full) {
    let lvl = tank;
    for (let j = i + 1; j < list.length; j++) lvl = Math.min(tank, Math.max(0, lvl - (list[j].odo - list[j - 1].odo) / S.avg) + list[j].litres);
    left = Math.max(0, lvl - km / S.avg);
  }
  return { last, km, left, pct: left === null ? null : left / tank, rideKm: left === null ? null : left * S.avg };
}

function insights() {
  const out = [], p = profile(), m = S.withM.map(e => e.kmpl), f = fuelState();
  if (f) {
    const title = `${Math.round(f.km).toLocaleString('en-IN')} km since last fill-up (${fmtDate(f.last.ts).replace(/ \d{4}$/, '')})`;
    if (f.left === null) out.push(['⛽', 'teal', title, 'Petrol left shows up once your mileage is known (after two full-tank fill-ups).']);
    else {
      const lv = f.pct > 0.35 ? 'ok' : f.pct > 0.15 ? 'warn' : 'danger';
      const sub = `≈ ${f.left.toFixed(1)} L left · about ${Math.round(f.rideKm)} km more to ride` + (lv === 'danger' ? ' · fill up soon' : '');
      out.push(['⛽', lv === 'danger' ? 'danger-c' : 'teal', title, sub,
        `<div class="bar" style="margin:6px 0 2px"><i class="bg-${lv}" style="width:${Math.max(3, f.pct * 100)}%"></i></div><small>Tank about ${Math.round(f.pct * 100)}% full</small>`]);
    }
  }
  if (S.avg) out.push(['🛣️', 'blue', `≈ ${Math.round(S.avg * p.tank)} km on a full tank`, `${p.tank} L tank × ${S.avg.toFixed(1)} km/l average`]);
  if (m.length >= 4) {
    const recent = avgOf(m.slice(-2)), before = avgOf(m.slice(0, -2)), ch = (recent - before) / before;
    if (ch < -0.08) out.push(['⚠️', 'danger-c', `Mileage dropped ${Math.round(-ch * 100)}% in the last 2 fill-ups`, 'Check tyre pressure and air filter, or get a service.']);
    else if (ch > 0.08) out.push(['🎉', 'teal', `Mileage up ${Math.round(ch * 100)}% recently`, `${recent.toFixed(1)} km/l vs ${before.toFixed(1)} km/l before. Nice riding!`]);
  }
  if (m.length >= 2) {
    const best = S.withM.reduce((a, b) => (b.kmpl > a.kmpl ? b : a)), worst = S.withM.reduce((a, b) => (b.kmpl < a.kmpl ? b : a));
    out.push(['🏆', 'orange', `Best ${best.kmpl.toFixed(1)} · worst ${worst.kmpl.toFixed(1)} km/l`, `Best on ${fmtDate(best.ts)}, worst on ${fmtDate(worst.ts)}`]);
  }
  if (S.list.length >= 3 && S.days >= 3) {
    out.push(['📍', 'pink', `You ride about ${Math.round(S.km / S.days)} km a day`, `and fill up every ${Math.round(S.days / (S.list.length - 1))} days on average`]);
  }
  const now = new Date(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), day = now.getDate();
  const ym = todayStr().slice(0, 7), spent = S.list.filter(e => e.ts.startsWith(ym)).reduce((s, e) => s + e.amount, 0);
  let est = null;
  if (day >= 5 && spent > 0) est = spent / day * dim;
  else if (S.km > 0 && S.days >= 3) est = S.km / S.days * dim * (S.petrolAfterFirst / S.km);
  if (est) out.push(['📅', 'violet', `≈ ${inr(Math.max(est, spent))} on petrol in ${monthName(ym, true).split(' ')[0]}`, `${inr(spent)} spent so far this month`]);
  return out;
}

function serviceStatus() {
  const p = profile(), out = [];
  for (const [key, label, everyKm, everyMonths] of [['General service', 'General service', p.svcKm, p.svcMonths], ['Engine oil', 'Engine oil change', p.oilKm, 0]]) {
    const last = services.filter(s => s.items.includes(key)).sort((a, b) => b.odo - a.odo || b.date.localeCompare(a.date))[0];
    if (!last) { out.push({ label, level: 'none', text: 'Not logged yet', sub: 'Log your last service to start reminders', pct: 0 }); continue; }
    const used = Math.max(0, S.curOdo - last.odo), leftKm = Math.round(everyKm - used);
    let leftDays = null, pctDays = 0;
    if (everyMonths) {
      const due = new Date(last.date + 'T00:00'); due.setMonth(due.getMonth() + everyMonths);
      leftDays = Math.ceil((due - new Date()) / 864e5);
      pctDays = 1 - leftDays / (everyMonths * 30.4);
    }
    const pct = Math.min(1, Math.max(0, used / everyKm, pctDays));
    const overKm = leftKm <= 0, overDays = leftDays !== null && leftDays <= 0;
    const level = overKm || overDays ? 'danger' : leftKm <= 300 || (leftDays !== null && leftDays <= 14) ? 'warn' : 'ok';
    const text = overKm ? `Overdue by ${(-leftKm).toLocaleString('en-IN')} km` : overDays ? `Overdue by ${plural(-leftDays, 'day')}`
      : `Due in ${leftKm.toLocaleString('en-IN')} km` + (leftDays !== null ? ` or ${plural(leftDays, 'day')}` : '');
    out.push({ label, level, text, pct, sub: `Last done ${fmtDate(last.date)} at ${Math.round(last.odo).toLocaleString('en-IN')} km` });
  }
  return out;
}

function docStatus(d) {
  if (!d || !d.expiry) return { level: 'none', text: 'Not added' };
  const days = Math.ceil((new Date(d.expiry + 'T23:59') - new Date()) / 864e5);
  if (days < 0) return { level: 'danger', text: `Expired ${plural(-days, 'day')} ago` };
  if (days <= 30) return { level: 'warn', text: days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}` };
  return { level: 'ok', text: `Valid till ${fmtDate(d.expiry)}` };
}

/* ---------- rendering ---------- */
async function refresh() {
  [entries, services, expenses, docs, logs] = await Promise.all(['entries', 'services', 'expenses', 'docs', 'logs'].map(getAll));
  render();
}
function render() {
  S = summarize();
  renderHeader(); renderHome(); renderFills(); renderLogs(); renderGarage(); renderReports(); renderPrice();
  drawCharts();
}

function renderHeader() {
  const p = profile(), h = new Date().getHours();
  $('greet').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('vehicleName').textContent = p.name;
  $('plate').hidden = !p.reg; $('plate').querySelector('b').textContent = p.reg;
  let age = '';
  if (p.buy) {
    const mo = Math.max(0, Math.floor(daysBetween(p.buy, new Date()) / 30.44)), y = Math.floor(mo / 12), r = mo % 12;
    age = (y ? plural(y, 'yr') + ' ' : '') + (r || !y ? plural(r, 'mo') : '') + ' old';
  }
  $('vehicleMeta').textContent = [p.model, age].filter(Boolean).join(' · ');
}

function renderHome() {
  $('sAvg').textContent = S.avg ? S.avg.toFixed(1) : '–';
  $('gaugeArc').setAttribute('stroke-dasharray', `${S.avg ? Math.min(S.avg / 70, 1) * 100 : 0} 100`);
  const last = S.withM[S.withM.length - 1], f = fuelState();
  const sinceFill = f ? `<span>⛽ <b>${Math.round(f.km).toLocaleString('en-IN')} km</b> since fill${f.left !== null ? ` · ≈${Math.round(f.rideKm)} km left` : ''}</span>` : '';
  $('heroPills').innerHTML = S.avg
    ? `${sinceFill}<span>🛣️ Range ≈ <b>${Math.round(S.avg * profile().tank)} km</b></span><span>Last: <b>${last.kmpl.toFixed(1)} km/l</b></span>`
    : sinceFill + '<span>Add two full-tank fill-ups to see mileage</span>';

  // Alerts: documents and services that need attention.
  const alerts = [];
  DOC_TYPES.forEach(([id, icon, name]) => {
    const st = docStatus(docs.find(d => d.id === id));
    if (st.level === 'danger' || st.level === 'warn') alerts.push([st.level, icon, name, st.text]);
  });
  serviceStatus().forEach(s => { if (s.level === 'danger' || s.level === 'warn') alerts.push([s.level, '🔧', s.label, s.text]); });
  $('alerts').innerHTML = alerts.map(([lv, icon, t, s]) =>
    `<div class="alert ${lv}" data-go="garage"><span class="ai">${icon}</span><div><b>${esc(t)}</b>${esc(s)}</div><span>›</span></div>`).join('');

  const ins = insights();
  $('insights').innerHTML = ins.length
    ? ins.map(([icon, cls, t, s, extra]) => `<div class="ins"><span class="chip ${cls}">${icon}</span><div style="flex:1"><b>${esc(t)}</b><small>${esc(s)}</small>${extra || ''}</div></div>`).join('')
    : '<div class="empty">Add a few fill-ups to unlock insights about your riding.</div>';

  $('sCpk').textContent = S.km > 0 ? inr(S.petrolAfterFirst / S.km, 2) : '–';
  $('sKm').textContent = S.km > 0 ? Math.round(S.km).toLocaleString('en-IN') + ' km' : '–';
  $('sOdo').textContent = S.curOdo ? 'odometer ' + Math.round(S.curOdo).toLocaleString('en-IN') : 'tracked';
  const ym = todayStr().slice(0, 7), thisMonth = S.list.filter(e => e.ts.startsWith(ym));
  $('sMonth').textContent = inr(thisMonth.reduce((s, e) => s + e.amount, 0));
  $('sMonthN').textContent = plural(thisMonth.length, 'fill-up');

  $('homeService').innerHTML = serviceBars();
  $('homeDocs').innerHTML = DOC_TYPES.map(([id, icon, name]) => {
    const st = docStatus(docs.find(d => d.id === id));
    return `<div class="doc" data-doc="${id}"><b>${icon} ${name.split(' (')[0]}</b><span class="pill ${st.level}">${st.level === 'ok' ? 'Valid' : esc(st.text)}</span></div>`;
  }).join('');

  const rec = $('recent'); rec.innerHTML = '';
  const latest = [...S.list].reverse().slice(0, 3);
  if (!latest.length) rec.innerHTML = '<div class="empty">No fill-ups yet. Tap <b>+</b> and take a photo of your odometer.</div>';
  latest.forEach(e => rec.appendChild(fillRow(e)));
}

function serviceBars() {
  return serviceStatus().map(s => `
    <div class="rem"><div class="row"><b>${s.label}</b><span class="lv-${s.level}">${esc(s.text)}</span></div>
      ${s.level === 'none' ? '' : `<div class="bar"><i class="bg-${s.level}" style="width:${Math.max(4, s.pct * 100)}%"></i></div>`}
      <small>${esc(s.sub)}</small></div>`).join('');
}

function fillRow(e) {
  const row = document.createElement('div');
  row.className = 'entry';
  row.innerHTML = `${e.thumb ? '<img class="thumb" alt="">' : '<div class="thumb">⛽</div>'}
    <div class="mid"><div class="d"></div><div class="m"></div></div><div class="r"></div>`;
  if (e.thumb) row.querySelector('img').src = e.thumb;
  row.querySelector('.d').textContent = fmtDate(e.ts);
  if (!e.full) row.querySelector('.d').insertAdjacentHTML('beforeend', '<span class="tag">partial</span>');
  row.querySelector('.m').textContent = [`${Math.round(e.odo).toLocaleString('en-IN')} km`, `${e.litres.toFixed(2)} L`, inr(e.amount), e.bunk].filter(Boolean).join(' · ');
  row.querySelector('.r').innerHTML = e.kmpl ? `${e.kmpl.toFixed(1)}<small>km/l</small>` : '';
  row.addEventListener('click', () => openDetail(e));
  return row;
}

function renderFills() {
  const total = S.list.reduce((s, e) => s + e.amount, 0), litres = S.list.reduce((s, e) => s + e.litres, 0);
  $('fillsSummary').innerHTML = `
    <div class="stat"><div class="top"><span class="chip violet">⛽</span>Fill-ups</div><div class="v">${S.list.length}</div><div class="s">${litres.toFixed(1)} L in total</div></div>
    <div class="stat"><div class="top"><span class="chip orange">💰</span>Spent on petrol</div><div class="v">${inr(total)}</div><div class="s">${S.list.length ? 'since ' + fmtDate(S.first.ts) : 'nothing yet'}</div></div>`;
  const el = $('fillList'); el.innerHTML = '';
  if (!S.list.length) { el.innerHTML = '<div class="empty">No fill-ups yet. Tap <b>+</b> to add your first one.</div>'; return; }
  let cur = null;
  [...S.list].reverse().forEach(e => {
    const mk = monthKey(e.ts);
    if (mk !== cur) {
      cur = mk;
      const inMonth = S.list.filter(x => monthKey(x.ts) === mk);
      el.insertAdjacentHTML('beforeend', `<div class="month-h"><span>${monthName(mk, true)}</span><span>${inr(inMonth.reduce((s, x) => s + x.amount, 0))} · ${plural(inMonth.length, 'fill')}</span></div>`);
    }
    el.appendChild(fillRow(e));
  });
}

/* ---------- daily log ---------- */
// Logs in time order, each with the km ridden since the previous log.
function logsWithDelta() {
  const list = [...logs].sort((a, b) => a.ts.localeCompare(b.ts) || a.odo - b.odo);
  list.forEach((l, i) => { const d = i ? l.odo - list[i - 1].odo : null; l.delta = d !== null && d >= 0 ? d : null; });
  return list;
}
const purposeIcon = p => (LOG_PURPOSES.find(x => x[0] === p) || ['', '📝'])[1];
const fmtDay = d => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function logRow(l) {
  const row = document.createElement('div');
  row.className = 'entry';
  row.innerHTML = `<div class="thumb">${purposeIcon(l.purpose)}</div><div class="mid"><div class="d"></div><div class="m"></div></div><div class="delta"></div>`;
  row.querySelector('.d').textContent = [l.purpose, l.remarks].filter(Boolean).join(' · ') || 'Trip';
  row.querySelector('.m').textContent = `${fmtTime(l.ts)} · ${Math.round(l.odo).toLocaleString('en-IN')} km`;
  row.querySelector('.delta').innerHTML = l.delta !== null ? `+${Math.round(l.delta).toLocaleString('en-IN')}<small>km</small>` : '<small>start</small>';
  row.addEventListener('click', () => openLog(l));
  return row;
}
function renderLogs() {
  const list = logsWithDelta(), today = todayStr(), ym = today.slice(0, 7);
  const kmOf = arr => arr.reduce((s, l) => s + (l.delta || 0), 0);
  const todays = list.filter(l => l.ts.startsWith(today)), month = list.filter(l => l.ts.startsWith(ym));

  // Home card
  const last = list[list.length - 1];
  $('homeLog').innerHTML = `<div class="today"><span class="chip pink" style="width:48px;height:48px;font-size:22px">🛵</span><div>
    <div class="km">${Math.round(kmOf(todays)).toLocaleString('en-IN')} <small>km today · ${plural(todays.length, 'log')}</small></div>
    <div class="last"></div></div></div>`;
  $('homeLog').querySelector('.last').textContent = last
    ? `Last: ${fmtDate(last.ts)}, ${fmtTime(last.ts)} · ${Math.round(last.odo).toLocaleString('en-IN')} km${last.remarks ? ' · ' + last.remarks : ''}`
    : 'Log your odometer with the reason for each trip.';

  // Logbook → Daily log
  $('logsSummary').innerHTML = `
    <div class="stat"><div class="top"><span class="chip pink">📍</span>Today</div><div class="v">${Math.round(kmOf(todays)).toLocaleString('en-IN')} km</div><div class="s">${plural(todays.length, 'log')}</div></div>
    <div class="stat"><div class="top"><span class="chip blue">📅</span>This month</div><div class="v">${Math.round(kmOf(month)).toLocaleString('en-IN')} km</div><div class="s">${plural(month.length, 'log')}</div></div>`;
  const el = $('logList'); el.innerHTML = '';
  if (!list.length) el.innerHTML = '<div class="empty">No daily logs yet. Tap <b>+ Add daily log</b> to record your odometer and the reason for the trip.</div>';
  let cur = null;
  [...list].reverse().forEach(l => {
    const d = l.ts.slice(0, 10);
    if (d !== cur) {
      cur = d;
      const day = list.filter(x => x.ts.startsWith(d));
      el.insertAdjacentHTML('beforeend', `<div class="month-h"><span>${d === today ? 'Today' : fmtDay(d)}</span><span>${Math.round(kmOf(day)).toLocaleString('en-IN')} km · ${plural(day.length, 'log')}</span></div>`);
    }
    el.appendChild(logRow(l));
  });

  // Reports → trips by purpose (last 30 days)
  const since = localISO(new Date(Date.now() - 30 * 864e5)).slice(0, 10), groups = {};
  list.filter(l => l.ts.slice(0, 10) >= since && l.delta !== null).forEach(l => {
    const k = l.purpose || 'Other';
    (groups[k] = groups[k] || { km: 0, n: 0 }); groups[k].km += l.delta; groups[k].n++;
  });
  const rows = Object.entries(groups).sort((a, b) => b[1].km - a[1].km), max = rows.length ? rows[0][1].km || 1 : 1;
  $('purposeList').innerHTML = rows.length
    ? rows.map(([p, g]) => `<div class="bunk"><div class="row"><b>${purposeIcon(p)} ${esc(p)}</b><b>${Math.round(g.km).toLocaleString('en-IN')} km</b></div>
        <div class="bar"><i style="width:${g.km / max * 100}%"></i></div><small>${plural(g.n, 'trip')}</small></div>`).join('')
    : '<div class="empty">Add daily logs with a purpose to see where your km go.</div>';
}

let editLog = null;
$('lgPurpose').innerHTML = LOG_PURPOSES.map(([p, i]) => `<label><input type="radio" name="lgPurpose" value="${p}"><span>${i} ${p}</span></label>`).join('');
function prevLog(ts) {
  return logsWithDelta().filter(l => l.id !== (editLog && editLog.id) && l.ts <= ts).pop() || null;
}
function updateLogHints() {
  const ts = val('lgTs'), v = num('lgOdo'), prev = ts ? prevLog(ts) : null, w = $('lgWarn');
  $('lgLast').textContent = prev ? `Previous log: ${Math.round(prev.odo).toLocaleString('en-IN')} km on ${fmtDate(prev.ts)}, ${fmtTime(prev.ts)}`
    : S.curOdo ? `Last known reading: ${Math.round(S.curOdo).toLocaleString('en-IN')} km` : '';
  $('lgDelta').textContent = prev && v >= prev.odo ? `+${Math.round(v - prev.odo).toLocaleString('en-IN')} km` : '';
  w.hidden = !(prev && v > 0 && v < prev.odo);
  if (!w.hidden) w.textContent = `Heads up: lower than the previous log (${Math.round(prev.odo).toLocaleString('en-IN')} km).`;
}
function openLog(l) {
  editLog = l || null;
  const f = $('lgForm'); f.reset(); clearErrs(f);
  $('lgTitle').textContent = l ? 'Edit daily log' : 'Daily log';
  $('lgDelete').hidden = !l;
  // Actual current date & time by default; the rider can change it.
  $('lgTs').value = l ? l.ts : localISO(new Date());
  $('lgTsSrc').textContent = l ? '' : 'now';
  if (l) {
    $('lgOdo').value = l.odo; $('lgRemarks').value = l.remarks || '';
    const r = f.querySelector(`#lgPurpose input[value="${l.purpose}"]`); if (r) r.checked = true;
  }
  updateLogHints();
  $('logSheet').showModal(); $('logSheet').scrollTop = 0;
}
$('lgTs').addEventListener('input', () => { $('lgTsSrc').textContent = 'changed'; updateLogHints(); });
$('lgOdo').addEventListener('input', updateLogHints);
$('lgForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = $('lgForm'), purpose = f.querySelector('#lgPurpose input:checked'), errs = [];
  if (!val('lgTs')) errs.push([$('lgTs'), 'Date and time are missing.']);
  else if (new Date(val('lgTs')).getTime() > Date.now() + 10 * 60000) errs.push([$('lgTs'), 'Date and time cannot be in the future.']);
  if (!val('lgOdo')) errs.push([$('lgOdo'), 'Enter the odometer reading shown on your meter.']);
  else if (!(num('lgOdo') > 0)) errs.push([$('lgOdo'), 'Odometer reading must be more than 0.']);
  if (!purpose && !val('lgRemarks')) errs.push([$('lgRemarks'), 'Add the reason for the trip, or pick a purpose above.']);
  if (errs.length) return showErrs(f, errs);
  const rec = { id: editLog ? editLog.id : newId('l'), ts: val('lgTs'), odo: num('lgOdo'), purpose: purpose ? purpose.value : '', remarks: val('lgRemarks') };
  try { await saveRecord('logs', rec); } catch (e) { return showSaveFail(f, e); }
  $('logSheet').close(); await refresh(); toast(editLog ? 'Log updated ✓' : 'Log saved ✓');
});
$('lgDelete').addEventListener('click', async () => {
  if (!confirm('Delete this daily log?')) return;
  try { await deleteRecord('logs', editLog.id); } catch (e) { return toast('Could not delete: ' + e.message, true); }
  $('logSheet').close(); await refresh(); toast('Deleted');
});
function showBook(b) {
  $('bookSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.b === b));
  $('bookFills').hidden = b !== 'fills'; $('bookLogs').hidden = b !== 'logs';
}
$('bookSeg').addEventListener('click', e => { if (e.target.dataset.b) showBook(e.target.dataset.b); });
$('addLogBtn').addEventListener('click', () => openLog(null));
$('homeLogBtn').addEventListener('click', () => openLog(null));
$('homeLogAll').addEventListener('click', () => { showBook('logs'); showTab('fills'); });

function renderGarage() {
  $('svcReminders').innerHTML = serviceBars();

  const sl = $('svcList'); sl.innerHTML = '';
  const svs = [...services].sort((a, b) => b.date.localeCompare(a.date) || b.odo - a.odo);
  if (!svs.length) sl.innerHTML = '<div class="empty">No services logged yet.</div>';
  svs.forEach(s => {
    const row = document.createElement('div');
    row.className = 'entry';
    row.innerHTML = `<div class="thumb">${s.hasPhoto ? '🧾' : '🔧'}</div><div class="mid"><div class="d"></div><div class="m"></div></div><div class="r"></div>`;
    row.querySelector('.d').textContent = s.items.join(', ');
    row.querySelector('.m').textContent = [fmtDate(s.date), `${Math.round(s.odo).toLocaleString('en-IN')} km`, s.where].filter(Boolean).join(' · ');
    row.querySelector('.r').textContent = s.cost ? inr(s.cost) : 'Free';
    row.addEventListener('click', () => openService(s));
    sl.appendChild(row);
  });

  $('docList').innerHTML = DOC_TYPES.map(([id, icon, name]) => {
    const d = docs.find(x => x.id === id), st = docStatus(d);
    return `<div class="entry" data-doc="${id}"><div class="thumb">${icon}</div>
      <div class="mid"><div class="d">${name}</div><div class="m">${esc([d && d.number, d && d.provider].filter(Boolean).join(' · ') || (d ? '' : 'Tap to add'))}</div></div>
      <span class="pill ${st.level}">${esc(st.text)}</span></div>`;
  }).join('');

  const el = $('expList'); el.innerHTML = '';
  const exs = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
  $('expTotal').textContent = exs.length ? inr(exs.reduce((s, x) => s + x.amount, 0)) + ' total' : '';
  if (!exs.length) el.innerHTML = '<div class="empty">Parking, washing, accessories… add them here.</div>';
  exs.forEach(x => {
    const row = document.createElement('div');
    row.className = 'entry';
    row.innerHTML = `<div class="thumb">${(EXPENSE_CATS.find(c => c[0] === x.category) || ['', '🧾'])[1]}</div><div class="mid"><div class="d"></div><div class="m"></div></div><div class="r"></div>`;
    row.querySelector('.d').textContent = x.category;
    row.querySelector('.m').textContent = [fmtDate(x.date), x.note].filter(Boolean).join(' · ');
    row.querySelector('.r').textContent = inr(x.amount);
    row.addEventListener('click', () => openExpense(x));
    el.appendChild(row);
  });
}

/* ---------- reports ---------- */
let monthMode = 'spend';
function lastMonths(n) {
  const out = [], d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) { out.unshift(localISO(d).slice(0, 7)); d.setMonth(d.getMonth() - 1); }
  return out;
}
function monthData(keys) {
  const petrol = keys.map(k => S.list.filter(e => monthKey(e.ts) === k).reduce((s, e) => s + e.amount, 0));
  const service = keys.map(k => services.filter(s => monthKey(s.date) === k).reduce((s, x) => s + (x.cost || 0), 0));
  const other = keys.map(k => expenses.filter(x => monthKey(x.date) === k).reduce((s, x) => s + x.amount, 0));
  // Distance between consecutive fill-ups counts toward the month of the later one.
  const km = keys.map(k => S.list.reduce((s, e, i) => s + (i && monthKey(e.ts) === k ? e.odo - S.list[i - 1].odo : 0), 0));
  return { petrol, service, other, km };
}
function renderReports() {
  // Running cost: everything since the first fill-up, per km.
  const since = S.first ? S.first.ts.slice(0, 10) : null;
  const svc = services.filter(s => !since || s.date >= since).reduce((s, x) => s + (x.cost || 0), 0);
  const oth = expenses.filter(x => !since || x.date >= since).reduce((s, x) => s + x.amount, 0);
  const total = S.petrolAfterFirst + svc + oth;
  if (S.km > 0) {
    const parts = [['Petrol', S.petrolAfterFirst, SERIES.petrol], ['Service', svc, SERIES.service], ['Other', oth, SERIES.other]];
    $('runCost').innerHTML = `<div class="big-num">${inr(total / S.km, 2)}<span class="hint" style="font-size:14px;font-weight:600"> per km</span></div>
      <div class="hint">${inr(total)} over ${Math.round(S.km).toLocaleString('en-IN')} km since ${fmtDate(since)}</div>
      <div class="stack">${parts.map(([, v, c]) => `<i style="width:${total ? v / total * 100 : 0}%;background:${c}"></i>`).join('')}</div>
      ${parts.map(([n, v, c]) => `<div class="brk"><span><i style="background:${c}"></i>${n}</span><span><b>${inr(v)}</b> · ${inr(v / S.km, 2)}/km</span></div>`).join('')}`;
  } else $('runCost').innerHTML = '<div class="empty">Appears after two fill-ups.</div>';

  $('monthLegend').innerHTML = monthMode === 'spend'
    ? `<span><i style="background:${SERIES.petrol}"></i>Petrol</span><span><i style="background:${SERIES.service}"></i>Service</span><span><i style="background:${SERIES.other}"></i>Other</span>`
    : `<span><i style="background:${SERIES.petrol}"></i>Km ridden</span>`;

  const prices = S.list.filter(e => e.price);
  $('priceStats').innerHTML = prices.length >= 2
    ? `<span>Lowest <b>${inr(Math.min(...prices.map(e => e.price)), 2)}</b></span><span>Highest <b>${inr(Math.max(...prices.map(e => e.price)), 2)}</b></span><span>Average <b>${inr(avgOf(prices.map(e => e.price)), 2)}</b></span>`
    : '';

  // Mileage by bunk: a segment's mileage belongs to the bunk where that petrol was bought.
  const byId = Object.fromEntries(S.list.map(e => [e.id, e])), groups = {};
  S.withM.forEach(e => {
    const b = byId[e.baseId] && byId[e.baseId].bunk;
    if (!b) return;
    (groups[b] = groups[b] || { km: 0, l: 0, n: 0 }); groups[b].km += e.segKm; groups[b].l += e.segL; groups[b].n++;
  });
  const rows = Object.entries(groups).map(([name, g]) => [name, g.km / g.l, g.n]).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  $('bunkList').innerHTML = rows.length
    ? rows.map(([name, v, n]) => `<div class="bunk"><div class="row"><b>${esc(name)}</b><b>${v.toFixed(1)} km/l</b></div>
        <div class="bar"><i style="width:${v / max * 100}%"></i></div><small>${plural(n, 'tank')} measured</small></div>`).join('')
      + (rows.length === 1 ? '<p class="hint">Fill up at another bunk to compare.</p>' : '')
    : '<div class="empty">Add the petrol bunk name when you save fill-ups, and mileage per bunk shows up here.</div>';

  // Summary month picker: months with any data, newest first.
  const keys = new Set([todayStr().slice(0, 7)]);
  S.list.forEach(e => keys.add(monthKey(e.ts))); services.forEach(s => keys.add(monthKey(s.date))); expenses.forEach(x => keys.add(monthKey(x.date)));
  const sel = $('sumMonth'), prev = sel.value;
  sel.innerHTML = [...keys].sort().reverse().map(k => `<option value="${k}">${monthName(k, true)}</option>`).join('');
  if (prev && keys.has(prev)) sel.value = prev;
}

function monthSummary(k) {
  const fills = S.list.filter(e => monthKey(e.ts) === k);
  const md = monthData([k]);
  const seg = S.withM.filter(e => monthKey(e.ts) === k);
  const segKm = seg.reduce((s, e) => s + e.segKm, 0), segL = seg.reduce((s, e) => s + e.segL, 0);
  const spend = md.petrol[0] + md.service[0] + md.other[0];
  return { fills: fills.length, km: md.km[0], petrol: md.petrol[0], spend, kmpl: segL ? segKm / segL : null, cpk: md.km[0] ? spend / md.km[0] : null };
}
function drawSummary() {
  const c = $('sumCanvas'), g = c.getContext('2d'), k = $('sumMonth').value || todayStr().slice(0, 7), p = profile(), m = monthSummary(k);
  const W = 1080, H = 1350;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#6d5dfc'); bg.addColorStop(.55, '#a855f7'); bg.addColorStop(1, '#f472b6');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.10)';
  g.beginPath(); g.arc(W - 80, 120, 260, 0, 7); g.fill();
  g.beginPath(); g.arc(60, H - 60, 200, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  g.font = '600 34px system-ui, sans-serif'; g.globalAlpha = .85; g.fillText('MONTHLY RIDE REPORT', 80, 140); g.globalAlpha = 1;
  g.font = '800 92px system-ui, sans-serif'; g.fillText(p.name, 80, 250);
  g.font = '600 48px system-ui, sans-serif'; g.fillText(monthName(k, true) + (p.reg ? '  ·  ' + p.reg : ''), 80, 330);
  // white card with stats
  g.fillStyle = '#fff'; g.beginPath(); g.roundRect(60, 410, W - 120, 800, 48); g.fill();
  const cells = [
    ['Distance', m.km ? Math.round(m.km).toLocaleString('en-IN') + ' km' : '–'],
    ['Avg mileage', m.kmpl ? m.kmpl.toFixed(1) + ' km/l' : '–'],
    ['Petrol', inr(m.petrol)],
    ['Total spend', inr(m.spend)],
    ['Cost per km', m.cpk ? inr(m.cpk, 2) : '–'],
    ['Fill-ups', String(m.fills)]
  ];
  cells.forEach(([label, val], i) => {
    const x = 110 + (i % 2) * 450, y = 520 + Math.floor(i / 2) * 240;
    g.fillStyle = '#6b7194'; g.font = '600 36px system-ui, sans-serif'; g.fillText(label, x, y);
    g.fillStyle = i === 1 ? '#6d5dfc' : '#1d2240'; g.font = '800 76px system-ui, sans-serif'; g.fillText(val, x, y + 90);
  });
  g.fillStyle = '#fff'; g.font = '600 32px system-ui, sans-serif'; g.globalAlpha = .9;
  g.fillText('Designed by KarthikMinds', 80, H - 70); g.globalAlpha = 1;
}

/* ---------- charts ---------- */
function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  g.font = '11px system-ui, sans-serif';
  return { g, w, h };
}
function lineChart(c, pts, fmt) {
  const { g, w, h } = setupCanvas(c);
  if (!w) return;
  const vals = pts.map(p => p.v), span = Math.max(...vals) - Math.min(...vals);
  const padV = Math.max(span * 0.25, Math.abs(vals[0]) * 0.02, 1);
  const lo = Math.min(...vals) - padV, hi = Math.max(...vals) + padV;
  const pad = { l: 36, r: 10, t: 12, b: 22 };
  const x = i => pad.l + (w - pad.l - pad.r) * i / (pts.length - 1);
  const y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  g.fillStyle = css('--muted'); g.strokeStyle = css('--line'); g.lineWidth = 1;
  for (let k = 0; k <= 2; k++) {
    const v = lo + (hi - lo) * k / 2, yy = y(v);
    g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(w - pad.r, yy); g.stroke();
    g.fillText(fmt(v), 2, yy + 4);
  }
  const a = fmtDate(pts[0].ts), b = fmtDate(pts[pts.length - 1].ts);
  g.fillText(a, pad.l, h - 5); g.fillText(b, w - pad.r - g.measureText(b).width, h - 5);
  const fill = g.createLinearGradient(0, pad.t, 0, h - pad.b);
  fill.addColorStop(0, 'rgba(168,85,247,.28)'); fill.addColorStop(1, 'rgba(168,85,247,0)');
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.v)) : g.moveTo(x(i), y(p.v))));
  g.lineTo(x(pts.length - 1), h - pad.b); g.lineTo(x(0), h - pad.b); g.closePath();
  g.fillStyle = fill; g.fill();
  const stroke = g.createLinearGradient(pad.l, 0, w - pad.r, 0);
  stroke.addColorStop(0, '#6d5dfc'); stroke.addColorStop(.6, '#a855f7'); stroke.addColorStop(1, '#f472b6');
  g.beginPath(); g.strokeStyle = stroke; g.lineWidth = 3; g.lineJoin = 'round';
  pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.v)) : g.moveTo(x(i), y(p.v))));
  g.stroke();
  pts.forEach((p, i) => {
    g.beginPath(); g.arc(x(i), y(p.v), 4.5, 0, 7); g.fillStyle = css('--card'); g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#a855f7'; g.stroke();
  });
}
// opts.every: draw every Nth label; opts.values: false hides the totals above bars.
function barChart(c, labels, series, fmt, opts = {}) {
  const { g, w, h } = setupCanvas(c);
  if (!w) return;
  const every = opts.every || 1, showValues = opts.values !== false;
  const n = labels.length, totals = labels.map((_, i) => series.reduce((s, se) => s + se.values[i], 0));
  const max = Math.max(1, ...totals) * 1.18, pad = { l: 6, r: 6, t: 20, b: 24 }, bw = (w - pad.l - pad.r) / n, ih = h - pad.t - pad.b;
  g.strokeStyle = css('--line'); g.beginPath(); g.moveTo(pad.l, h - pad.b); g.lineTo(w - pad.r, h - pad.b); g.stroke();
  g.textAlign = 'center';
  labels.forEach((lab, i) => {
    const x = pad.l + bw * i + bw * 0.2, bwid = bw * 0.6, th = ih * totals[i] / max;
    if (th > 0) {
      g.save(); g.beginPath(); g.roundRect(x, h - pad.b - th, bwid, th, [7, 7, 0, 0]); g.clip();
      let yy = h - pad.b;
      series.forEach(se => { const bh = ih * se.values[i] / max; g.fillStyle = se.color; g.fillRect(x, yy - bh, bwid, bh); yy -= bh; });
      g.restore();
      if (showValues) {
        g.fillStyle = css('--text'); g.font = '700 11px system-ui, sans-serif';
        g.fillText(fmt(totals[i]), x + bwid / 2, h - pad.b - th - 6);
      }
    }
    if ((n - 1 - i) % every === 0) {
      g.fillStyle = css('--muted'); g.font = '11px system-ui, sans-serif';
      g.fillText(lab, x + bwid / 2, h - 7);
    }
  });
  g.textAlign = 'left';
}
// Home: km logged per day (sum of each log's km since the previous log).
let logDays = 14;
function drawLogChart() {
  const list = logsWithDelta(), days = [];
  for (let i = logDays - 1; i >= 0; i--) days.push(localISO(new Date(Date.now() - i * 864e5)).slice(0, 10));
  const km = days.map(d => list.filter(l => l.ts.startsWith(d)).reduce((s, l) => s + (l.delta || 0), 0));
  const show = list.length >= 2 && km.some(v => v > 0);
  $('logChart').hidden = !show; $('logChartEmpty').hidden = show;
  $('logChartStats').innerHTML = '';
  if (!show) return;
  const total = km.reduce((s, v) => s + v, 0), rideDays = km.filter(v => v > 0).length, best = Math.max(...km);
  const labels = days.map(d => String(+d.slice(8)));
  barChart($('logChart'), labels, [{ values: km, color: '#14b8a6' }], v => String(Math.round(v)), { every: logDays > 14 ? 5 : 1, values: logDays <= 14 });
  $('logChartStats').innerHTML = `<span>Total <b>${Math.round(total).toLocaleString('en-IN')} km</b></span>`
    + `<span>Avg <b>${Math.round(total / logDays)} km/day</b></span>`
    + `<span>Best day <b>${Math.round(best)} km</b> (${fmtDate(days[km.indexOf(best)]).replace(/ \d{4}$/, '')})</span>`
    + `<span>Rode on <b>${rideDays}/${logDays}</b> days</span>`;
}
$('logSeg').addEventListener('click', e => {
  const d = +e.target.dataset.d; if (!d) return;
  logDays = d;
  $('logSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.d === d));
  drawLogChart();
});

let currentTab = 'home';
function drawCharts() {
  if (!S) return;
  if (currentTab === 'home') {
    const show = S.withM.length >= 2;
    $('chart').hidden = !show; $('chartEmpty').hidden = show;
    if (show) lineChart($('chart'), S.withM.map(e => ({ ts: e.ts, v: e.kmpl })), v => v.toFixed(0));
    drawLogChart();
  }
  if (currentTab === 'reports') {
    const keys = lastMonths(6), md = monthData(keys), labels = keys.map(k => monthName(k));
    if (monthMode === 'spend') barChart($('monthChart'), labels, [{ values: md.petrol, color: SERIES.petrol }, { values: md.service, color: SERIES.service }, { values: md.other, color: SERIES.other }], inrShort);
    else barChart($('monthChart'), labels, [{ values: md.km, color: SERIES.petrol }], v => Math.round(v) + ' km');
    const prices = S.list.filter(e => e.price);
    const show = prices.length >= 2;
    $('priceChart').hidden = !show; $('priceEmpty').hidden = show;
    if (show) lineChart($('priceChart'), prices.map(e => ({ ts: e.ts, v: e.price })), v => '₹' + v.toFixed(0));
    drawSummary();
  }
}

/* ---------- tabs ---------- */
function showTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  scrollTo(0, 0);
  drawCharts();
}
document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) return showTab(go.dataset.go);
  const doc = e.target.closest('[data-doc]'); if (doc) openDoc(doc.dataset.doc);
});
$('monthSeg').addEventListener('click', e => {
  const m = e.target.dataset.m; if (!m) return;
  monthMode = m;
  $('monthSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  renderReports(); drawCharts();
});
$('sumMonth').addEventListener('change', drawSummary);
$('shareBtn').addEventListener('click', () => {
  const k = $('sumMonth').value, name = `activa-report-${k}.png`;
  $('sumCanvas').toBlob(async blob => {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${profile().name} · ${monthName(k, true)}` }); } catch (e) { /* user closed the share sheet */ }
    } else { download(name, blob); toast('Summary image saved'); }
  }, 'image/png');
});

/* ---------- Hyderabad petrol price ---------- */
// No official free feed exists, so read public price pages through a reader proxy (adds CORS).
const PRICE_SOURCES = [
  { name: 'goodreturns', url: 'https://r.jina.ai/https://www.goodreturns.in/petrol-price-in-hyderabad.html',
    re: /Rs\.\s*(\d{2,3}\.\d{1,2})\s*\/\s*Ltr/i },
  { name: 'NDTV', url: 'https://r.jina.ai/https://www.ndtv.com/fuel-prices/petrol-price-in-hyderabad-city',
    re: /Hyderabad[^.]*?is Rs\.?\s*(\d{2,3}\.\d{1,2}) per litre/i }
];
const price = () => settings.get('price', DEFAULT_PRICE);
async function fetchPrice(force) {
  if (!force && price().date === todayStr() && price().fetched) return;
  for (const src of PRICE_SOURCES) {
    try {
      const r = await fetch(src.url, { signal: AbortSignal.timeout(12000) });
      const m = (await r.text()).match(src.re);
      const v = m && parseFloat(m[1]);
      if (v > 60 && v < 250) {
        settings.set('price', { value: v, date: todayStr(), source: src.name, fetched: true });
        renderPrice();
        return true;
      }
    } catch (e) {}
  }
  renderPrice();
  return false;
}
function renderPrice() {
  const p = price(), fresh = p.date === todayStr();
  $('sPrice').textContent = inr(p.value, 2);
  $('sPriceNote').textContent = fresh ? `today · ${p.source}` : `last known · ${fmtDate(p.date)}`;
  $('setPrice').textContent = `${inr(p.value, 2)}/L from ${p.source}, ${fresh ? 'today' : fmtDate(p.date)}`;
}

/* ---------- form errors (shared by every form) ---------- */
const errEl = el => el.closest('.field').querySelector('.err');
function clearFieldErr(el) { el.classList.remove('bad'); el.removeAttribute('aria-invalid'); const e = errEl(el); if (e) e.textContent = ''; }
function clearErrs(form) {
  form.querySelectorAll('.bad').forEach(clearFieldErr);
  form.querySelector('.form-err').hidden = true;
}
function showErrs(form, errs) {
  clearErrs(form);
  errs.forEach(([el, msg]) => { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); errEl(el).textContent = msg; });
  const box = form.querySelector('.form-err');
  box.textContent = `⚠ Not saved. Please fix ${errs.length === 1 ? 'the highlighted field' : `the ${errs.length} highlighted fields`} above.`;
  box.hidden = false;
  const first = errs[0][0];
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (first.focus) setTimeout(() => first.focus({ preventScroll: true }), 300);
}
function showSaveFail(form, e) {
  const box = form.querySelector('.form-err');
  box.textContent = `⚠ Could not save on this phone: ${e && e.message ? e.message : e}. Your phone may be low on storage, or the browser is in private mode.`;
  box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// Typing in a field clears its error; the summary goes away once nothing is red.
document.querySelectorAll('form').forEach(f => ['input', 'change'].forEach(ev => f.addEventListener(ev, e => {
  const field = e.target.closest('.field');
  if (field) field.querySelectorAll('.bad').forEach(clearFieldErr);
  if (!f.querySelector('.bad')) f.querySelector('.form-err').hidden = true;
})));
const val = id => $(id).value.trim(), num = id => parseFloat(val(id));

/* ---------- photo helpers ---------- */
function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}
function scaled(img, max, quality, asDataUrl) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return asDataUrl ? c.toDataURL('image/jpeg', quality) : new Promise(r => c.toBlob(r, 'image/jpeg', quality));
}
// Simple photo picker used for service bills and documents.
function photoSlot(root) {
  const input = root.querySelector('input'), pick = root.querySelector('.pick'), prev = root.querySelector('.pprev'), img = prev.querySelector('img');
  const slot = { blob: null, changed: false };
  const show = b => { pick.hidden = !!b; prev.hidden = !b; if (b) img.src = URL.createObjectURL(b); };
  slot.load = async id => {
    slot.blob = null; slot.changed = false; input.value = ''; show(null);
    if (id) { const b = await getPhoto(id); if (b) { slot.blob = b; show(b); } }
  };
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try { slot.blob = await scaled(await loadImage(f), 1600, 0.82); slot.changed = true; show(slot.blob); }
    catch (e) { toast('Could not open that image. Try another photo.', true); }
  });
  prev.querySelector('button').addEventListener('click', () => { slot.blob = null; slot.changed = true; input.value = ''; show(null); });
  img.addEventListener('click', () => { if (slot.blob) window.open(img.src); });
  return slot;
}

/* ---------- photo: date/time from EXIF ---------- */
async function exifDate(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 10 < v.byteLength) {
      const marker = v.getUint16(o);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return null;
      if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiffDate(v, o + 10);
      o += 2 + v.getUint16(o + 2);
    }
  } catch (e) {}
  return null;
}
function tiffDate(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const ifd = off => { const tags = {}, n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; tags[u16(e)] = e; } return tags; };
  const str = e => { const n = u32(e + 4), p = n > 4 ? t + u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; };
  const ifd0 = ifd(u32(t + 4));
  let s = null;
  if (ifd0[0x8769]) { const ex = ifd(u32(ifd0[0x8769] + 8)); if (ex[0x9003]) s = str(ex[0x9003]); }
  if (!s && ifd0[0x0132]) s = str(ifd0[0x0132]);
  const m = s && s.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/);
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : null;
}

/* ---------- fill-up: odometer photo with crop box ---------- */
let photo = null;      // { img, crop: {x,y,w,h} | null }
let photoBlob = null;  // compressed full photo to save
let photoChanged = false;

function drawPhoto() {
  const c = $('photoCanvas'), img = photo.img;
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  if (photo.crop) {
    const r = photo.crop, s = c.width / img.naturalWidth;
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, r.x, r.y, r.w, r.h, r.x * s, r.y * s, r.w * s, r.h * s);
    g.strokeStyle = '#a855f7'; g.lineWidth = 3; g.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
  }
}
// Drag a box around the digits to help OCR.
(() => {
  const c = $('photoCanvas');
  let start = null;
  const pt = ev => {
    const b = c.getBoundingClientRect(), k = photo.img.naturalWidth / b.width;
    return { x: Math.max(0, Math.min(b.width, ev.clientX - b.left)) * k, y: Math.max(0, Math.min(b.height, ev.clientY - b.top)) * k };
  };
  c.addEventListener('pointerdown', ev => { if (!photo) return; start = pt(ev); c.setPointerCapture(ev.pointerId); });
  c.addEventListener('pointermove', ev => {
    if (!start) return;
    const p = pt(ev);
    photo.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    drawPhoto();
  });
  c.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    const r = photo.crop, min = photo.img.naturalWidth * 0.04;
    if (!r || r.w < min || r.h < min / 2) { photo.crop = null; drawPhoto(); return; }
    runOcr();
  });
})();

async function onPhotoPicked(file, fromCamera) {
  if (!file) return;
  try {
    const img = await loadImage(file);
    photo = { img, crop: null };
    photoBlob = await scaled(img, 1280, 0.8);
    photoChanged = true;
  } catch (e) { toast('Could not open that image. Try another photo.', true); return; }
  $('photoPick').hidden = true; $('photoWrap').hidden = false;
  drawPhoto();
  // Date & time: photo EXIF first; else capture time (camera) or file time (gallery).
  const ex = await exifDate(file);
  if (ex) setTs(ex, 'from photo');
  else if (fromCamera) setTs(localISO(new Date()), 'captured now');
  else if (file.lastModified) setTs(localISO(new Date(file.lastModified)), 'file time');
  runOcr();
}
function setTs(v, src) { $('fTs').value = v; $('tsSrc').textContent = src; clearFieldErr($('fTs')); }

/* ---------- OCR (Tesseract.js, runs on the phone) ---------- */
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const s = document.createElement('script');
      s.src = TESSERACT_URL; s.onload = res; s.onerror = () => rej(new Error('offline'));
      document.head.appendChild(s);
    }).then(async () => {
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: '0123456789' });
      return w;
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}
// Grayscale + contrast stretch, optionally inverted (LCDs can be light-on-dark).
function prep(img, r, invert) {
  r = r || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const k = r.h < 120 ? 120 / r.h : Math.min(1, 1600 / Math.max(r.w, r.h));
  const c = document.createElement('canvas');
  c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
  const g = c.getContext('2d');
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < p.length; i += 4) {
    const y = p[i] * .299 + p[i + 1] * .587 + p[i + 2] * .114;
    p[i] = y; if (y < lo) lo = y; if (y > hi) hi = y;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    let y = (p[i] - lo) * 255 / span;
    if (invert) y = 255 - y;
    p[i] = p[i + 1] = p[i + 2] = y;
  }
  g.putImageData(d, 0, 0);
  return c;
}
function lastOdo() {
  const list = compute(entries).list.filter(e => e.id !== editingId);
  return list.length ? list[list.length - 1].odo : null;
}
// Pick the most believable odometer number from OCR text.
function pickReading(texts) {
  const prev = lastOdo();
  const cands = new Set();
  texts.forEach(t => (t.replace(/\s+/g, ' ').match(/\d[\d ]{2,8}\d/g) || [])
    .forEach(s => { const d = s.replace(/ /g, ''); if (d.length >= 3 && d.length <= 7) cands.add(d); }));
  let best = null, bestScore = -Infinity;
  for (const d of cands) {
    let n = parseInt(d, 10), score = d.length;
    if (prev !== null) {
      // Mechanical odometers often show an extra tenths digit.
      if (n > prev + 5000 && Math.abs(n / 10 - prev) < 5000) n = n / 10;
      const diff = n - prev;
      score = diff >= 0 && diff <= 3000 ? 100 - diff / 100 : diff > 3000 && diff < 20000 ? 20 : -Math.abs(diff) / 1000;
    } else if (d.length === 5 || d.length === 6) score += 3;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}
let ocrRun = 0;
async function runOcr() {
  if (!photo) return;
  const run = ++ocrRun, st = $('ocrStatus');
  st.innerHTML = '<span class="spin"></span>Reading odometer… (first time downloads ~5 MB)';
  try {
    const w = await getWorker();
    const texts = [];
    for (const invert of [false, true]) {
      await w.setParameters({ tessedit_pageseg_mode: photo.crop ? '7' : '11' });
      const { data } = await w.recognize(prep(photo.img, photo.crop, invert));
      texts.push(data.text);
      if (run !== ocrRun) return;
    }
    const n = pickReading(texts);
    if (n !== null) {
      $('fOdo').value = n; clearFieldErr($('fOdo'));
      $('odoSrc').textContent = 'read from photo – please check';
      st.innerHTML = `Read <b>${n.toLocaleString('en-IN')} km</b>. Wrong? Drag a box around the digits, or type it.`;
      checkOdo();
    } else {
      st.textContent = 'Could not read the digits. Drag a box around them, or type the reading below.';
    }
  } catch (e) {
    if (run === ocrRun) st.textContent = 'Reading needs internet the first time. Type the reading below instead.';
  }
}

/* ---------- fill-up form ---------- */
let editingId = null, lastEdited = 'amount';
function validateFill() {
  const errs = [];
  if (!val('fOdo')) errs.push([$('fOdo'), 'Odometer reading is missing. Take a photo or type the km shown on your meter.']);
  else if (!(num('fOdo') > 0)) errs.push([$('fOdo'), 'Odometer reading must be more than 0.']);
  else if (entries.some(e => e.id !== editingId && e.odo === num('fOdo'))) errs.push([$('fOdo'), 'You already saved a fill-up with this exact reading.']);
  if (!val('fTs')) errs.push([$('fTs'), 'Date and time are missing.']);
  else if (new Date(val('fTs')).getTime() > Date.now() + 10 * 60000) errs.push([$('fTs'), 'Date and time cannot be in the future.']);
  if (!val('fPrice')) errs.push([$('fPrice'), 'Petrol price is missing.']);
  else if (!(num('fPrice') > 0)) errs.push([$('fPrice'), 'Price must be more than 0.']);
  if (!val('fAmount')) errs.push([$('fAmount'), 'Enter the amount you paid.']);
  else if (!(num('fAmount') > 0)) errs.push([$('fAmount'), 'Amount must be more than 0.']);
  else if (!(num('fLitres') > 0)) errs.push([$('fLitres'), 'Litres must be more than 0.']);
  return errs;
}
function resetPhotoUi() {
  photo = null; photoBlob = null; photoChanged = false; ocrRun++;
  $('photoPick').hidden = false; $('photoWrap').hidden = true; $('ocrStatus').textContent = '';
  $('camInput').value = ''; $('galInput').value = '';
}
async function openAdd(entry) {
  editingId = entry ? entry.id : null;
  resetPhotoUi();
  $('addTitle').textContent = entry ? 'Edit fill-up' : 'New fill-up';
  $('form').reset(); clearErrs($('form'));
  $('odoSrc').textContent = ''; $('odoWarn').hidden = true;
  $('bunkOptions').innerHTML = [...new Set(entries.map(e => e.bunk).filter(Boolean))].map(b => `<option value="${esc(b)}">`).join('');
  if (entry) {
    $('fOdo').value = entry.odo; setTs(entry.ts, '');
    $('fPrice').value = entry.price || ''; $('fAmount').value = entry.amount; $('fLitres').value = entry.litres;
    $('fFull').checked = entry.full; $('fNote').value = entry.note || ''; $('fBunk').value = entry.bunk || '';
    $('priceSrc').textContent = '';
    if (entry.hasPhoto) {
      const blob = await getPhoto(entry.id);
      if (blob) { photo = { img: await loadImage(blob), crop: null }; $('photoPick').hidden = true; $('photoWrap').hidden = false; drawPhoto(); }
    }
  } else {
    setTs(localISO(new Date()), 'now');
    $('fPrice').value = price().value;
    $('priceSrc').textContent = price().date === todayStr() ? 'today' : 'last known';
    $('fFull').checked = true;
    const lastBunk = [...S.list].reverse().find(e => e.bunk);
    if (lastBunk) $('fBunk').value = lastBunk.bunk;
    fetchPrice().then(ok => {
      if (ok && !editingId && $('addSheet').open && $('priceSrc').textContent !== 'edited') { $('fPrice').value = price().value; $('priceSrc').textContent = 'today'; recalc(); }
    });
  }
  lastEdited = 'amount';
  $('addSheet').showModal();
  $('addSheet').scrollTop = 0;
}
function recalc() {
  const p = parseFloat($('fPrice').value);
  if (!(p > 0)) return;
  if (lastEdited === 'amount') {
    const a = parseFloat($('fAmount').value);
    $('fLitres').value = a > 0 ? (a / p).toFixed(2) : '';
  } else {
    const l = parseFloat($('fLitres').value);
    $('fAmount').value = l > 0 ? (l * p).toFixed(2) : '';
  }
}
$('fAmount').addEventListener('input', () => { lastEdited = 'amount'; clearFieldErr($('fLitres')); recalc(); });
$('fLitres').addEventListener('input', () => { lastEdited = 'litres'; clearFieldErr($('fAmount')); recalc(); });
$('fPrice').addEventListener('input', () => { $('priceSrc').textContent = 'edited'; recalc(); });
$('fOdo').addEventListener('input', () => { $('odoSrc').textContent = ''; checkOdo(); });
$('fTs').addEventListener('input', () => { $('tsSrc').textContent = ''; });
function checkOdo() {
  const v = parseFloat($('fOdo').value), prev = lastOdo(), w = $('odoWarn');
  w.hidden = !(prev !== null && v > 0 && (v < prev || v - prev > 3000));
  if (!w.hidden) w.textContent = v < prev
    ? `Heads up: lower than your last reading (${prev.toLocaleString('en-IN')} km).`
    : `Heads up: ${Math.round(v - prev).toLocaleString('en-IN')} km since the last fill-up. Is it right?`;
}
$('camInput').addEventListener('change', e => onPhotoPicked(e.target.files[0], true));
$('galInput').addEventListener('change', e => onPhotoPicked(e.target.files[0], false));
$('rereadBtn').addEventListener('click', () => { photo.crop = null; drawPhoto(); runOcr(); });
$('changePhotoBtn').addEventListener('click', () => $('galInput').click());
$('removePhotoBtn').addEventListener('click', () => { resetPhotoUi(); photoChanged = true; });

$('form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = $('form'), errs = validateFill();
  if (errs.length) return showErrs(form, errs);
  clearErrs(form);
  const old = editingId ? entries.find(e => e.id === editingId) : null;
  const p = num('fPrice');
  const entry = {
    id: editingId || newId(''), ts: val('fTs'), odo: num('fOdo'), litres: num('fLitres'), amount: num('fAmount'),
    price: p, full: $('fFull').checked, bunk: val('fBunk'), note: val('fNote'),
    thumb: old ? old.thumb : null, hasPhoto: old ? old.hasPhoto : false
  };
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (photoChanged) { entry.hasPhoto = !!photoBlob; entry.thumb = photo ? scaled(photo.img, 160, 0.7, true) : null; }
    await saveRecord('entries', entry, { changed: photoChanged, blob: photoBlob });
  } catch (e) { return showSaveFail(form, e); }
  finally { btn.disabled = false; btn.textContent = 'Save fill-up'; }
  if ($('priceSrc').textContent === 'edited') settings.set('price', { value: p, date: todayStr(), source: 'you' });
  const wasEdit = !!editingId;
  $('addSheet').close();
  await refresh();
  toast(wasEdit ? 'Fill-up updated ✓' : 'Fill-up saved ✓');
});

/* ---------- fill-up detail ---------- */
let detailEntry = null;
async function openDetail(e) {
  detailEntry = e;
  $('dTitle').textContent = `${fmtDate(e.ts)}, ${fmtTime(e.ts)}`;
  const img = $('dPhoto'); img.hidden = true;
  if (e.hasPhoto) { const blob = await getPhoto(e.id); if (blob) { img.src = URL.createObjectURL(blob); img.hidden = false; } }
  const rows = [
    ['Odometer', Math.round(e.odo).toLocaleString('en-IN') + ' km'],
    ['Mileage', e.kmpl ? e.kmpl.toFixed(1) + ' km/l' : (e.full ? 'first full tank' : 'partial fill')],
    ['Amount', inr(e.amount, 2)], ['Litres', e.litres.toFixed(2) + ' L'],
    ['Price', e.price ? inr(e.price, 2) + '/L' : '–'], ['Tank', e.full ? 'Full' : 'Partial']
  ];
  if (e.bunk) rows.push(['Petrol bunk', e.bunk]);
  if (e.note) rows.push(['Note', e.note]);
  $('dKv').innerHTML = rows.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('');
  $('detailSheet').showModal();
}
$('dEdit').addEventListener('click', () => { $('detailSheet').close(); openAdd(detailEntry); });
$('dDelete').addEventListener('click', async () => {
  if (!confirm('Delete this fill-up and its photo?')) return;
  try { await deleteRecord('entries', detailEntry.id); } catch (e) { return toast('Could not delete: ' + e.message, true); }
  $('detailSheet').close(); await refresh(); toast('Deleted');
});

/* ---------- service form ---------- */
const svSlot = photoSlot($('svPhoto'));
$('svItems').innerHTML = SERVICE_ITEMS.map(i => `<label><input type="checkbox" value="${i}"><span>${i}</span></label>`).join('');
let editSvc = null;
async function openService(s) {
  editSvc = s || null;
  const f = $('svForm'); f.reset(); clearErrs(f);
  $('svTitle').textContent = s ? 'Edit service' : 'Log service';
  $('svDelete').hidden = !s;
  $('svDate').value = s ? s.date : todayStr();
  $('svOdo').value = s ? s.odo : (S.curOdo || '');
  if (s) { $('svCost').value = s.cost; $('svWhere').value = s.where || ''; $('svNote').value = s.note || ''; }
  f.querySelectorAll('#svItems input').forEach(i => { i.checked = s ? s.items.includes(i.value) : i.value === 'General service'; });
  await svSlot.load(s && s.hasPhoto ? s.id : null);
  $('serviceSheet').showModal(); $('serviceSheet').scrollTop = 0;
}
$('svForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = $('svForm'), items = [...f.querySelectorAll('#svItems input:checked')].map(i => i.value), errs = [];
  if (!items.length) errs.push([$('svItems'), 'Pick at least one thing that was done.']);
  if (!val('svDate')) errs.push([$('svDate'), 'Date is missing.']);
  else if (val('svDate') > todayStr()) errs.push([$('svDate'), 'Date cannot be in the future.']);
  if (!val('svOdo')) errs.push([$('svOdo'), 'Odometer reading is missing.']);
  else if (!(num('svOdo') > 0)) errs.push([$('svOdo'), 'Must be more than 0.']);
  if (!val('svCost')) errs.push([$('svCost'), 'Enter the cost (0 if it was free).']);
  else if (num('svCost') < 0) errs.push([$('svCost'), 'Cost cannot be negative.']);
  if (errs.length) return showErrs(f, errs);
  const rec = { id: editSvc ? editSvc.id : newId('s'), date: val('svDate'), odo: num('svOdo'), cost: num('svCost'), items,
    where: val('svWhere'), note: val('svNote'), hasPhoto: svSlot.changed ? !!svSlot.blob : !!(editSvc && editSvc.hasPhoto) };
  try { await saveRecord('services', rec, svSlot); } catch (e) { return showSaveFail(f, e); }
  $('serviceSheet').close(); await refresh(); toast(editSvc ? 'Service updated ✓' : 'Service saved ✓');
});
$('svDelete').addEventListener('click', async () => {
  if (!confirm('Delete this service record?')) return;
  try { await deleteRecord('services', editSvc.id); } catch (e) { return toast('Could not delete: ' + e.message, true); }
  $('serviceSheet').close(); await refresh(); toast('Deleted');
});

/* ---------- expense form ---------- */
$('exCat').innerHTML = EXPENSE_CATS.map(([c, i]) => `<label><input type="radio" name="exCat" value="${c}"><span>${i} ${c}</span></label>`).join('');
let editExp = null;
function openExpense(x) {
  editExp = x || null;
  const f = $('exForm'); f.reset(); clearErrs(f);
  $('exTitle').textContent = x ? 'Edit expense' : 'Add expense';
  $('exDelete').hidden = !x;
  $('exDate').value = x ? x.date : todayStr();
  if (x) { $('exAmount').value = x.amount; $('exNote').value = x.note || ''; f.querySelector(`#exCat input[value="${x.category}"]`).checked = true; }
  $('expenseSheet').showModal(); $('expenseSheet').scrollTop = 0;
}
$('exForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = $('exForm'), cat = f.querySelector('#exCat input:checked'), errs = [];
  if (!cat) errs.push([$('exCat'), 'Pick a category.']);
  if (!val('exAmount')) errs.push([$('exAmount'), 'Enter the amount.']);
  else if (!(num('exAmount') > 0)) errs.push([$('exAmount'), 'Amount must be more than 0.']);
  if (!val('exDate')) errs.push([$('exDate'), 'Date is missing.']);
  else if (val('exDate') > todayStr()) errs.push([$('exDate'), 'Date cannot be in the future.']);
  if (errs.length) return showErrs(f, errs);
  const rec = { id: editExp ? editExp.id : newId('x'), date: val('exDate'), category: cat.value, amount: num('exAmount'), note: val('exNote') };
  try { await saveRecord('expenses', rec); } catch (e) { return showSaveFail(f, e); }
  $('expenseSheet').close(); await refresh(); toast(editExp ? 'Expense updated ✓' : 'Expense saved ✓');
});
$('exDelete').addEventListener('click', async () => {
  if (!confirm('Delete this expense?')) return;
  try { await deleteRecord('expenses', editExp.id); } catch (e) { return toast('Could not delete: ' + e.message, true); }
  $('expenseSheet').close(); await refresh(); toast('Deleted');
});

/* ---------- document form ---------- */
const dcSlot = photoSlot($('dcPhoto'));
$('dcType').innerHTML = DOC_TYPES.map(([id, icon, name]) => `<label><input type="radio" name="dcType" value="${id}"><span>${icon} ${name.split(' (')[0]}</span></label>`).join('');
async function openDoc(type) {
  const f = $('dcForm'); f.reset(); clearErrs(f);
  $('dcTypeWrap').hidden = !!type;
  if (type) f.querySelector(`#dcType input[value="${type}"]`).checked = true;
  await fillDoc(type);
  $('docSheet').showModal(); $('docSheet').scrollTop = 0;
}
async function fillDoc(type) {
  const d = type && docs.find(x => x.id === type), t = DOC_TYPES.find(x => x[0] === type);
  $('dcTitle').textContent = t ? t[2] : 'Add document';
  $('dcExpiry').value = d ? d.expiry || '' : '';
  $('dcNumber').value = d ? d.number || '' : '';
  $('dcProvider').value = d ? d.provider || '' : '';
  $('dcDelete').hidden = !d;
  await dcSlot.load(d && d.hasPhoto ? d.id : null);
}
$('dcType').addEventListener('change', e => fillDoc(e.target.value));
$('dcForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = $('dcForm'), type = f.querySelector('#dcType input:checked'), errs = [];
  if (!type) errs.push([$('dcType'), 'Pick which document this is.']);
  if (!val('dcExpiry')) errs.push([$('dcExpiry'), 'Enter the date it is valid till.']);
  if (errs.length) return showErrs(f, errs);
  const old = docs.find(x => x.id === type.value);
  const rec = { id: type.value, expiry: val('dcExpiry'), number: val('dcNumber').toUpperCase(), provider: val('dcProvider'),
    hasPhoto: dcSlot.changed ? !!dcSlot.blob : !!(old && old.hasPhoto) };
  try { await saveRecord('docs', rec, dcSlot); } catch (e) { return showSaveFail(f, e); }
  $('docSheet').close(); await refresh(); toast('Document saved ✓');
});
$('dcDelete').addEventListener('click', async () => {
  const type = $('dcForm').querySelector('#dcType input:checked');
  if (!type || !confirm('Remove this document and its photo?')) return;
  try { await deleteRecord('docs', type.value); } catch (e) { return toast('Could not delete: ' + e.message, true); }
  $('docSheet').close(); await refresh(); toast('Removed');
});

/* ---------- vehicle profile ---------- */
function openProfile() {
  const p = profile(), f = $('pfForm'); clearErrs(f);
  $('pfName').value = p.name; $('pfModel').value = p.model; $('pfReg').value = p.reg; $('pfBuy').value = p.buy;
  $('pfTank').value = p.tank; $('pfSvcKm').value = p.svcKm; $('pfSvcMonths').value = p.svcMonths; $('pfOilKm').value = p.oilKm;
  $('profileSheet').showModal(); $('profileSheet').scrollTop = 0;
}
$('pfForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const f = $('pfForm'), errs = [];
  const range = (id, lo, hi, msg) => { const v = num(id); if (!(v >= lo && v <= hi)) errs.push([$(id), msg]); };
  if (!val('pfName')) errs.push([$('pfName'), 'Give your vehicle a name.']);
  if (val('pfBuy') && val('pfBuy') > todayStr()) errs.push([$('pfBuy'), 'Purchase date cannot be in the future.']);
  range('pfTank', 1, 20, 'Tank size should be between 1 and 20 litres.');
  range('pfSvcKm', 500, 20000, 'Enter a distance between 500 and 20,000 km.');
  range('pfSvcMonths', 1, 24, 'Enter between 1 and 24 months.');
  range('pfOilKm', 500, 20000, 'Enter a distance between 500 and 20,000 km.');
  if (errs.length) return showErrs(f, errs);
  settings.set('profile', { name: val('pfName'), model: val('pfModel'), reg: val('pfReg').toUpperCase().replace(/\s+/g, ' '), buy: val('pfBuy'),
    tank: num('pfTank'), svcKm: num('pfSvcKm'), svcMonths: num('pfSvcMonths'), oilKm: num('pfOilKm') });
  $('profileSheet').close(); render(); toast('Profile saved ✓');
});

/* ---------- add menu, settings, backup ---------- */
$('addBtn').addEventListener('click', () => $('addMenu').showModal());
$('addMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  $('addMenu').close();
  ({ fill: () => openAdd(null), log: () => openLog(null), service: () => openService(null), expense: () => openExpense(null), doc: () => openDoc(null) })[b.dataset.add]();
});
$('logServiceBtn').addEventListener('click', () => openService(null));
$('addExpenseBtn').addEventListener('click', () => openExpense(null));
$('intervalsBtn').addEventListener('click', openProfile);
$('profileBtn').addEventListener('click', () => { $('settingsSheet').close(); openProfile(); });
$('settingsBtn').addEventListener('click', () => {
  const p = profile();
  $('setName').textContent = [p.name, p.model, p.reg].filter(Boolean).join(' · ');
  renderPrice(); applyTheme(); $('settingsSheet').showModal();
});
$('themeSeg').addEventListener('click', e => { const t = e.target.dataset.t; if (t) { settings.set('theme', t); applyTheme(); } });
$('refreshPriceBtn').addEventListener('click', async () => {
  $('setPrice').textContent = 'Checking…';
  if (await fetchPrice(true)) toast('Price updated');
  else toast('Could not fetch the price right now. Check your internet.', true);
});
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$('exportBtn').addEventListener('click', async () => {
  if (!entries.length && !services.length && !expenses.length && !docs.length && !logs.length) return toast('Nothing to back up yet', true);
  const photos = {};
  for (const r of [...entries, ...services, ...docs]) if (r.hasPhoto) { const b = await getPhoto(r.id); if (b) photos[r.id] = await blobToDataUrl(b); }
  const data = { app: 'activa-mileage', version: 3, profile: profile(), entries, services, expenses, docs, logs, photos };
  download(`activa-backup-${todayStr()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
});
$('csvBtn').addEventListener('click', () => {
  if (!entries.length) return toast('No fill-ups to export yet', true);
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Time', 'Odometer', 'Litres', 'Amount', 'Price per L', 'Full tank', 'Mileage km/l', 'Petrol bunk', 'Note']];
  S.list.forEach(e => rows.push([e.ts.slice(0, 10), e.ts.slice(11), e.odo, e.litres, e.amount, e.price || '',
    e.full ? 'yes' : 'no', e.kmpl ? e.kmpl.toFixed(2) : '', q(e.bunk || ''), q(e.note || '')]));
  download(`activa-mileage-${todayStr()}.csv`, new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); if (!Array.isArray(data.entries)) throw 0; }
  catch (e) { return toast('That file is not a valid backup', true); }
  if (!confirm(`Replace current data with ${data.entries.length} fill-ups from this backup?`)) return;
  try {
    const photos = {};
    for (const [id, url] of Object.entries(data.photos || {})) photos[id] = await (await fetch(url)).blob();
    await tx(DATA_STORES, 'readwrite', (es, ss, xs, ds, ls, ps) => {
      [es, ss, xs, ds, ls, ps].forEach(s => s.clear());
      data.entries.forEach(r => es.put(r));
      (data.services || []).forEach(r => ss.put(r));
      (data.expenses || []).forEach(r => xs.put(r));
      (data.docs || []).forEach(r => ds.put(r));
      (data.logs || []).forEach(r => ls.put(r));
      Object.entries(photos).forEach(([id, b]) => ps.put(b, id));
    });
  } catch (e) { return toast('Restore failed: ' + e.message, true); }
  if (data.profile) settings.set('profile', data.profile);
  else if (data.vehicle) settings.set('vehicle', data.vehicle);
  $('settingsSheet').close(); await refresh(); toast('Backup restored');
});

function loadDemoScript() {
  return new Promise((res, rej) => {
    if (window.loadSampleData) return res();
    const s = document.createElement('script');
    s.src = 'demo.js'; s.onload = res; s.onerror = () => rej(new Error('could not load sample data'));
    document.body.appendChild(s);
  });
}
$('sampleBtn').addEventListener('click', async () => {
  if (!confirm('Load random sample data?\n\nThis replaces all data saved on this phone. Export a backup first if you need it.')) return;
  const btn = $('sampleBtn'); btn.disabled = true; btn.textContent = 'Loading…';
  try { await loadDemoScript(); await loadSampleData(); $('settingsSheet').close(); showTab('home'); }
  catch (e) { toast('Could not load sample data: ' + e.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Load'; }
});
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL fill-ups, daily logs, services, expenses, documents and photos on this phone?\n\nThis cannot be undone.')) return;
  try { await tx(DATA_STORES, 'readwrite', (...stores) => { stores.forEach(s => s.clear()); }); }
  catch (e) { return toast('Could not clear: ' + e.message, true); }
  settings.set('profile', {});
  $('settingsSheet').close(); await refresh(); showTab('home'); toast('All data cleared');
});

/* ---------- wiring ---------- */
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => document.body.appendChild($('toast')));
});
$('addSheet').addEventListener('close', () => { editingId = null; ocrRun++; });
window.addEventListener('resize', drawCharts);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

(async () => {
  try { db = await openDb(); }
  catch (e) { toast('Storage is blocked in this browser, so data cannot be saved. Turn off private/incognito mode.', true); return; }
  await refresh();
  fetchPrice();
  if (new URLSearchParams(location.search).has('demo')) loadDemoScript().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
