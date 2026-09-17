// 자리 바꾸기 — 모든 데이터는 이 브라우저의 localStorage에만 저장된다.

const STORE = 'seat-changer-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (r, c) => r + ':' + c;
const rc = (k) => k.split(':').map(Number);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const koDate = (s) => { const [, m, d] = s.split('-').map(Number); return m + '월 ' + d + '일'; };

const KINDS = ['서로 붙지 않기', '최대한 멀리', '짝으로 앉히기', '앞 2줄 안에', '뒤 2줄 안에', '창가 쪽 분단', '복도 쪽 분단'];
const PAIR_KINDS = ['서로 붙지 않기', '최대한 멀리', '짝으로 앉히기'];

// ---------- 저장 ----------
function defaults() {
  const desks = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) desks.push(key(r, c));
  return {
    v: 1,
    className: '',
    rosterText: '',
    students: [],                       // [{ name, g: 'm' | 'w' | '' }]
    layout: { R: 4, G: 3, desks, window: 'left' },
    current: { seats: {}, date: null }, // 지난 자리 (key → 이름)
    rules: [],                          // [{ id, said, a, b, kind, must }]
    basics: { prev: true, pair: true, mix: true },
    draft: { seats: {}, pinned: [] },   // 결과 화면에서 다듬는 중인 자리
    history: []                         // 확정 기록 [{ date, seats }]
  };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (d && d.v === 1) return Object.assign(defaults(), d);
  } catch (e) { /* 저장소를 못 쓰면 새로 시작 */ }
  return defaults();
}

let S = load();
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 개인정보 보호 모드 등 */ }
}

// ---------- 교실 모양 ----------
let DESKS = new Set();
const cols = () => S.layout.G * 2;
const group = (c) => Math.floor(c / 2);

function syncDesks() {
  S.layout.desks = S.layout.desks.filter((k) => { const [r, c] = rc(k); return r < S.layout.R && c < cols(); });
  DESKS = new Set(S.layout.desks);
}

const deskList = () => [...DESKS].sort((a, b) => { const [ra, ca] = rc(a), [rb, cb] = rc(b); return ra - rb || ca - cb; });
const partnerKey = (k) => { const [r, c] = rc(k); const p = key(r, c % 2 ? c - 1 : c + 1); return DESKS.has(p) ? p : null; };
const touching = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return a !== b && group(c1) === group(c2) && Math.abs(r1 - r2) <= 1; };
const dist = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return Math.hypot((c1 - c2) + (group(c1) - group(c2)) * 0.8, r1 - r2); };
const windowGroup = () => (S.layout.window === 'left' ? 0 : S.layout.G - 1);
const hallGroup = () => (S.layout.window === 'left' ? S.layout.G - 1 : 0);
const posOf = (seats) => { const p = {}; for (const k in seats) if (seats[k]) p[seats[k]] = k; return p; };
const shortPos = (k) => { const [r, c] = rc(k); return (r + 1) + '-' + (group(c) + 1); };
const longPos = (k) => { const [r, c] = rc(k); return (r + 1) + '줄 ' + (group(c) + 1) + '분단'; };

// ---------- 명단 ----------
const names = () => S.students.map((s) => s.name);
const genderOf = () => { const g = {}; S.students.forEach((s) => { g[s.name] = s.g; }); return g; };

function parseRoster(text) {
  const students = [], seen = new Set(), dup = [];
  text.split('\n').forEach((line) => {
    let parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return;
    if (parts.length > 1 && /^\d+\.?$/.test(parts[0])) parts = parts.slice(1);
    let g = '';
    const last = parts[parts.length - 1];
    if (parts.length > 1 && /^(남|여|남자|여자|m|f)$/i.test(last)) {
      g = /^(남|남자|m)$/i.test(last) ? 'm' : 'w';
      parts = parts.slice(0, -1);
    }
    const name = parts.join(' ');
    if (!name || /^(이름|성명)$/.test(name)) return;
    if (seen.has(name)) { dup.push(name); return; }
    seen.add(name);
    students.push({ name, g });
  });
  return { students, dup };
}

// 책상이 없어졌거나 명단에서 빠진 학생을 정리한다. fill이면 자리 없는 학생을 빈 책상에 채운다.
function reconcile(seats, fill) {
  const roster = new Set(names());
  const displaced = [];
  for (const k of Object.keys(seats)) {
    const n = seats[k];
    if (!DESKS.has(k) || !n || !roster.has(n)) {
      if (n && roster.has(n)) displaced.push(n);
      delete seats[k];
    }
  }
  if (!fill) return [];
  const seated = new Set(Object.values(seats));
  const waiting = displaced.concat(names().filter((n) => !seated.has(n) && !displaced.includes(n)));
  deskList().forEach((k) => { if (!seats[k] && waiting.length) seats[k] = waiting.shift(); });
  return waiting; // 책상이 모자라 못 앉은 학생
}

// ---------- 조건 문장 해석 ----------
function findNames(text) {
  const hits = [];
  S.students.forEach((s) => {
    let i = text.indexOf(s.name), len = s.name.length;
    if (i < 0 && s.name.length >= 3) { const given = s.name.slice(1); i = text.indexOf(given); len = given.length; }
    if (i >= 0) hits.push({ name: s.name, i, len });
  });
  hits.sort((x, y) => x.i - y.i || y.len - x.len);
  const picked = [];
  let ambiguous = false;
  hits.forEach((h) => {
    const prev = picked[picked.length - 1];
    if (prev && h.i < prev.i + prev.len) { if (h.i === prev.i && h.len === prev.len) ambiguous = true; return; }
    picked.push(h);
  });
  return { found: picked.map((h) => h.name), ambiguous };
}

function parseRule(text) {
  const { found, ambiguous } = findNames(text);
  let kind = null;
  if (/짝.{0,6}(않|말|안|싫|금지)/.test(text) || /붙지|떨어|띄워|멀어지/.test(text)) kind = '서로 붙지 않기';
  else if (/멀리|멀게/.test(text)) kind = '최대한 멀리';
  else if (/짝|같이|옆자리|나란히/.test(text)) kind = '짝으로 앉히기';
  else if (/앞줄|앞자리|앞쪽|앞에|시력|눈이 나/.test(text)) kind = '앞 2줄 안에';
  else if (/뒷줄|뒷자리|뒤쪽|뒤에/.test(text)) kind = '뒤 2줄 안에';
  else if (/창가|창문/.test(text)) kind = '창가 쪽 분단';
  else if (/복도/.test(text)) kind = '복도 쪽 분단';
  const pair = kind ? PAIR_KINDS.includes(kind) : found.length >= 2;
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    said: text,
    a: ambiguous ? '' : (found[0] || ''),
    b: ambiguous || !pair ? '' : (found[1] || ''),
    kind: kind || '',
    must: !/되도록|가능하면|웬만하면|가급적/.test(text)
  };
}

function ruleProblem(r) {
  const roster = new Set(names());
  if (!r.kind) return '무슨 조건인지 못 알아들었어요';
  if (!roster.has(r.a)) return '학생 이름을 명단에서 찾지 못했어요';
  if (PAIR_KINDS.includes(r.kind) && (!roster.has(r.b) || r.b === r.a)) return '두 번째 학생을 골라 주세요';
  return '';
}

// ---------- 평가 ----------
function context() {
  const g = genderOf();
  let m = 0, w = 0, u = 0;
  S.students.forEach((s) => { if (s.g === 'm') m++; else if (s.g === 'w') w++; else u++; });
  const list = deskList();
  const singles = list.filter((k) => !partnerKey(k)).length;
  const emptyDesks = Math.max(0, list.length - S.students.length);
  const excess = Math.max(0, Math.max(m, w) - Math.min(m, w) - u - singles - emptyDesks);
  return {
    g,
    oldSeats: S.current.seats,
    oldPos: posOf(S.current.seats),
    pinned: new Set(S.draft.pinned),
    rules: S.rules.filter((r) => !ruleProblem(r)),
    basics: S.basics,
    minSameGender: Math.ceil(excess / 2), // 인원상 어쩔 수 없는 같은 성별 짝 수
    windowG: windowGroup(),
    hallG: hallGroup(),
    R: S.layout.R
  };
}

function evaluate(seats, ctx) {
  const pos = posOf(seats);
  const items = [];
  let pen = 0;
  const push = (title, ok, hard, note) => { items.push({ title, ok, hard, note }); if (!ok) pen += hard ? 1000 : 10; };

  ctx.rules.forEach((rule) => {
    const pa = pos[rule.a];
    if (!pa) return;
    if (PAIR_KINDS.includes(rule.kind)) {
      const pb = pos[rule.b];
      if (!pb) return;
      const t = rule.a + ' · ' + rule.b + ' ';
      if (rule.kind === '서로 붙지 않기') { const ok = !touching(pa, pb); push(t + '붙지 않기', ok, rule.must, ok ? '떨어짐' : '붙음'); }
      if (rule.kind === '최대한 멀리') { const d = dist(pa, pb); pen += Math.max(0, 10 - d); push(t + '멀리', d >= 3, rule.must, d >= 3 ? '멀리 떨어짐' : '가까움'); }
      if (rule.kind === '짝으로 앉히기') { const ok = partnerKey(pa) === pb; push(t + '짝', ok, rule.must, ok ? longPos(pa) : '짝 아님'); }
    } else {
      const [r, c] = rc(pa);
      if (rule.kind === '앞 2줄 안에') push(rule.a + ' 앞 2줄', r <= 1, rule.must, (r + 1) + '줄');
      if (rule.kind === '뒤 2줄 안에') push(rule.a + ' 뒤 2줄', r >= ctx.R - 2, rule.must, (r + 1) + '줄');
      if (rule.kind === '창가 쪽 분단') push(rule.a + ' 창가 쪽', group(c) === ctx.windowG, rule.must, (group(c) + 1) + '분단');
      if (rule.kind === '복도 쪽 분단') push(rule.a + ' 복도 쪽', group(c) === ctx.hallG, rule.must, (group(c) + 1) + '분단');
    }
  });

  if (ctx.basics.prev) {
    let n = 0;
    for (const name in pos) if (pos[name] === ctx.oldPos[name] && !ctx.pinned.has(name)) n++;
    push('지난 자리와 겹침', n === 0, true, n + '명');
  }
  let samePair = 0, sameGender = 0;
  for (const k in seats) {
    const n = seats[k];
    if (!n || rc(k)[1] % 2) continue;
    const pk = partnerKey(k), m = pk && seats[pk];
    if (!m) continue;
    const op = ctx.oldPos[n] && partnerKey(ctx.oldPos[n]);
    if (op && ctx.oldSeats[op] === m && !(ctx.pinned.has(n) && ctx.pinned.has(m))) samePair++;
    if (ctx.g[n] && ctx.g[n] === ctx.g[m]) sameGender++;
  }
  if (ctx.basics.pair) push('지난 짝과 다시 짝', samePair === 0, true, samePair + '쌍');
  if (ctx.basics.mix) {
    const ok = sameGender <= ctx.minSameGender;
    if (!ok) pen += (sameGender - ctx.minSameGender) * 50;
    push('남녀 짝', ok, true, sameGender ? '같은 성별 ' + sameGender + '쌍' + (ctx.minSameGender ? ' (인원상 최소 ' + ctx.minSameGender + ')' : '') : '모두 섞임');
  }
  return { items, pen };
}

// ---------- 자리 뽑기 ----------
// 무작위로 앉힌 뒤, 두 자리를 바꿔 보며 벌점이 늘지 않으면 유지한다. 여러 번 새로 시작해 가장 좋은 배치를 고른다.
let lastProblem = null;

function generate() {
  syncDesks();
  const list = deskList();
  const all = names();
  lastProblem = null;
  if (!all.length) { S.draft.seats = {}; lastProblem = { type: 'empty' }; return; }
  if (all.length > list.length) { S.draft.seats = {}; lastProblem = { type: 'desks', lack: all.length - list.length }; return; }

  const pos = posOf(S.draft.seats);
  const fixed = {};
  S.draft.pinned = S.draft.pinned.filter((n) => pos[n] && DESKS.has(pos[n]) && all.includes(n));
  S.draft.pinned.forEach((n) => { fixed[pos[n]] = n; });
  const freeKeys = list.filter((k) => !fixed[k]);
  const freeNames = all.filter((n) => !S.draft.pinned.includes(n));

  const ctx = context();
  const steps = Math.max(600, freeKeys.length * 40);
  let best = null, bestPen = Infinity;
  for (let t = 0; t < 30 && bestPen > 0; t++) {
    const shuffled = freeNames.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const seats = Object.assign({}, fixed);
    freeKeys.forEach((k, i) => { seats[k] = shuffled[i] || null; });
    let cur = evaluate(seats, ctx).pen;
    for (let s = 0; s < steps && cur > 0; s++) {
      const a = freeKeys[Math.floor(Math.random() * freeKeys.length)];
      const b = freeKeys[Math.floor(Math.random() * freeKeys.length)];
      if (a === b || (!seats[a] && !seats[b])) continue;
      const va = seats[a], vb = seats[b];
      seats[a] = vb; seats[b] = va;
      const p = evaluate(seats, ctx).pen;
      if (p <= cur) cur = p; else { seats[a] = va; seats[b] = vb; }
    }
    if (cur < bestPen) { bestPen = cur; best = seats; }
  }
  for (const k in best) if (!best[k]) delete best[k];
  S.draft.seats = best;
  S.draft.date = today();

  const failed = evaluate(best, ctx).items.filter((i) => i.hard && !i.ok);
  if (failed.length) lastProblem = { type: 'rules', failed };
}

// ---------- 화면 상태 ----------
let view = 'setup', setupMode = 'seats', teacher = false;
let selOld = null, selNew = null;
let dirty = !Object.keys(S.draft.seats).length;
const undoStack = [];
const markDirty = () => { dirty = true; };

// ---------- 자리표 그리기 ----------
const lockSvg = (closed) => '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="5.5" width="7" height="5" rx="1"' + (closed ? ' fill="currentColor"' : '') + '/><path d="' + (closed ? 'M4 5.5V4a2 2 0 0 1 4 0v1.5' : 'M4 5.5V4a2 2 0 0 1 3.9-.6') + '"/></svg>';

function drawChart(el, kind) {
  el.innerHTML = '';
  const flip = kind !== 'desks' && kind !== 'old' && teacher;
  const g = genderOf();
  const tags = new Set();
  S.rules.forEach((r) => { if (!ruleProblem(r)) { tags.add(r.a); if (r.b) tags.add(r.b); } });
  const oldPos = posOf(S.current.seats);

  const boardRow = document.createElement('div');
  boardRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;align-self:stretch;gap:12px';
  const windowLeft = (S.layout.window === 'left') !== flip;
  boardRow.innerHTML = '<span class="tiny" style="width:40px">' + (windowLeft ? '창문' : '') + '</span><div class="board">칠판 · 교탁</div><span class="tiny" style="width:40px;text-align:right">' + (windowLeft ? '' : '창문') + '</span>';
  if (!flip) el.appendChild(boardRow);

  const rows = [...Array(S.layout.R).keys()];
  if (flip) rows.reverse();
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const cs = [...Array(cols()).keys()];
    if (flip) cs.reverse();
    for (let i = 0; i < cs.length; i += 2) {
      const pair = document.createElement('div');
      pair.className = 'pair';
      pair.appendChild(cell(key(r, cs[i]), kind, g, tags, oldPos));
      pair.appendChild(cell(key(r, cs[i + 1]), kind, g, tags, oldPos));
      row.appendChild(pair);
    }
    el.appendChild(row);
  });
  if (flip) el.appendChild(boardRow);
  fitChart(el, kind === 'show');
}

// 분단·줄 수에 맞춰 자리 크기를 줄여 한 화면(또는 인쇄 한 장)에 들어가게 한다.
function fitChart(el, big, pageWidth) {
  const G = S.layout.G, R = S.layout.R;
  const box = el.parentElement;
  const availW = pageWidth || (box.clientWidth - (big ? 64 : 8));
  const maxW = big ? 170 : 104, minW = big ? 60 : 44;
  const pg = big ? 8 : 6;
  const gapFor = (w) => Math.min(big ? 48 : 32, Math.max(10, Math.round(w * 0.3)));
  let w = maxW;
  if (availW > 0) {
    for (let i = 0; i < 3; i++) w = Math.floor((availW - G * pg - (G - 1) * gapFor(w)) / (2 * G));
  }
  w = Math.max(minW, Math.min(maxW, w));

  // 세로: 칠판부터 마지막 줄까지 창 높이 안에 들어가게 (아래 안내·범례 자리 남김)
  const boardH = big ? 40 : 30;
  let availH;
  if (pageWidth) availH = 640;
  else if (big) availH = window.innerHeight - 130;
  else availH = window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - 90;
  const maxH = big ? Math.round(w * 0.56) : 56, minH = big ? 44 : 36;
  let h = Math.floor((Math.max(availH, 200) - boardH) / R / 1.22);
  h = Math.max(minH, Math.min(maxH, h));
  const rg = Math.max(6, Math.round(h * 0.22));

  const compact = !big && (w < 76 || h < 48); // 작을 때는 지난 자리 표시를 숨기고 자물쇠를 아래로
  el.classList.toggle('compact', compact);
  const set = (k, v) => el.style.setProperty(k, v + 'px');
  set('--w', w);
  set('--h', h);
  set('--gap', gapFor(w));
  set('--pg', pg);
  set('--rg', rg);
  set('--fs', big ? Math.max(14, Math.min(26, Math.round(Math.min(w * 0.16, h * 0.4)))) : (w >= 90 && h >= 50 ? 14 : 12));
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    ['oldChart', 'newChart'].forEach((id) => { if ($(id).children.length) fitChart($(id), false); });
    if (!$('present').hidden) fitChart($('presentChart'), true);
  }, 100);
});
window.addEventListener('beforeprint', () => fitChart($('presentChart'), true, 1000));

function cell(k, kind, g, tags, oldPos) {
  const [r, c] = rc(k);
  const where = (r + 1) + '줄 ' + (group(c) + 1) + '분단 ' + (c % 2 ? '오른쪽' : '왼쪽');
  if (kind === 'desks') {
    const b = document.createElement('button');
    b.type = 'button';
    const has = DESKS.has(k);
    b.className = 'seat ' + (has ? 'desk' : 'slot');
    b.textContent = has ? '책상' : '+';
    b.setAttribute('aria-label', where + (has ? ' 책상 빼기' : ' 책상 놓기'));
    b.onclick = () => {
      if (has) S.layout.desks = S.layout.desks.filter((x) => x !== k); else S.layout.desks.push(k);
      syncDesks(); markDirty(); save(); drawSetup();
    };
    return b;
  }
  const d = document.createElement('div');
  if (!DESKS.has(k)) { d.className = 'seat none'; return d; }
  const seats = kind === 'old' ? S.current.seats : S.draft.seats;
  const n = seats[k];
  const isNew = kind === 'new';
  const pinned = isNew && n && S.draft.pinned.includes(n);
  const sel = kind === 'old' ? selOld : kind === 'new' ? selNew : null;
  d.className = 'seat' + (n ? '' : ' vacant') + (isNew && n && tags.has(n) ? ' tag' : '') + (sel === k ? ' sel' : '') + (pinned ? ' pin' : '');
  const inner = n
    ? (g[n] ? '<span class="g ' + g[n] + '"></span>' : '') + '<span class="n">' + esc(n) + '</span>' + (isNew && oldPos[n] ? '<span class="f">' + shortPos(oldPos[n]) + '</span>' : '')
    : '<span class="n">' + (kind === 'show' ? '' : '빈 책상') + '</span>';
  if (kind === 'show') {
    d.innerHTML = '<div class="main">' + inner + '</div>';
    return d;
  }
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'main';
  main.innerHTML = inner;
  main.setAttribute('aria-label', where + ' ' + (n || '빈 책상'));
  if (isNew && n && oldPos[n]) main.title = n + ' · 지난 자리 ' + longPos(oldPos[n]);
  main.onclick = () => pick(kind, k);
  d.appendChild(main);
  if (isNew && n) {
    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'lock';
    lock.innerHTML = lockSvg(pinned);
    lock.setAttribute('aria-label', n + (pinned ? ' 고정 풀기' : ' 자리 고정'));
    lock.setAttribute('aria-pressed', String(!!pinned));
    lock.onclick = () => {
      S.draft.pinned = pinned ? S.draft.pinned.filter((x) => x !== n) : S.draft.pinned.concat(n);
      if (selNew === k) selNew = null;
      save(); drawResult();
    };
    d.appendChild(lock);
  }
  return d;
}

function pick(kind, k) {
  const seats = kind === 'old' ? S.current.seats : S.draft.seats;
  const sel = kind === 'old' ? selOld : selNew;
  const hint = $(kind === 'old' ? 'setupHint' : 'resultHint');
  const locked = (x) => kind === 'new' && seats[x] && S.draft.pinned.includes(seats[x]);
  let next = null;
  hint.classList.remove('warn');
  if (locked(k) || (sel && locked(sel))) {
    hint.textContent = '고정한 학생은 옮길 수 없어요. 자물쇠를 먼저 풀어 주세요.';
    hint.classList.add('warn');
  } else if (!sel) {
    if (!seats[k]) return;
    next = k;
  } else if (sel !== k) {
    if (kind === 'new') undoStack.push(Object.assign({}, S.draft.seats));
    const a = seats[sel], b = seats[k];
    if (b) seats[sel] = b; else delete seats[sel];
    seats[k] = a;
    if (kind === 'old') markDirty();
    save();
  }
  if (kind === 'old') { selOld = next; drawSetup(); } else { selNew = next; drawResult(); }
}

// ---------- 1. 반 설정 ----------
function drawHeader() {
  $('brandSub').textContent = (S.className || '우리 반') + ' · ' + S.students.length + '명';
}

function drawSetup() {
  syncDesks();
  drawHeader();
  const waiting = reconcile(S.current.seats, true);
  save();

  let m = 0, w = 0, u = 0;
  S.students.forEach((s) => { if (s.g === 'm') m++; else if (s.g === 'w') w++; else u++; });
  $('rosterSum').textContent = S.students.length ? '남 ' + m + ' · 여 ' + w + (u ? ' · 성별 없음 ' + u : '') : '';

  $('rVal').textContent = S.layout.R;
  $('gVal').textContent = S.layout.G;
  document.querySelectorAll('[data-window]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.window === S.layout.window)));
  const n = DESKS.size, diff = n - S.students.length;
  $('deskCount').innerHTML = '책상 ' + n + '개 · 학생 ' + S.students.length + '명' +
    (diff < 0 ? ' <b class="warn-text">· ' + (-diff) + '개 부족</b>' : diff > 0 ? ' · 빈 책상 ' + diff + '개' : '');
  $('deskTools').hidden = setupMode !== 'desks';

  $('setupSub').textContent = setupMode === 'desks'
    ? '실제 교실과 같게 책상을 놓아 주세요. 뒤에 한 자리만 더 있어도 괜찮아요.'
    : S.current.date
      ? koDate(S.current.date) + '에 확정한 자리. 새 자리는 이것과 겹치지 않게 뽑습니다.'
      : '처음이라 명단 순서대로 채워 두었어요. 실제 자리와 맞춰 주세요.';

  const hint = $('setupHint');
  if (!hint.classList.contains('warn')) {
    hint.textContent = setupMode === 'desks'
      ? '빈 칸(+)을 누르면 책상이 생기고, 책상을 누르면 없어집니다.'
      : !S.students.length ? '왼쪽에 학생 명단을 먼저 붙여넣어 주세요.'
      : waiting.length ? '책상이 모자라 자리가 없는 학생: ' + waiting.join(', ')
      : '실제 자리와 다르면 두 자리를 차례로 누르세요. 서로 바뀝니다.';
  }
  drawChart($('oldChart'), setupMode === 'desks' ? 'desks' : 'old');
}

let rosterTimer = null;
$('roster').addEventListener('input', () => {
  clearTimeout(rosterTimer);
  rosterTimer = setTimeout(applyRoster, 400);
});
function applyRoster() {
  const { students, dup } = parseRoster($('roster').value);
  S.rosterText = $('roster').value;
  S.students = students;
  $('rosterWarn').hidden = !dup.length;
  $('rosterWarn').textContent = dup.length ? '같은 이름이 두 번 있어요: ' + dup.join(', ') + ' — 구별되게 적어 주세요 (예: 김민준A).' : '';
  S.draft.pinned = S.draft.pinned.filter((n) => names().includes(n));
  markDirty();
  save();
  drawSetup();
}

$('className').addEventListener('input', () => { S.className = $('className').value.trim(); save(); drawHeader(); });

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  setupMode = b.dataset.mode;
  selOld = null;
  $('setupHint').classList.remove('warn');
  document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  drawSetup();
}));
document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
  const [which, delta] = b.dataset.step.split(':');
  if (which === 'R') S.layout.R = Math.min(10, Math.max(1, S.layout.R + Number(delta)));
  else S.layout.G = Math.min(6, Math.max(1, S.layout.G + Number(delta)));
  syncDesks(); markDirty(); save(); drawSetup();
}));
document.querySelectorAll('[data-window]').forEach((b) => b.addEventListener('click', () => {
  S.layout.window = b.dataset.window;
  markDirty(); save(); drawSetup();
}));

// 백업
function dataMsg(text) { $('dataMsg').textContent = text; $('dataMsg').hidden = !text; }
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '자리바꾸기-백업-' + today() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  dataMsg('백업 파일을 저장했어요. 학생 이름이 들어 있으니 보관에 주의해 주세요.');
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = () => {
  const file = $('importFile').files[0];
  if (!file) return;
  file.text().then((text) => {
    const d = JSON.parse(text);
    if (!d || d.v !== 1 || !Array.isArray(d.students)) throw new Error('bad');
    S = Object.assign(defaults(), d);
    undoStack.length = 0;
    markDirty(); save(); fillInputs(); drawSetup();
    dataMsg('백업을 불러왔어요.');
  }).catch(() => dataMsg('이 파일은 불러올 수 없어요. 자리 바꾸기에서 저장한 백업 파일인지 확인해 주세요.'))
    .finally(() => { $('importFile').value = ''; });
};
let resetArmed = false;
$('resetBtn').onclick = () => {
  if (!resetArmed) {
    resetArmed = true;
    $('resetBtn').textContent = '정말 지울까요? 한 번 더 누르면 모두 지워집니다';
    setTimeout(() => { resetArmed = false; $('resetBtn').textContent = '모두 지우기'; }, 5000);
    return;
  }
  resetArmed = false;
  $('resetBtn').textContent = '모두 지우기';
  S = defaults();
  undoStack.length = 0;
  markDirty(); save(); fillInputs(); drawSetup();
  dataMsg('모두 지웠어요.');
};

// ---------- 2. 조건 ----------
const editing = new Set();

function drawRules() {
  const list = $('ruleList');
  list.innerHTML = '';
  $('ruleCount').textContent = S.rules.length;
  if (!S.rules.length) {
    list.innerHTML = '<div class="empty">아직 조건이 없어요. 조건 없이 뽑아도 기본 규칙은 지킵니다.</div>';
    return;
  }
  const roster = names();
  S.rules.forEach((r, i) => {
    const problem = ruleProblem(r);
    const edit = problem || editing.has(r.id);
    const d = document.createElement('div');
    d.className = 'rule' + (problem ? ' fix' : '');
    const nameOpts = (v) => '<option value="">학생 고르기</option>' + roster.map((n) => '<option' + (n === v ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    const pair = PAIR_KINDS.includes(r.kind);
    let detail;
    if (edit) {
      detail = '<select data-f="a" aria-label="학생">' + nameOpts(r.a) + '</select>' +
        (pair || !r.kind ? '<select data-f="b" aria-label="두 번째 학생"' + (r.kind ? '' : ' hidden') + '>' + nameOpts(r.b) + '</select>' : '') +
        '<select data-f="kind" aria-label="조건 종류"><option value="">조건 고르기</option>' + KINDS.map((k) => '<option' + (k === r.kind ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>' +
        (!problem ? '<button type="button" class="linkbtn" data-done>완료</button>' : '');
    } else {
      detail = '<span class="name">' + esc(r.a) + '</span>' + (pair ? ' <span class="tiny">·</span> <span class="name">' + esc(r.b) + '</span>' : '') +
        ' <span style="font-weight:500">' + r.kind + '</span> <button type="button" class="linkbtn" data-edit>고치기</button>';
    }
    d.innerHTML =
      '<div class="body"><span class="said">“' + esc(r.said) + '”' + (problem ? ' — ' + problem : '') + '</span>' +
      '<div class="row" style="flex-wrap:wrap">' + detail + '</div></div>' +
      '<div class="seg" role="group" aria-label="강도"><button type="button" aria-pressed="' + r.must + '">반드시</button><button type="button" aria-pressed="' + !r.must + '">되도록</button></div>' +
      '<button type="button" class="x" aria-label="조건 삭제"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>';

    const [mustB, tryB] = d.querySelectorAll('.seg button');
    const change = () => { markDirty(); save(); drawRules(); };
    mustB.onclick = () => { r.must = true; change(); };
    tryB.onclick = () => { r.must = false; change(); };
    d.querySelector('.x').onclick = () => { S.rules.splice(i, 1); editing.delete(r.id); change(); };
    d.querySelectorAll('select').forEach((s) => {
      s.onchange = () => {
        r[s.dataset.f] = s.value;
        if (s.dataset.f === 'kind' && !PAIR_KINDS.includes(r.kind)) r.b = '';
        if (!ruleProblem(r)) editing.add(r.id);
        change();
      };
    });
    const done = d.querySelector('[data-done]');
    if (done) done.onclick = () => { editing.delete(r.id); drawRules(); };
    const ed = d.querySelector('[data-edit]');
    if (ed) ed.onclick = () => { editing.add(r.id); drawRules(); };
    list.appendChild(d);
  });
}

$('ruleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('ruleInput').value.trim();
  if (!text) return;
  S.rules.push(parseRule(text));
  $('ruleInput').value = '';
  markDirty(); save(); drawRules();
});

[['tPrev', 'prev'], ['tPair', 'pair'], ['tMix', 'mix']].forEach(([id, k]) => {
  $(id).onchange = () => { S.basics[k] = $(id).checked; markDirty(); save(); };
});
$('drawBtn').onclick = () => { markDirty(); go('result'); };

// ---------- 3. 결과 ----------
const okSvg = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#2E6B5E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5l3.2 3L14 5.5"/></svg>';
const warnSvg = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#A0620F" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M9 5.5v4M9 12.3v.1"/></svg>';

function drawConflict() {
  const box = $('conflict');
  const p = lastProblem;
  if (!p) { box.hidden = true; return; }
  if (p.type === 'empty') box.innerHTML = '<b>학생 명단이 비어 있어요</b><span>반 설정에서 명단을 먼저 붙여넣어 주세요.</span>';
  if (p.type === 'desks') box.innerHTML = '<b>책상이 ' + p.lack + '개 부족해요</b><span>반 설정의 “책상 배치 바꾸기”에서 책상을 더 놓아 주세요.</span>';
  if (p.type === 'rules') {
    box.innerHTML = '<b>반드시 조건을 모두 지키는 자리를 찾지 못했어요</b>' +
      '<span>서로 부딪히는 조건이 있는 것 같아요. 가장 가깝게 맞춘 자리를 아래에 보여 드려요. 못 지킨 조건:</span>' +
      '<ul>' + p.failed.map((i) => '<li>' + esc(i.title) + ' — ' + esc(i.note) + '</li>').join('') + '</ul>' +
      '<div class="row" style="flex-wrap:wrap"><button type="button" class="btn sm" data-to-rules>조건 고치기</button><span class="tiny" style="color:inherit">일부를 “되도록”으로 바꾸' + (S.draft.pinned.length ? '거나 고정을 풀' : '') + '면 해결될 수 있어요.</span></div>';
    box.querySelector('[data-to-rules]').onclick = () => go('rules');
  }
  box.hidden = false;
}

function drawResult() {
  syncDesks();
  reconcile(S.draft.seats, false);
  drawHeader();
  drawConflict();
  const has = Object.keys(S.draft.seats).length > 0;
  $('newChart').parentElement.hidden = !has;
  $('resultSub').textContent = has ? (S.draft.date ? koDate(S.draft.date) + ' · ' : '') + '조건을 가장 잘 지킨 배치' : '';
  const hint = $('resultHint');
  if (!hint.classList.contains('warn')) hint.textContent = has ? '두 자리를 차례로 누르면 서로 바뀝니다. 자물쇠를 누르면 그 학생은 다시 뽑아도 그 자리에 남습니다.' : '';
  ['regen', 'bigBtn', 'printBtn', 'confirmBtn'].forEach((id) => { $(id).disabled = !has && id !== 'regen'; });
  $('undo').disabled = !undoStack.length;
  $('regen').textContent = S.draft.pinned.length ? '고정 빼고 다시 뽑기' : '다시 뽑기';

  if (!has) { $('checks').innerHTML = ''; $('checkSum').textContent = ''; return; }
  drawChart($('newChart'), 'new');
  const { items } = evaluate(S.draft.seats, context());
  if (S.draft.pinned.length) items.push({ title: '고정한 학생', ok: true, note: S.draft.pinned.join(', ') });
  const bad = items.filter((i) => !i.ok).length;
  $('checkSum').textContent = bad ? bad + '개 못 지킴' : '모두 지킴';
  $('checkSum').style.color = bad ? 'var(--warn)' : 'var(--accent)';
  $('checks').innerHTML = items.map((i) =>
    '<div class="check' + (i.ok ? '' : ' bad') + '">' + (i.ok ? okSvg : warnSvg) + '<span class="t">' + esc(i.title) +
    (i.hard === false ? ' <span class="tiny">(되도록)</span>' : '') + '</span><span class="tiny">' + esc(i.note) + '</span></div>').join('');
}

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  teacher = b.dataset.view === 'teacher';
  document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  drawResult();
}));
$('regen').onclick = () => {
  if (Object.keys(S.draft.seats).length) undoStack.push(Object.assign({}, S.draft.seats));
  selNew = null;
  $('resultHint').classList.remove('warn');
  generate(); dirty = false; save(); drawResult();
};
$('undo').onclick = () => {
  if (!undoStack.length) return;
  S.draft.seats = undoStack.pop();
  selNew = null;
  save(); drawResult();
};

let confirmArmed = false;
$('confirmBtn').onclick = () => {
  if (!confirmArmed) {
    confirmArmed = true;
    $('confirmBtn').textContent = '한 번 더 누르면 확정됩니다';
    $('confirmNote').textContent = '지금 자리가 이 자리로 바뀌고, 다음번에는 이 자리와 겹치지 않게 뽑습니다.';
    setTimeout(resetConfirm, 5000);
    return;
  }
  const seats = Object.assign({}, S.draft.seats);
  S.current = { seats, date: today() };
  S.history.unshift({ date: today(), seats });
  S.history = S.history.slice(0, 10);
  undoStack.length = 0;
  save();
  markDirty();
  setupMode = 'seats';
  document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === 'seats')));
  go('setup');
};
function resetConfirm() {
  confirmArmed = false;
  $('confirmBtn').textContent = '이 자리로 확정';
  $('confirmNote').textContent = '확정하면 다음번 ‘지난 자리’로 저장됩니다.';
}

// 크게 보기 · 인쇄
function openPresent() {
  $('presentTitle').textContent = (S.className || '우리 반') + ' 자리표' + (S.draft.date ? ' · ' + koDate(S.draft.date) : '');
  $('present').hidden = false;
  drawChart($('presentChart'), 'show');
}
$('bigBtn').onclick = openPresent;
$('printBtn').onclick = () => { openPresent(); printAndClose = true; window.print(); };
$('presentPrint').onclick = () => window.print();
$('presentClose').onclick = () => { $('present').hidden = true; };
let printAndClose = false;
window.addEventListener('afterprint', () => { if (printAndClose) { printAndClose = false; $('present').hidden = true; } else fitChart($('presentChart'), true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('present').hidden) $('present').hidden = true; });

// ---------- 화면 전환 ----------
function go(id) {
  view = id;
  ['setup', 'rules', 'result'].forEach((v) => { $(v).hidden = v !== id; });
  document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.go === id)));
  resetConfirm();
  if (id === 'setup') drawSetup();
  if (id === 'rules') drawRules();
  if (id === 'result') {
    if (dirty || !Object.keys(S.draft.seats).length) {
      if (Object.keys(S.draft.seats).length) undoStack.push(Object.assign({}, S.draft.seats));
      selNew = null;
      $('resultHint').classList.remove('warn');
      generate();
      dirty = false;
      save();
    }
    drawResult();
  }
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

function fillInputs() {
  $('className').value = S.className;
  $('roster').value = S.rosterText;
  $('tPrev').checked = S.basics.prev;
  $('tPair').checked = S.basics.pair;
  $('tMix').checked = S.basics.mix;
  $('rosterWarn').hidden = true;
  editing.clear();
}

syncDesks();
fillInputs();
drawSetup();
