'use strict';
/* Ask MileMate: answers plain-English questions about your own data, entirely on the phone.
   A question is read for two things: what it is about (mileage, km, spending…) and the period
   (last week, this month, October…). The matching answerer builds an answer card. */

const DAY = 864e5;
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dShort = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthLong = (y, m) => new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const km0 = v => Math.round(v).toLocaleString('en-IN');
const toDate = ts => new Date(ts.length === 10 ? ts + 'T12:00' : ts);
const MONTH_RE = /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b|\b(?:in|of|during|for)\s+(may)\b/;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/* ---------- period ---------- */
function parseRange(q, fallback) {
  const today = sod(new Date()), tomorrow = new Date(+today + DAY);
  const weekStart = new Date(+today - ((today.getDay() + 6) % 7) * DAY); // Monday
  const y = today.getFullYear(), mo = today.getMonth();
  const R = (from, to, name) => ({ from, to, name });
  let m;
  if (/\btoday\b/.test(q)) return R(today, tomorrow, 'Today');
  if (/\byesterday\b/.test(q)) return R(new Date(+today - DAY), today, 'Yesterday');
  if ((m = q.match(/\b(?:last|past|previous)\s+(\d+)\s*(day|week|month)s?\b/))) {
    const n = +m[1], u = m[2];
    const from = u === 'month' ? new Date(y, mo - n, today.getDate() + 1) : new Date(+today - ((u === 'week' ? 7 : 1) * n - 1) * DAY);
    return R(from, tomorrow, `Last ${n} ${u}${n > 1 ? 's' : ''}`);
  }
  if (/\b(last|previous|past)\s+week\b/.test(q)) return R(new Date(+weekStart - 7 * DAY), weekStart, 'Last week');
  if (/\bthis\s+week\b/.test(q)) return R(weekStart, tomorrow, 'This week');
  if (/\b(last|previous|past)\s+month\b/.test(q)) return R(new Date(y, mo - 1, 1), new Date(y, mo, 1), monthLong(y, mo - 1));
  if (/\bthis\s+month\b/.test(q)) return R(new Date(y, mo, 1), tomorrow, 'This month');
  if (/\b(last|previous|past)\s+year\b/.test(q)) return R(new Date(y - 1, 0, 1), new Date(y, 0, 1), String(y - 1));
  if (/\bthis\s+year\b/.test(q)) return R(new Date(y, 0, 1), tomorrow, String(y));
  if ((m = q.match(MONTH_RE))) {
    const i = MONTH_KEYS.indexOf((m[1] || m[2]).slice(0, 3)), yy = i > mo ? y - 1 : y;
    return R(new Date(yy, i, 1), new Date(yy, i + 1, 1), monthLong(yy, i));
  }
  if (/\b(all ?time|overall|ever|lifetime|so far|since start|till now|total)\b/.test(q)) return R(new Date(0), tomorrow, 'All time');
  const presets = {
    all: R(new Date(0), tomorrow, 'All time'),
    month: R(new Date(y, mo, 1), tomorrow, 'This month'),
    days30: R(new Date(+today - 29 * DAY), tomorrow, 'Last 30 days')
  };
  return presets[fallback];
}
function rangeText(r) {
  if (r.name === 'All time') return 'All time';
  const end = new Date(Math.min(+r.to, +sod(new Date()) + DAY) - DAY);
  return +end <= +r.from ? `${r.name} · ${dShort(r.from)}` : `${r.name} · ${dShort(r.from)} – ${dShort(end)}`;
}
const inR = (ts, r) => { const t = toDate(ts); return t >= r.from && t < r.to; };
const rangeDays = r => Math.max(1, Math.round((Math.min(+r.to, +sod(new Date()) + DAY) - Math.max(+r.from, firstDataTime())) / DAY));
function firstDataTime() {
  const ts = [...entries.map(e => e.ts), ...logs.map(l => l.ts), ...services.map(s => s.date)].map(t => +toDate(t));
  return ts.length ? +sod(new Date(Math.min(...ts))) : Date.now();
}

/* ---------- data helpers ---------- */
// Every odometer reading we know of (fill-ups, daily logs, services), oldest first.
function readings() {
  return [...entries.map(e => ({ t: toDate(e.ts), odo: e.odo })), ...logs.map(l => ({ t: toDate(l.ts), odo: l.odo })),
    ...services.map(s => ({ t: toDate(s.date), odo: s.odo }))].sort((a, b) => a.t - b.t || a.odo - b.odo);
}
// Km between consecutive readings, counted on the day of the later reading.
function kmByDay(r) {
  const p = readings(), out = {};
  for (let i = 1; i < p.length; i++) {
    if (p[i].t < r.from || p[i].t >= r.to) continue;
    const d = localISO(p[i].t).slice(0, 10);
    out[d] = (out[d] || 0) + Math.max(0, p[i].odo - p[i - 1].odo);
  }
  return out;
}
const sumObj = o => Object.values(o).reduce((s, v) => s + v, 0);
// Mileage of every tank whose riding overlaps the period.
function tanksIn(r) {
  const byId = Object.fromEntries(S.list.map(e => [e.id, e]));
  return S.withM.filter(e => { const b = byId[e.baseId]; return b && toDate(b.ts) < r.to && toDate(e.ts) >= r.from; });
}
const spendIn = r => {
  const petrol = entries.filter(e => inR(e.ts, r)).reduce((s, e) => s + e.amount, 0);
  const service = services.filter(s => inR(s.date, r)).reduce((s, x) => s + (x.cost || 0), 0);
  const other = expenses.filter(x => inR(x.date, r)).reduce((s, x) => s + x.amount, 0);
  return { petrol, service, other, total: petrol + service + other };
};
function previousRange(r) {
  const len = +r.to - +r.from;
  return { from: new Date(+r.from - len), to: r.from, name: 'previous period' };
}
const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
const trend = (a, b, upGood) => {
  const p = pct(a, b);
  if (p === null || !isFinite(p)) return null;
  if (p === 0) return 'same as before';
  return `${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs previous period${(p > 0) === upGood ? ' 👍' : ''}`;
};
// Daily bars for periods up to a month.
function dayChart(r, valuesByDay) {
  const days = [];
  const end = Math.min(+r.to, +sod(new Date()) + DAY);
  for (let t = +sod(r.from); t < end; t += DAY) days.push(localISO(new Date(t)).slice(0, 10));
  if (days.length < 2 || days.length > 31) return null;
  return { labels: days.map(d => String(+d.slice(8))), values: days.map(d => valuesByDay[d] || 0), every: days.length > 14 ? 5 : 1 };
}

/* ---------- answerers ---------- */
const A = {
  mileage(q) {
    const r = parseRange(q, 'all');
    if (!S.avg) return { icon: '⛽', cls: 'teal', label: rangeText(r), big: '–', sub: 'Mileage needs two full-tank fill-ups. Add your next full tank and I can tell you.' };
    const tanks = r.name === 'All time' ? S.withM : tanksIn(r);
    if (!tanks.length) {
      const last = S.withM[S.withM.length - 1];
      return { icon: '⛽', cls: 'teal', label: rangeText(r), big: `${S.avg.toFixed(1)}`, unit: 'km/l overall',
        sub: 'No full tank was finished in this period, so I am showing your overall average.',
        facts: [['Last measured tank', `${last.kmpl.toFixed(1)} km/l (${dShort(toDate(last.ts))})`]] };
    }
    const km = tanks.reduce((s, e) => s + e.segKm, 0), l = tanks.reduce((s, e) => s + e.segL, 0), v = km / l;
    const facts = [['Measured over', `${km0(km)} km on ${l.toFixed(1)} L`], ['Tanks counted', String(tanks.length)]];
    if (r.name !== 'All time') facts.push(['Your overall average', `${S.avg.toFixed(1)} km/l`]);
    if (tanks.length > 1) {
      const best = tanks.reduce((a, b) => (b.kmpl > a.kmpl ? b : a)), worst = tanks.reduce((a, b) => (b.kmpl < a.kmpl ? b : a));
      facts.push(['Best tank', `${best.kmpl.toFixed(1)} km/l (${dShort(toDate(best.ts))})`], ['Worst tank', `${worst.kmpl.toFixed(1)} km/l (${dShort(toDate(worst.ts))})`]);
    }
    const diff = r.name !== 'All time' ? pct(v, S.avg) : null;
    return { icon: '⛽', cls: 'teal', label: rangeText(r), big: v.toFixed(1), unit: 'km/l',
      sub: diff === null ? 'Average across all your full tanks.' : diff === 0 ? 'Right on your usual average.' : `${Math.abs(diff)}% ${diff > 0 ? 'better' : 'lower'} than your usual ${S.avg.toFixed(1)} km/l.`,
      facts, chart: tanks.length >= 2 ? { labels: tanks.map(e => String(toDate(e.ts).getDate())), values: tanks.map(e => e.kmpl), fmt: v => v.toFixed(0) } : null };
  },

  distance(q) {
    const r = parseRange(q, 'month'), byDay = kmByDay(r), km = sumObj(byDay), days = rangeDays(r);
    const rode = Object.values(byDay).filter(v => v > 0).length, best = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    const prev = sumObj(kmByDay(previousRange(r)));
    const facts = [['Average', `${km0(km / days)} km/day`], ['Days ridden', `${rode} of ${days}`]];
    if (best && best[1] > 0) facts.push(['Longest day', `${km0(best[1])} km (${dShort(new Date(best[0] + 'T00:00'))})`]);
    if (r.name !== 'All time' && prev) facts.push(['Previous period', `${km0(prev)} km`]);
    return { icon: '🛵', cls: 'pink', label: rangeText(r), big: km0(km), unit: 'km',
      sub: km ? (r.name !== 'All time' && trend(km, prev, true)) || 'Based on your odometer readings.' : 'No odometer readings in this period. Add daily logs to track km.',
      facts, chart: dayChart(r, byDay) };
  },

  spend(q) {
    const r = parseRange(q, 'month'), s = spendIn(r), petrolOnly = /petrol|fuel/.test(q) && !/total|all|overall|everything/.test(q);
    const prev = spendIn(previousRange(r)), value = petrolOnly ? s.petrol : s.total;
    const km = sumObj(kmByDay(r));
    const facts = petrolOnly
      ? [['Fill-ups', String(entries.filter(e => inR(e.ts, r)).length)], ['Litres', `${entries.filter(e => inR(e.ts, r)).reduce((a, e) => a + e.litres, 0).toFixed(1)} L`]]
      : [['⛽ Petrol', inr(s.petrol)], ['🔧 Service', inr(s.service)], ['🧾 Other', inr(s.other)]];
    if (km) facts.push(['Cost per km', inr(value / km, 2)]);
    const byDay = {};
    entries.filter(e => inR(e.ts, r)).forEach(e => { const d = e.ts.slice(0, 10); byDay[d] = (byDay[d] || 0) + e.amount; });
    if (!petrolOnly) {
      services.filter(x => inR(x.date, r)).forEach(x => { byDay[x.date] = (byDay[x.date] || 0) + (x.cost || 0); });
      expenses.filter(x => inR(x.date, r)).forEach(x => { byDay[x.date] = (byDay[x.date] || 0) + x.amount; });
    }
    return { icon: '💰', cls: 'orange', label: rangeText(r), big: inr(value), unit: petrolOnly ? 'on petrol' : 'total',
      sub: value ? (r.name !== 'All time' && trend(value, petrolOnly ? prev.petrol : prev.total, false)) || '' : 'Nothing spent in this period.',
      facts, chart: dayChart(r, byDay) };
  },

  fills(q) {
    const r = parseRange(q, 'month'), list = entries.filter(e => inR(e.ts, r));
    const litres = list.reduce((s, e) => s + e.litres, 0), amount = list.reduce((s, e) => s + e.amount, 0);
    const bunks = [...new Set(list.map(e => e.bunk).filter(Boolean))];
    const facts = [['Petrol', `${litres.toFixed(1)} L`], ['Paid', inr(amount)]];
    if (litres) facts.push(['Average price', `${inr(amount / litres, 2)}/L`]);
    if (list.length) facts.push(['Partial fills', String(list.filter(e => !e.full).length)]);
    if (bunks.length) facts.push(['Bunks', bunks.join(', ')]);
    if (/litre|liter|\bltr\b/.test(q)) {
      facts[0] = ['Fill-ups', String(list.length)];
      return { icon: '⛽', cls: 'violet', label: rangeText(r), big: litres.toFixed(1), unit: 'litres',
        sub: list.length ? `Across ${plural(list.length, 'fill-up')}.` : 'No fill-ups in this period.', facts };
    }
    return { icon: '⛽', cls: 'violet', label: rangeText(r), big: String(list.length), unit: list.length === 1 ? 'fill-up' : 'fill-ups',
      sub: list.length ? `Last one on ${fmtDate(list.sort((a, b) => a.ts.localeCompare(b.ts))[list.length - 1].ts)}.` : 'No fill-ups in this period.', facts };
  },

  price() {
    const p = price(), recent = entries.filter(e => e.price && inR(e.ts, parseRange('', 'days30')));
    const facts = [['Source', `${p.source}, ${p.date === todayStr() ? 'today' : fmtDate(p.date)}`]];
    if (recent.length) facts.push(['You paid (last 30 days)', `${inr(avgOf(recent.map(e => e.price)), 2)}/L on average`]);
    return { icon: '🏷️', cls: 'blue', label: 'Petrol price · Hyderabad', big: inr(p.value, 2), unit: 'per litre',
      sub: `A full ${profile().tank} L tank costs about ${inr(p.value * profile().tank)}.`, facts };
  },

  fuel() {
    const f = fuelState();
    if (!f) return { icon: '⛽', cls: 'teal', label: 'Petrol left', big: '–', sub: 'Add a fill-up first.' };
    const facts = [['Km since last fill-up', `${km0(f.km)} km`], ['Last fill-up', `${fmtDate(f.last.ts)} at ${km0(f.last.odo)} km`]];
    if (f.left === null) return { icon: '⛽', cls: 'teal', label: 'Petrol left', big: `${km0(f.km)} km`, unit: 'since fill-up', sub: 'Petrol left shows up once mileage is known (two full tanks).', facts };
    facts.unshift(['Km you can still ride', `about ${km0(f.rideKm)} km`]);
    return { icon: '⛽', cls: f.pct <= 0.15 ? 'danger-c' : 'teal', label: 'Petrol left · estimate', big: f.left.toFixed(1), unit: `L (${Math.round(f.pct * 100)}% tank)`,
      sub: f.pct <= 0.15 ? 'Running low. Fill up soon.' : 'Based on your average mileage and readings since the last fill-up.', facts };
  },

  service(q) {
    const st = serviceStatus();
    const worst = (/\boil\b/.test(q) && st.find(s => s.label === 'Engine oil change'))
      || st.find(s => s.level === 'danger') || st.find(s => s.level === 'warn') || st[0];
    return { icon: '🔧', cls: worst.level === 'danger' ? 'danger-c' : 'teal', label: 'Service', big: worst.label, unit: '',
      sub: worst.text + (worst.level === 'none' ? '' : '.'), facts: st.map(s => [s.label, s.text]) };
  },

  docs(q) {
    const want = DOC_TYPES.find(([id]) => ({ insurance: /insur/, puc: /puc|pollution/, rc: /\brc\b|registration/, licence: /licen[cs]e|dl\b/ })[id].test(q));
    const rows = DOC_TYPES.map(([id, icon, name]) => ({ id, icon, name, st: docStatus(docs.find(d => d.id === id)) }));
    const main = want ? rows.find(x => x.id === want[0]) : rows.find(x => x.st.level === 'danger') || rows.find(x => x.st.level === 'warn') || rows[0];
    return { icon: main.icon, cls: main.st.level === 'danger' ? 'danger-c' : main.st.level === 'warn' ? 'orange' : 'teal', label: 'Documents',
      big: main.name.split(' (')[0], unit: '', sub: main.st.text + '.', facts: rows.filter(x => x !== main).map(x => [`${x.icon} ${x.name.split(' (')[0]}`, x.st.text]) };
  },

  costPerKm(q) {
    const r = parseRange(q, 'all'), s = spendIn(r), km = sumObj(kmByDay(r));
    if (!km) return { icon: '🪙', cls: 'teal', label: rangeText(r), big: '–', sub: 'Not enough odometer readings in this period.' };
    return { icon: '🪙', cls: 'teal', label: rangeText(r), big: inr(s.total / km, 2), unit: 'per km (all costs)',
      sub: `${inr(s.total)} over ${km0(km)} km.`, facts: [['Petrol only', `${inr(s.petrol / km, 2)}/km`], ['Service', `${inr(s.service / km, 2)}/km`], ['Other', `${inr(s.other / km, 2)}/km`]] };
  },

  trips(q) {
    const r = parseRange(q, 'days30'), list = logsWithDelta().filter(l => inR(l.ts, r));
    const purpose = LOG_PURPOSES.find(([p]) => new RegExp('\\b' + p.toLowerCase()).test(q));
    if (purpose) {
      const mine = list.filter(l => l.purpose === purpose[0]), km = mine.reduce((s, l) => s + (l.delta || 0), 0);
      return { icon: purpose[1], cls: 'pink', label: rangeText(r), big: km0(km), unit: `km for ${purpose[0]}`,
        sub: `${plural(mine.length, 'trip')}.`, facts: mine.slice(-4).reverse().map(l => [`${fmtDate(l.ts)} ${fmtTime(l.ts)}`, l.remarks || '—']) };
    }
    const g = {};
    list.forEach(l => { const k = l.purpose || 'Other'; (g[k] = g[k] || { km: 0, n: 0 }); g[k].km += l.delta || 0; g[k].n++; });
    const rows = Object.entries(g).sort((a, b) => b[1].km - a[1].km);
    return { icon: '📝', cls: 'pink', label: rangeText(r), big: String(list.length), unit: list.length === 1 ? 'trip logged' : 'trips logged',
      sub: rows.length ? `Most km for ${rows[0][0]}.` : 'No daily logs in this period.',
      facts: rows.map(([p, x]) => [`${(LOG_PURPOSES.find(y => y[0] === p) || ['', '📝'])[1]} ${p}`, `${km0(x.km)} km · ${plural(x.n, 'trip')}`]) };
  },

  bestWorst(q) {
    const r = parseRange(q, 'all'), tanks = r.name === 'All time' ? S.withM : tanksIn(r);
    if (tanks.length < 2) return A.mileage(q);
    const best = tanks.reduce((a, b) => (b.kmpl > a.kmpl ? b : a)), worst = tanks.reduce((a, b) => (b.kmpl < a.kmpl ? b : a));
    const pick = /worst|lowest|min|poor/.test(q) ? worst : best;
    return { icon: pick === best ? '🏆' : '📉', cls: pick === best ? 'orange' : 'danger-c', label: rangeText(r), big: pick.kmpl.toFixed(1), unit: 'km/l',
      sub: `${pick === best ? 'Best' : 'Worst'} tank, finished on ${fmtDate(pick.ts)}${pick.bunk ? '' : ''}.`,
      facts: [['Best', `${best.kmpl.toFixed(1)} km/l (${dShort(toDate(best.ts))})`], ['Worst', `${worst.kmpl.toFixed(1)} km/l (${dShort(toDate(worst.ts))})`], ['Average', `${S.avg.toFixed(1)} km/l`]] };
  },

  summary(q) {
    const r = parseRange(q, 'month'), km = sumObj(kmByDay(r)), s = spendIn(r), tanks = tanksIn(r);
    const l = tanks.reduce((a, e) => a + e.segL, 0), mil = l ? tanks.reduce((a, e) => a + e.segKm, 0) / l : null;
    return { icon: '📊', cls: 'violet', label: rangeText(r), big: km0(km), unit: 'km ridden',
      sub: 'Here is how this period looks.',
      facts: [['Mileage', mil ? `${mil.toFixed(1)} km/l` : '–'], ['Spent (all)', inr(s.total)], ['Petrol', inr(s.petrol)],
        ['Cost per km', km ? inr(s.total / km, 2) : '–'], ['Fill-ups', String(entries.filter(e => inR(e.ts, r)).length)], ['Trips logged', String(logs.filter(x => inR(x.ts, r)).length)]] };
  },

  help() {
    return { icon: '✨', cls: 'violet', label: 'Things you can ask', big: 'Try these', unit: '',
      sub: 'I answer from your own fill-ups, logs, services and documents.',
      facts: [['Mileage', '“Mileage last week?”'], ['Distance', '“How many km this month?”'], ['Spending', '“Spent on petrol in October?”'],
        ['Petrol', '“How much petrol is left?”'], ['Service', '“When is the service due?”'], ['Documents', '“When does insurance expire?”'],
        ['Trips', '“Km for office last 30 days?”'], ['Overview', '“Summary of last month”']] };
  }
};

// Work out what the question is about. Order matters: more specific topics first.
function intent(q) {
  const t = re => re.test(q);
  if (t(/\b(help|what can you|how to use|examples?)\b/)) return 'help';
  if (t(/insur|\bpuc\b|pollution|\brc\b|registration|licen[cs]e|document|expir|renew/)) return 'docs';
  if (t(/service|oil change|engine oil|maintenance|\bdue\b/)) return 'service';
  if (t(/\b(left|remaining)\b|how far|\btank\b|reserve|empty|can i (still )?ride/)) return 'fuel';
  if (t(/per ?km|\/ ?km|cost per|running cost/)) return 'costPerKm';
  if (t(/\b(price|rate)\b/) && !t(/paid|spent|spend/)) return 'price';
  if (t(/trip|purpose|\boffice\b|personal|shopping|family|travel|delivery|\blogs?\b|reason/)) return 'trips';
  if (t(/\b(best|worst|highest|lowest|max(imum)?|min(imum)?|poor)\b/)) return 'bestWorst';
  if (t(/mileage|km ?\/ ?l|kmpl|efficien|economy|average/)) return 'mileage';
  if (t(/spen[dt]|\bcost|money|expense|paid|\bpay\b|rupee|₹|\brs\b|budget|how much did/)) return 'spend';
  if (t(/fill|refuel|litre|liter|\bltr\b|petrol|fuel/)) return 'fills';
  if (t(/\bkms?\b|kilomet|distance|ride|rode|travell?ed|drove|drive|odo/)) return 'distance';
  if (t(/summary|report|overview|stats?|how am i|doing|recap/)) return 'summary';
  return 'help';
}

/* ---------- UI ---------- */
const SUGGESTIONS = ['Mileage last week?', 'Km this week', 'Spent this month', 'Petrol left?', 'Fill-ups last month', 'Service due?',
  'Insurance expiry', 'Trips last 30 days', 'Summary of last month', 'Cost per km', 'Best mileage', 'Petrol price today'];
$('askChips').innerHTML = SUGGESTIONS.map(s => `<button type="button">${esc(s)}</button>`).join('');

function ask(raw) {
  const text = raw.trim();
  if (!text) return;
  const q = ' ' + text.toLowerCase().replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  let a;
  try { a = A[intent(q)](q); } catch (e) { a = { icon: '⚠️', cls: 'danger-c', label: 'Sorry', big: 'Could not answer', unit: '', sub: e.message }; }
  const card = document.createElement('div');
  card.className = 'ans';
  card.innerHTML = `<div class="q">You asked: <b></b></div>
    <div class="ans-head"><span class="chip ${a.cls}" style="width:46px;height:46px;font-size:22px">${a.icon}</span>
      <div><div class="lbl"></div><div class="big"></div></div></div>
    ${a.sub ? '<div class="sub"></div>' : ''}
    ${a.chart ? '<canvas></canvas>' : ''}
    ${a.facts && a.facts.length ? '<ul></ul>' : ''}`;
  card.querySelector('.q b').textContent = text;
  card.querySelector('.lbl').textContent = a.label;
  card.querySelector('.big').innerHTML = `${esc(a.big)} ${a.unit ? `<small>${esc(a.unit)}</small>` : ''}`;
  if (a.sub) card.querySelector('.sub').textContent = a.sub;
  if (a.facts && a.facts.length) card.querySelector('ul').innerHTML = a.facts.map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('');
  const box = $('askAnswers');
  box.querySelector('.ans-empty') && box.querySelector('.ans-empty').remove();
  box.prepend(card);
  while (box.children.length > 8) box.lastChild.remove();
  if (a.chart) barChart(card.querySelector('canvas'), a.chart.labels, [{ values: a.chart.values, color: '#a855f7' }], a.chart.fmt || (v => String(Math.round(v))),
    { every: a.chart.every || 1, values: a.chart.labels.length <= 14 });
  $('askInput').value = '';
  $('askSheet').scrollTop = 0;
}

function openAsk() {
  if (!$('askAnswers').children.length) $('askAnswers').innerHTML = '<div class="ans-empty">Ask anything about your riding, or tap a suggestion above.<br>Answers come from your own data and stay on this phone.</div>';
  $('askSheet').showModal();
  setTimeout(() => $('askInput').focus(), 200);
}
$('askBar').addEventListener('click', openAsk);
$('askForm').addEventListener('submit', e => { e.preventDefault(); ask($('askInput').value); });
$('askChips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });

// Voice questions where the browser supports speech recognition (Chrome on Android does).
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Speech) {
  const mic = $('askMic'); mic.hidden = false;
  let rec = null;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Speech(); rec.lang = 'en-IN'; rec.interimResults = true;
    mic.classList.add('on');
    rec.onresult = e => { const r = e.results[e.results.length - 1]; $('askInput').value = r[0].transcript; if (r.isFinal) ask(r[0].transcript); };
    rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice input: ' + e.error, true); };
    rec.onend = () => { mic.classList.remove('on'); rec = null; };
    rec.start();
  });
}
