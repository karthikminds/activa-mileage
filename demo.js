// Random sample data for trying the app: a different, realistic history every time.
// Loaded from Settings → "Load sample data", or automatically when the URL has ?demo (after asking).
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
const r2 = n => Math.round(n * 100) / 100;

// A fake odometer photo (dial + LCD) so fill-ups have pictures like real ones.
function sampleOdoPhoto(odo) {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(400, 300, 60, 400, 300, 520);
  bg.addColorStop(0, `hsl(220,6%,${rint(22, 30)}%)`); bg.addColorStop(1, '#121317');
  g.fillStyle = bg; g.fillRect(0, 0, 800, 600);
  g.save(); g.translate(400, 300); g.rotate(rnd(-0.06, 0.06)); g.translate(-400, -300);
  g.fillStyle = '#0b0c0e'; g.beginPath(); g.ellipse(400, 300, 340, 250, 0, 0, 7); g.fill();
  g.strokeStyle = '#d9dde3'; g.lineWidth = 4;
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (1 + i / 12);
    g.beginPath(); g.moveTo(400 + Math.cos(a) * 225, 290 + Math.sin(a) * 165); g.lineTo(400 + Math.cos(a) * 258, 290 + Math.sin(a) * 190); g.stroke();
  }
  const na = Math.PI * (1 + rnd(0, 0.15));
  g.strokeStyle = '#ff5a36'; g.lineWidth = 6; g.beginPath(); g.moveTo(400, 290); g.lineTo(400 + Math.cos(na) * 200, 290 + Math.sin(na) * 150); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('km/h', 400, 250);
  g.fillStyle = '#a9c2a6'; g.fillRect(250, 335, 300, 92);
  g.fillStyle = '#1c241b'; g.font = 'bold 66px Consolas, "Roboto Mono", monospace';
  g.fillText(String(Math.round(odo)).padStart(5, '0'), 400, 404);
  g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'left'; g.fillText('ODO', 252, 327);
  g.restore();
  const glare = g.createLinearGradient(0, 0, 800, 600);
  glare.addColorStop(0, 'rgba(255,255,255,0)'); glare.addColorStop(rnd(.3, .6), `rgba(255,255,255,${rnd(.03, .12)})`); glare.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glare; g.fillRect(0, 0, 800, 600);
  return sampleImage(c);
}
// A fake workshop bill.
function sampleBillPhoto(s) {
  const c = document.createElement('canvas'); c.width = 600; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, 600, 800);
  g.save(); g.translate(300, 400); g.rotate(rnd(-0.05, 0.05)); g.translate(-300, -400);
  g.fillStyle = '#fbfaf6'; g.fillRect(70, 40, 460, 720);
  g.fillStyle = '#222'; g.textAlign = 'center'; g.font = 'bold 30px sans-serif'; g.fillText(s.where.toUpperCase(), 300, 110);
  g.font = '18px sans-serif'; g.fillText('Service Invoice', 300, 140);
  g.textAlign = 'left'; g.font = '18px monospace';
  g.fillText(`Date: ${s.date}`, 100, 200); g.fillText(`KM:   ${s.odo}`, 100, 228);
  let y = 290;
  s.items.forEach(it => { g.fillText(it, 100, y); y += 34; });
  g.fillRect(100, y, 400, 2);
  g.font = 'bold 24px monospace'; g.fillText(`TOTAL  Rs ${s.cost}`, 100, y + 44);
  g.restore();
  return sampleImage(c);
}
// Shrinks and encodes synchronously; async toBlob is very slow in background tabs.
function sampleImage(src) {
  const c = document.createElement('canvas'), s = 0.6;
  c.width = src.width * s; c.height = src.height * s;
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const bin = atob(c.toDataURL('image/jpeg', 0.75).split(',')[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const t = document.createElement('canvas'), k = 160 / Math.max(c.width, c.height);
  t.width = c.width * k; t.height = c.height * k;
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { blob, thumb: t.toDataURL('image/jpeg', 0.7) };
}

async function loadSampleData() {
  const now = new Date(), day = n => localISO(new Date(now.getTime() - n * 864e5)).slice(0, 10);
  const bunks = ['HP Kukatpally', 'IOCL Miyapur', 'BPCL Madhapur', 'Shell Gachibowli'];
  const favourite = pick(bunks);
  const notes = ['Long ride to Shamshabad', 'Weekend trip', 'Tyre pressure checked', 'Rainy week', 'Office commute only', 'Ride to Yadagirigutta'];
  const baseKmpl = rnd(46, 52), dropAtEnd = chance(0.5);
  let odo = rint(6000, 18000), price = rnd(110.5, 113), cursor = new Date(now.getTime() - rint(190, 230) * 864e5);

  // Fill-ups: the km before each one = mileage × litres added (the tank gets back what was burned).
  const fills = [];
  while (cursor < now) {
    const i = fills.length, partial = i > 0 && chance(0.18);
    if (chance(0.3)) price = Math.min(118, Math.max(108, price + rnd(-0.2, 0.45)));
    const amount = partial ? pick([100, 150, 200, 250]) : chance(0.5) ? pick([350, 400, 450, 500, 550]) : Math.round(rnd(3.6, 5.1) * price);
    const litres = r2(amount / price);
    let k = baseKmpl + rnd(-2.2, 2.2);
    const left = (now - cursor) / 864e5;
    if (dropAtEnd && left < 22) k -= rnd(4.5, 6.5);
    if (i) odo = Math.round(odo + k * litres);
    cursor.setHours(rint(7, 21), rint(0, 59));
    if (cursor > now) break;
    fills.push({ id: 'demo' + i, ts: localISO(cursor), odo, litres, amount, price: r2(price), full: !partial,
      bunk: chance(0.6) ? favourite : pick(bunks), note: chance(0.15) ? pick(notes) : '', thumb: null, hasPhoto: true });
    cursor = new Date(cursor.getTime() + (partial ? rint(3, 5) : rint(7, 12)) * 864e5);
  }
  const dateAtOdo = target => { const f = fills.find(x => x.odo >= target) || fills[fills.length - 1]; return f.ts.slice(0, 10); };

  // Services roughly every 3,000 km, sometimes with extra work, plus the odd repair.
  const garages = ['Honda Sai Motors', 'Sri Balaji Honda', 'Local garage'];
  const svcs = [];
  for (let at = fills[0].odo + rint(400, 1500); at < odo; at += rint(2700, 3300)) {
    const items = ['General service', 'Engine oil'];
    let cost = rint(65, 120) * 10;
    if (chance(0.45)) { items.push(pick(['Air filter', 'Spark plug', 'Brake shoes', 'Drive belt'])); cost += rint(15, 60) * 10; }
    svcs.push({ id: 's' + svcs.length, date: dateAtOdo(at), odo: at, cost, items, where: pick(garages), note: '', hasPhoto: chance(0.7) });
  }
  if (chance(0.6)) {
    const at = rint(fills[0].odo, odo);
    const item = pick(['Tyres', 'Battery']);
    svcs.push({ id: 's' + svcs.length, date: dateAtOdo(at), odo: at, cost: item === 'Tyres' ? rint(140, 190) * 10 : rint(120, 170) * 10,
      items: [item], where: pick(garages), note: item === 'Tyres' ? 'Rear tyre replaced' : '', hasPhoto: chance(0.5) });
  }

  const docsData = [
    { id: 'insurance', expiry: day(-rint(-5, 200)), number: 'POL' + rint(100000, 999999), provider: pick(['ICICI Lombard', 'Bajaj Allianz', 'HDFC ERGO', 'Acko']), hasPhoto: false },
    { id: 'puc', expiry: day(-rint(8, 180)), number: 'TS' + rint(1000000, 9999999), provider: '', hasPhoto: false },
    { id: 'licence', expiry: day(-rint(800, 4000)), number: 'TS09' + rint(2010, 2022) + rint(1000000, 9999999), provider: '', hasPhoto: false }
  ];
  if (chance(0.6)) docsData.push({ id: 'rc', expiry: day(-rint(2000, 5000)), number: '', provider: '', hasPhoto: false });

  const expSpec = [['Parking', 20, 60, 4], ['Washing', 100, 250, 3], ['Repair', 80, 150, 2], ['Accessories', 200, 1500, 1], ['Toll', 25, 50, 1], ['Other', 50, 300, 1]];
  const span = Math.max(30, Math.round((now - new Date(fills[0].ts)) / 864e5));
  const exps = [];
  expSpec.forEach(([category, lo, hi, n]) => {
    for (let j = rint(0, n); j > 0; j--) {
      const amount = rint(lo, hi);
      exps.push({ id: 'x' + exps.length, date: day(rint(0, span)), category, amount: Math.max(lo, amount - (amount % 10)),
        note: category === 'Repair' ? 'Puncture' : category === 'Accessories' ? pick(['Helmet visor', 'Seat cover', 'Phone holder', 'Rain cover']) : '' });
    }
  });

  // Pictures for every fill-up and some service bills.
  const photos = {};
  for (const f of fills) { const p = sampleOdoPhoto(f.odo); f.thumb = p.thumb; photos[f.id] = p.blob; }
  for (const s of svcs) if (s.hasPhoto) photos[s.id] = sampleBillPhoto(s).blob;

  await tx(['entries', 'services', 'expenses', 'docs', 'photos'], 'readwrite', (es, ss, xs, ds, ps) => {
    [es, ss, xs, ds, ps].forEach(s => s.clear());
    fills.forEach(r => es.put(r)); svcs.forEach(r => ss.put(r)); exps.forEach(r => xs.put(r)); docsData.forEach(r => ds.put(r));
    Object.entries(photos).forEach(([id, b]) => ps.put(b, id));
  });
  const letters = () => String.fromCharCode(rint(65, 90), rint(65, 90));
  settings.set('profile', { name: pick(['My Activa', 'Activa', 'Daily Ride']), model: pick(['Activa 6G', 'Activa 125', 'Activa 5G']),
    reg: `TS ${String(rint(7, 36)).padStart(2, '0')} ${letters()} ${rint(1000, 9999)}`, buy: day(rint(400, 2200)),
    tank: 5.3, svcKm: 3000, svcMonths: 4, oilKm: 3000 });
  await refresh();
  toast(`Sample data loaded: ${plural(fills.length, 'fill-up')}, ${plural(svcs.length, 'service')}, ${plural(exps.length, 'expense')} ✓`);
}

if (new URLSearchParams(location.search).has('demo')) {
  history.replaceState(null, '', location.pathname);
  if (confirm('Load random sample data to try the app?\n\nThis replaces all data saved in this browser.')) loadSampleData();
}
