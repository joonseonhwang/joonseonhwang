/* People Book — 개인용 인맥 관리 PWA
   모든 데이터는 이 기기의 IndexedDB에만 저장된다. 서버 전송 없음. */
'use strict';

const APP_VERSION = '1.0.0';
const DB_NAME = 'peoplebook';
const DB_VER = 1;
const REL_TYPES = ['배우자', '약혼', '연인', '전 연인', '가족', '친구', '동료', '지인', '소개해줌', '갈등', '기타'];
const EVENT_TYPES = ['결혼식', '생일', '모임', '기타'];
const EVENT_ICON = { '결혼식': '💍', '생일': '🎂', '모임': '🍻', '기타': '📌' };

/* ───────────── IndexedDB ───────────── */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['people', 'relations', 'events'])
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function run(stores, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, 'readwrite');
    fn(t);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
function getAll(store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/* 메모리 캐시 (데이터가 작으므로 전체 로드) */
const S = { people: [], relations: [], events: [], meta: { dismissedDups: [], lastBackup: null } };
async function loadAll() {
  const [p, r, e, m] = await Promise.all(['people', 'relations', 'events', 'meta'].map(getAll));
  p.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
  S.people = p; S.relations = r; S.events = e;
  S.meta = { dismissedDups: [], lastBackup: null };
  for (const row of m) S.meta[row.key] = row.value;
}
const byId = id => S.people.find(p => p.id === id);
async function save(store, obj) { await run([store], t => t.objectStore(store).put(obj)); await loadAll(); }
async function setMeta(key, value) { await run(['meta'], t => t.objectStore('meta').put({ key, value })); S.meta[key] = value; }

/* ───────────── utils ───────────── */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowISO = () => new Date().toISOString();
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const splitList = s => [...new Set(String(s || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean))];
const uniq = a => [...new Set(a.filter(Boolean))];
const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

const PALETTE = ['#8ea8ff', '#9fe0c2', '#ffc99a', '#f7a8c8', '#c8b0ff', '#8fd8f0', '#f5d27a', '#b8e08a'];
function avColor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function avatar(p, lg) {
  const n = (p.name || '?').trim();
  const ch = /^[가-힣]{3}$/.test(n) ? n.slice(1) : n.slice(0, n.length === 2 && /^[가-힣]+$/.test(n) ? 2 : 1);
  return `<div class="av${lg ? ' lg' : ''}${ch.length > 1 ? ' two' : ''}" style="background:${avColor(n)}">${esc(ch)}</div>`;
}

/* 한글 초성 */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function choseong(s) { let o = ''; for (const ch of s) { const c = ch.charCodeAt(0) - 0xac00; o += (c >= 0 && c < 11172) ? CHO[Math.floor(c / 588)] : ch; } return o; }
const isCho = s => /^[ㄱ-ㅎ]+$/.test(s);
function hasBatchim(ch) { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; }

/* ───────────── 날짜 ───────────── */
function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function fmtDate(dt) {
  const { y, m, d } = dt || {};
  if (!y && !m) return '날짜 미정';
  if (!y) return `${m}월${d ? ' ' + d + '일' : ''} (연도 미정)`;
  if (!m) return `${y}년 (날짜 미정)`;
  return `${y}.${String(m).padStart(2, '0')}${d ? '.' + String(d).padStart(2, '0') : ''}`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function eventState(ev) {
  const { y, m, d } = ev.date || {};
  if (!y || !m) return { kind: 'tbd', ts: Infinity };
  const start = new Date(y, m - 1, d || 1);
  const end = d ? start : new Date(y, m, 0);
  const t = today0();
  if (end < t) return { kind: 'past', ts: start.getTime() };
  const days = d ? Math.round((start - t) / 864e5) : null;
  return { kind: 'upcoming', ts: start.getTime(), days, wd: d ? WD[start.getDay()] : null };
}
function nextBirthday(p) {
  const { m, d } = p.birth || {};
  if (!m || !d) return null;
  const t = today0();
  let n = new Date(t.getFullYear(), m - 1, d);
  if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d);
  return { date: n, days: Math.round((n - t) / 864e5) };
}
const ddayText = days => days === 0 ? 'D-DAY' : `D-${days}`;

/* ───────────── 도메인 ───────────── */
function subtitle(p) {
  return [p.job, (p.companies || []).join('·'), (p.schools || []).join('·')].filter(Boolean).join(' · ');
}
function relationsOf(id) {
  return S.relations.filter(r => r.a === id || r.b === id)
    .map(r => ({ ...r, other: byId(r.a === id ? r.b : r.a) })).filter(r => r.other);
}
function eventsOf(id) { return S.events.filter(e => (e.people || []).includes(id)); }
function personHay(p) {
  const rel = relationsOf(p.id).map(r => `${r.type} ${r.other.name} ${(r.other.aliases || []).join(' ')}`).join(' ');
  return [p.name, ...(p.aliases || []), ...(p.groups || []), ...(p.schools || []), ...(p.companies || []),
    p.job, p.mbti, p.hometown, p.residence, p.phone, p.notes, p.checkNote, rel].filter(Boolean).join(' ').toLowerCase();
}
function searchPeople(q) {
  const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return S.people.filter(p => {
    const hay = personHay(p);
    const names = [p.name, ...(p.aliases || [])];
    return toks.every(t => isCho(t) ? names.some(n => choseong(n).includes(t)) : hay.includes(t));
  }).sort((a, b) => {
    const t = toks[0];
    const sa = a.name.toLowerCase().startsWith(t) ? 0 : 1, sb = b.name.toLowerCase().startsWith(t) ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name, 'ko');
  });
}
function searchEvents(q) {
  const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return S.events.filter(e => {
    const hay = [e.title, e.type, e.place, e.note, ...(e.people || []).map(id => byId(id)?.name)].filter(Boolean).join(' ').toLowerCase();
    return toks.every(t => hay.includes(t));
  });
}

/* 중복 탐지 */
function normName(n) {
  n = String(n || '').replace(/\s+/g, '');
  n = n.replace(/(프로님|프로|선배님|선배|후배|언니|오빠|누나|님|씨|형)$/, '');
  if (n.length >= 3 && n.endsWith('이') && hasBatchim(n[n.length - 2])) n = n.slice(0, -1);
  return n;
}
function nameKeys(p) {
  const keys = new Set();
  for (const raw of [p.name, ...(p.aliases || [])]) {
    const n = normName(raw);
    if (n.length < 2) continue;
    keys.add(n);
    if (n.length === 3 && /^[가-힣]+$/.test(n)) keys.add(n.slice(1)); // 성 뗀 이름
  }
  return keys;
}
const pairKey = (a, b) => [a, b].sort().join('|');
function findDuplicates() {
  const out = [];
  const dismissed = new Set(S.meta.dismissedDups || []);
  const keys = S.people.map(p => [p, nameKeys(p)]);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const [a, ka] = keys[i], [b, kb] = keys[j];
    if (dismissed.has(pairKey(a.id, b.id))) continue;
    if (S.relations.some(r => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id))) continue;
    const why = [];
    const shared = [...ka].filter(k => kb.has(k));
    if (shared.length) {
      why.push(normName(a.name) === normName(b.name) ? `이름 같음 (${shared[0]})` : `이름 겹침 (${shared[0]})`);
    }
    const phoneA = (a.phone || '').replace(/\D/g, ''), phoneB = (b.phone || '').replace(/\D/g, '');
    if (phoneA.length >= 8 && phoneA === phoneB) why.push('전화번호 같음');
    if (!why.length) continue;
    const g = (a.groups || []).filter(x => (b.groups || []).includes(x));
    const c = (a.companies || []).filter(x => (b.companies || []).includes(x));
    const s = (a.schools || []).filter(x => (b.schools || []).includes(x));
    if (g.length) why.push('같은 그룹: ' + g.join(', '));
    if (c.length) why.push('같은 직장: ' + c.join(', '));
    if (s.length) why.push('같은 학교: ' + s.join(', '));
    const score = why.length + (why.includes('전화번호 같음') ? 3 : 0);
    out.push({ a, b, why, score });
  }
  return out.sort((x, y) => y.score - x.score);
}

/* ───────────── UI 공통 ───────────── */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
let modalResolve = null;
function openSheet(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  m.hidden = false;
  onMount && onMount(m);
  return new Promise(res => { modalResolve = res; });
}
function closeSheet(val) {
  const m = $('#modal'); m.hidden = true; m.innerHTML = '';
  const r = modalResolve; modalResolve = null; r && r(val);
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(null); });
function confirmSheet(title, msg, okLabel = '확인', danger = false) {
  return openSheet(`<h3>${esc(title)}</h3>${msg ? `<p>${msg}</p>` : ''}
    <div class="btns"><button class="btn" data-act="sheetVal" data-v="0">취소</button>
    <button class="btn ${danger ? 'danger' : 'pri'}" data-act="sheetVal" data-v="1">${esc(okLabel)}</button></div>`).then(v => v === '1');
}
function choiceSheet(title, msg, options) {
  return openSheet(`<h3>${esc(title)}</h3>${msg ? `<p>${msg}</p>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
    ${options.map(o => `<button class="btn block ${o.cls || ''}" data-act="sheetVal" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('')}
    <button class="btn block" data-act="sheetVal" data-v="">취소</button></div>`);
}

/* 사람 선택 시트 */
function pickPeople({ multi = false, selected = [], exclude = [], title = '사람 선택' } = {}) {
  const sel = new Set(selected);
  const pool = S.people.filter(p => !exclude.includes(p.id));
  const rows = list => list.map(p => `<button class="pickrow${sel.has(p.id) ? ' on' : ''}" data-act="pickRow" data-id="${p.id}">
      ${multi ? '<span class="ck"></span>' : ''}${avatar(p)}
      <span style="flex:1;min-width:0"><b>${esc(p.name)}</b><br><small style="color:var(--sub)">${esc((p.groups || [])[0] || subtitle(p))}</small></span></button>`).join('')
    || '<p style="padding:14px 2px">검색 결과가 없어요</p>';
  return openSheet(`<h3>${esc(title)}</h3>
    <div class="search" style="margin-top:0"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="pickQ" placeholder="이름·그룹·회사 검색" autocomplete="off"></div>
    <div class="scroll" id="pickList">${rows(pool)}</div>
    ${multi ? `<div class="btns"><button class="btn pri" data-act="pickDone">선택 완료 (<span id="pickN">${sel.size}</span>)</button></div>` : ''}`,
    m => {
      m._pick = { multi, sel };
      $('#pickQ', m).addEventListener('input', e => {
        const q = e.target.value.trim();
        $('#pickList', m).innerHTML = rows(q ? searchPeople(q).filter(p => !exclude.includes(p.id)) : pool);
      });
    });
}

/* ───────────── 라우터 ───────────── */
let depth = 0;
function goBack(fallback) { if (depth > 0) history.back(); else location.replace(fallback); }
const UI = { peopleMode: 'group', eventFilter: '전체', q: '' };
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/');
  let tab = 'home', html;
  if (!a) html = vHome();
  else if (a === 'people') { tab = 'people'; html = vPeople(); }
  else if (a === 'p' && b === 'new') { tab = 'people'; html = vPersonEdit(null); }
  else if (a === 'p' && c === 'edit') { tab = 'people'; html = vPersonEdit(b); }
  else if (a === 'p') { tab = 'people'; html = vPerson(b); }
  else if (a === 'events') { tab = 'events'; html = vEvents(); }
  else if (a === 'e') { tab = 'events'; html = vEventEdit(b === 'new' ? null : b, c); }
  else if (a === 'check') { html = vCheck(); }
  else if (a === 'dups') { tab = 'settings'; html = vDups(); }
  else if (a === 'merge') { tab = 'settings'; html = vMerge(b, c); }
  else if (a === 'settings') { tab = 'settings'; html = vSettings(); }
  else html = vHome();
  $('#view').innerHTML = html;
  document.querySelectorAll('#tabbar a').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  afterRender(a);
}
function afterRender(a) {
  if (!a) {
    const inp = $('#q'); if (!inp) return;
    inp.value = UI.q; renderResults();
    inp.addEventListener('input', () => { UI.q = inp.value; renderResults(); });
  }
  if (a === 'settings') refreshStorageInfo();
  if (a === 'e') renderEvPeople();
}
const back = () => `<button class="iconbtn" data-act="back" aria-label="뒤로"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>`;
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

/* ───────────── 화면: 홈 ───────────── */
function personRow(p, extra = '') {
  return `<a class="row" href="#/p/${p.id}">${avatar(p)}<div class="main">
    <div class="t">${esc(p.name)}${p.needsCheck ? '<span class="badge warn">확인</span>' : ''}${extra}</div>
    <div class="s">${esc(subtitle(p) || (p.groups || []).join(' · ') || '정보 없음')}</div></div></a>`;
}
function eventRow(ev, showDday = true) {
  const st = eventState(ev);
  const names = (ev.people || []).map(id => byId(id)?.name).filter(Boolean).join(', ');
  const right = showDday && st.kind === 'upcoming' && st.days != null ? `<span class="dday">${ddayText(st.days)}</span>` : '';
  return `<a class="row" href="#/e/${ev.id}"><div class="ico">${EVENT_ICON[ev.type] || '📌'}</div><div class="main">
    <div class="t">${esc(ev.title)}${ev.needsCheck ? '<span class="badge warn">확인</span>' : ''}</div>
    <div class="s">${esc(fmtDate(ev.date))}${st.wd ? ` (${st.wd})` : ''}${ev.place ? ' · ' + esc(ev.place) : ''}${names ? ' · ' + esc(names) : ''}</div></div>
    <div class="r">${right}</div></a>`;
}
function birthdayRow(p, nb) {
  return `<a class="row" href="#/p/${p.id}"><div class="ico">🎂</div><div class="main"><div class="t">${esc(p.name)} 생일</div>
    <div class="s">${nb.date.getMonth() + 1}월 ${nb.date.getDate()}일 (${WD[nb.date.getDay()]})</div></div><div class="r"><span class="dday">${ddayText(nb.days)}</span></div></a>`;
}
function upcomingItems(withinDays) {
  const items = [];
  for (const ev of S.events) {
    const st = eventState(ev);
    if (st.kind === 'upcoming' && (st.days == null || st.days <= withinDays)) items.push({ ts: st.ts, html: eventRow(ev) });
  }
  for (const p of S.people) {
    const nb = nextBirthday(p);
    if (nb && nb.days <= withinDays) items.push({ ts: nb.date.getTime(), html: birthdayRow(p, nb) });
  }
  return items.sort((a, b) => a.ts - b.ts);
}
function vHome() {
  const n = S.people.length;
  if (!n) return `<div class="top"><h1>People Book</h1></div>
    <div class="empty"><p style="font-size:40px;margin-bottom:6px">📒</p><p>아직 등록된 사람이 없어요.<br>백업 파일(JSON)이 있으면 불러오세요.</p>
    <div style="display:flex;flex-direction:column;gap:8px"><button class="btn pri block" data-act="restore">백업 파일 불러오기</button>
    <a class="btn block" href="#/p/new">직접 추가하기</a></div></div>
    <p class="foot">데이터는 이 폰에만 저장돼요. 서버로 전송되지 않아요.</p>`;
  const checkN = S.people.filter(p => p.needsCheck).length + S.events.filter(e => e.needsCheck).length;
  const dupN = findDuplicates().length;
  const up = upcomingItems(120);
  const tbd = S.events.filter(e => eventState(e).kind === 'tbd').length;
  const groups = uniq(S.people.flatMap(p => p.groups || []));
  const lb = S.meta.lastBackup ? Math.floor((Date.now() - new Date(S.meta.lastBackup)) / 864e5) : null;
  const backupBanner = lb === null || lb >= 14
    ? `<div class="banner warn"><div class="tx">${lb === null ? '아직 백업한 적이 없어요.' : `마지막 백업이 ${lb}일 전이에요.`} 폰을 바꾸거나 앱 데이터를 지우면 사라지니 백업해 두세요.</div><button class="btn sm warn" data-act="backup">백업</button></div>` : '';
  return `<div class="top"><h1>People Book</h1><a class="iconbtn" href="#/p/new" aria-label="사람 추가">${PLUS}</a></div>
    <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="이름, 회사, 학교, 관계 검색" autocomplete="off" enterkeyhint="search">
      <button class="clear" data-act="clearQ" aria-label="지우기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div id="results"></div>
    <div id="dash">
      ${backupBanner}
      <div class="stats">
        <a class="stat acc" href="#/people"><b>${n}</b><span>사람</span></a>
        <a class="stat warn" href="#/check"><b>${checkN}</b><span>확인 필요</span></a>
        <a class="stat" href="#/dups"><b>${dupN}</b><span>중복 후보</span></a>
      </div>
      <div class="sec"><h3>다가오는 일정</h3><a href="#/events">전체</a></div>
      ${up.length ? `<div class="list">${up.slice(0, 6).map(i => i.html).join('')}</div>` : `<div class="empty">120일 안에 잡힌 일정이 없어요</div>`}
      ${tbd ? `<p class="hint" style="margin:8px 2px 0">날짜 미정 일정 ${tbd}개 — <a href="#/events" style="color:var(--accent)">일정 탭</a>에서 날짜를 채워보세요</p>` : ''}
      <div class="sec"><h3>그룹</h3></div>
      <div class="chips">${groups.map(g => `<button class="chip" data-act="goGroup" data-g="${esc(g)}">${esc(g)} <span style="color:var(--mute)">${S.people.filter(p => (p.groups || []).includes(g)).length}</span></button>`).join('')}</div>
    </div>`;
}
function hl(text, q) {
  const t = esc(text); if (!q) return t;
  const toks = q.trim().split(/\s+/).filter(x => x && !isCho(x)).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return toks.length ? t.replace(new RegExp(`(${toks.map(esc).join('|')})`, 'gi'), '<mark>$1</mark>') : t;
}
function matchSnippet(p, q) {
  const toks = q.toLowerCase().split(/\s+/).filter(x => x && !isCho(x));
  for (const r of relationsOf(p.id)) {
    const s = `${r.type}: ${r.other.name}`;
    if (toks.some(t => s.toLowerCase().includes(t))) return s;
  }
  if (p.notes && toks.some(t => p.notes.toLowerCase().includes(t))) {
    const i = p.notes.toLowerCase().indexOf(toks.find(t => p.notes.toLowerCase().includes(t)));
    return (i > 15 ? '…' : '') + p.notes.slice(Math.max(0, i - 15), i + 35) + '…';
  }
  return subtitle(p) || (p.groups || []).join(' · ');
}
function renderResults() {
  const q = UI.q.trim(); const box = $('#results'), dash = $('#dash');
  if (!box) return;
  if (!q) { box.innerHTML = ''; dash && (dash.hidden = false); return; }
  dash && (dash.hidden = true);
  const ps = searchPeople(q), es = searchEvents(q);
  box.innerHTML = `<div class="sec" style="margin-top:0"><h3>사람 ${ps.length}</h3></div>
    ${ps.length ? `<div class="list">${ps.map(p => `<a class="row" href="#/p/${p.id}">${avatar(p)}<div class="main">
      <div class="t">${hl(p.name, q)}${(p.aliases || []).length ? `<small>${hl(p.aliases.join(', '), q)}</small>` : ''}${p.needsCheck ? '<span class="badge warn">확인</span>' : ''}</div>
      <div class="s">${hl(matchSnippet(p, q), q)}</div></div></a>`).join('')}</div>` : '<div class="empty">일치하는 사람이 없어요</div>'}
    ${es.length ? `<div class="sec"><h3>일정 ${es.length}</h3></div><div class="list">${es.map(e => eventRow(e)).join('')}</div>` : ''}`;
}

/* ───────────── 화면: 사람 목록 ───────────── */
function vPeople() {
  const mode = UI.peopleMode;
  const seg = [['group', '그룹'], ['school', '학교'], ['company', '직장'], ['all', '가나다']]
    .map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-act="peopleMode" data-m="${k}">${l}</button>`).join('');
  let body = '';
  if (!S.people.length) body = `<div class="empty"><p>등록된 사람이 없어요</p><a class="btn pri" href="#/p/new">추가하기</a></div>`;
  else if (mode === 'all') {
    const sorted = [...S.people].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    body = `<div class="list">${sorted.map(p => personRow(p)).join('')}</div>`;
  } else {
    const field = { group: 'groups', school: 'schools', company: 'companies' }[mode];
    const none = { group: '그룹 없음', school: '학교 정보 없음', company: '직장 정보 없음' }[mode];
    const keys = uniq(S.people.flatMap(p => p[field] || []));
    if (mode !== 'group') keys.sort((a, b) => S.people.filter(p => (p[field] || []).includes(b)).length - S.people.filter(p => (p[field] || []).includes(a)).length || a.localeCompare(b, 'ko'));
    const sections = keys.map(k => [k, S.people.filter(p => (p[field] || []).includes(k))]);
    const rest = S.people.filter(p => !(p[field] || []).length);
    if (rest.length) sections.push([none, rest]);
    body = sections.map(([k, list]) => `<details class="grp" open data-key="${esc(k)}"><summary>${esc(k)} <span class="n">${list.length}</span></summary>
      <div class="list">${list.map(p => personRow(p)).join('')}</div></details>`).join('');
  }
  return `<div class="top"><h1>사람</h1><span style="color:var(--mute);font-size:13px">${S.people.length}명</span></div>
    <div class="seg">${seg}</div>${body}
    <a class="fab" href="#/p/new" aria-label="사람 추가">${PLUS}</a>`;
}

/* ───────────── 화면: 사람 상세 ───────────── */
function vPerson(id) {
  const p = byId(id);
  if (!p) return `<div class="top">${back()}<h2>없는 사람</h2></div><div class="empty">삭제되었거나 없는 사람이에요</div>`;
  const rels = relationsOf(id);
  const evs = eventsOf(id).sort((a, b) => eventState(a).ts - eventState(b).ts);
  const b = p.birth || {};
  const birthTxt = b.y || b.m ? `${b.y ? b.y + '년' : ''}${b.m ? ` ${b.m}월` : ''}${b.d ? ` ${b.d}일` : ''}`.trim() : '';
  const kv = [['직업', esc(p.job)], ['MBTI', esc(p.mbti)], ['고향', esc(p.hometown)], ['사는 곳', esc(p.residence)], ['생일', esc(birthTxt)],
    ['연락처', p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : '']].filter(x => x[1]);
  const tags = [...(p.groups || []).map(g => `<span class="tag g">${esc(g)}</span>`), ...(p.schools || []).map(s => `<span class="tag s">🎓 ${esc(s)}</span>`), ...(p.companies || []).map(c => `<span class="tag c">🏢 ${esc(c)}</span>`)].join('');
  return `<div class="top">${back()}<h2></h2><a class="textbtn" href="#/p/${id}/edit">수정</a></div>
    <div class="hero">${avatar(p, true)}<div><div class="nm">${esc(p.name)}</div>${(p.aliases || []).length ? `<div class="al">${esc(p.aliases.join(' · '))}</div>` : ''}</div></div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    ${p.needsCheck ? `<div class="checkbox"><div class="tx"><b>⚠ 확인 필요</b>${esc(p.checkNote || '확인할 내용을 적어두세요')}</div><button class="btn sm warn" data-act="resolveCheck" data-id="${id}">확인 완료</button></div>` : ''}
    ${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    <div class="sec"><h3>관계 ${rels.length}</h3><button data-act="addRel" data-id="${id}">+ 연결</button></div>
    ${rels.length ? `<div class="list">${rels.map(r => `<div class="row"><a href="#/p/${r.other.id}" style="display:flex;gap:12px;align-items:center;flex:1;min-width:0">${avatar(r.other)}
      <div class="main"><div class="t">${esc(r.other.name)} <span class="badge acc">${esc(r.type)}</span></div>${r.note ? `<div class="s">${esc(r.note)}</div>` : ''}</div></a>
      <button class="iconbtn" data-act="relMenu" data-rid="${r.id}" aria-label="관계 메뉴"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button></div>`).join('')}</div>`
      : `<div class="empty" style="padding:16px">연결된 사람이 없어요</div>`}
    <div class="sec"><h3>일정 ${evs.length}</h3><a href="#/e/new/${id}">+ 일정</a></div>
    ${evs.length ? `<div class="list">${evs.map(e => eventRow(e)).join('')}</div>` : `<div class="empty" style="padding:16px">등록된 일정이 없어요</div>`}
    ${p.notes ? `<div class="sec"><h3>메모</h3></div><div class="note">${esc(p.notes)}</div>` : ''}
    ${(p.raw || []).length ? `<details class="raw"><summary>원문 기록 ${p.raw.length}개 보기</summary>${p.raw.map(r => `<p><i>${esc(r.group)}</i>${esc(r.text)}</p>`).join('')}</details>` : ''}
    <div class="btns" style="margin-top:22px">${p.needsCheck ? '' : `<button class="btn warn" data-act="flagCheck" data-id="${id}">확인 필요로 표시</button>`}
      <button class="btn danger" data-act="delPerson" data-id="${id}">삭제</button></div>`;
}

/* ───────────── 화면: 사람 추가/수정 ───────────── */
function suggestChips(field, cur) {
  const all = uniq(S.people.flatMap(p => p[field] || [])).filter(x => !cur.includes(x)).slice(0, 14);
  return all.length ? `<div class="sugg">${all.map(v => `<button type="button" class="chip sm" data-act="addSugg" data-f="${field}" data-v="${esc(v)}">+ ${esc(v)}</button>`).join('')}</div>` : '';
}
function vPersonEdit(id) {
  const p = id ? byId(id) : null;
  if (id && !p) return `<div class="top">${back()}<h2>없는 사람</h2></div>`;
  const v = p || { name: '', aliases: [], groups: [], schools: [], companies: [], birth: {}, needsCheck: false };
  const b = v.birth || {};
  return `<div class="top">${back()}<h2>${p ? '정보 수정' : '사람 추가'}</h2><button class="textbtn" form="pf" type="submit">저장</button></div>
  <form class="form" id="pf" data-form="person" data-id="${p ? p.id : ''}" autocomplete="off">
    <label><span>이름 *</span><input name="name" required value="${esc(v.name)}" placeholder="예: 홍길동"></label>
    <label><span>부르는 이름 / 별칭 (쉼표 구분)</span><input name="aliases" value="${esc((v.aliases || []).join(', '))}" placeholder="예: 길동이, 길동오빠"></label>
    <label><span>그룹 (쉼표 구분)</span><input name="groups" value="${esc((v.groups || []).join(', '))}" placeholder="예: 고등학교 2학년 친구">${suggestChips('groups', v.groups || [])}</label>
    <label><span>학교 (쉼표 구분)</span><input name="schools" value="${esc((v.schools || []).join(', '))}">${suggestChips('schools', v.schools || [])}</label>
    <label><span>직장 (쉼표 구분)</span><input name="companies" value="${esc((v.companies || []).join(', '))}">${suggestChips('companies', v.companies || [])}</label>
    <div class="two"><label><span>직업/직급</span><input name="job" value="${esc(v.job)}"></label><label><span>MBTI</span><input name="mbti" value="${esc(v.mbti)}" maxlength="4" style="text-transform:uppercase"></label></div>
    <div class="two"><label><span>고향</span><input name="hometown" value="${esc(v.hometown)}"></label><label><span>사는 곳</span><input name="residence" value="${esc(v.residence)}"></label></div>
    <label><span>생일 (모르는 칸은 비워두기)</span><div class="three">
      <input name="by" inputmode="numeric" placeholder="연도" value="${b.y ?? ''}"><input name="bm" inputmode="numeric" placeholder="월" value="${b.m ?? ''}"><input name="bd" inputmode="numeric" placeholder="일" value="${b.d ?? ''}"></div></label>
    <label><span>연락처</span><input name="phone" type="tel" value="${esc(v.phone)}" placeholder="010-0000-0000"></label>
    <label><span>메모</span><textarea name="notes">${esc(v.notes)}</textarea></label>
    <label class="tick"><input type="checkbox" name="needsCheck" ${v.needsCheck ? 'checked' : ''}><span style="margin:0;color:var(--text)">확인이 필요한 정보가 있음</span></label>
    <label><span>확인할 내용</span><input name="checkNote" value="${esc(v.checkNote)}" placeholder="예: 결혼 날짜 확인"></label>
    <button class="btn pri block" type="submit">저장</button>
  </form>`;
}

/* ───────────── 화면: 일정 ───────────── */
function vEvents() {
  const f = UI.eventFilter;
  const chips = ['전체', ...EVENT_TYPES].map(t => `<button class="chip${f === t ? ' on' : ''}" data-act="evFilter" data-t="${t}">${t === '전체' ? t : EVENT_ICON[t] + ' ' + t}</button>`).join('');
  const evs = S.events.filter(e => f === '전체' || e.type === f).map(e => ({ e, st: eventState(e) }));
  const up = evs.filter(x => x.st.kind === 'upcoming').sort((a, b) => a.st.ts - b.st.ts);
  const tbd = evs.filter(x => x.st.kind === 'tbd');
  const past = evs.filter(x => x.st.kind === 'past').sort((a, b) => b.st.ts - a.st.ts);
  const bdays = (f === '전체' || f === '생일') ? S.people.map(p => ({ p, nb: nextBirthday(p) })).filter(x => x.nb).sort((a, b) => a.nb.days - b.nb.days) : [];
  const block = (title, arr, fn) => arr.length ? `<div class="sec"><h3>${title} ${arr.length}</h3></div><div class="list">${arr.map(fn).join('')}</div>` : '';
  const body = block('다가오는', up, x => eventRow(x.e)) + block('생일', bdays, x => birthdayRow(x.p, x.nb)) +
    block('날짜 미정', tbd, x => eventRow(x.e)) + block('지난 일정', past, x => eventRow(x.e, false));
  return `<div class="top"><h1>일정</h1><a class="iconbtn" href="#/e/new" aria-label="일정 추가">${PLUS}</a></div>
    <div class="chips">${chips}</div>${body || '<div class="empty">일정이 없어요</div>'}
    <a class="fab" href="#/e/new" aria-label="일정 추가">${PLUS}</a>`;
}
let evDraftPeople = [];
function vEventEdit(id, presetPerson) {
  const ev = id ? S.events.find(e => e.id === id) : null;
  if (id && !ev) return `<div class="top">${back()}<h2>없는 일정</h2></div>`;
  const v = ev || { type: '결혼식', title: '', date: {}, people: presetPerson && byId(presetPerson) ? [presetPerson] : [], place: '', note: '', needsCheck: false };
  evDraftPeople = [...(v.people || [])];
  const d = v.date || {};
  return `<div class="top">${back()}<h2>${ev ? '일정 수정' : '일정 추가'}</h2><button class="textbtn" form="ef" type="submit">저장</button></div>
  <form class="form" id="ef" data-form="event" data-id="${ev ? ev.id : ''}" autocomplete="off">
    <label><span>종류</span><select name="type">${EVENT_TYPES.map(t => `<option ${t === v.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label><span>제목 *</span><input name="title" required value="${esc(v.title)}" placeholder="예: 원정 결혼식"></label>
    <label><span>날짜 (모르는 칸은 비워두기)</span><div class="three">
      <input name="y" inputmode="numeric" placeholder="연도" value="${d.y ?? ''}"><input name="m" inputmode="numeric" placeholder="월" value="${d.m ?? ''}"><input name="d" inputmode="numeric" placeholder="일" value="${d.d ?? ''}"></div></label>
    <label><span>장소</span><input name="place" value="${esc(v.place)}"></label>
    <label><span>관련된 사람</span></label>
    <div class="picked" id="evPeople" style="margin:-8px 0 14px"></div>
    <label><span>메모</span><textarea name="note">${esc(v.note)}</textarea></label>
    <label class="tick"><input type="checkbox" name="needsCheck" ${v.needsCheck ? 'checked' : ''}><span style="margin:0;color:var(--text)">확인 필요 (날짜·장소 등)</span></label>
    <button class="btn pri block" type="submit">저장</button>
    ${ev ? `<button class="btn danger block" type="button" style="margin-top:8px" data-act="delEvent" data-id="${ev.id}">일정 삭제</button>` : ''}
  </form>`;
}
function renderEvPeople() {
  const box = $('#evPeople'); if (!box) return;
  box.innerHTML = evDraftPeople.map(id => byId(id)).filter(Boolean).map(p => `<button type="button" class="chip on" data-act="evRemovePerson" data-id="${p.id}">${esc(p.name)} ✕</button>`).join('')
    + `<button type="button" class="chip" data-act="evAddPeople">+ 사람 선택</button>`;
}

/* ───────────── 화면: 확인 필요 ───────────── */
function vCheck() {
  const ps = S.people.filter(p => p.needsCheck), es = S.events.filter(e => e.needsCheck);
  return `<div class="top">${back()}<h2>확인 필요 ${ps.length + es.length}</h2></div>
    <p class="hint" style="margin:0 2px 12px">빈칸이거나 원문이 애매해서 확인이 필요한 항목이에요. 확인하면 "확인 완료"를 눌러주세요.</p>
    ${ps.length ? `<div class="sec"><h3>사람 ${ps.length}</h3></div><div class="list">${ps.map(p => `<a class="row" href="#/p/${p.id}">${avatar(p)}<div class="main"><div class="t">${esc(p.name)}<small>${esc((p.groups || [])[0] || '')}</small></div><div class="s" style="color:#f7dc9c;white-space:normal">${esc(p.checkNote || '확인 필요')}</div></div></a>`).join('')}</div>` : ''}
    ${es.length ? `<div class="sec"><h3>일정 ${es.length}</h3></div><div class="list">${es.map(e => eventRow(e)).join('')}</div>` : ''}
    ${!ps.length && !es.length ? '<div class="empty">확인할 항목이 없어요 👍</div>' : ''}`;
}

/* ───────────── 화면: 중복 / 통합 ───────────── */
function vDups() {
  const d = findDuplicates();
  return `<div class="top">${back()}<h2>중복 후보 ${d.length}</h2></div>
    <p class="hint" style="margin:0 2px 12px">이름이 같거나 겹치는 사람을 찾았어요. 같은 사람이면 "통합", 다른 사람이면 "다른 사람"을 누르면 다시 안 떠요.</p>
    ${d.length ? d.map(x => `<div class="dup"><div class="pair">
      <a href="#/p/${x.a.id}"><b>${esc(x.a.name)}</b><small>${esc((x.a.groups || []).join(', ') || subtitle(x.a))}</small></a>
      <span style="color:var(--mute)">↔</span>
      <a href="#/p/${x.b.id}"><b>${esc(x.b.name)}</b><small>${esc((x.b.groups || []).join(', ') || subtitle(x.b))}</small></a></div>
      <div class="why">${esc(x.why.join(' · '))}</div>
      <div class="btns" style="margin-top:0"><button class="btn sm" data-act="dismissDup" data-a="${x.a.id}" data-b="${x.b.id}">다른 사람</button>
      <a class="btn sm pri" href="#/merge/${x.a.id}/${x.b.id}">통합</a></div></div>`).join('')
      : '<div class="empty">중복으로 보이는 사람이 없어요 👍</div>'}
    ${(S.meta.dismissedDups || []).length ? `<button class="btn block" style="margin-top:12px" data-act="resetDismissed">'다른 사람' 처리 ${S.meta.dismissedDups.length}건 초기화</button>` : ''}`;
}
const MERGE_SCALARS = [['name', '이름'], ['job', '직업'], ['mbti', 'MBTI'], ['hometown', '고향'], ['residence', '사는 곳'], ['phone', '연락처']];
function vMerge(aId, bId) {
  const a = byId(aId), b = byId(bId);
  if (!a || !b) return `<div class="top">${back()}<h2>통합</h2></div><div class="empty">대상을 찾을 수 없어요</div>`;
  const rows = MERGE_SCALARS.filter(([k]) => (a[k] || '') !== (b[k] || '') && (a[k] || b[k])).map(([k, l]) => {
    const def = a[k] ? 'a' : 'b';
    return `<div class="mrow"><span>${l}</span>
      <label><input type="radio" name="${k}" value="a" ${def === 'a' ? 'checked' : ''}><span class="auto">${esc(a[k] || '(비어 있음)')}</span></label>
      <label><input type="radio" name="${k}" value="b" ${def === 'b' ? 'checked' : ''}><span class="auto">${esc(b[k] || '(비어 있음)')}</span></label></div>`;
  }).join('');
  return `<div class="top">${back()}<h2>두 사람 통합</h2></div>
    <p class="hint" style="margin:0 2px 12px">다른 값만 골라주세요. 그룹·학교·직장·별칭·메모·원문·관계·일정은 모두 합쳐져요.</p>
    <form class="form" data-form="merge" data-a="${a.id}" data-b="${b.id}">
      ${rows || '<div class="empty" style="padding:14px;margin-bottom:8px">겹치는 기본 정보가 같아요. 나머지는 자동으로 합쳐요.</div>'}
      <div class="mrow"><span>자동으로 합쳐지는 것</span><div class="auto" style="font-size:13.5px;color:var(--sub)">
        그룹: ${esc(uniq([...(a.groups || []), ...(b.groups || [])]).join(', ') || '-')}<br>
        학교: ${esc(uniq([...(a.schools || []), ...(b.schools || [])]).join(', ') || '-')}<br>
        직장: ${esc(uniq([...(a.companies || []), ...(b.companies || [])]).join(', ') || '-')}<br>
        관계 ${relationsOf(a.id).length + relationsOf(b.id).length}개 · 일정 ${uniq([...eventsOf(a.id), ...eventsOf(b.id)].map(e => e.id)).length}개</div></div>
      <button class="btn pri block" type="submit" style="margin-top:8px">하나로 통합</button>
    </form>`;
}
async function mergePeople(aId, bId, choice) {
  const a = byId(aId), b = byId(bId);
  const m = { ...a };
  for (const [k] of MERGE_SCALARS) m[k] = (choice[k] === 'b' ? b[k] : a[k]) || a[k] || b[k] || '';
  m.aliases = uniq([...(a.aliases || []), ...(b.aliases || []), a.name, b.name]).filter(x => x !== m.name);
  for (const f of ['groups', 'schools', 'companies']) m[f] = uniq([...(a[f] || []), ...(b[f] || [])]);
  const ba = a.birth || {}, bb = b.birth || {};
  m.birth = { y: ba.y || bb.y || null, m: ba.m || bb.m || null, d: ba.d || bb.d || null };
  m.notes = [a.notes, b.notes].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join('\n\n');
  m.raw = [...(a.raw || []), ...(b.raw || [])];
  m.needsCheck = !!(a.needsCheck || b.needsCheck);
  m.checkNote = [a.checkNote, b.checkNote].filter(Boolean).join(' / ');
  m.updatedAt = nowISO();
  const relSeen = new Set();
  const relPut = [], relDel = [];
  for (const r of S.relations) {
    if (r.a !== bId && r.b !== bId && r.a !== aId && r.b !== aId) continue;
    const nr = { ...r, a: r.a === bId ? aId : r.a, b: r.b === bId ? aId : r.b };
    const k = pairKey(nr.a, nr.b) + '|' + nr.type;
    if (nr.a === nr.b || relSeen.has(k)) { relDel.push(r.id); continue; }
    relSeen.add(k); relPut.push(nr);
  }
  const evPut = S.events.filter(e => (e.people || []).includes(bId)).map(e => ({ ...e, people: uniq(e.people.map(x => x === bId ? aId : x)) }));
  await run(['people', 'relations', 'events'], t => {
    t.objectStore('people').put(m); t.objectStore('people').delete(bId);
    relPut.forEach(r => t.objectStore('relations').put(r)); relDel.forEach(id => t.objectStore('relations').delete(id));
    evPut.forEach(e => t.objectStore('events').put(e));
  });
  await loadAll();
}

/* ───────────── 화면: 설정 ───────────── */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (location.hash.startsWith('#/settings')) route(); });
function vSettings() {
  const lb = S.meta.lastBackup ? new Date(S.meta.lastBackup) : null;
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return `<div class="top"><h1>설정</h1></div>
    <div class="sec" style="margin-top:4px"><h3>데이터</h3></div>
    <div class="setgrp">
      <div class="setrow"><div class="main">사람 ${S.people.length} · 관계 ${S.relations.length} · 일정 ${S.events.length}<small id="storeInfo">이 기기에만 저장됨 (IndexedDB)</small></div></div>
      <button class="setrow" data-act="backup"><div class="main">백업 파일 저장 (JSON)<small>${lb ? `마지막 백업: ${lb.toLocaleString('ko-KR')}` : '아직 백업한 적 없음'}</small></div><span>⬇️</span></button>
      ${navigator.canShare ? `<button class="setrow" data-act="shareBackup"><div class="main">백업 파일 공유하기<small>카톡 나에게 보내기·드라이브 등으로</small></div><span>📤</span></button>` : ''}
      <button class="setrow" data-act="restore"><div class="main">백업에서 복원<small>합치기 또는 전체 바꾸기 선택</small></div><span>⬆️</span></button>
    </div>
    <div class="sec"><h3>정리</h3></div>
    <div class="setgrp">
      <a class="setrow" href="#/dups"><div class="main">중복 인물 찾기·통합<small>후보 ${findDuplicates().length}건</small></div><span>›</span></a>
      <a class="setrow" href="#/check"><div class="main">확인 필요 목록<small>${S.people.filter(p => p.needsCheck).length + S.events.filter(e => e.needsCheck).length}건</small></div><span>›</span></a>
    </div>
    <div class="sec"><h3>앱</h3></div>
    <div class="setgrp">
      ${standalone ? `<div class="setrow"><div class="main">홈 화면 앱으로 실행 중 ✓</div></div>`
        : installPrompt ? `<button class="setrow" data-act="install"><div class="main">홈 화면에 설치<small>앱처럼 독립 실행·오프라인 사용</small></div><span>📲</span></button>`
        : `<div class="setrow"><div class="main">홈 화면에 설치<small>크롬 메뉴(⋮) → '홈 화면에 추가' 또는 '앱 설치'</small></div></div>`}
      <button class="setrow" data-act="persist"><div class="main">저장공간 보호 요청<small id="persistInfo">브라우저가 데이터를 자동 정리하지 않도록 요청</small></div></button>
      <button class="setrow danger" data-act="wipe"><div class="main">모든 데이터 삭제<small>되돌릴 수 없어요. 먼저 백업하세요</small></div></button>
    </div>
    <p class="foot">People Book v${APP_VERSION}<br>모든 정보는 이 폰 안에만 저장되고 어떤 서버로도 전송되지 않아요.<br>앱 데이터를 지우거나 폰을 바꾸면 사라지니 백업 파일을 꼭 보관하세요.</p>`;
}
async function refreshStorageInfo() {
  try {
    if (navigator.storage?.persisted) {
      const ok = await navigator.storage.persisted();
      const el = $('#persistInfo'); if (el) el.textContent = ok ? '보호됨 ✓ — 자동 정리 대상 아님' : '보호 안 됨 — 눌러서 요청';
    }
    if (navigator.storage?.estimate) {
      const { usage } = await navigator.storage.estimate();
      const el = $('#storeInfo'); if (el && usage != null) el.textContent = `이 기기에만 저장됨 · 약 ${(usage / 1024).toFixed(0)}KB 사용`;
    }
  } catch (_) { }
}

/* ───────────── 백업 / 복원 ───────────── */
function exportData() {
  return { app: 'peoplebook', version: 1, exportedAt: nowISO(), people: S.people, relations: S.relations, events: S.events, meta: { dismissedDups: S.meta.dismissedDups || [] } };
}
function backupFile() {
  const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `peoplebook-backup-${stamp}.json`;
  return new File([JSON.stringify(exportData(), null, 1)], name, { type: 'application/json' });
}
async function doBackup() {
  const f = backupFile();
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  await setMeta('lastBackup', nowISO());
  toast('백업 파일을 저장했어요 (다운로드 폴더)');
  route();
}
async function doShareBackup() {
  const f = backupFile();
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f], title: 'People Book 백업' });
      await setMeta('lastBackup', nowISO()); route();
    } else toast('이 브라우저는 파일 공유를 지원하지 않아요');
  } catch (e) { if (e.name !== 'AbortError') toast('공유 실패: ' + e.message); }
}
function validateBackup(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.people)) throw new Error('People Book 백업 파일이 아니에요');
  for (const p of d.people) if (!p.id || !p.name) throw new Error('인물 데이터 형식이 올바르지 않아요');
  d.relations = Array.isArray(d.relations) ? d.relations.filter(r => r.id && r.a && r.b) : [];
  d.events = Array.isArray(d.events) ? d.events.filter(e => e.id && e.title) : [];
  return d;
}
async function importData(d, mode) {
  const newer = (inc, cur) => !cur || (inc.updatedAt || inc.createdAt || '') >= (cur.updatedAt || cur.createdAt || '');
  await run(['people', 'relations', 'events', 'meta'], t => {
    if (mode === 'replace') ['people', 'relations', 'events'].forEach(s => t.objectStore(s).clear());
    const cur = { people: new Map(S.people.map(x => [x.id, x])), relations: new Map(S.relations.map(x => [x.id, x])), events: new Map(S.events.map(x => [x.id, x])) };
    for (const s of ['people', 'relations', 'events'])
      for (const x of d[s]) if (mode === 'replace' || newer(x, cur[s].get(x.id))) t.objectStore(s).put(x);
    const dis = uniq([...(mode === 'replace' ? [] : S.meta.dismissedDups || []), ...((d.meta && d.meta.dismissedDups) || [])]);
    t.objectStore('meta').put({ key: 'dismissedDups', value: dis });
  });
  await loadAll();
}
function pickFile() {
  return new Promise(res => {
    const inp = $('#fileInput'); inp.value = '';
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
async function doRestore(file) {
  file = file || await pickFile();
  if (!file) return;
  let d;
  try { d = validateBackup(JSON.parse(await file.text())); }
  catch (e) { toast('불러오기 실패: ' + (e.message || '파일 오류')); return; }
  let mode = 'replace';
  if (S.people.length) {
    mode = await choiceSheet('백업에서 복원', `파일: 사람 ${d.people.length} · 관계 ${d.relations.length} · 일정 ${d.events.length}<br>현재: 사람 ${S.people.length}명`, [
      { v: 'merge', label: '합치기 (같은 항목은 최신으로)', cls: 'pri' },
      { v: 'replace', label: '전체 바꾸기 (현재 데이터 삭제)', cls: 'danger' }]);
    if (!mode) return;
  }
  await importData(d, mode);
  toast(`불러왔어요 — 사람 ${S.people.length}명`);
  location.hash = '#/'; route();
}

/* ───────────── 액션 ───────────── */
const actions = {
  back: () => goBack('#/'),
  sheetVal: el => closeSheet(el.dataset.v),
  clearQ: () => { UI.q = ''; const i = $('#q'); i.value = ''; renderResults(); i.focus(); },
  goGroup: el => { UI.peopleMode = 'group'; location.hash = '#/people'; setTimeout(() => { const d = document.querySelector(`details[data-key="${CSS.escape(el.dataset.g)}"]`); d && d.scrollIntoView({ block: 'start' }); }, 120); },
  peopleMode: el => { UI.peopleMode = el.dataset.m; route(); },
  evFilter: el => { UI.eventFilter = el.dataset.t; route(); },
  backup: () => doBackup(),
  shareBackup: () => doShareBackup(),
  restore: () => doRestore(),
  install: async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; route(); },
  persist: async () => { if (!navigator.storage?.persist) return toast('이 브라우저는 지원하지 않아요'); const ok = await navigator.storage.persist(); toast(ok ? '저장공간 보호됨' : '브라우저가 거절했어요 (앱 설치 후 다시 시도)'); refreshStorageInfo(); },
  wipe: async () => {
    if (!await confirmSheet('모든 데이터 삭제', `사람 ${S.people.length}명과 모든 관계·일정이 지워져요. 되돌릴 수 없어요.`, '전부 삭제', true)) return;
    await run(['people', 'relations', 'events', 'meta'], t => ['people', 'relations', 'events', 'meta'].forEach(s => t.objectStore(s).clear()));
    await loadAll(); toast('삭제했어요'); location.hash = '#/'; route();
  },
  resolveCheck: async el => { const p = byId(el.dataset.id); await save('people', { ...p, needsCheck: false, updatedAt: nowISO() }); toast('확인 완료'); route(); },
  flagCheck: async el => {
    const p = byId(el.dataset.id);
    const note = await openSheet(`<h3>확인 필요로 표시</h3><form class="form" data-form="sheetInput"><label><span>무엇을 확인해야 하나요?</span><input name="v" placeholder="예: 회사 이직했는지"></label><button class="btn pri block">표시</button></form>`, m => $('input', m).focus());
    if (note === null) return;
    await save('people', { ...p, needsCheck: true, checkNote: note, updatedAt: nowISO() }); route();
  },
  delPerson: async el => {
    const p = byId(el.dataset.id);
    const rn = relationsOf(p.id).length;
    if (!await confirmSheet(`${p.name} 삭제`, `연결된 관계 ${rn}개도 함께 지워져요. 일정에서는 이름만 빠져요.`, '삭제', true)) return;
    const evs = eventsOf(p.id).map(e => ({ ...e, people: e.people.filter(x => x !== p.id) }));
    await run(['people', 'relations', 'events'], t => {
      t.objectStore('people').delete(p.id);
      S.relations.filter(r => r.a === p.id || r.b === p.id).forEach(r => t.objectStore('relations').delete(r.id));
      evs.forEach(e => t.objectStore('events').put(e));
    });
    await loadAll(); toast('삭제했어요'); location.replace('#/people');
  },
  addRel: async el => {
    const id = el.dataset.id;
    const picked = await pickPeople({ exclude: [id], title: '누구와 연결할까요?' });
    if (!picked) return;
    const other = byId(picked);
    const res = await relTypeSheet(other.name);
    if (!res) return;
    await save('relations', { id: uid('r'), a: id, b: other.id, type: res.type, note: res.note, createdAt: nowISO() });
    toast(`${other.name}님과 ${res.type}(으)로 연결했어요`); route();
  },
  relMenu: async el => {
    const r = S.relations.find(x => x.id === el.dataset.rid);
    const v = await choiceSheet('관계', '', [{ v: 'edit', label: '관계 종류·메모 수정' }, { v: 'del', label: '연결 끊기', cls: 'danger' }]);
    if (v === 'del') { await run(['relations'], t => t.objectStore('relations').delete(r.id)); await loadAll(); route(); }
    if (v === 'edit') {
      const res = await relTypeSheet('', r);
      if (res) { await save('relations', { ...r, type: res.type, note: res.note }); route(); }
    }
  },
  pickRow: el => {
    const m = $('#modal'); const st = m._pick;
    if (!st.multi) return closeSheet(el.dataset.id);
    st.sel.has(el.dataset.id) ? st.sel.delete(el.dataset.id) : st.sel.add(el.dataset.id);
    el.classList.toggle('on'); $('#pickN').textContent = st.sel.size;
  },
  pickDone: () => closeSheet([...$('#modal')._pick.sel]),
  relType: el => { el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); },
  addSugg: el => {
    const inp = el.closest('label').querySelector('input');
    const cur = splitList(inp.value); if (!cur.includes(el.dataset.v)) cur.push(el.dataset.v);
    inp.value = cur.join(', '); el.remove();
  },
  evAddPeople: async () => {
    const ids = await pickPeople({ multi: true, selected: evDraftPeople, title: '관련된 사람' });
    if (ids) { evDraftPeople = ids; renderEvPeople(); }
  },
  evRemovePerson: el => { evDraftPeople = evDraftPeople.filter(x => x !== el.dataset.id); renderEvPeople(); },
  delEvent: async el => {
    const ev = S.events.find(e => e.id === el.dataset.id);
    if (!await confirmSheet('일정 삭제', esc(ev.title), '삭제', true)) return;
    await run(['events'], t => t.objectStore('events').delete(ev.id)); await loadAll(); toast('삭제했어요'); goBack('#/events');
  },
  dismissDup: async el => { await setMeta('dismissedDups', uniq([...(S.meta.dismissedDups || []), pairKey(el.dataset.a, el.dataset.b)])); toast('다른 사람으로 표시했어요'); route(); },
  resetDismissed: async () => { await setMeta('dismissedDups', []); route(); },
};
function relTypeSheet(name, cur) {
  return openSheet(`<h3>${name ? esc(name) + '님은 어떤 관계인가요?' : '관계 수정'}</h3>
    <form class="form" data-form="relType"><div class="typegrid">${REL_TYPES.map(t => `<button type="button" data-act="relType" data-t="${t}" class="${(cur ? cur.type : '친구') === t ? 'on' : ''}">${t}</button>`).join('')}</div>
    <label><span>메모 (선택)</span><input name="note" value="${esc(cur?.note || '')}" placeholder="예: 2024년 결혼"></label>
    <button class="btn pri block">저장</button></form>`);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

/* ───────────── 폼 제출 ───────────── */
const forms = {
  async person(f) {
    const fd = new FormData(f); const id = f.dataset.id;
    const old = id ? byId(id) : null;
    const name = fd.get('name').trim();
    if (!name) return toast('이름을 입력해 주세요');
    const bm = num(fd.get('bm')), bd = num(fd.get('bd'));
    if ((bm && (bm < 1 || bm > 12)) || (bd && (bd < 1 || bd > 31))) return toast('생일 월/일을 확인해 주세요');
    const p = {
      ...(old || { id: uid('p'), createdAt: nowISO(), raw: [] }),
      name, aliases: splitList(fd.get('aliases')), groups: splitList(fd.get('groups')), schools: splitList(fd.get('schools')),
      companies: splitList(fd.get('companies')), job: fd.get('job').trim(), mbti: fd.get('mbti').trim().toUpperCase(),
      hometown: fd.get('hometown').trim(), residence: fd.get('residence').trim(), phone: fd.get('phone').trim(),
      birth: { y: num(fd.get('by')), m: bm, d: bd }, notes: fd.get('notes').trim(),
      needsCheck: fd.get('needsCheck') === 'on', checkNote: fd.get('checkNote').trim(), updatedAt: nowISO(),
    };
    await save('people', p);
    toast(old ? '저장했어요' : `${name}님을 추가했어요`);
    const dup = findDuplicates().find(x => x.a.id === p.id || x.b.id === p.id);
    if (!old && dup) setTimeout(() => toast(`비슷한 이름이 있어요 — 설정 > 중복 인물 찾기`), 2300);
    location.replace(`#/p/${p.id}`);
  },
  async event(f) {
    const fd = new FormData(f); const id = f.dataset.id;
    const old = id ? S.events.find(e => e.id === id) : null;
    const m = num(fd.get('m')), d = num(fd.get('d'));
    if ((m && (m < 1 || m > 12)) || (d && (d < 1 || d > 31))) return toast('월/일을 확인해 주세요');
    const ev = {
      ...(old || { id: uid('e'), createdAt: nowISO() }),
      type: fd.get('type'), title: fd.get('title').trim(), date: { y: num(fd.get('y')), m, d },
      place: fd.get('place').trim(), note: fd.get('note').trim(), people: evDraftPeople,
      needsCheck: fd.get('needsCheck') === 'on', updatedAt: nowISO(),
    };
    if (!ev.title) return toast('제목을 입력해 주세요');
    await save('events', ev);
    toast('일정을 저장했어요');
    goBack('#/events');
  },
  async merge(f) {
    const fd = new FormData(f);
    const choice = Object.fromEntries(MERGE_SCALARS.map(([k]) => [k, fd.get(k) || 'a']));
    await mergePeople(f.dataset.a, f.dataset.b, choice);
    toast('하나로 통합했어요');
    location.replace(`#/p/${f.dataset.a}`);
  },
  relType(f) {
    const t = f.querySelector('.typegrid button.on')?.dataset.t || '친구';
    closeSheet({ type: t, note: new FormData(f).get('note').trim() });
  },
  sheetInput(f) { closeSheet(new FormData(f).get('v').trim()); },
};
document.addEventListener('submit', e => {
  const fn = forms[e.target.dataset.form];
  if (fn) { e.preventDefault(); fn(e.target); }
});

/* ───────────── 시작 ───────────── */
window.addEventListener('hashchange', () => {
  const st = history.state;
  if (st && typeof st.d === 'number') depth = st.d; else { depth++; history.replaceState({ d: depth }, ''); }
  closeSheet(null); route(); window.scrollTo(0, 0);
});
if (!history.state) history.replaceState({ d: 0 }, '');
window.addEventListener('popstate', () => { if (!$('#modal').hidden) closeSheet(null); });

(async function init() {
  try {
    db = await openDB();
    await loadAll();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">저장소를 열 수 없어요: ${esc(e.message)}<br>시크릿 모드에서는 작동하지 않을 수 있어요.</div>`;
    return;
  }
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  if (navigator.storage?.persist && matchMedia('(display-mode: standalone)').matches) navigator.storage.persist().catch(() => { });
})();

/* 테스트/디버그용 노출 (네트워크 사용 없음) */
window.PB = { S, importData, validateBackup, findDuplicates, searchPeople, exportData };
