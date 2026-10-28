/* Dayline 프로토타입 — 큰 앱 + 작은 메모창, 할 일, 시간 인식, 미리 알림, 오늘 한 일 타임라인 */
(function () {
  'use strict';

  const P = window.DaylineParser;
  const { pad, dateKey, fromKey, addDays, hm, at } = P.util;

  const STORE = 'dayline.v1';
  const HOUR = 48; // 타임라인 1시간 높이(px)
  const PROMPT_MS = 9000;
  const WEEK = '일월화수목금토';
  const COLORS = {
    blue: '#3B82F6', green: '#22A06B', purple: '#8B5CF6', orange: '#F76707',
    pink: '#E64980', yellow: '#F59F00', teal: '#0CA5B0', gray: '#868E96',
    red: '#F03E3E', indigo: '#4C6EF5', lime: '#74B816', brown: '#A0785A',
  };
  const COLOR_NAMES = {
    blue: '파랑', green: '초록', purple: '보라', orange: '주황',
    pink: '분홍', yellow: '노랑', teal: '청록', gray: '회색',
    red: '빨강', indigo: '남색', lime: '연두', brown: '갈색',
  };
  // 직접 고른 색은 '#RRGGBB'로 저장한다
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const colorOf = (c) => (isHex(c) ? c : COLORS[c] || COLORS.gray);
  function hueToHex(h) {
    const s = 0.72;
    const l = 0.5;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  function hexToHue(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    if (!d) return 0;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }

  /* ---------- 시계 (데모용 ?t=2026-10-16T11:13) ---------- */
  const params = new URLSearchParams(location.search);
  const clockOffset = (() => {
    const t = params.get('t');
    if (t) {
      const d = new Date(t);
      if (!isNaN(d)) return d.getTime() - Date.now();
    }
    return 0;
  })();
  const now = () => new Date(Date.now() + clockOffset);
  const forceSaveFail = params.get('fail') === 'save';
  // Windows 앱(Electron)으로 실행 중이면 preload가 window.dayline을 열어 준다
  const APP = window.dayline && window.dayline.isApp ? window.dayline : null;
  const appInfo = { autostart: null, version: '', notificationsSupported: true };

  /* ---------- 작은 도구 ---------- */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayKey = () => dateKey(now());
  const fmtHM = (d) => hm(d.getHours(), d.getMinutes());
  const minToHM = (m) => {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return hm(Math.floor(m / 60), m % 60);
  };
  const hmToMin = (s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  const snap15 = (m) => Math.round(m / 15) * 15;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dayLong = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
  const dayShort = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  function relDay(key) {
    const diff = Math.round((fromKey(key) - startOfDay(now())) / 864e5);
    if (diff === 0) return '오늘';
    if (diff === -1) return '어제';
    if (diff === 1) return '내일';
    if (diff === 2) return '모레';
    const d = fromKey(key);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  // 목록 왼쪽 칸용: '내일 10/21', '금 10/23'처럼 짧은 말 + 날짜
  function dayLabel(key) {
    const diff = Math.round((fromKey(key) - startOfDay(now())) / 864e5);
    const d = fromKey(key);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    const word = { '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' }[diff] || WEEK[d.getDay()];
    return `${word} ${md}`;
  }
  function relDayFull(key) {
    const r = relDay(key);
    return r.includes('/') ? dayShort(fromKey(key)) : r;
  }
  function durText(min) {
    min = Math.round(min);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h}시간 ${m}분`;
    if (h) return `${h}시간`;
    return `${m}분`;
  }
  const sameDay = (a, b) => dateKey(a) === dateKey(b);

  /* ---------- 아이콘 (인라인 SVG, 1.6px 선) ---------- */
  const ICONS = {
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    expand: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevRight: '<path d="m9 18 6-6-6-6"/>',
    chevLeft: '<path d="m15 18-6-6 6-6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    mini: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="6" height="6" rx="1"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    note: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    sticky: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2z"/><path d="M14 21v-5a2 2 0 0 1 2-2h5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    timeline: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M7 13h5"/><path d="M10 17h7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 20.5l1.4-4.2A8 8 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12.3 3 8.4 8.4 0 0 1 21 11.5z"/><path d="M8.5 11.5h.01M12.3 11.5h.01M16 11.5h.01" stroke-width="2.2"/>',
    snooze: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  };
  const icon = (n, s = 20, cls = '') =>
    `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  /* ---------- 상태 ---------- */
  const defaultPrefs = () => ({
    mode: 'big', view: 'list', tlMode: 'week', anchor: null, filter: 'all', pinned: true, miniPos: null,
  });
  function normalize(d) {
    d.projects = d.projects || [];
    d.notifications = d.notifications || [];
    d.fired = d.fired || {};
    d.imported = d.imported || {};
    d.settings = Object.assign({ workStart: 9, workEnd: 18 }, d.settings);
    d.prefs = Object.assign(defaultPrefs(), d.prefs);
    d.tasks.forEach((t) => {
      t.spans = t.spans || [];
      if (t.memo == null) t.memo = '';
      if (t.repeat) {
        t.doneDates = t.doneDates || {};
        t.skipDates = t.skipDates || [];
      }
    });
    return d;
  }
  // Windows 앱은 빈 상태로 시작한다(샘플은 브라우저 데모용)
  const emptyState = () => normalize({ tasks: [], projects: [], notifications: [], fired: {}, settings: {}, prefs: {} });
  function seed() {
    if (APP) return emptyState();
    const n = now();
    const T = startOfDay(n);
    const y = addDays(T, -1);
    const k = dateKey;
    const projects = [
      { id: 'p-app', name: '모바일앱', color: 'blue' },
      { id: 'p-web', name: '홈페이지', color: 'orange' },
    ];
    const tasks = [];
    let order = 0;
    const mk = (text, f) => {
      const t = Object.assign(
        {
          id: uid(), text, projectId: null, date: null, start: null, end: null, duration: null,
          reminder: null, memo: '', done: false, doneAt: null, order: order++, createdAt: n.toISOString(),
          spans: P.parse(text, at(T, 8, 0)).spans,
        },
        f || {},
      );
      tasks.push(t);
    };
    const doneAt = (d, h, m) => at(d, h, m).toISOString();
    mk('주간 보고서', { date: k(y), start: '18:00', reminder: 10 });
    mk('1시30분 Tech Week', { date: k(T), start: '13:30', reminder: 10 });
    mk('모바일앱 릴리스 노트 공유', { date: k(T), start: '16:00', projectId: 'p-app' });
    mk('홈페이지 문의 폼 오류 확인', { projectId: 'p-web' });
    {
      const wk = P.parse('매주 수요일 9시-10시 주간 회의', n);
      mk('매주 수요일 9시-10시 주간 회의', {
        date: wk.date, start: wk.start, end: wk.end, reminder: 10, repeat: wk.repeat, doneDates: {}, skipDates: [],
        spans: wk.spans,
      });
    }
    const dd = n >= at(T, 10, 50) ? T : y;
    mk('메일 정리', { date: k(dd), start: '09:30', done: true, doneAt: doneAt(dd, 10, 20) });
    mk('스탠드업', { date: k(dd), start: '10:30', done: true, doneAt: doneAt(dd, 10, 50) });
    const hist = [
      [1, '모바일앱 QA 대응', '10:00', [11, 30], 'p-app'],
      [1, '홈페이지 API 연동', '13:00', [15, 30], 'p-web'],
      [2, '모바일앱 결제 화면 검토', '09:30', [12, 0], 'p-app'],
      [2, '기획 회의', '14:00', [15, 0], null],
      [2, '홈페이지 화면 점검', '14:30', [16, 0], 'p-web'],
      [3, '홈페이지 이슈 트래킹', '10:00', [11, 40], 'p-web'],
      [3, '모바일앱 디자인 싱크', '15:00', [16, 30], 'p-app'],
      [4, '주간 기획 회의', '09:30', [11, 0], null],
      [4, '홈페이지 배포 준비', '13:30', [17, 0], 'p-web'],
    ];
    for (const [ago, title, st, [eh, em], pid] of hist) {
      const d = addDays(T, -ago);
      mk(title, { date: k(d), start: st, done: true, doneAt: doneAt(d, eh, em), projectId: pid });
    }
    return normalize({ tasks, projects, notifications: [], fired: {}, settings: {}, prefs: {} });
  }
  function load() {
    if (params.has('reset')) {
      try { localStorage.removeItem(STORE); } catch (e) { /* 무시 */ }
    }
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.tasks)) return normalize(d);
      }
    } catch (e) { /* 읽기 실패 → 샘플로 시작 */ }
    return seed();
  }

  // 최근 오류 기록(문제 알리기에 붙인다). 할 일 내용은 남기지 않는다
  const ERR_KEY = 'dayline.errors';
  let errLog = [];
  try {
    errLog = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
    if (!Array.isArray(errLog)) errLog = [];
  } catch (e) {
    errLog = [];
  }
  function logError(msg) {
    errLog.push({ at: new Date().toISOString(), msg: String(msg).slice(0, 300) });
    errLog = errLog.slice(-20);
    try {
      localStorage.setItem(ERR_KEY, JSON.stringify(errLog));
    } catch (e) { /* 무시 */ }
  }
  window.addEventListener('error', (e) => logError(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => logError(`promise: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

  const S = load();
  const ui = {
    sheet: null, prompt: null, snack: null, inbox: false, modal: null, showDone: false, showLater: null,
    saveError: false, lastSaved: null, hidden: false, quit: false, trayMenu: false, freshId: null,
    draft: '', permTest: null, scrolledKey: null, mpop: null, quickNew: null, draftProject: null,
  };

  function save() {
    try {
      if (forceSaveFail) throw new Error('저장 실패 테스트');
      localStorage.setItem(STORE, JSON.stringify(S));
      ui.saveError = false;
      ui.lastSaved = now();
    } catch (e) {
      ui.saveError = true;
    }
  }
  function commit() {
    save();
    render();
  }

  /* ---------- 할 일 계산 ---------- */
  /* 반복 일정: 할 일 하나(series)에 규칙을 저장하고, 화면에는 날짜별 회차(instance)로 펼친다.
     회차 id = 시리즈id@YYYY-MM-DD */
  function inst(t, k) {
    const da = (t.doneDates || {})[k];
    return Object.assign({}, t, { id: t.id + '@' + k, seriesId: t.id, date: k, done: !!da, doneAt: da || null });
  }
  const seriesOf = (t) => (t && t.seriesId ? S.tasks.find((x) => x.id === t.seriesId) : null);
  const target = (t) => seriesOf(t) || t; // 템플릿 값(제목·프로젝트·알림)을 바꿀 대상
  function instancesBetween(t, a, b) {
    const out = [];
    if (!t.repeat || !t.date) return out;
    const startDay = fromKey(t.date);
    const until = t.repeat.until ? addDays(fromKey(t.repeat.until), 1) : null;
    let d = startOfDay(a) < startDay ? startDay : startOfDay(a);
    for (let i = 0; d < b && i < 800; i++, d = addDays(d, 1)) {
      if (until && d >= until) break;
      const k = dateKey(d);
      if ((t.skipDates || []).includes(k)) continue;
      if (P.matchRepeat(t.repeat, d, t.date)) out.push(inst(t, k));
    }
    return out;
  }
  function nextInstance(t, fromDay) {
    const list = instancesBetween(t, fromDay, addDays(fromDay, 400));
    return list.find((i) => !i.done) || null;
  }
  function expandRange(a, b) {
    const out = [];
    for (const t of S.tasks) {
      if (t.repeat) out.push(...instancesBetween(t, a, b));
      else out.push(t);
    }
    return out;
  }
  const seriesActive = (t) => !t.repeat.until || t.repeat.until >= todayKey();
  const repLabel = (t) => P.repeatLabel(t.repeat, t.date);
  function findTask(id) {
    if (!id) return null;
    const i = id.indexOf('@');
    if (i < 0) return S.tasks.find((t) => t.id === id) || null;
    const s = S.tasks.find((t) => t.id === id.slice(0, i));
    return s && s.repeat ? inst(s, id.slice(i + 1)) : null;
  }
  const proj = (id) => S.projects.find((p) => p.id === id);
  const pColor = (p) => colorOf(p && p.color);
  function taskStart(t) {
    if (!t.date || !t.start) return null;
    const [h, m] = t.start.split(':').map(Number);
    return at(fromKey(t.date), h, m);
  }
  function taskEnd(t) {
    const s = taskStart(t);
    if (!s) return null;
    if (t.end) {
      const [h, m] = t.end.split(':').map(Number);
      let e = at(fromKey(t.date), h, m);
      if (e <= s) e = addDays(e, 1);
      return e;
    }
    if (t.duration) return new Date(s.getTime() + t.duration * 60000);
    return null;
  }
  /* 마감(~까지): t.due = { date, time|null } */
  function dueMoment(t) {
    if (!t.due || !t.due.date) return null;
    const d = fromKey(t.due.date);
    if (!t.due.time) return at(d, 23, 59);
    const [h, m] = t.due.time.split(':').map(Number);
    return at(d, h, m);
  }
  // 마감만 있는 할 일의 알림 기준: 마감 시각, 시간이 없으면 그날 업무 시작 시각
  function dueBase(t) {
    if (!t.due || !t.due.date) return null;
    if (t.due.time) return dueMoment(t);
    return at(fromKey(t.due.date), S.settings.workStart ?? 9, 0);
  }
  const dueOver = (t) => !!t.due && !t.done && dueMoment(t) <= now();
  function dueDays(t) {
    return Math.round((fromKey(t.due.date) - startOfDay(now())) / 86400000);
  }
  // 목록 왼쪽 칸: 지남 / 오늘 / 내일 / D-3
  function dueBadge(t) {
    if (dueOver(t)) return '지남';
    const n = dueDays(t);
    return n <= 0 ? '오늘' : n === 1 ? '내일' : `D-${n}`;
  }
  // "목요일까지", "10/30(금) 18:00까지"
  function dueText(t, short) {
    const d = fromKey(t.due.date);
    const n = dueDays(t);
    let day;
    if (n === 0) day = '오늘';
    else if (n === 1) day = '내일';
    else if (n > 1 && n < 7 && !short) day = `${WEEK[d.getDay()]}요일`;
    else day = `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
    return `${day}${t.due.time ? ' ' + t.due.time : ''}까지`;
  }
  const remBase = (t) => taskStart(t) || dueBase(t);
  function reminderAt(t) {
    const s = remBase(t);
    if (!s || t.reminder == null) return null;
    return new Date(s.getTime() - t.reminder * 60000);
  }
  /* 작업 기록: 완료 전이라도 '한 일'로 타임라인에 남긴다. t.sessions = [{ id, s, e|null }] (e 없음 = 진행 중) */
  function runningWork() {
    for (const t of S.tasks) {
      const w = (t.sessions || []).find((x) => !x.e);
      if (w) return { t, w };
    }
    return null;
  }
  const workingOn = (t) => !!(t && t.sessions && t.sessions.some((x) => !x.e));
  function stopWork(t, at) {
    const w = (t.sessions || []).find((x) => !x.e);
    if (!w) return 0;
    const end = at || now();
    const mins = Math.round((end - new Date(w.s)) / 60000);
    if (mins < 1) {
      t.sessions.splice(t.sessions.indexOf(w), 1); // 실수로 누른 경우
      return 0;
    }
    w.e = end.toISOString();
    return mins;
  }
  function startWork(t) {
    const r = runningWork();
    let note = '';
    if (r && r.t !== t) {
      const m = stopWork(r.t);
      if (m) note = ` · "${plainTitle(r.t)}" ${durText(m)} 기록`;
    }
    t.sessions = t.sessions || [];
    t.sessions.push({ id: uid(), s: now().toISOString(), e: null });
    return note;
  }
  function workMinutes(t, a, b) {
    let sum = 0;
    const n = now();
    for (const w of t.sessions || []) {
      const s = new Date(w.s);
      const e = w.e ? new Date(w.e) : n;
      const x = a ? Math.max(s, a) : s;
      const y = b ? Math.min(e, b) : e;
      if (y > x) sum += (y - x) / 60000;
    }
    return Math.round(sum);
  }
  // 마감만 있을 때 고를 수 있는 미리 알림
  function dueRemOpts(due) {
    return due && due.time
      ? [[0, '마감 시각'], [60, '1시간 전'], [180, '3시간 전'], [1440, '하루 전']]
      : [[0, '당일 아침'], [1440, '하루 전'], [2880, '이틀 전']];
  }
  function matchesFilter(t) {
    const f = S.prefs.filter;
    if (f === 'all') return true;
    if (f === 'none') return !t.projectId;
    return t.projectId === f;
  }
  function allSpans(t) {
    // 마감 문구(목요일까지)는 아래 줄에 따로 보이니 제목에서는 숨긴다
    if (t.due && t.dueSpan === undefined) t.dueSpan = P.parse(t.text, now(), S.settings).dueSpan;
    const ds = t.due && t.dueSpan && t.dueSpan[1] <= t.text.length ? t.dueSpan : null;
    const spans = (t.spans || [])
      .filter(([a, b]) => b <= t.text.length && !(ds && a === ds[0] && b === ds[1]))
      .map(([a, b]) => [a, b, 'time']);
    if (ds) spans.push([ds[0], ds[1], 'due']);
    const re = /#[^\s#]+/g;
    let m;
    while ((m = re.exec(t.text))) spans.push([m.index, m.index + m[0].length, 'tag']);
    return spans.sort((a, b) => a[0] - b[0]);
  }
  function plainTitle(t) {
    let out = '';
    let i = 0;
    for (const [a, b] of allSpans(t)) {
      if (a < i) continue;
      out += t.text.slice(i, a);
      i = b;
    }
    out += t.text.slice(i);
    const clean = out
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.·])/g, '$1')
      .replace(/^[\s,.·~\-–]+|[\s,·~\-–]+$/g, '')
      .trim();
    return clean || t.text.trim();
  }
  // 제목 맨 앞이 프로젝트 이름·자동 연결 단어(예: "모바일앱 ...")면, 아래 줄에 프로젝트가 보이니 화면에서는 뺀다.
  function shownTitle(t) {
    const title = plainTitle(t);
    const p = proj(t.projectId);
    if (!p) return title;
    const low = title.toLowerCase();
    const kws = projectKeywords(p).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const kw of kws) {
      const k = kw.toLowerCase();
      if (!low.startsWith(k)) continue;
      const next = title[k.length];
      if (next && !/[\s:·\-–\]\)\/,]/.test(next)) continue; // "모바일앱스"처럼 다른 단어의 앞부분이면 그대로
      const rest = title.slice(k.length).replace(/^[\s:·\-–\]\)\/,]+/, '').trim();
      return rest || title;
    }
    return title;
  }
  // 시간·반복·마감·#프로젝트는 왼쪽 칸과 아래 줄에 따로 보이니 제목에서는 뺀다.
  // 막 추가한 할 일만 잠깐 밑줄로 보여줘서 어떻게 읽었는지 확인할 수 있게 한다.
  function titleHtml(t) {
    if (ui.freshId !== t.id) return esc(shownTitle(t));
    let out = '';
    let i = 0;
    let hid = false;
    for (const [a, b, kind] of allSpans(t)) {
      if (a < i) continue;
      if (kind === 'due') {
        out += esc(t.text.slice(i, a).replace(/[\s,·]+$/, ''));
        hid = true;
      } else {
        out += esc(hid ? t.text.slice(i, a).replace(/^[\s,·]+/, a > i ? ' ' : '') : t.text.slice(i, a));
        out += `<span class="${kind === 'tag' ? 'tag' : 'tsp'}">${esc(t.text.slice(a, b))}</span>`;
        hid = false;
      }
      i = b;
    }
    const tail = t.text.slice(i);
    out += esc(hid ? tail.replace(/^[\s,·]+/, out ? ' ' : '').replace(/^\s+$/, '') : tail);
    return out.trim() || esc(t.text);
  }
  function isOverdue(t) {
    if (workingOn(t)) return false;
    const n = now();
    const s = taskStart(t);
    if (!s) return t.date && t.date < todayKey();
    const e = taskEnd(t) || new Date(s.getTime() + 30 * 60000);
    return e <= n;
  }
  function openCountFor(filter) {
    return S.tasks.filter((t) => {
      if (t.repeat ? !seriesActive(t) : t.done) return false;
      if (filter === 'all') return true;
      if (filter === 'none') return !t.projectId;
      return t.projectId === filter;
    }).length;
  }
  function listSections() {
    const n = now();
    const tk = dateKey(n);
    const vis = S.tasks.filter(matchesFilter);
    const past = [];
    const upcoming = [];
    const untimed = [];
    const later = [];
    const T = startOfDay(n);
    const doneRep = [];
    const items = [];
    for (const t of vis) {
      if (!t.repeat) {
        items.push(t);
        continue;
      }
      const todays = instancesBetween(t, T, addDays(T, 1));
      todays.forEach((i) => !i.done && items.push(i));
      if (!todays.some((i) => !i.done) && seriesActive(t)) {
        const nx = nextInstance(t, addDays(T, 1));
        if (nx) items.push(nx);
      }
      for (const [k, da] of Object.entries(t.doneDates || {})) {
        if (dateKey(new Date(da)) === tk && !(t.skipDates || []).includes(k)) doneRep.push(inst(t, k));
      }
    }
    const doing = [];
    for (const t of items) {
      if (t.done) continue;
      if (!t.repeat && !t.seriesId && t.sessions && t.sessions.length) {
        doing.push(t);
        continue;
      }
      // 할 일 = 오늘(과 지난) 것 + 날짜 없는 것, 일정 = 내일 이후. 그날이 되면 일정이 할 일로 올라온다.
      const s = taskStart(t);
      if (t.date && t.date > tk) later.push(t);
      else if (!t.date && t.due && t.due.date > tk) later.push(t); // 마감만 있는 일은 마감 날 일정으로, 그날이 되면 할 일로
      else if (s) {
        if (s <= n) past.push(t);
        else upcoming.push(t);
      } else untimed.push(t);
    }
    // 같은 날 안에서는 시간 없는 반복이 먼저, 그다음 시간순
    const key = (t) => {
      const s = taskStart(t);
      if (s) return s.getTime();
      if (t.due && t.due.time && dueInTimeCol(t)) return dueMoment(t).getTime(); // 마감 시각 자리에 끼워 넣는다
      if (t.date) return fromKey(t.date).getTime();
      return t.due ? dueMoment(t).getTime() - (t.due.time ? 0 : 86399000) : Infinity;
    };
    past.sort((a, b) => key(a) - key(b));
    upcoming.sort((a, b) => key(a) - key(b));
    later.sort((a, b) => key(a) - key(b));
    // 할 일: 마감·날짜가 가까운 것 먼저(지난 것 → 오늘 → 내일…), 날짜 없는 건 내가 정한 순서
    const when = (t) => Math.min(t.due ? dueMoment(t).getTime() : Infinity, t.date ? fromKey(t.date).getTime() : Infinity);
    untimed.sort((a, b) => {
      const da = when(a);
      const db = when(b);
      return da !== db ? da - db : a.order - b.order;
    });
    const doneToday = vis
      .filter((t) => !t.repeat && t.done && t.doneAt && dateKey(new Date(t.doneAt)) === tk)
      .concat(doneRep)
      .sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));
    const lastWork = (t) => (workingOn(t) ? Infinity : Math.max(...t.sessions.map((w) => new Date(w.e || w.s).getTime())));
    doing.sort((a, b) => lastWork(b) - lastWork(a));
    return { doing, past, upcoming, untimed, later, doneToday, openCount: doing.length + past.length + upcoming.length + untimed.length };
  }

  /* ---------- 알림 권한 ---------- */
  function permState() {
    if (APP) return appInfo.notificationsSupported ? 'granted' : 'unsupported';
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // granted | denied | default
  }
  function statusInfo() {
    const st = permState();
    if (APP && st === 'granted') return { cls: 'ok', text: '알림 켜짐 · 창을 닫아도 트레이에서 동작' };
    if (APP) return { cls: 'bad', text: '이 PC에서 Windows 알림을 쓸 수 없어요' };
    if (st === 'granted') return { cls: 'ok', text: '알림 켜짐 · 이 창이 열려 있는 동안 동작' };
    if (st === 'denied') return { cls: 'bad', text: '알림 권한 꺼짐 · 앱 안 알림만 와요' };
    if (st === 'unsupported') return { cls: 'warn', text: '시스템 알림 미지원 · 앱 안 알림만 와요' };
    return { cls: 'warn', text: '알림 권한 확인 필요' };
  }
  function askPermissionOnce() {
    if (!APP && permState() === 'default') {
      try {
        Notification.requestPermission().then(() => render());
      } catch (e) { /* 무시 */ }
    }
  }

  /* ---------- 공통 조각 ---------- */
  const unreadCount = () => S.notifications.filter((n) => !n.read).length;
  function bellBtn() {
    const c = unreadCount();
    return `<button class="ibtn" data-act="inbox" title="알림">${icon('bell')}${c ? `<em class="badge">${c}</em>` : ''}</button>`;
  }
  function banners() {
    let h = '';
    if (ui.saveError) {
      h += `<div class="banner bad">${icon('alert', 18)}<span>저장하지 못했어요. 변경 내용이 사라질 수 있어요.</span><button data-act="retry-save">다시 시도</button></div>`;
    }
    if (permState() === 'denied' && S.tasks.some((t) => !t.done && t.reminder != null)) {
      h += `<div class="banner warn">${icon('bellOff', 18)}<span>${S.prefs.mode === 'mini' ? '시스템 알림 권한이 꺼져 있어요' : '알림 권한이 꺼져 있어 시스템 알림이 오지 않아요'}</span><button data-act="settings">설정</button></div>`;
    }
    return h;
  }
  const hmm = (min) => `${Math.floor(min / 60)}:${pad(Math.round(min) % 60)}`;
  function timeCol(t, kind, isNext) {
    if (kind === 'sched') {
      const s0 = taskStart(t);
      if (dueInTimeCol(t)) return `<div class="tc sdue"><small>${icon('flag', 10)}마감</small><b>${t.due.time || '그날'}</b></div>`;
      return `<div class="tc"><b>${s0 ? fmtHM(s0) : '–'}</b></div>`;
    }
    if (kind === 'doing') {
      if (workingOn(t)) return `<div class="tc acc doing"><small>작업 중</small><b><i class="wdot"></i></b></div>`;
      return `<div class="tc doing"><button class="resume" data-act="work" data-id="${t.id}" title="이어서 작업" aria-label="이어서 작업">${icon('play', 12)}<span>이어서</span></button></div>`;
    }
    if (kind === 'untimed') {
      if (t.due && !t.done) {
        const over = dueOver(t);
        const n = dueDays(t);
        return `<div class="tc due${over ? ' red' : n <= 1 ? ' acc' : ''}"><small>마감</small><b>${dueBadge(t)}</b></div>`;
      }
      if (t.date && !t.done) {
        const late = t.date < todayKey();
        return `<div class="tc${late ? ' red' : t.date === todayKey() ? ' acc' : ''}"><small>${dayLabel(t.date)}</small><b>${late ? '지남' : '–'}</b></div>`;
      }
      return '<div class="tc"><span class="dash">–</span></div>';
    }
    const s = taskStart(t);
    const tk = todayKey();
    const label = t.date && t.date !== tk ? `<small>${dayLabel(t.date)}</small>` : '';
    let cls = '';
    if (kind === 'past' && isOverdue(t)) cls = 'red';
    else if (kind === 'past') cls = !t.done && !workingOn(t) ? 'warn' : 'acc';
    else if (kind === 'upcoming' && isNext) cls = 'acc';
    else if (kind === 'done') cls = 'muted';
    const fixable = s && !t.done ? ' fix' : '';
    return `<div class="tc ${cls}">${label}<b class="${fixable}">${s ? fmtHM(s) : '–'}</b></div>`;
  }
  // 일정 칸: 시작 시간이 없고 마감이 그 줄의 날짜와 같으면 시간 자리에 마감을 보여준다
  function dueInTimeCol(t) {
    return !!(t.due && !t.done && !taskStart(t) && (!t.date || t.date === t.due.date));
  }
  function metaHtml(t, kind) {
    const parts = [];
    // 프로젝트는 항상 맨 앞
    const p = proj(t.projectId);
    if (p) parts.push(`<span class="pj"><i style="--c:${pColor(p)}"></i>${esc(p.name)}</span>`);
    // 계획 시간은 '시간', 실제로 한 것은 '작업'. 시간이 됐어도 ▶를 누르기 전엔 '시작 전'
    const planLate = kind === 'past' && !t.done && !workingOn(t);
    if (planLate) parts.push(isOverdue(t) ? '<span class="red">지남</span>' : '<span class="warn">시작 전</span>');
    const s = taskStart(t);
    const e = taskEnd(t);
    if (s && e) {
      parts.push(`<span>~ ${sameDay(s, e) ? '' : '다음 날 '}${fmtHM(e)}</span>`);
    }
    if (t.done && t.doneAt) parts.push(`<span>${fmtHM(new Date(t.doneAt))} 완료</span>`);
    if (kind === 'sched' && dueInTimeCol(t)) {
      parts.push(`<span class="dpill">${dueBadge(t)}</span>`);
    } else if (t.due && !(kind === 'sched' && !t.date)) {
      const over = dueOver(t);
      const lbl = kind === 'untimed' || t.done ? '' : ` · ${dueBadge(t)}`;
      parts.push(`<span class="dueb${over ? ' red' : ''}">${icon('flag', 13)}${dueText(t)}${over && kind === 'untimed' ? ' · 지났어요' : lbl}</span>`);
    }
    const r = reminderAt(t);
    if (r && !t.done) {
      const off = permState() === 'denied';
      const base = remBase(t);
      const prev = s && !sameDay(r, s) ? ' (전날)' : !s && !sameDay(r, base) ? ` (${relDay(dateKey(r))})` : '';
      parts.push(`<span class="rem${off ? ' off' : ''}">${icon(off ? 'bellOff' : 'bell', 13)}${fmtHM(r)} 알림${prev}</span>`);
    }
    if (workingOn(t)) {
      const today = durText(Math.max(1, workMinutes(t, startOfDay(now()))));
      parts.push(`<button class="wchip on" data-act="work" data-id="${t.id}" title="작업 멈추기 · 한 시간은 타임라인에 남아요">${icon('stop', 11)}${kind === 'doing' ? '멈추기' : `작업 중 ${today}`}</button>`);
      if (kind === 'doing') parts.push(`<span class="work">오늘 ${today}째</span>`);
    } else if (t.sessions && t.sessions.length && kind === 'doing') {
      const last = new Date(Math.max(...t.sessions.map((w) => new Date(w.e || w.s).getTime())));
      parts.push(`<span class="work">${relDay(dateKey(last))} ${fmtHM(last)}까지 작업</span>`);
    } else if (t.sessions && t.sessions.length) {
      parts.push(`<span class="work">${icon('play', 11)}작업 ${durText(workMinutes(t))}</span>`);
    }
    if (t.repeat) parts.push(`<span class="rep">${icon('repeat', 13)}${repLabel(t)}</span>`);
    if (t.memo) parts.push(`<span class="memo">${icon('note', 13)}메모</span>`);
    if (t.images && t.images.length) parts.push(`<span class="memo">${icon('image', 13)}사진 ${t.images.length}</span>`);
    if (!parts.length) return '';
    return `<div class="meta">${parts.join('<span class="sep">·</span>')}</div>`;
  }
  function promptHtml(t) {
    const s = taskStart(t);
    const big = S.prefs.mode === 'big';
    const pills = s
      ? [[0, '시작할 때'], [5, '5분 전'], [10, '10분 전']]
      : dueRemOpts(t.due).slice(0, t.due && t.due.time ? 3 : 2);
    const head = s ? (big ? `<b>${relDay(t.date)} ${fmtHM(s)}</b> ` : '') : big ? `<b>${dueText(t)}</b> · ` : '';
    return `<div class="trow-x"><div></div><div class="cc"></div>
      <div class="prompt" data-nodrag>
        <div class="pr-top"><span>${head}${s || head ? '' : '마감 전에 '}미리 알려드릴까요?</span><button class="txt" data-act="prompt-skip">괜찮아요</button></div>
        <div class="pr-pills">
          ${pills.map(([v, l]) => `<button class="pill" data-act="prompt-pick" data-min="${v}">${l}</button>`).join('')}
          ${big ? '<button class="pill" data-act="prompt-more">더보기</button>' : `<button class="pill more" data-act="prompt-more" aria-label="더보기" title="더보기">${icon('chevRight', 14)}</button>`}
        </div>
        <div class="pr-bar"><i style="animation-duration:${Math.max(0, ui.prompt.until - Date.now())}ms"></i></div>
      </div></div>`;
  }
  function rowHtml(t, kind, isNext) {
    const fresh = ui.freshId === t.id ? ' fresh' : '';
    const draggable = kind === 'untimed' || kind === 'later' || kind === 'sched' || kind === 'past' || kind === 'upcoming' || kind === 'doing';
    // 오늘 시간이 정해진 일(지났든 곧이든)은 시작·미루기를 바로 쓸 수 있게
    const canSnooze = (kind === 'past' || kind === 'upcoming') && !t.done && !workingOn(t) && !!taskStart(t);
    return `<div class="trow${t.done ? ' done' : ''}${workingOn(t) ? ' working' : ''}${fresh}" data-act="open" data-id="${t.id}" ${draggable ? 'data-drag="row"' : ''} data-kind="${kind}">
        ${timeCol(t, kind, isNext)}
        <div class="cc"><button class="cb${t.done ? ' on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="${t.done ? '미완료로 바꾸기' : '완료'}">${icon('check', 14)}</button></div>
        <div class="tb"><div class="tt">${titleHtml(t)}</div>${metaHtml(t, kind)}</div>
        <div class="ra">
          ${
            canSnooze
              ? `<button class="rplay" data-act="work-go" data-id="${t.id}" title="지금 작업 시작" aria-label="작업 시작">${icon('play', 15)}</button><button class="rsnz${ui.snooze === t.id ? ' on' : ''}" data-act="snooze-open" data-id="${t.id}" title="미루기" aria-label="미루기">${icon('snooze', 17)}</button>`
              : !t.done && !t.repeat && !t.seriesId && !workingOn(t)
                ? `<button class="rplay" data-act="work" data-id="${t.id}" title="작업 시작 · 완료 전이라도 타임라인에 남아요" aria-label="작업 시작">${icon('play', 15)}</button>`
                : ''
          }
          <button class="rdel" data-act="row-delete" data-id="${t.id}" title="${t.seriesId ? '이번 회차 삭제' : '삭제'}" aria-label="삭제">${icon('trash', 16)}</button>
          ${draggable ? `<span class="grip">${icon('grip', 16)}</span>` : ''}
        </div>
      </div>${ui.prompt && ui.prompt.id === t.id ? promptHtml(t) : ''}${ui.snooze === t.id && canSnooze ? snoozeHtml(t) : ''}`;
  }
  // 미루기: 지금(또는 원래 시작 중 늦은 쪽)부터 N분 뒤로. 길이는 그대로
  const SNOOZES = [[30, '30분 뒤'], [60, '1시간 뒤'], [120, '2시간 뒤']];
  function snoozeTarget(t, mins) {
    const s = taskStart(t);
    const n = now();
    const base = new Date(Math.ceil(Math.max(n.getTime(), s ? s.getTime() : 0) / 300000) * 300000);
    return new Date(base.getTime() + mins * 60000);
  }
  function snoozeHtml(t) {
    return `<div class="trow-x"><div></div><div class="cc"></div>
      <div class="prompt snz" data-nodrag>
        <div class="pr-pills">
          ${SNOOZES.map(([m, l]) => `<button class="pill" data-act="snooze" data-id="${t.id}" data-val="${m}">${l} <small>${fmtHM(snoozeTarget(t, m))}</small></button>`).join('')}
          <button class="pill" data-act="snooze" data-id="${t.id}" data-val="tomorrow">내일</button>
          <span class="grow"></span><button class="txt" data-act="snooze-open" data-id="${t.id}">닫기</button>
        </div>
      </div></div>`;
  }
  function snoozeTask(t0, mins) {
    if (mins === 'tomorrow') return moveToTomorrow(t0);
    const t = t0.seriesId ? detach(t0) : t0;
    const s = taskStart(t);
    if (!s) return t;
    const e = taskEnd(t);
    const ns = snoozeTarget(t, mins);
    t.date = dateKey(ns);
    t.start = fmtHM(ns);
    if (t.end && e) {
      const ne = new Date(ns.getTime() + (e - s));
      t.end = fmtHM(ne);
    }
    if (ui.prompt && ui.prompt.id === t0.id) ui.prompt = null;
    return t;
  }
  function nowLine() {
    return `<div class="nowline"><span class="nowpill">${fmtHM(now())}</span><i></i></div>`;
  }
  function collapsible(key, label, count, open, body) {
    return `<button class="fold" data-act="fold" data-val="${key}">${label} ${count}${icon(open ? 'chevDown' : 'chevRight', 16)}</button>${open ? body : ''}`;
  }
  function listHtml(mode) {
    const L = listSections();
    let h = '';
    if (L.openCount === 0 && L.later.length === 0 && !L.doing.length) {
      if (L.doneToday.length) {
        h += `<div class="empty"><span class="ok">${icon('check', 26)}</span><b>오늘 할 일을 모두 끝냈어요</b><span>완료 ${L.doneToday.length}개</span></div>`;
      } else {
        h += `<div class="empty"><b>할 일을 입력해 보세요</b><span>1시30분 Tech Week</span><span>내일 10:00 회의 #프로젝트</span><span>금요일까지 보고서</span></div>`;
      }
    }
    if (L.doing.length) {
      h += `<div class="sec-label first">작업 중</div><div class="tl-list doing">${L.doing.map((t) => rowHtml(t, 'doing')).join('')}</div>`;
    }
    if (L.untimed.length || L.past.length || L.upcoming.length) {
      const movable = [...L.untimed, ...L.past, ...L.upcoming].filter((t) => !t.seriesId && !t.repeat && t.date && t.date <= todayKey());
      h += `<div class="sec-label">할 일${movable.length > 1 ? `<button class="sec-act" data-act="all-tomorrow">오늘 남은 ${movable.length}개 내일로</button>` : ''}</div>`;
      // 시간 없는 할 일이 먼저, 오늘 시간이 정해진 일은 그 아래 현재 시각 선과 함께
      if (L.untimed.length) h += `<div class="tl-list" data-untimed>${L.untimed.map((t) => rowHtml(t, 'untimed')).join('')}</div>`;
      if (L.past.length || L.upcoming.length) {
        h += '<div class="tl-list timed">';
        L.past.forEach((t) => (h += rowHtml(t, 'past')));
        h += nowLine();
        L.upcoming.forEach((t, i) => (h += rowHtml(t, 'upcoming', i === 0)));
        h += '</div>';
      }
    }
    if (L.later.length) {
      // 날짜별로 묶고, 줄마다 날짜를 반복하지 않는다(시간만)
      const groups = new Map();
      L.later.forEach((t) => {
        const k = t.date || t.due.date;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      });
      h += '<div class="sec-label">일정</div><div class="tl-list sched">';
      for (const [k, list] of groups) {
        const d = fromKey(k);
        const diff = Math.round((d - startOfDay(now())) / 864e5);
        const word = { 1: '내일', 2: '모레' }[diff];
        h += `<div class="day-h${d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : ''}">${word ? `<em>${word}</em>` : ''}<b>${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일</b><span>${list.length}개</span></div>`;
        h += list.map((t) => rowHtml(t, 'sched')).join('');
      }
      h += '</div>';
    }
    if (L.doneToday.length) {
      h += collapsible('done', '완료', L.doneToday.length, ui.showDone, `<div class="tl-list">${L.doneToday.map((t) => rowHtml(t, 'done')).join('')}</div>`);
    }
    return h;
  }
  function draftProjChip() {
    const p = proj(ui.draftProject);
    if (!p) return '';
    return `<span class="qi-pj" style="--c:${pColor(p)}"><i></i>${esc(p.name)}<button type="button" data-act="qi-pj-clear" aria-label="프로젝트 빼기">${icon('x', 11)}</button></span>`;
  }
  /* '#' 프로젝트 자동완성 */
  const hashState = { open: false, q: '', start: -1, sel: 0, items: [] };
  function hashItems(q) {
    const k = q.trim().toLowerCase();
    const list = S.projects.filter((p) => !k || p.name.toLowerCase().includes(k) || projectKeywords(p).some((w) => w.toLowerCase().startsWith(k)));
    list.sort((a, b) => (a.name.toLowerCase().startsWith(k) ? 0 : 1) - (b.name.toLowerCase().startsWith(k) ? 0 : 1));
    const items = list.slice(0, 6).map((p) => ({ id: p.id, name: p.name, color: pColor(p) }));
    if (k && !S.projects.some((p) => p.name.toLowerCase() === k)) items.push({ create: q.trim() });
    return items;
  }
  function closeHash() {
    hashState.open = false;
    document.querySelectorAll('.qi-menu').forEach((m) => m.remove());
  }
  function updateHash(input) {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const m = /(^|\s)#([^#\n]{0,24})$/.exec(before);
    if (!m) return closeHash();
    const q = m[2];
    // 띄어쓰기는 그 이름으로 시작하는 프로젝트가 있을 때만 이어서 본다
    if (/\s/.test(q) && !S.projects.some((p) => p.name.toLowerCase().startsWith(q.toLowerCase()))) return closeHash();
    const items = hashItems(q);
    if (!items.length) return closeHash();
    const reset = !hashState.open || hashState.q !== q;
    Object.assign(hashState, { open: true, q, start: pos - q.length - 1, items, sel: reset ? 0 : Math.min(hashState.sel, items.length - 1) });
    const form = input.closest('.qi');
    let menu = form.querySelector('.qi-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'qi-menu';
      form.appendChild(menu);
    }
    menu.innerHTML = items
      .map((it, i) =>
        it.create
          ? `<button type="button" class="qm-item${i === hashState.sel ? ' on' : ''}" data-hash="${i}">${icon('plus', 14)}<span>"${esc(it.create)}" 새 프로젝트 만들기</span></button>`
          : `<button type="button" class="qm-item${i === hashState.sel ? ' on' : ''}" data-hash="${i}"><i style="--c:${it.color}"></i><span>${esc(it.name)}</span></button>`,
      )
      .join('') + '<p class="qm-hint">↑↓ 고르기 · Enter 선택 · Esc 닫기</p>';
  }
  function pickHash(i, input) {
    const it = hashState.items[i];
    if (!it) return;
    let pid = it.id;
    if (it.create) {
      const p = { id: uid(), name: it.create, color: nextColor() };
      S.projects.push(p);
      pid = p.id;
    }
    const pos = input.selectionStart ?? input.value.length;
    const v = input.value;
    const start = hashState.start;
    const left = v.slice(0, start).replace(/\s+$/, '');
    const right = v.slice(pos).replace(/^\s+/, '');
    const next = left ? `${left} ${right}` : right;
    const caret = left ? left.length + 1 : 0;
    ui.draft = next;
    ui.draftProject = pid;
    closeHash();
    commit();
    const q = document.querySelector('.qi-input');
    if (q) {
      q.focus();
      q.setSelectionRange(caret, caret);
    }
    updateHints();
  }
  function quickInput(mode) {
    return `<form class="qi" data-form="quick">
        <div class="qi-hint" data-hint></div>
        <div class="qi-box">
          ${draftProjChip()}
          <input data-keep="quick-${mode}" class="qi-input" autocomplete="off" spellcheck="false" placeholder="${ui.draftProject ? '할 일 입력' : '할 일 입력 · #으로 프로젝트 고르기'}" value="${esc(ui.draft)}">
          <button class="qi-clear${ui.draft || ui.draftProject ? ' on' : ''}" type="button" data-act="qi-clear" data-keepfocus title="지우기" aria-label="입력 지우기">${icon('x', 14)}</button>
          <button class="send" type="submit" aria-label="추가">${icon('up', 20)}</button>
        </div>
      </form>`;
  }
  /* 프로젝트 자동 연결: 할 일 문장에 프로젝트 이름(또는 첫 단어, 직접 넣은 단어)이 있으면 그 프로젝트로 */
  function projectKeywords(p) {
    const kws = new Set([p.name]);
    const first = p.name.split(/\s+/)[0];
    if (first && first !== p.name && first.length >= 2) kws.add(first);
    (p.keywords || []).forEach((k) => k.trim() && kws.add(k.trim()));
    return [...kws];
  }
  // "#모바일"처럼 쓴 이름으로 기존 프로젝트(모바일앱) 찾기: 같은 이름 → 첫 단어·자동 연결 단어 → 그 글자로 시작하는 프로젝트가 하나뿐일 때.
  // 못 찾을 때만 새 프로젝트를 만든다.
  function findProjectByTag(name) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return null;
    let p = S.projects.find((x) => x.name.toLowerCase() === n);
    if (p) return p;
    p = S.projects.find((x) => projectKeywords(x).some((k) => k.toLowerCase() === n));
    if (p) return p;
    const starts = S.projects.filter((x) => x.name.toLowerCase().replace(/\s+/g, '').startsWith(n.replace(/\s+/g, '')));
    return starts.length === 1 ? starts[0] : null;
  }
  function matchProject(text) {
    const low = text.toLowerCase();
    const word = (c) => !!c && /[a-z0-9]/.test(c);
    let best = null;
    let bestLen = 0;
    for (const p of S.projects) {
      for (const kw of projectKeywords(p)) {
        const k = kw.toLowerCase();
        if (!k || k.length <= bestLen) continue;
        for (let i = low.indexOf(k); i >= 0; i = low.indexOf(k, i + 1)) {
          const badStart = word(k[0]) && word(low[i - 1]);
          const badEnd = word(k[k.length - 1]) && word(low[i + k.length]);
          if (!badStart && !badEnd) {
            best = p;
            bestLen = k.length;
            break;
          }
        }
      }
    }
    return best;
  }
  function hintText(v) {
    if (!v.trim()) return '';
    const r = P.parse(v, now(), S.settings);
    const bits = [];
    if (r.repeat) bits.push(`<b>${P.repeatLabel(r.repeat, r.date)}${r.start ? ' ' + r.start : ''}${r.end ? ' – ' + r.end : ''} 반복</b> · 첫 회차 ${relDayFull(r.date)}`);
    else if (r.date) bits.push(`<b>${relDayFull(r.date)}${r.start ? ' ' + r.start : ''}${r.end ? ' – ' + r.end : ''}</b>`);
    if (r.due) bits.push(`마감 <b>${relDayFull(r.due.date)}${r.due.time ? ' ' + r.due.time : ''}까지</b>`);
    if (ui.draftProject && proj(ui.draftProject)) {
      /* 칩으로 고른 프로젝트가 우선 — 따로 안내하지 않는다 */
    } else if (hashState.open) {
      /* 고르는 중 */
    } else if (r.project) {
      const tp = findProjectByTag(r.project);
      bits.push(tp ? `<span class="pj"><i style="--c:${pColor(tp)}"></i>${esc(tp.name)}</span> 프로젝트로` : `#${esc(r.project)} (새 프로젝트)`);
    } else {
      // 문장 속 단어로 자동 연결된 프로젝트: [빼기]로 이번 입력만 연결하지 않을 수 있다
      const mp = matchProject(v);
      if (mp && !ui.noAutoPj) {
        bits.push(`<span class="pj"><i style="--c:${pColor(mp)}"></i>${esc(mp.name)}</span> 프로젝트로<button type="button" class="hint-btn" data-act="qi-auto" data-val="off" data-keepfocus title="이번 할 일은 이 프로젝트에 넣지 않기" aria-label="프로젝트 빼기">${icon('x', 12)}</button>`);
      } else if (mp) {
        const fp = S.prefs.filter !== 'all' && S.prefs.filter !== 'none' ? proj(S.prefs.filter) : null;
        bits.push(`<span class="pj off"><i style="--c:${pColor(mp)}"></i>${esc(mp.name)}</span><button type="button" class="hint-btn" data-act="qi-auto" data-val="on" data-keepfocus title="${esc(mp.name)} 프로젝트로 다시 넣기" aria-label="되돌리기">${icon('undo', 12)}</button>${fp ? ` · <span class="pj"><i style="--c:${pColor(fp)}"></i>${esc(fp.name)}</span> 프로젝트로` : ''}`);
      }
    }
    if (!bits.length) return '';
    let why = '';
    if (r.rule === 'work') why = ' · 업무시간 기준';
    if (r.rule === 'nearest') why = ' · 지금 이후 가장 가까운 시각';
    return bits.join(' · ') + why;
  }
  // 작은 창 프로젝트 칩: 보던 가로 위치 유지, 고른 칩은 보이게, 넘칠 때만 양 끝 화살표
  function chipNavState(sc) {
    const w = sc && sc.closest('[data-chipwrap]');
    if (!w) return;
    w.classList.toggle('can-l', sc.scrollLeft > 2);
    w.classList.toggle('can-r', sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2);
  }
  function syncChips() {
    const sc = document.querySelector('[data-chips]');
    if (!sc) return;
    if (ui.chipsX != null) sc.scrollLeft = ui.chipsX;
    const on = sc.querySelector('.chip.on');
    if (on && ui.chipsReveal) {
      const a = on.offsetLeft - 44;
      const b = on.offsetLeft + on.offsetWidth + 44 - sc.clientWidth;
      if (sc.scrollLeft > a) sc.scrollLeft = Math.max(0, a);
      else if (sc.scrollLeft < b) sc.scrollLeft = b;
    }
    ui.chipsReveal = false;
    chipNavState(sc);
    if (!sc.clientWidth) requestAnimationFrame(() => sc.isConnected && chipNavState(sc));
  }
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.matches && e.target.matches('[data-chips]')) {
      ui.chipsX = e.target.scrollLeft;
      chipNavState(e.target);
    }
  }, true);
  // 입력 중에 누르는 작은 버튼(미리보기의 [빼기] 등)은 입력칸 커서를 뺏지 않는다
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('[data-keepfocus]')) e.preventDefault();
  });
  // 칩 위에서 마우스 휠을 굴리면 옆으로
  document.addEventListener('wheel', (e) => {
    const sc = e.target.closest && e.target.closest('[data-chips]');
    if (!sc || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (sc.scrollWidth <= sc.clientWidth) return;
    sc.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('resize', () => chipNavState(document.querySelector('[data-chips]')));
  function updateHints() {
    document.querySelectorAll('[data-hint]').forEach((el) => {
      const h = hintText(ui.draft);
      el.innerHTML = h;
      el.classList.toggle('on', !!h);
    });
  }
  function snackHtml() {
    if (!ui.snack || ui.snack.until < Date.now()) return '';
    return `<div class="snack"><span>${esc(ui.snack.msg)}</span>${ui.snack.undo ? '<button data-act="undo">되돌리기</button>' : ''}</div>`;
  }
  function snack(msg, extra) {
    ui.snack = Object.assign({ msg, until: Date.now() + (extra && extra.undo ? 5000 : 3200) }, extra || {});
    const until = ui.snack.until;
    setTimeout(() => {
      if (ui.snack && ui.snack.until === until) {
        ui.snack = null;
        render();
      }
    }, until - Date.now() + 30);
  }

  /* ---------- 작은 메모창 ---------- */
  function renderMini() {
    const n = now();
    const L = listSections();
    const pos = S.prefs.miniPos;
    const style = pos ? `left:${pos.x}px;top:${pos.y}px` : 'right:48px;top:40px';
    const chips = [
      `<button class="chip${S.prefs.filter === 'all' ? ' on' : ''}" data-act="filter" data-val="all">전체</button>`,
      ...S.projects.map(
        (p) =>
          `<button class="chip${S.prefs.filter === p.id ? ' on' : ''}" data-act="filter" data-val="${p.id}" data-drop-project="${p.id}" data-edit-project="${p.id}" data-drag="proj" data-id="${p.id}" title="끌어서 순서 바꾸기 · 우클릭: 프로젝트 편집" style="--c:${pColor(p)}"><i class="cdot"></i>${esc(p.name)}</button>`,
      ),
      '<button class="chip add" data-act="add-project" aria-label="프로젝트 추가">' + icon('plus', 16) + '</button>',
    ].join('');
    return `<div class="${APP ? 'app-root' : 'desktop'}">
      ${APP ? '' : '<div class="desk-note">바탕화면에 띄운 작은 메모창 · 위쪽 막대를 잡고 옮길 수 있어요</div>'}
      <div class="win mini${S.prefs.pinned ? ' pinned' : ''}" ${APP ? '' : `style="${style}"`}>
        <div class="wbar" ${APP ? '' : 'data-drag="window"'}>
          <span class="wlogo"><i></i>Dayline</span><span class="grow"></span>
          <button class="wb" data-act="win-hide" data-val="min" title="최소화">${icon('minus', 14)}</button>
          <button class="wb" data-act="win-hide" data-val="close" title="닫기">${icon('x', 14)}</button>
        </div>
        <div class="mini-body">
          <header class="m-head">
            <div><h1>오늘</h1><p>${dayLong(n)} · ${L.openCount}개 남음</p></div>
            <div class="icons">
              ${bellBtn()}
              <button class="ibtn${S.prefs.pinned ? ' on' : ''}" data-act="pin" title="항상 위에 고정">${icon('pin')}</button>
              <button class="ibtn" data-act="mode" data-val="big" title="큰 화면으로 (보던 목록·타임라인 그대로)">${icon('expand')}</button>
              <button class="ibtn" data-act="settings" title="설정">${icon('settings')}</button>
            </div>
          </header>
          <div class="chips-wrap" data-chipwrap>
            <button class="chips-nav prev" data-act="chips-nav" data-val="-1" aria-label="앞 프로젝트" tabindex="-1"><span>${icon('chevLeft', 16)}</span></button>
            <div class="chips" data-chips>${chips}</div>
            <button class="chips-nav next" data-act="chips-nav" data-val="1" aria-label="다음 프로젝트" tabindex="-1"><span>${icon('chevRight', 16)}</span></button>
          </div>
          ${banners()}
          <div class="m-scroll" data-scroll="mini-list">${listHtml('mini')}</div>
          ${snackHtml()}
          ${quickInput('mini')}
        </div>
        ${overlays()}
      </div>
    </div>`;
  }

  /* ---------- 큰 앱 ---------- */
  function sidebar() {
    const f = S.prefs.filter;
    const item = (val, label, count, extra) =>
      `<button class="sitem${f === val ? ' on' : ''}" data-act="filter" data-val="${val}" ${extra || ''}>${label}<span class="cnt">${count}</span></button>`;
    const st = statusInfo();
    return `<aside class="side">
      <nav>
        <div class="side-label top"><span>프로젝트</span><button class="txt acc" data-act="add-project">+ 프로젝트</button></div>
        ${item('all', `<i class="dot all"></i><span class="nm">전체</span>`, openCountFor('all'))}
        ${S.projects
          .map((p) =>
            item(
              p.id,
              `<i class="dot" style="--c:${pColor(p)}" data-act="edit-project" data-id="${p.id}" title="색·이름 바꾸기"></i><span class="nm">${esc(p.name)}</span><span class="edit" data-act="edit-project" data-id="${p.id}" title="편집">${icon('pencil', 14)}</span>`,
              openCountFor(p.id),
              `data-drop-project="${p.id}" data-edit-project="${p.id}" data-drag="proj" data-id="${p.id}"`,
            ),
          )
          .join('')}
        ${item('none', `<i class="dot none"></i><span class="nm">미지정</span>`, openCountFor('none'), 'data-drop-project=""')}
      </nav>
      ${S.prefs.view === 'timeline' ? unschedHtml() : ''}
      <button class="side-status ${st.cls}" data-act="settings"><i></i>${st.text}</button>
    </aside>`;
  }
  function renderBig() {
    const isList = S.prefs.view === 'list';
    return `<div class="win big">
      <div class="topbar">
        <div class="logo"><i></i>Dayline</div>
        <div class="seg">
          <button class="${isList ? 'on' : ''}" data-act="view" data-val="list">목록</button>
          <button class="${!isList ? 'on' : ''}" data-act="view" data-val="timeline">타임라인</button>
        </div>
        <span class="grow"></span>
        ${bellBtn()}
        <button class="ibtn" data-act="mode" data-val="mini" title="작은 메모창으로" aria-label="작은 메모창으로">${icon('mini')}</button>
        ${isList ? `<button class="ibtn cal-tg${S.prefs.cal ? ' on' : ''}" data-act="cal-toggle" title="달력 ${S.prefs.cal ? '닫기' : '열기'}" aria-label="달력">${icon('calendar')}</button>` : ''}
        <button class="ibtn" data-act="settings" title="설정" aria-label="설정">${icon('settings')}</button>
        <div class="wbtns">
          <button class="wb" data-act="win-hide" data-val="min" title="최소화">${icon('minus', 14)}</button>
          <button class="wb" title="최대화" ${APP ? 'data-act="win-max"' : 'disabled'}>${icon('square', 13)}</button>
          <button class="wb close" data-act="win-hide" data-val="close" title="닫기">${icon('x', 14)}</button>
        </div>
      </div>
      <div class="big-main">
        ${sidebar()}
        <main class="main ${isList ? 'is-list' : 'is-tl'}">${isList ? bigList() : timelineHtml()}</main>
        ${isList && S.prefs.cal ? calPaneHtml() : ''}
      </div>
      ${snackHtml()}
      ${overlays()}
    </div>`;
  }
  function bigList() {
    const n = now();
    const L = listSections();
    const f = S.prefs.filter;
    const title = f === 'all' ? '오늘' : f === 'none' ? '미지정' : esc((proj(f) || {}).name || '오늘');
    return `<div class="scroll" data-scroll="big-list"><div class="col">
      <header class="b-head"><h1>${title}</h1><span>${dayLong(n)} · ${L.openCount}개 남음</span></header>
      ${quickInput('big')}
      ${banners()}
      ${listHtml('big')}
    </div></div>`;
  }

  /* ---------- 타임라인 ---------- */
  function intervalOf(t) {
    if (t.done && t.sessions && t.sessions.length) return null; // 작업 기록 블록으로 대신 보여준다
    if (t.done) {
      const da = t.doneAt ? new Date(t.doneAt) : null;
      let s = taskStart(t);
      let e = taskEnd(t);
      if (!s) {
        // 시간 없이 완료한 일: 완료한 그 시각에 작은 표시로(가짜 시작 시각을 만들지 않는다)
        if (!da) return null;
        return { s: da, e: new Date(da.getTime() + 15 * 60000), kind: 'done', point: true };
      } else if (!e) {
        // 완료하면서 시작 시간이 자동으로 들어간 일(끝 없음): 그 시각에 '완료'로만 보인다
        if (da && Math.abs(da - s) < 120000) return { s, e: new Date(s.getTime() + 15 * 60000), kind: 'done', point: true };
        e = da && da > s ? da : new Date(s.getTime() + 15 * 60000);
        if (e - s > 8 * 3600000) e = new Date(s.getTime() + 60 * 60000); // 완료를 아주 늦게 누른 경우
      }
      if (e - s < 15 * 60000) e = new Date(s.getTime() + 15 * 60000);
      return { s, e, kind: 'done' };
    }
    const s = taskStart(t);
    if (!s) return null;
    const e = taskEnd(t);
    return { s, e: e || new Date(s.getTime() + 30 * 60000), kind: 'plan', open: !e };
  }
  function weekDays(anchor) {
    const s = addDays(startOfDay(anchor), -anchor.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  function blocksFor(days) {
    const out = {};
    days.forEach((d) => (out[dateKey(d)] = []));
    const n = now();
    for (const t of expandRange(addDays(days[0], -1), addDays(days[days.length - 1], 1))) {
      if (!matchesFilter(t)) continue;
      const iv = intervalOf(t);
      if (!iv) continue;
      for (const d of days) {
        const ds = startOfDay(d);
        const de = addDays(ds, 1);
        if (iv.e <= ds || iv.s >= de) continue;
        const sMin = (Math.max(iv.s, ds) - ds) / 60000;
        const eMin = (Math.min(iv.e, de) - ds) / 60000;
        out[dateKey(d)].push({
          t, kind: iv.kind, open: iv.open, sMin, eMin, iv,
          contPrev: iv.s < ds, contNext: iv.e > de,
          overdue: iv.kind === 'plan' && isOverdue(t), now: n,
        });
      }
    }
    for (const t of S.tasks) {
      if (!t.sessions || !t.sessions.length || !matchesFilter(t)) continue;
      for (const w of t.sessions) {
        const s = new Date(w.s);
        let e = w.e ? new Date(w.e) : n;
        if (e - s < 15 * 60000) e = new Date(s.getTime() + 15 * 60000);
        const iv = { s, e, kind: 'work' };
        for (const d of days) {
          const ds = startOfDay(d);
          const de = addDays(ds, 1);
          if (e <= ds || s >= de) continue;
          out[dateKey(d)].push({
            t, kind: 'work', sid: w.id, live: !w.e, iv,
            sMin: (Math.max(s, ds) - ds) / 60000, eMin: (Math.min(e, de) - ds) / 60000,
            contPrev: s < ds, contNext: e > de, now: n,
          });
        }
      }
    }
    // 겹치는 블록은 나란히. 단, 같은 할 일의 '예정' 위에 겹친 작업 기록은 옆으로 나누지 않고 그 위에 겹쳐 그린다.
    for (const key of Object.keys(out)) {
      const all = out[key];
      const ovl = (a, b) => a.sMin < Math.max(b.eMin, b.sMin + 30) && b.sMin < Math.max(a.eMin, a.sMin + 30);
      const overlays = all.filter((b) => b.kind === 'work' && all.some((x) => x.kind === 'plan' && x.t.id === b.t.id && ovl(x, b)));
      const items = all.filter((b) => !overlays.includes(b)).sort((a, b) => a.sMin - b.sMin || b.eMin - a.eMin);
      let cluster = [];
      let colsEnd = [];
      let clusterEnd = -1;
      const flush = () => {
        cluster.forEach((b) => (b.cols = colsEnd.length));
        cluster = [];
        colsEnd = [];
        clusterEnd = -1;
      };
      for (const b of items) {
        const visEnd = Math.max(b.eMin, b.sMin + (22 / HOUR) * 60); // 화면에 그려지는 최소 높이만큼
        if (cluster.length && b.sMin >= clusterEnd) flush();
        let ci = colsEnd.findIndex((e) => e <= b.sMin);
        if (ci < 0) {
          ci = colsEnd.length;
          colsEnd.push(visEnd);
        } else colsEnd[ci] = visEnd;
        b.col = ci;
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, visEnd);
      }
      flush();
      for (const b of overlays) {
        const host = items.find((x) => x.kind === 'plan' && x.t.id === b.t.id && ovl(x, b));
        b.col = host.col;
        b.cols = host.cols;
        b.overlay = true;
      }
      out[key] = items.concat(overlays); // 겹쳐 그리는 블록이 위로 오도록 마지막에
    }
    return out;
  }
  function blockHtml(b, dayKeyStr) {
    const t = b.t;
    const p = proj(t.projectId);
    const c = b.overdue ? '#F04452' : pColor(p);
    const top = (b.sMin / 60) * HOUR;
    const height = Math.max(20, ((b.eMin - b.sMin) / 60) * HOUR - 2);
    const left = (b.col / b.cols) * 100;
    const width = 100 / b.cols;
    let label;
    if (b.live) label = `${b.contPrev ? '전날' : fmtHM(b.iv.s)} – 지금 · 작업 중`;
    else if (b.iv.point) label = fmtHM(b.iv.s); // 시간 없이 완료한 일: 완료한 시각만
    else if (b.kind === 'plan' && b.open) label = fmtHM(b.iv.s);
    else if (b.contNext) label = `${fmtHM(b.iv.s)} – 다음 날 ${fmtHM(b.iv.e)}`;
    else if (b.contPrev) label = `전날부터 – ${fmtHM(b.iv.e)}`;
    else label = `${fmtHM(b.iv.s)} – ${fmtHM(b.iv.e)}`;
    const small = height < 38 ? ' sm' : '';
    const narrow = b.cols > 1 && S.prefs.tlMode === 'week' ? ' narrow' : '';
    // 블록 높이에 맞춰 제목을 여러 줄로(좁은 블록은 시간 줄 대신 제목만)
    const fit = Math.max(1, Math.floor((height - 6) / 16));
    const titleLines = narrow ? fit : fit >= 3 ? fit - 1 : 1;
    const canResize = !b.contPrev && !b.contNext && !b.live;
    const cls = b.kind === 'work' ? `done work${b.live ? ' live' : ''}` : b.kind;
    const lead = b.kind === 'work' ? (t.done && !b.live ? icon('check', 12, 'bc') : icon('play', 11, 'bc bplay')) : t.done ? icon('check', 12, 'bc') : '';
    return `<div class="blk ${cls}${b.overdue ? ' overdue' : ''}${small}${narrow}${b.overlay ? ' over' : ''}" title="${esc(plainTitle(t))} · ${esc(label)}${p ? ' · ' + esc(p.name) : ''}" style="--c:${c};--lines:${titleLines};--h:${height}px;top:${top}px;height:${height}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)"
        data-act="open" data-id="${t.id}" data-drag="block" data-day="${dayKeyStr}" data-smin="${b.sMin}" data-emin="${b.eMin}"${b.sid ? ` data-sid="${b.sid}"` : ''}>
        <div class="bt">${lead}<span>${esc(plainTitle(t))}</span>${t.repeat ? icon('repeat', 11, 'brep') : ''}</div>
        <div class="bm">${label}${p ? `<span class="bpj"> · ${esc(p.name)}</span>` : ''}</div>
        ${canResize ? `<div class="rz" data-drag="resize" data-id="${t.id}"></div>` : ''}
      </div>`;
  }
  // 타임라인 빈 곳을 끌어서 만든 칸에 할 일 이름을 넣는 작은 창
  // 끌어 만드는 칸에 쓴 글로 어느 프로젝트에 들어갈지(#이름, 자동 연결, 보고 있는 프로젝트 순)
  function qnProjectHtml(text) {
    const v = (text || '').trim();
    if (!v) return '';
    const r = P.parse(v, now(), S.settings);
    let p = null;
    let isNew = false;
    if (r.project) {
      p = findProjectByTag(r.project);
      if (!p) isNew = true;
    } else p = matchProject(v) || (S.prefs.filter !== 'all' && S.prefs.filter !== 'none' ? proj(S.prefs.filter) : null);
    if (isNew) return `#${esc(r.project)} (새 프로젝트)`;
    return p ? `<span class="pj"><i style="--c:${pColor(p)}"></i>${esc(p.name)}</span> 프로젝트로` : '';
  }
  function quickNewHtml(q, right) {
    const top = (q.sMin / 60) * HOUR;
    const height = Math.max(20, ((q.eMin - q.sMin) / 60) * HOUR - 2);
    const label = `${minToHM(q.sMin)} – ${q.eMin >= 1440 ? '다음 날 ' : ''}${minToHM(q.eMin % 1440)} · ${durText(q.eMin - q.sMin)}`;
    return `<div class="tl-draft" style="top:${top}px;height:${height}px"></div>
      <div class="qn${right ? ' right' : ''}" style="top:${top + Math.min(height, 60) + 4}px" data-nodrag>
        <div class="qn-time">${label}</div>
        <input class="qn-input" data-qn data-keep="tl-new" placeholder="무엇을 했나요 / 할 건가요?" value="${esc(q.text || '')}" autocomplete="off" spellcheck="false">
        <div class="qn-pj" data-qn-pj>${qnProjectHtml(q.text)}</div>
        <div class="qn-foot">
          ${q.past ? `<button type="button" class="pill${q.done ? ' on' : ''}" data-act="qn-done">${icon('check', 12)}한 일로 완료</button>` : ''}
          <span class="grow"></span>
          <button type="button" class="btn ghost sm" data-act="qn-cancel">취소</button>
          <button type="button" class="btn primary sm" data-act="qn-save">추가</button>
        </div>
      </div>`;
  }
  // 내일로 미루기: 날짜만 내일로(시간·알림·프로젝트는 그대로). 반복 회차는 이번 회차만 떼어서.
  function moveToTomorrow(t0) {
    const t = t0.seriesId ? detach(t0) : t0;
    if (workingOn(t)) stopWork(t);
    t.date = dateKey(addDays(startOfDay(now()), 1));
    if (ui.prompt && ui.prompt.id === t0.id) ui.prompt = null;
    return t;
  }
  function saveQuickNew() {
    const q = ui.quickNew;
    if (!q) return;
    const text = (q.text || '').trim();
    if (!text) {
      snack('이름을 입력해 주세요');
      return render();
    }
    const t = createTask(text, { noFilter: false });
    if (!t) return;
    // 문장 속 날짜·시간보다 끌어서 고른 칸이 우선
    t.date = q.day;
    t.start = minToHM(q.sMin);
    t.end = minToHM(q.eMin % 1440);
    t.duration = null;
    if (t.repeat) {
      delete t.repeat;
      delete t.doneDates;
      delete t.skipDates;
    }
    if (q.past && q.done) {
      t.done = true;
      t.doneAt = new Date(fromKey(q.day).getTime() + q.eMin * 60000).toISOString();
    }
    ui.quickNew = null;
    snack(t.done ? `${minToHM(q.sMin)}–${minToHM(q.eMin % 1440)} 한 일로 기록했어요` : `${relDay(q.day)} ${minToHM(q.sMin)}에 추가했어요`);
    commit();
  }
  function doneMinutesBetween(a, b) {
    let sum = 0;
    let count = 0;
    for (const t of expandRange(addDays(a, -1), b)) {
      if (!t.done || !matchesFilter(t)) continue;
      const iv = intervalOf(t);
      if (!iv) continue;
      const s = Math.max(iv.s, a);
      const e = Math.min(iv.e, b);
      if (e > s) {
        sum += (e - s) / 60000;
        if (t.doneAt && new Date(t.doneAt) >= a && new Date(t.doneAt) < b) count++;
      }
    }
    for (const t of S.tasks) {
      if (!t.sessions || !matchesFilter(t)) continue;
      sum += workMinutes(t, a, b);
      if (t.done && t.doneAt && new Date(t.doneAt) >= a && new Date(t.doneAt) < b) count++;
    }
    return { sum, count };
  }
  /* ---------- 월 보기: 날짜 칸마다 마감 · 예정(반복은 흐리게) · 한 일(프로젝트 색 점) ---------- */
  // 날짜별로 예정·마감·한 일을 모은다(월 보기와 옆 달력이 같이 쓴다)
  function collectDays(start, end) {
    const cells = {};
    for (let d = start; d <= end; d = addDays(d, 1)) cells[dateKey(d)] = { due: [], plan: [], done: new Map() };
    // 예정(반복 회차 포함)
    for (const t of expandRange(start, addDays(end, 1))) {
      if (!matchesFilter(t) || !t.date || !cells[t.date]) continue;
      if (t.done) continue;
      cells[t.date].plan.push(t);
    }
    // 마감
    for (const t of S.tasks) {
      if (t.due && !t.done && !t.repeat && cells[t.due.date] && matchesFilter(t)) cells[t.due.date].due.push(t);
    }
    // 한 일: 완료한 날 + 작업 기록이 있는 날
    const mark = (k, t) => cells[k] && cells[k].done.set(t.id.split('@')[0], t);
    for (const t of expandRange(start, addDays(end, 1))) {
      if (!matchesFilter(t) || !t.done || !t.doneAt) continue;
      mark(dateKey(new Date(t.doneAt)), t);
    }
    for (const t of S.tasks) {
      if (!t.sessions || !matchesFilter(t)) continue;
      for (const w of t.sessions) mark(dateKey(new Date(w.s)), t);
    }
    return cells;
  }
  /* ---------- 옆 달력(큰 화면 목록) ---------- */
  function calPaneHtml() {
    const T = startOfDay(now());
    const tk = dateKey(T);
    const sel = ui.calSel || tk;
    const base = ui.calMonth ? fromKey(ui.calMonth) : fromKey(sel);
    const y = base.getFullYear();
    const mo = base.getMonth();
    const first = new Date(y, mo, 1);
    const start = addDays(first, -first.getDay());
    const end = addDays(start, 41); // 늘 6주로 그려서 높이가 흔들리지 않게
    const cells = collectDays(start, end);
    const grid = Object.entries(cells)
      .map(([k, c]) => {
        const d = fromKey(k);
        const colors = [...new Set(c.plan.map((t) => pColor(proj(t.projectId))))].slice(0, 3);
        let dots = colors.map((col) => `<i style="--c:${col}"></i>`).join('');
        if (c.due.length) dots += `<i class="due"></i>`;
        if (!c.plan.length && !c.due.length && c.done.size) dots += `<i class="did"></i>`;
        const cls = ['cp-d', d.getMonth() === mo ? '' : 'out', k === tk ? 'today' : '', k === sel ? 'sel' : '', d.getDay() === 0 ? 'sun' : '', d.getDay() === 6 ? 'sat' : '']
          .filter(Boolean)
          .join(' ');
        return `<button class="${cls}" data-act="cal-pick" data-val="${k}" data-mday="${k}" title="${d.getMonth() + 1}/${d.getDate()} · 두 번 누르면 타임라인"><span>${d.getDate()}</span><em>${dots}</em></button>`;
      })
      .join('');
    // 고른 날 보기
    const sc = cells[sel] || collectDays(fromKey(sel), fromKey(sel))[sel];
    const sd = fromKey(sel);
    const startKey = (t) => t.start || '99:99';
    const rows = [
      ...sc.due.map((t) => `<button class="cp-it due${dueOver(t) ? ' red' : ''}" data-act="open" data-id="${t.id}"><b>${icon('flag', 11)}${t.due.time || '마감'}</b><span>${esc(plainTitle(t))}</span></button>`),
      ...[...sc.plan]
        .sort((a, b) => startKey(a).localeCompare(startKey(b)))
        .map((t) => `<button class="cp-it" style="--c:${pColor(proj(t.projectId))}" data-act="open" data-id="${t.id}"><b>${t.start || '–'}</b><i></i><span>${esc(plainTitle(t))}</span></button>`),
      ...[...sc.done.values()].map((t) => `<button class="cp-it did" data-act="open" data-id="${t.id}"><b>${icon(t.done ? 'check' : 'play', 11)}</b><span>${esc(plainTitle(t))}</span></button>`),
    ].join('');
    const rel = { 0: '오늘', 1: '내일', '-1': '어제' }[Math.round((sd - T) / 864e5)];
    return `<aside class="calpane">
        <div class="cp-head"><b>${y}년 ${mo + 1}월</b><span class="grow"></span>
          <button class="ibtn" data-act="cal-move" data-val="-1" aria-label="이전 달">${icon('chevLeft', 16)}</button>
          <button class="cp-today" data-act="cal-today">오늘</button>
          <button class="ibtn" data-act="cal-move" data-val="1" aria-label="다음 달">${icon('chevRight', 16)}</button></div>
        <div class="cp-week">${[...WEEK].map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
        <div class="cp-grid">${grid}</div>
        <div class="cp-day">
          <div class="cp-dh"><b>${sd.getMonth() + 1}월 ${sd.getDate()}일 (${WEEK[sd.getDay()]})</b>${rel ? `<em>${rel}</em>` : ''}<span class="grow"></span>
            <button class="txt" data-act="cal-open-day" data-val="${sel}" title="타임라인에서 이날 보기">타임라인${icon('chevRight', 12)}</button></div>
          <div class="cp-list">${rows || '<p class="cp-empty">이 날은 비어 있어요</p>'}</div>
          <input class="cp-add" data-keep="cal-add" placeholder="+ 이 날 할 일 추가" value="${esc(ui.calDraft || '')}" autocomplete="off" spellcheck="false">
        </div>
      </aside>`;
  }
  function addOnCalDay(text) {
    const day = ui.calSel || todayKey();
    const t = createTask(text, {});
    if (!t) return;
    // 문장에 날짜·마감·반복이 없으면 고른 날로
    if (!t.date && !t.due && !t.repeat) t.date = day;
    if (t.repeat && !t.date) t.date = day;
    ui.calDraft = '';
    snack(`${relDayFull(t.date || (t.due && t.due.date) || day)}에 추가했어요`);
    commit();
  }
  function monthHtml(anchor) {
    const n = now();
    const T = startOfDay(n);
    const y = anchor.getFullYear();
    const mo = anchor.getMonth();
    const first = new Date(y, mo, 1);
    const last = new Date(y, mo + 1, 0);
    const start = addDays(first, -first.getDay());
    const end = addDays(last, 6 - last.getDay());
    const weeks = Math.round((end - start) / 864e5 + 1) / 7;
    const cells = collectDays(start, end);
    const startKey = (t) => t.start || '99:99';
    let monthDone = 0;
    let monthDue = 0;
    const body = Object.entries(cells)
      .map(([k, c], idx) => {
        const d = fromKey(k);
        const inMonth = d.getMonth() === mo;
        if (inMonth) {
          monthDone += [...c.done.values()].filter((t) => t.done).length;
          monthDue += c.due.length;
        }
        c.plan.sort((a, b) => startKey(a).localeCompare(startKey(b)));
        const items = [
          ...c.due.map((t) => {
            const over = dueOver(t);
            return `<div class="mi due${over ? ' red' : ''}" data-act="open" data-id="${t.id}" data-drag="card" data-due="1" title="${esc(plainTitle(t))} · ${esc(dueText(t))}">${icon('flag', 11)}<span>${esc(plainTitle(t))}</span></div>`;
          }),
          ...c.plan.map((t) => {
            const p = proj(t.projectId);
            const rep = !!t.seriesId;
            return `<div class="mi${rep ? ' rep' : ''}${workingOn(t) ? ' doing' : ''}" style="--c:${pColor(p)}" data-act="open" data-id="${t.id}" data-drag="card" title="${esc(plainTitle(t))}${t.start ? ' · ' + t.start : ''}${rep ? ' · ' + repLabel(seriesOf(t)) : ''}"><i></i>${t.start ? `<b>${t.start}</b>` : ''}<span>${esc(plainTitle(t))}</span></div>`;
          }),
          // 한 일: 그날 완료한 일(✓)과 작업 기록만 있는 일(▶)
          ...[...c.done.values()].map((t) => {
            const p = proj(t.projectId);
            const tip = t.done ? '완료' : '작업함';
            return `<div class="mi did" style="--c:${pColor(p)}" data-act="open" data-id="${t.id}" title="${esc(plainTitle(t))} · ${tip}">${icon(t.done ? 'check' : 'play', 11)}<span>${esc(plainTitle(t))}</span></div>`;
          }),
        ];
        const MAX = 3;
        const shown = items.slice(0, MAX).join('');
        const more = items.length > MAX ? `<button class="mmore" data-act="mpop" data-val="${k}">+${items.length - MAX}</button>` : '';
        const col = d.getDay();
        const pop =
          ui.mpop === k
            ? `<div class="mpop${col >= 5 ? ' right' : ''}${idx >= (weeks - 2) * 7 ? ' up' : ''}" data-nodrag><div class="mpop-head"><button class="mpop-day" data-act="tl-day" data-val="${k}" title="이날 크게 보기">${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[col]})${icon('chevRight', 14)}</button><button class="ibtn" data-act="mpop-close" aria-label="닫기">${icon('x', 14)}</button></div><div class="mpop-list">${items.join('')}</div></div>`
            : '';
        const dotHtml = '';
        const cls = ['m-cell', inMonth ? '' : 'out', k === dateKey(T) ? 'today' : '', d.getDay() === 0 ? 'sun' : '', d < T ? 'past' : ''].join(' ').trim();
        return `<div class="${cls}${ui.mpop === k ? ' popped' : ''}" data-mday="${k}"><button class="mnum" data-act="tl-day" data-val="${k}" title="이날 크게 보기">${d.getDate()}</button><div class="mlist">${shown}${more}</div>${dotHtml}${pop}</div>`;
      })
      .join('');
    return {
      sum: `<div class="tl-sum"><h1>${mo === T.getMonth() && y === T.getFullYear() ? '이번 달' : `${mo + 1}월`} 완료 ${monthDone}개</h1><span>마감 ${monthDue}개</span></div>`,
      label: `${y}년 ${mo + 1}월`,
      grid: `<div class="tl-card month">
          <div class="mo-head">${[...WEEK].map((w, i) => `<span class="${i === 0 ? 'sun' : ''}">${w}</span>`).join('')}</div>
          <div class="m-grid" style="grid-template-rows:repeat(${weeks}, minmax(0, 1fr))">${body}</div>
        </div>`,
    };
  }
  function timelineHtml() {
    const n = now();
    const anchor = S.prefs.anchor ? fromKey(S.prefs.anchor) : startOfDay(n);
    const mode = S.prefs.tlMode;
    const segs = `<div class="seg sm">
          <button class="${mode === 'day' ? 'on' : ''}" data-act="tl-mode" data-val="day">일</button>
          <button class="${mode === 'week' ? 'on' : ''}" data-act="tl-mode" data-val="week">주</button>
          <button class="${mode === 'month' ? 'on' : ''}" data-act="tl-mode" data-val="month">월</button>
        </div>`;
    if (mode === 'month') {
      const M = monthHtml(anchor);
      return `<div class="tl">
      <div class="tl-top">
        ${M.sum}
        <span class="grow"></span>
        <div class="tl-nav">
          <button class="ibtn" data-act="tl-move" data-val="-1" aria-label="이전 달">${icon('chevLeft', 18)}</button>
          <span>${M.label}</span>
          <button class="ibtn" data-act="tl-move" data-val="1" aria-label="다음 달">${icon('chevRight', 18)}</button>
        </div>
        <button class="ibtn" data-act="report-open" title="한 일 내보내기 (Markdown / CSV)" aria-label="한 일 내보내기">${icon('download', 18)}</button>
        <button class="btn line" data-act="tl-today">오늘</button>
        ${segs}
      </div>
      <div class="tl-legend"><span><i class="lg due"></i>마감</span><span><i class="lg plan"></i>예정</span><span><i class="lg rep"></i>반복</span><span><i class="lg didm"></i>한 일</span><span class="muted">날짜를 누르면 그날을 크게 보고, 할 일을 다른 날로 끌어 옮겨요</span></div>
      ${M.grid}
    </div>`;
    }
    const isWeek = S.prefs.tlMode === 'week';
    const days = isWeek ? weekDays(anchor) : [startOfDay(anchor)];
    const blocks = blocksFor(days);
    const T = startOfDay(n);
    const today = doneMinutesBetween(T, addDays(T, 1));
    const wk = weekDays(anchor);
    const week = doneMinutesBetween(wk[0], addDays(wk[6], 1));
    const rangeLabel = isWeek
      ? `${wk[0].getMonth() + 1}월 ${wk[0].getDate()}일 – ${wk[6].getMonth() + 1 !== wk[0].getMonth() + 1 ? wk[6].getMonth() + 1 + '월 ' : ''}${wk[6].getDate()}일`
      : dayShort(days[0]);
    // 주간 보기: 요일마다 사용자가 끌어서 정한 너비(비율)
    const colW = isWeek && Array.isArray(S.prefs.colW) && S.prefs.colW.length === 7 ? S.prefs.colW : null;
    const cols = colW ? `56px ${colW.map((w) => `minmax(0,${w}fr)`).join(' ')}` : `56px repeat(${days.length}, minmax(0,1fr))`;
    const hours = Array.from({ length: 23 }, (_, i) => i + 1)
      .map((h) => `<div class="hl" style="top:${h * HOUR}px">${pad(h)}:00</div>`)
      .join('');
    const nowMin = (n - T) / 60000;
    return `<div class="tl">
      <div class="tl-top">
        <div class="tl-sum"><h1>오늘 완료 ${today.count}개</h1><span>${wk.some((d) => sameDay(d, n)) ? '이번 주' : '이 주'} 완료 ${week.count}개</span></div>
        <span class="grow"></span>
        <div class="tl-nav">
          <button class="ibtn" data-act="tl-move" data-val="-1" aria-label="이전">${icon('chevLeft', 18)}</button>
          <span>${rangeLabel}</span>
          <button class="ibtn" data-act="tl-move" data-val="1" aria-label="다음">${icon('chevRight', 18)}</button>
        </div>
        <button class="ibtn" data-act="report-open" title="한 일 내보내기 (Markdown / CSV)" aria-label="한 일 내보내기">${icon('download', 18)}</button>
        <button class="btn line" data-act="tl-today">오늘</button>
        ${segs}
      </div>
      <div class="tl-legend"><span><i class="lg done"></i>한 일</span><span><i class="lg plan"></i>예정</span><span><i class="lg late"></i>지난 예정</span><span class="muted">빈 곳을 끌어 새로 만들고, 블록은 끌어 옮기거나 아래 끝으로 길이를 바꿔요</span></div>
      <div class="tl-card">
        <div class="tl-head" style="grid-template-columns:${cols}"><div></div>
          ${days
            .map((d) => {
              const it = sameDay(d, n);
              const dk = dateKey(d);
              const dues = S.tasks.filter((t) => t.due && !t.done && !t.repeat && t.due.date === dk && matchesFilter(t));
              const dueTip = dues.map((t) => plainTitle(t)).join(', ');
              const rz = isWeek && d.getDay() < 6 ? `<i class="col-rz" data-drag="colrz" data-i="${d.getDay()}" title="끌어서 너비 바꾸기 · 두 번 누르면 원래대로"></i>` : '';
              return `<div class="dh${it ? ' today' : ''}${isWeek ? ' link' : ''}" ${isWeek ? `data-act="tl-day" data-val="${dk}" title="이날 크게 보기"` : ''}>${rz}<span>${WEEK[d.getDay()]}</span><b>${d.getDate()}</b>${
                dues.length ? `<em class="dh-due${dues.some(dueOver) ? ' red' : ''}" title="${esc(dueTip)}">${icon('flag', 11)}마감 ${dues.length}</em>` : ''
              }</div>`;
            })
            .join('')}
        </div>
        <div class="tl-scroll" data-scroll="tl">
          <div class="tl-grid" style="grid-template-columns:${cols};height:${24 * HOUR}px;--hour:${HOUR}px">
            <div class="tl-hours">${hours}</div>
            ${days
              .map((d) => {
                const k = dateKey(d);
                const it = sameDay(d, n);
                return `<div class="tl-col${it ? ' today' : ''}" data-day="${k}" data-drag="create">
                  ${blocks[k].map((b) => blockHtml(b, k)).join('')}
                  ${ui.quickNew && ui.quickNew.day === k ? quickNewHtml(ui.quickNew, days.length > 1 && d.getDay() >= 5) : ''}
                  ${it ? `<div class="tl-now" style="top:${(nowMin / 60) * HOUR}px"><span>${fmtHM(n)}</span></div>` : ''}
                </div>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    </div>`;
  }
  function unschedHtml() {
    const items = S.tasks.filter((t) => !t.repeat && !t.done && !t.start && matchesFilter(t)).sort((a, b) => a.order - b.order);
    return `<div class="unsched" data-drop-unsched>
      <div class="side-label"><span>시간 미정</span><span class="cnt">${items.length}</span></div>
      ${
        items
          .map((t) => {
            const p = proj(t.projectId);
            return `<div class="ucard" data-drag="card" data-act="open" data-id="${t.id}"><i style="--c:${pColor(p)}"></i><span>${esc(plainTitle(t))}</span>${
              workingOn(t)
                ? '<small class="ws on"><i></i>작업 중</small>'
                : t.sessions && t.sessions.length && !t.done
                  ? '<small class="ws">작업 중</small>'
                  : t.date ? `<small>${relDay(t.date)}</small>` : t.due ? `<small class="${dueOver(t) ? 'red' : ''}">${dueBadge(t)}</small>` : ''
            }</div>`;
          })
          .join('') || '<p class="muted sm">시간표에 놓을 할 일이 없어요</p>'
      }
      <p class="hint">시간표로 끌어다 놓으면 일정이 되고, 블록을 여기로 끌면 시간이 지워져요</p>
    </div>`;
  }

  /* ---------- 겹쳐 뜨는 화면들 ---------- */
  function overlays() {
    let h = '';
    if (ui.sheet) h += sheetHtml();
    if (ui.sheet && ui.lightbox) h += lightboxHtml();
    if (ui.inbox) h += inboxHtml();
    if (ui.modal) h += modalHtml();
    return h;
  }
  function draftFrom(t) {
    return {
      // 상세에서도 제목만 보여준다(날짜·시간·반복·마감·#프로젝트는 아래 칸에 있으니까)
      text: shownTitle(t), origTitle: shownTitle(t), projectId: t.projectId || '', date: t.date || '', start: t.start || '',
      end: t.end || (t.start && t.duration ? minToHM((hmToMin(t.start) + t.duration) % 1440) : ''), duration: null, endMode: 'end',
      reminder: t.reminder, remCustom: null, memo: t.memo || '', done: t.done,
      images: (t.images || []).map((x) => Object.assign({}, x)),
      repeatFreq: t.repeat ? t.repeat.freq : 'none',
      repeatDays: t.repeat && t.repeat.days ? [...t.repeat.days] : [],
      due: t.due ? t.due.date : '', dueTime: t.due && t.due.time ? t.due.time : '',
    };
  }
  function draftRepeat(d) {
    if (!d.repeatFreq || d.repeatFreq === 'none') return null;
    const day = d.date ? fromKey(d.date) : startOfDay(now());
    if (d.repeatFreq === 'weekly') return { freq: 'weekly', days: d.repeatDays.length ? [...d.repeatDays] : [day.getDay()] };
    if (d.repeatFreq === 'monthly') return { freq: 'monthly', monthDay: day.getDate() };
    return { freq: d.repeatFreq };
  }
  function draftStart(d) {
    if (!d.start) return null;
    const day = d.date ? fromKey(d.date) : startOfDay(now());
    const [h, m] = d.start.split(':').map(Number);
    return at(day, h, m);
  }
  function draftDue(d) {
    return d.due ? { date: d.due, time: d.dueTime || null } : null;
  }
  function remLine(d) {
    const s0 = draftStart(d);
    const s = s0 || (d.due ? dueBase({ due: draftDue(d) }) : null);
    if (!s) return '시작 시간이나 마감을 넣으면 미리 알림을 받을 수 있어요';
    if (d.reminder == null) return '알림 없음 · 할 일과 시간만 저장돼요';
    const r = new Date(s.getTime() - d.reminder * 60000);
    let txt = `${dayShort(r)} ${fmtHM(r)}에 알려드려요`;
    if (!sameDay(r, s)) txt += s0 ? ' · 전날' : ` · 마감 ${Math.round((startOfDay(s) - startOfDay(r)) / 86400000)}일 전`;
    if (r < now()) txt += ' · 이미 지난 시각이에요';
    return txt;
  }
  function endNote(d) {
    if (d.endMode === 'end' && d.start && d.end && hmToMin(d.end) <= hmToMin(d.start)) return `다음 날 ${d.end}까지`;
    if (d.endMode === 'dur' && d.start && d.duration) {
      const e = hmToMin(d.start) + d.duration;
      return `${e >= 1440 ? '다음 날 ' : ''}${minToHM(e)}에 끝나요`;
    }
    return '';
  }
  /* ---------- 날짜·시간 선택(앱 스타일) ---------- */
  function koTime(v) {
    const [h, m] = v.split(':').map(Number);
    const ap = h < 12 ? '오전' : '오후';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${ap} ${h12}:${pad(m)}`;
  }
  function dateChipText(k) {
    const r = relDay(k);
    const d = fromKey(k);
    const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
    return r.includes('/') ? (d.getFullYear() !== now().getFullYear() ? `${d.getFullYear()}년 ${base}` : base) : `${r} · ${base}`;
  }
  function fieldChip(key, text, placeholder) {
    const open = ui.sheet.picker === key;
    return `<div class="fchip${open ? ' open' : ''}${text ? '' : ' none'}">
        <button type="button" class="fchip-main" data-act="sh-pick" data-val="${key}">${text ? esc(text) : placeholder}</button>
        ${text ? `<button type="button" class="fchip-x" data-act="sh-clear" data-val="${key}" aria-label="지우기">${icon('x', 12)}</button>` : ''}
      </div>`;
  }
  function datePicker(d, key) {
    key = key || 'date';
    const sel = d[key] || '';
    const tk = todayKey();
    const base = ui.sheet.cal ? fromKey(ui.sheet.cal) : sel ? fromKey(sel) : startOfDay(now());
    const y = base.getFullYear();
    const mo = base.getMonth();
    const first = new Date(y, mo, 1);
    const days = new Date(y, mo + 1, 0).getDate();
    const T = startOfDay(now());
    const nextMon = addDays(T, ((8 - T.getDay()) % 7) || 7);
    const fri = addDays(T, (5 - T.getDay() + 7) % 7);
    const quick =
      key === 'due'
        ? [['오늘', dateKey(T)], ['내일', dateKey(addDays(T, 1))], ['이번 주 금요일', dateKey(fri)], ['다음 주 금요일', dateKey(addDays(fri, 7))]]
        : [['오늘', dateKey(T)], ['내일', dateKey(addDays(T, 1))], ['다음 주 월요일', dateKey(nextMon)]];
    let cells = '';
    for (let i = 0; i < first.getDay(); i++) cells += '<span></span>';
    for (let n = 1; n <= days; n++) {
      const dd = new Date(y, mo, n);
      const k = dateKey(dd);
      const cls = [k === sel ? 'on' : '', k === tk ? 'today' : '', dd.getDay() === 0 ? 'sun' : ''].join(' ').trim();
      cells += `<button type="button" class="${cls}" data-act="pick-date" data-key="${key}" data-val="${k}">${n}</button>`;
    }
    return `<div class="pk" data-nodrag>
        <div class="pk-quick">${quick
          .map(([l, k]) => `<button type="button" class="pill${sel === k ? ' on' : ''}" data-act="pick-date" data-key="${key}" data-val="${k}">${l}</button>`)
          .join('')}</div>
        <div class="cal-head">
          <button type="button" class="ibtn" data-act="cal-move" data-key="${key}" data-val="-1" aria-label="이전 달">${icon('chevLeft', 18)}</button>
          <b>${y}년 ${mo + 1}월</b>
          <button type="button" class="ibtn" data-act="cal-move" data-key="${key}" data-val="1" aria-label="다음 달">${icon('chevRight', 18)}</button>
        </div>
        <div class="cal-grid">${[...WEEK].map((w, i) => `<em class="${i === 0 ? 'sun' : ''}">${w}</em>`).join('')}${cells}</div>
      </div>`;
  }
  // 시 고르기: 오전/오후 전환 없이 네 줄(새벽·오전·오후·저녁)로
  const HOUR_ROWS = [['오전', [6, 7, 8, 9, 10, 11]], ['오후', [12, 13, 14, 15, 16, 17]], ['저녁', [18, 19, 20, 21, 22, 23]], ['새벽', [0, 1, 2, 3, 4, 5]]];
  const h12 = (h) => (h % 12 === 0 ? 12 : h % 12);
  function hourGrid(selH, act, key) {
    return `<div class="hgrid">${HOUR_ROWS.map(
      ([lab, hs]) =>
        `<span class="hlab">${lab}</span>${hs
          .map((h) => `<button type="button" class="${h === selH ? 'on' : ''}" data-act="${act}" data-key="${key}" data-val="${h}">${h12(h)}</button>`)
          .join('')}`,
    ).join('')}</div>`;
  }
  function minuteGrid(selM, act, key, enabled) {
    const mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    return `<div class="tgrid">${mins
      .map((m) => `<button type="button" class="${selM === m ? 'on' : ''}" data-act="${act}" data-key="${key}" data-val="${m}" ${enabled ? '' : 'disabled'}>${pad(m)}</button>`)
      .join('')}</div>`;
  }
  function timeChipText(d) {
    if (!d.start) return '';
    if (!d.end) return koTime(d.start);
    const next = hmToMin(d.end) <= hmToMin(d.start);
    return `${koTime(d.start)} – ${next ? '다음 날 ' : ''}${koTime(d.end)}`;
  }
  // 시작 → 끝을 한 판에서 고른다. 길이 버튼으로 끝을 바로 정할 수도 있다.
  /* ---------- 시간 고르기: 칸을 누르면 15분 단위 목록, 직접 입력도 된다 ---------- */
  // "930", "9:30", "9시반", "오후 3시", "15시 20분", "3pm" → "HH:MM"
  function parseTimeText(str) {
    let t = String(str || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let mer = null;
    const mm = /^(오전|오후|아침|점심|저녁|밤|새벽|am|pm)/.exec(t) || /(am|pm|오전|오후)$/.exec(t);
    if (mm) {
      mer = mm[1];
      t = t.replace(mm[0], '');
    }
    let h;
    let m = 0;
    let lead0 = false;
    let x;
    if ((x = /^(\d{1,2})시(?:(\d{1,2})분?|반)?$/.exec(t))) {
      h = +x[1];
      m = x[2] != null ? +x[2] : /반$/.test(t) ? 30 : 0;
      lead0 = /^0/.test(x[1]);
    } else if ((x = /^(\d{1,2})[:.](\d{1,2})$/.exec(t))) {
      h = +x[1];
      m = +x[2];
      lead0 = /^0/.test(x[1]) || h >= 13;
    } else if ((x = /^(\d{3,4})$/.exec(t))) {
      h = +x[1].slice(0, -2);
      m = +x[1].slice(-2);
      lead0 = x[1].length === 4;
    } else if ((x = /^(\d{1,2})$/.exec(t))) {
      h = +x[1];
      lead0 = /^0/.test(x[1]);
    } else return null;
    if (h > 24 || m > 59) return null;
    if (mer) {
      if (/^(오후|저녁|밤|pm)$/.test(mer) && h < 12) h += 12;
      else if (mer === '점심' && h < 6) h += 12;
      else if (/^(오전|아침|새벽|am)$/.test(mer) && h === 12) h = 0;
    } else if (!lead0 && h >= 1 && h <= 6) h += 12; // 오전/오후 없이 1~6시는 오후로(업무시간 기준)
    if (h === 24) h = 0;
    return hm(h, m);
  }
  // id: 'start' | 'end' | 'dueTime' | 'ws:<기록id>:s' | 'ws:<기록id>:e'
  function tcombo(id, value, o) {
    o = o || {};
    const open = ui.tcOpen === id;
    let items = '';
    if (open) {
      const base = o.base ? hmToMin(o.base) : null;
      const slots = [];
      if (base != null) for (let k = 15; k <= 12 * 60; k += 15) slots.push([(base + k) % 1440, k]);
      else for (let k = 0; k < 1440; k += 15) slots.push([k, null]);
      const cur = value ? hmToMin(value) : null;
      // 1분 단위로 직접 넣은 값(예: 9:07)도 목록 제자리에 보이게 끼워 넣는다
      if (cur != null && !slots.some(([mi]) => mi === cur)) {
        const rel = (x) => (base != null ? (x - base + 1440) % 1440 : x);
        if (base == null || rel(cur) > 0) {
          slots.push([cur, base != null ? rel(cur) : null]);
          slots.sort((a, b) => rel(a[0]) - rel(b[0]));
        }
      }
      items = slots
        .map(([mi, dur]) => {
          const v = minToHM(mi);
          const sel = cur != null && mi === cur;
          return `<button type="button" class="tc-it${sel ? ' on' : ''}" data-act="tc-pick" data-id="${id}" data-val="${v}" ${sel ? 'data-sel' : ''}>${koTime(v)}${dur != null ? `<small>${durText(dur)}</small>` : ''}</button>`;
        })
        .join('');
    }
    return `<div class="tcombo${open ? ' open' : ''}${o.disabled ? ' dis' : ''}">
        <input class="tc-in" data-tc="${id}" data-keep="tc-${id}" value="${value ? koTime(value) : ''}" placeholder="${o.placeholder || '시간'}" autocomplete="off" spellcheck="false" ${o.disabled ? 'disabled' : ''}>
        ${o.clear && value ? `<button type="button" class="tc-x" data-act="tc-clear" data-id="${id}" aria-label="지우기">${icon('x', 12)}</button>` : ''}
        ${open ? `<div class="tc-list" data-nodrag data-scroll="tc-${id}">${items}</div>` : ''}
      </div>`;
  }
  function rangePicker(d) {
    const curDur = d.start && d.end ? (hmToMin(d.end) - hmToMin(d.start) + 1440) % 1440 : null;
    const s0 = draftStart(d);
    const past = !!(s0 && d.end && new Date(s0.getTime() + curDur * 60000) <= now());
    return `<div class="pk tp" data-nodrag>
        <div class="tp-row">
          ${tcombo('start', d.start, { placeholder: '시작' })}
          <span class="tp-arrow">${icon('chevRight', 14)}</span>
          ${tcombo('end', d.end, { placeholder: d.start ? '끝 (비워도 돼요)' : '–', base: d.start, disabled: !d.start, clear: true })}
        </div>
        <div class="rg-foot">
          <span class="rg-note">${d.start && d.end ? `${durText(curDur)}${hmToMin(d.end) <= hmToMin(d.start) ? ' · 다음 날 끝나요' : ''}` : '목록은 15분 단위 · 9:07, 907처럼 치면 1분 단위로 들어가요'}</span>
          ${past ? `<button type="button" class="pill${d.done ? ' on' : ''}" data-act="sheet-done">${icon('check', 12)}이 시간에 한 일로 완료</button>` : ''}
          <button type="button" class="pill" data-act="sh-pick" data-val="time">확인</button>
        </div>
      </div>`;
  }
  function timePicker(v, key) {
    return `<div class="pk tp" data-nodrag><div class="tp-row">${tcombo(key, v, { placeholder: '마감 시각' })}</div></div>`;
  }
  // 고른 시간을 제자리에 넣는다
  function tcApply(id, v) {
    if (id.startsWith('ws:')) {
      const [, sid, edge] = id.split(':');
      const t = ui.sheet && findTask(ui.sheet.id);
      const w = t && (t.sessions || []).find((x) => x.id === sid);
      if (!w) return;
      const [h, m] = v.split(':').map(Number);
      ui.tcOpen = null;
      ui.sheet.restoreScroll = true;
      if (setWorkEdge(t, w, edge, h, m)) {
        if (edge === 's' && w.e) ui.tcOpen = `ws:${sid}:e`;
        commit();
      } else render();
      return;
    }
    const d = ui.sheet && ui.sheet.d;
    if (!d) return;
    if (id === 'start') {
      const dur = d.start && d.end ? (hmToMin(d.end) - hmToMin(d.start) + 1440) % 1440 : null;
      const first = !d.start;
      d.start = v;
      if (dur) d.end = minToHM((hmToMin(v) + dur) % 1440); // 길이는 그대로 두고 끝도 같이 옮긴다
      d.endMode = 'end';
      if (!d.date) d.date = todayKey();
      if (first && d.due) d.reminder = null;
      ui.tcOpen = d.end ? null : 'end'; // 시작을 고르면 끝 목록을 바로 연다(비워 둬도 됨)
    } else if (id === 'end') {
      if (!d.start) return;
      d.end = v;
      d.endMode = 'end';
      ui.tcOpen = null;
    } else if (id === 'dueTime') {
      d.dueTime = v;
      if (!d.due) d.due = todayKey();
      ui.tcOpen = null;
      ui.sheet.picker = null;
      ui.sheet.restoreScroll = true;
    }
    render();
  }
  function tcScrollToSel() {
    const list = document.querySelector('.tc-list');
    if (!list) return;
    const sel = list.querySelector('[data-sel]');
    let target = sel;
    if (!target) {
      // 고른 값이 없으면 지금 시각(목록이 하루 전체일 때) 근처로
      const n = now();
      const k = Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15;
      target = list.querySelector(`[data-val="${minToHM(k % 1440)}"]`) || list.firstElementChild;
      if (list.querySelector('small')) target = list.firstElementChild;
    }
    if (target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
  }
  // 문장에서 읽은 시간이 지금 설정과 다르면 '적용' 버튼을 보여준다
  function recogInfo(d) {
    const r = P.parse(d.text || '', now(), S.settings);
    if (!r.date && !r.repeat && !r.due) return null;
    const dueLbl = r.due ? dueText({ due: r.due }) : '';
    let label = r.repeat
      ? `${P.repeatLabel(r.repeat, r.date)}${r.start ? ' ' + r.start : ''}${r.end ? ' – ' + r.end : ''}`
      : r.date
        ? `${relDayFull(r.date)}${r.start ? ' ' + r.start : ''}${r.end ? ' – ' + r.end : ''}`
        : '';
    if (dueLbl) label = label ? `${label} · ${dueLbl}` : `마감 ${dueLbl}`;
    const dr = draftRepeat(d);
    const sameRep = r.repeat
      ? !!dr && dr.freq === r.repeat.freq && (r.repeat.freq !== 'weekly' || String([...(dr.days || [])].sort()) === String([...(r.repeat.days || [])].sort()))
      : !dr;
    const same =
      sameRep &&
      (r.start || '') === (d.start || '') &&
      (!r.end || (d.endMode === 'end' && d.end === r.end)) &&
      (r.repeat || !r.date || r.date === d.date) &&
      (!r.due || (r.due.date === d.due && (r.due.time || '') === (d.dueTime || '')));
    return { r, label, same };
  }
  function recogHtml(d) {
    const info = recogInfo(d);
    if (!info) return '';
    return `<span>문장에서 읽은 ${info.r.repeat ? '반복' : '시간'}: ${esc(info.label)}</span>${
      info.same ? '' : '<button type="button" class="recog-apply" data-act="sh-apply-recog">적용</button>'
    }`;
  }
  /* ---------- 메모 사진 ---------- */
  const IMG_MAX = 20;
  function imgSrc(im) {
    if (!im) return '';
    if (im.data) return im.data;
    return appInfo.imgBase ? appInfo.imgBase + encodeURIComponent(im.file) : '';
  }
  function sheetImagesHtml(d) {
    const imgs = d.images || [];
    return `<div class="sh-imgs" data-shimgs>
        ${imgs
          .map(
            (im) => `<div class="shimg"><button type="button" class="shimg-v" data-act="img-view" data-id="${im.id}" title="크게 보기"><img src="${esc(imgSrc(im))}" alt="" draggable="false"></button><button type="button" class="shimg-x" data-act="img-del" data-id="${im.id}" title="사진 빼기" aria-label="사진 빼기">${icon('x', 12)}</button></div>`,
          )
          .join('')}
        <button type="button" class="shimg-add" data-act="img-add" title="사진 넣기 · Ctrl+V로 붙여넣거나 창에 끌어다 놓아도 돼요">${icon('image', 17)}<span>${imgs.length ? '추가' : '사진'}</span></button>
        ${imgs.length ? '' : '<span class="shimg-tip">Ctrl+V로 붙여넣거나 끌어다 놓아도 돼요</span>'}
      </div>`;
  }
  const readDataUrl = (f) =>
    new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(f);
    });
  // 브라우저에서는 저장 공간이 작아서 긴 변 1600px JPEG로 줄여 넣는다(앱은 원본을 파일로)
  function shrinkDataUrl(data) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * k);
        c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      im.onerror = () => res(null);
      im.src = data;
    });
  }
  async function addSheetImages(list) {
    const sh = ui.sheet;
    if (!sh) return;
    const d = sh.d;
    d.images = d.images || [];
    sh.added = sh.added || [];
    let skipped = 0;
    let failed = 0;
    for (const f of list) {
      if (!f || !(f.type || '').startsWith('image/')) continue;
      if (d.images.length >= IMG_MAX) {
        skipped++;
        continue;
      }
      const data = await readDataUrl(f);
      if (!data) {
        failed++;
        continue;
      }
      if (APP && APP.saveImage) {
        const r = await APP.saveImage(data);
        if (!r || !r.ok) {
          failed++;
          logError(`사진 저장 실패: ${(r && r.error) || ''}`);
          continue;
        }
        sh.added.push(r.file);
        d.images.push({ id: uid(), file: r.file });
      } else {
        const small = await shrinkDataUrl(data);
        if (!small) {
          failed++;
          continue;
        }
        d.images.push({ id: uid(), data: small });
      }
    }
    if (skipped) snack(`사진은 할 일 하나에 ${IMG_MAX}장까지예요`);
    else if (failed) snack('사진을 넣지 못했어요');
    if (ui.sheet === sh) render();
  }
  // 상세를 저장하지 않고 닫으면, 이번에 넣은 사진 파일 중 어디에도 안 쓰인 것은 지운다
  function dropUnsavedImages(sh) {
    if (!sh || !sh.added || !sh.added.length || !APP || !APP.deleteImage) return;
    const used = new Set();
    S.tasks.forEach((t) => (t.images || []).forEach((im) => im.file && used.add(im.file)));
    sh.added.filter((f) => !used.has(f)).forEach((f) => APP.deleteImage(f));
    sh.added = [];
  }
  function closeSheet() {
    const sh = ui.sheet;
    ui.sheet = null;
    ui.lightbox = null;
    dropUnsavedImages(sh);
  }
  function lightboxHtml() {
    const lb = ui.lightbox;
    const d = ui.sheet && ui.sheet.d;
    const im = d && (d.images || []).find((x) => x.id === lb.id);
    if (!im) return '';
    const i = d.images.indexOf(im);
    const n = d.images.length;
    return `<div class="lightbox" data-act="lb-close">
        <img src="${esc(imgSrc(im))}" alt="" data-nodrag>
        <div class="lb-bar">
          ${n > 1 ? `<button type="button" class="lb-btn" data-act="lb-step" data-val="-1" aria-label="이전 사진">${icon('chevLeft', 18)}</button><span class="lb-n">${i + 1} / ${n}</span><button type="button" class="lb-btn" data-act="lb-step" data-val="1" aria-label="다음 사진">${icon('chevRight', 18)}</button>` : ''}
          ${APP && APP.openImage && im.file ? `<button type="button" class="lb-btn txt" data-act="lb-open">원본 열기</button>` : ''}
          <button type="button" class="lb-btn" data-act="lb-close" aria-label="닫기">${icon('x', 18)}</button>
        </div>
      </div>`;
  }
  function sheetHtml() {
    const d = ui.sheet.d;
    const t = findTask(ui.sheet.id);
    if (!t) return '';
    const hasStart = !!d.start;
    const dueRem = !hasStart && !!d.due;
    const canRem = hasStart || dueRem;
    const rem = dueRem
      ? [[null, '없음'], ...dueRemOpts(draftDue(d))]
      : [[null, '없음'], [0, '시작할 때'], [5, '5분 전'], [10, '10분 전'], [30, '30분 전'], [60, '60분 전']];
    const isPreset = rem.some(([v]) => v === d.reminder);
    const durs = [15, 30, 60];
    const recog = P.parse(d.text, now(), S.settings);
    const recogTxt = recog.repeat
      ? `문장에서 읽은 반복: ${P.repeatLabel(recog.repeat, recog.date)}${recog.start ? ' ' + recog.start : ''}${recog.end ? ' – ' + recog.end : ''}`
      : recog.date
        ? `문장에서 읽은 시간: ${relDayFull(recog.date)}${recog.start ? ' ' + recog.start : ''}${recog.end ? ' – ' + recog.end : ''}`
        : '';
    const isInst = !!t.seriesId;
    const dr = draftRepeat(d);
    const repOpts = [['none', '안 함'], ['daily', '매일'], ['weekdays', '평일'], ['weekly', '매주'], ['monthly', '매월']];
    const dayOrder = [1, 2, 3, 4, 5, 6, 0];
    const curDays = dr && dr.freq === 'weekly' ? dr.days : [];
    const ask = ui.sheet.ask;
    const pk = ui.sheet.picker;
    const en = ui.sheet.shown ? '' : ' enter';
    return `<div class="scrim${en}" data-act="sheet-close"></div>
      <div class="sheet${en}" role="dialog" aria-label="할 일 수정">
        <div class="grab"></div>
        <div class="sh-title">
          <button class="cb${d.done ? ' on' : ''}" data-act="sheet-done" aria-label="완료">${icon('check', 14)}</button>
          <input class="sh-text" data-bind="text" data-keep="sh-text" value="${esc(d.text)}" spellcheck="false">
        </div>
        <div class="sh-recog" data-recog>${recogHtml(d)}</div>
        ${isInst ? `<div class="sh-series">${icon('repeat', 14)}반복 일정 · ${dayShort(fromKey(t.date))} 회차</div>` : ''}
        <div class="sh-body" data-scroll="sheet">
          <div class="srow">${icon('folder')}<span class="sl">프로젝트</span></div>
          <div class="pills proj">
            <button type="button" class="pill${!d.projectId ? ' on' : ''}" data-act="sh-proj" data-val="">없음</button>
            ${S.projects
              .map((p) => `<button type="button" class="pill pj-pill${d.projectId === p.id ? ' on' : ''}" style="--c:${pColor(p)}" data-act="sh-proj" data-val="${p.id}"><i></i>${esc(p.name)}</button>`)
              .join('')}
          </div>
          <div class="srow">${icon('calendar')}<span class="sl">날짜</span>${
            !d.done ? `<button type="button" class="pill dmove" data-act="sh-later">${!d.date || d.date <= todayKey() ? '내일로' : '하루 뒤로'}</button>` : ''
          }${fieldChip('date', d.date ? dateChipText(d.date) : '', '날짜 없음')}</div>
          ${pk === 'date' ? datePicker(d) : ''}
          <div class="srow">${icon('clock')}<span class="sl">시간</span>${fieldChip('time', timeChipText(d), '시간 없음')}</div>
          ${pk === 'time' ? rangePicker(d) : ''}
          <div class="srow">${icon('flag')}<span class="sl">마감</span>${fieldChip('due', d.due ? dateChipText(d.due) + '까지' : '', '마감 없음')}</div>
          ${pk === 'due' ? datePicker(d, 'due') : ''}
          ${
            d.due
              ? `<div class="srow sub"><span class="sl">마감 시각</span>${fieldChip('dueTime', d.dueTime ? koTime(d.dueTime) : '', '그날 안에')}</div>
                 ${pk === 'dueTime' ? timePicker(d.dueTime, 'dueTime') : ''}`
              : ''
          }
          ${t.repeat || isInst ? '' : workSectionHtml(t)}
          <div class="srow">${icon('repeat')}<span class="sl">반복</span></div>
          <div class="pills">
            ${repOpts.map(([v, l]) => `<button type="button" class="pill${d.repeatFreq === v ? ' on' : ''}" data-act="sh-rep" data-val="${v}">${l}</button>`).join('')}
          </div>
          ${
            d.repeatFreq === 'weekly'
              ? `<div class="pills days">${dayOrder
                  .map((w) => `<button type="button" class="pill day${curDays.includes(w) ? ' on' : ''}" data-act="sh-repday" data-val="${w}">${WEEK[w]}</button>`)
                  .join('')}</div>`
              : ''
          }
          ${dr ? `<div class="rep-line">${icon('repeat', 14)}<span>${P.repeatLabel(dr, d.date || todayKey())}${d.start ? ' ' + d.start : ''} 반복</span></div>` : ''}
          <div class="srow">${icon('bell')}<span class="sl">미리 알림</span></div>
          <div class="pills rem${canRem ? '' : ' disabled'}">
            ${rem
              .map(([v, l]) => `<button type="button" class="pill${d.reminder === v ? ' on' : ''}" data-act="sh-rem" data-val="${v == null ? 'none' : v}" ${canRem ? '' : 'disabled'}>${l}</button>`)
              .join('')}
            ${dueRem ? '' : `<input class="num" type="number" min="1" placeholder="직접(분)" data-bind="remCustom" data-keep="sh-remc" value="${!isPreset && d.reminder != null ? d.reminder : ''}" ${hasStart ? '' : 'disabled'}>`}
          </div>
          <div class="rem-line" data-remline>${icon('bell', 14)}<span>${remLine(d)}</span></div>
          <label class="srow top">${icon('note')}<textarea data-bind="memo" data-keep="sh-memo" rows="2" placeholder="메모 추가">${esc(d.memo)}</textarea></label>
          ${sheetImagesHtml(d)}
        </div>
        ${
          ask
            ? `<div class="sh-foot ask">
          <span class="ask-q">반복 일정이에요. ${ask === 'delete' ? '어디까지 삭제할까요?' : '어디에 적용할까요?'}</span>
          <button type="button" class="btn ghost" data-act="sheet-scope" data-val="cancel">취소</button>
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="sheet-scope" data-val="one">이번 회차만</button>
          <button type="button" class="btn ${ask === 'delete' ? 'danger' : 'primary'}" data-act="sheet-scope" data-val="all">앞으로 전부</button>
        </div>`
            : `<div class="sh-foot">
          <button type="button" class="danger-txt" data-act="sheet-delete">${icon('trash', 16)}삭제</button>
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="sheet-close">취소</button>
          <button type="button" class="btn primary" data-act="sheet-save">저장</button>
        </div>`
        }
      </div>`;
  }
  // 작업 시간(실제로 한 시간): 기록마다 시작·끝을 눌러 고친다. 계획 '시간'과 따로 여러 번 쌓인다
  function workSectionHtml(t) {
    const on = workingOn(t);
    const list = [...(t.sessions || [])].sort((a, b) => b.s.localeCompare(a.s));
    const total = workMinutes(t);
    const ed = ui.sheet.wEdit;
    const rows = list
      .map((w) => {
        const s = new Date(w.s);
        const e = w.e ? new Date(w.e) : null;
        const len = Math.max(1, Math.round(((e || now()) - s) / 60000));
        const open = ed && ed.sid === w.id;
        return `<div class="wrow${e ? '' : ' live'}${open ? ' open' : ''}" data-act="we-open" data-sid="${w.id}" title="눌러서 시작·끝 고치기">
            <span>${relDay(dateKey(s))} ${fmtHM(s)} – ${e ? (sameDay(s, e) ? '' : '다음 날 ') + fmtHM(e) : '지금'}</span><em>${e ? durText(len) : `${durText(len)}째`}</em>${
              e ? `<button type="button" class="wx" data-act="work-del" data-id="${t.id}" data-sid="${w.id}" aria-label="이 기록 지우기">${icon('x', 12)}</button>` : '<i class="wx"></i>'
            }</div>${open ? workEditor(t, w) : ''}`;
      })
      .join('');
    return `<div class="srow">${icon('play')}<span class="sl">작업 시간</span>${total ? `<span class="wtotal">총 ${durText(total)}</span>` : ''}
        <span class="wbtns2">
          <button type="button" class="pill wbtn${on ? ' on' : ''}" data-act="work" data-id="${t.id}">${icon(on ? 'stop' : 'play', 12)}${on ? '멈추기' : total ? '이어서 하기' : '지금 시작'}</button>
          <button type="button" class="pill wadd1" data-act="we-new" data-id="${t.id}" title="이미 한 작업을 직접 넣기">${icon('plus', 13)}직접 넣기</button>
        </span></div>
      ${rows ? `<div class="wlist">${rows}</div>` : '<p class="whint">계획한 시간과 따로, 실제로 한 만큼 타임라인에 초록으로 남아요</p>'}`;
  }
  function workEditor(t, w) {
    const s = new Date(w.s);
    const e = w.e ? new Date(w.e) : null;
    return `<div class="pk we tp" data-nodrag>
        <div class="tp-row">
          ${tcombo(`ws:${w.id}:s`, fmtHM(s), { placeholder: '시작' })}
          <span class="tp-arrow">${icon('chevRight', 14)}</span>
          ${e ? tcombo(`ws:${w.id}:e`, fmtHM(e), { placeholder: '끝', base: fmtHM(s) }) : '<span class="tp-live">지금 (하는 중)</span>'}
        </div>
        <div class="rg-foot"><span class="rg-note">${relDay(dateKey(s))} · ${e ? durText(Math.max(1, Math.round((e - s) / 60000))) + (sameDay(s, e) ? '' : ' · 다음 날 끝') : '끝은 멈추기를 누르면 정해져요'}</span><button type="button" class="pill" data-act="we-open" data-sid="${w.id}">확인</button></div>
      </div>`;
  }
  // 작업 기록 한 개의 시작/끝을 h:m으로 바꾼다(날짜는 시작한 날 기준, 끝이 시작보다 이르면 다음 날)
  function weSet(el, part) {
    const ed = ui.sheet && ui.sheet.wEdit;
    const t = ui.sheet && findTask(ui.sheet.id);
    const w = t && ed && (t.sessions || []).find((x) => x.id === ed.sid);
    if (!w) return;
    const edge = w.e ? ed.edge || 's' : 's';
    const cur = new Date(edge === 's' ? w.s : w.e);
    const h = part === 'h' ? +el.dataset.val : cur.getHours();
    const m = part === 'm' ? +el.dataset.val : cur.getMinutes();
    ui.sheet.restoreScroll = true;
    if (setWorkEdge(t, w, edge, h, m) && part === 'm' && edge === 's' && w.e) ed.edge = 'e';
    commit();
  }
  function setWorkEdge(t, w, edge, h, m) {
    const s0 = new Date(w.s);
    const base = startOfDay(s0);
    const n = now();
    if (edge === 's') {
      let ns = new Date(base.getTime() + (h * 60 + m) * 60000);
      const lim = w.e ? new Date(w.e) : n;
      if (ns >= lim) {
        snack(w.e ? '시작은 끝보다 앞이어야 해요' : '하는 중인 작업은 지금보다 늦게 시작할 수 없어요');
        return false;
      }
      w.s = ns.toISOString();
    } else {
      let ne = new Date(base.getTime() + (h * 60 + m) * 60000);
      if (ne <= s0) ne = new Date(ne.getTime() + 864e5);
      if (ne > n) {
        snack('끝은 지금보다 늦을 수 없어요');
        return false;
      }
      w.e = ne.toISOString();
    }
    t.sessions.sort((a, b) => a.s.localeCompare(b.s));
    return true;
  }
  function inboxHtml() {
    const items = [...S.notifications].sort((a, b) => b.firedAt.localeCompare(a.firedAt));
    const en = ui.inboxShown ? '' : ' enter';
    return `<div class="scrim light${en}" data-act="inbox"></div>
      <div class="inbox${en}" role="dialog" aria-label="알림">
        <div class="ib-head"><b>알림</b><span class="grow"></span>
          ${items.some((n) => !n.read) ? '<button class="txt acc" data-act="inbox-ackall">모두 확인</button>' : ''}
          <button class="ibtn" data-act="inbox" aria-label="닫기">${icon('x', 16)}</button></div>
        <p class="ib-note">확인해도 할 일은 완료되지 않아요</p>
        <div class="ib-list">
        ${
          items
            .map((n) => {
              const s = new Date(n.start);
              const f = new Date(n.firedAt);
              return `<div class="ib-item${n.read ? '' : ' unread'}">
                <i class="udot"></i>
                <div class="ib-txt"><b>${esc(n.title)}</b>
                  <span>${n.body ? esc(n.body) : `${relDay(dateKey(s))} ${fmtHM(s)} 시작`}${n.project ? ' · ' + esc(n.project) : ''}</span>
                  <small>${relDay(dateKey(f))} ${fmtHM(f)}에 울림${n.missed ? ' · 앱이 꺼져 있던 동안 놓친 알림' : ''}</small></div>
                <div class="ib-act">
                  ${findTask(n.taskId) ? `<button class="pill" data-act="inbox-open" data-id="${n.taskId}" data-nid="${n.id}">열기</button>` : ''}
                  ${n.read ? '' : `<button class="pill" data-act="inbox-ack" data-nid="${n.id}">확인</button>`}
                </div></div>`;
            })
            .join('') || '<p class="empty-sm">아직 울린 알림이 없어요</p>'
        }</div>
      </div>`;
  }
  function modalHtml() {
    const m = ui.modal;
    let body = '';
    if (m.type === 'settings') body = settingsHtml();
    if (m.type === 'project') body = projectHtml(m);
    if (m.type === 'sticky') body = stickyHtml(m);
    if (m.type === 'report') body = reportHtml(m);
    if (m.type === 'restore') body = restoreHtml(m);
    if (m.type === 'welcome') body = welcomeHtml(m);
    if (m.type === 'feedback') body = feedbackHtml(m);
    if (m.type === 'help') body = helpHtml(m);
    if (m.type === 'quit') {
      body = `<div class="md-head"><b>Dayline을 종료할까요?</b></div>
        <p class="md-p">종료하면 미리 알림이 오지 않아요. 창만 닫으려면 트레이로 숨기기를 쓰세요.</p>
        <div class="md-foot"><button class="btn ghost" data-act="modal-close">취소</button><button class="btn danger" data-act="quit-confirm">종료</button></div>`;
    }
    const en = m.shown ? '' : ' enter';
    return `<div class="scrim${en}" data-act="modal-close"></div><div class="modal ${m.type}${en}" role="dialog">${body}</div>`;
  }
  function settingsHtml() {
    const st = permState();
    const stTxt = { granted: '허용됨', denied: '꺼져 있음', default: '아직 허용하지 않음', unsupported: '지원하지 않음' }[st];
    const hours = (from, to, val, key) =>
      `<select data-set="${key}">${Array.from({ length: to - from + 1 }, (_, i) => from + i)
        .map((h) => `<option value="${h}" ${h === val ? 'selected' : ''}>${pad(h)}:00</option>`)
        .join('')}</select>`;
    const info = statusInfo();
    return `<div class="md-head"><b>설정</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <div class="md-scroll">
        <div class="sgroup"><div class="sg-label">업무시간</div>
          <div class="sg-card">
            <div class="sg-row"><span>시작 – 끝</span><span class="sg-val">${hours(6, 12, S.settings.workStart, 'workStart')} – ${hours(15, 23, S.settings.workEnd, 'workEnd')}</span></div>
            <p class="sg-help">오전/오후를 안 쓰면 이 시간 기준으로 읽어요. 예: "1시30분" → 13:30, "9시" → 09:00</p>
          </div></div>
        <div class="sgroup"><div class="sg-label">알림</div>
          <div class="sg-card">
            <div class="sg-row"><span>알림 권한</span><span class="sg-val"><i class="sdot ${info.cls}"></i>${stTxt}
              ${st === 'default' ? '<button class="pill" data-act="perm-request">허용하기</button>' : ''}</span></div>
            ${st === 'denied' ? '<p class="sg-help warn">브라우저 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요.</p>' : ''}
            <div class="sg-row"><span>실행 상태</span><span class="sg-val">${info.text}</span></div>
            <p class="sg-help">알림이 안 보이면 Windows 설정 → 시스템 → 알림에서 Dayline이 켜져 있는지, 방해 금지 모드가 꺼져 있는지 확인해 주세요.</p>
          </div></div>
        <div class="sgroup"><div class="sg-label">창</div>
          <div class="sg-card">
            <div class="sg-row"><span>항상 위에 고정 <small class="muted">작은 메모창</small></span><button class="switch${S.prefs.pinned ? ' on' : ''}" data-act="pin" aria-label="항상 위에 고정"><i></i></button></div>
            <div class="sg-row"><span>컴퓨터 켤 때</span>${
              APP
                ? (() => {
                    const cur = !appInfo.autostart ? 'off' : appInfo.startShow === false ? 'tray' : 'show';
                    const b = (v, l) => `<button type="button" class="${cur === v ? 'on' : ''}" data-act="boot-mode" data-val="${v}">${l}</button>`;
                    return `<span class="seg sm">${b('off', '안 켜기')}${b('tray', '트레이에만')}${b('show', '창 열기')}</span>`;
                  })()
                : '<span class="sg-val muted">앱 버전에서 지원</span>'
            }</div>
            <div class="sg-row"><span>닫기 버튼</span><span class="sg-val">트레이로 숨기기</span></div>
            <div class="sg-row"><span>빠른 입력 단축키</span><span class="sg-val">Ctrl + Shift + Space</span></div>
            ${APP ? '<button class="sg-row btnrow danger" data-act="app-quit"><span>Dayline 완전히 종료</span></button>' : ''}
          </div></div>
        <div class="sgroup"><div class="sg-label">데이터</div>
          <div class="sg-card">
            <div class="sg-row"><span>저장</span><span class="sg-val">${ui.saveError ? '<em class="bad">저장 실패</em>' : `자동 저장됨${ui.lastSaved ? ' · ' + fmtHM(ui.lastSaved) : ''}`}</span></div>
            ${
              APP
                ? `<div class="sg-row"><span>자동 백업</span><span class="sg-val">${
                    ui.backupError
                      ? `<em class="bad">${esc(ui.backupError)}</em>`
                      : S.backup
                        ? `${relDay(S.backup.date)} ${fmtHM(new Date(S.backup.at))}`
                        : '아직 없음'
                  }</span></div>
            <div class="sg-actions"><button class="pill" data-act="backup-now">지금 백업</button><button class="pill" data-act="backup-open">폴더 열기</button></div>
            <p class="sg-help">하루 한 번 문서 → Dayline 백업 폴더에 저장하고 최근 30일 치를 남겨요(한 개에 수십 KB라 용량 걱정은 없어요). 아래 '백업 가져오기'에서 골라 되돌릴 수 있어요.</p>`
                : ''
            }
            <button class="sg-row btnrow" data-act="report-open">${icon('note', 18)}<span>한 일 내보내기 <small class="muted">보고·AI 정리용 Markdown / CSV</small></span></button>
            <button class="sg-row btnrow" data-act="export">${icon('download', 18)}<span>백업 내보내기</span></button>
            <button class="sg-row btnrow" data-act="import">${icon('upload', 18)}<span>백업 가져오기 <small class="muted">되돌리기 · 합치기</small></span></button>
            <button class="sg-row btnrow" data-act="sticky-open">${icon('sticky', 18)}<span>할 일 가져오기 <small class="muted">붙여넣은 글·텍스트 파일·스티커 메모</small></span></button>
            <button class="sg-row btnrow danger" data-act="reset">${icon('trash', 18)}<span>${APP ? '모든 데이터 지우기' : '샘플 데이터로 되돌리기'}</span></button>
          </div></div>
        <div class="sgroup"><div class="sg-label">도움</div>
          <div class="sg-card">
            <button class="sg-row btnrow" data-act="help-open">${icon('note', 18)}<span>사용법 <small class="muted">입력 방법·목록·타임라인·작업 시간·단축키</small></span></button>
            <button class="sg-row btnrow" data-act="fb-open">${icon('chat', 18)}<span>의견 보내기 <small class="muted">문제·개선점, 스크린샷·파일 첨부</small></span></button>
          </div></div>
        ${APP && appInfo.version ? `<p class="sg-help center">Dayline ${esc(appInfo.version)}</p>` : ''}
      </div>`;
  }
  function projectHtml(m) {
    const p = m.id ? proj(m.id) : null;
    const count = p ? S.tasks.filter((t) => t.projectId === p.id).length : 0;
    return `<div class="md-head"><b>${p ? '프로젝트 편집' : '새 프로젝트'}</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <label class="field"><span>프로젝트 이름</span><input data-mbind="name" data-keep="pj-name" value="${esc(m.name)}" placeholder="예: 회사 프로젝트"></label>
      <label class="field"><span>자동 연결 단어</span><input data-mbind="kw" data-keep="pj-kw" value="${esc(m.kw || '')}" placeholder="쉼표로 구분 · 예: 회사, 고객사"></label>
      <p class="field-help">할 일 문장에 ${esc(projectKeywords({ name: m.name || '프로젝트 이름', keywords: [] }).map((k) => `"${k}"`).join(', '))}${m.kw ? ' 또는 위 단어' : ''}가 있으면 자동으로 이 프로젝트에 넣어요.</p>
      <div class="field"><span>색</span><div class="swatches">
        ${Object.keys(COLORS)
          .map((k) => `<button class="sw${m.color === k ? ' on' : ''}" style="--c:${COLORS[k]}" data-act="pj-color" data-val="${k}" title="${COLOR_NAMES[k]}">${m.color === k ? icon('check', 14) : ''}</button>`)
          .join('')}
        <button class="sw custom${isHex(m.color) ? ' on' : ''}" style="--c:${isHex(m.color) ? m.color : '#fff'}" data-act="pj-color" data-val="${isHex(m.color) ? m.color : hueToHex(200)}" title="직접 고른 색">${isHex(m.color) ? icon('check', 14) : ''}</button>
      </div>
      <div class="hue-row"><span>직접 고르기</span><input type="range" class="hue" min="0" max="359" step="1" value="${isHex(m.color) ? hexToHue(m.color) : 200}" data-hue aria-label="색 직접 고르기"></div>
      </div>
      <div class="field row"><span>미리보기</span><span class="pj big"><i style="--c:${colorOf(m.color)}"></i>${esc(m.name || '프로젝트')}</span></div>
      ${m.confirmDel ? `<p class="md-p warn">할 일 ${count}개는 미지정으로 옮겨져요. 한 번 더 누르면 삭제해요.</p>` : ''}
      <div class="md-foot">
        ${p ? `<button class="danger-txt" data-act="pj-delete">${icon('trash', 16)}${m.confirmDel ? '정말 삭제' : '삭제'}</button>` : ''}
        <span class="grow"></span>
        <button class="btn ghost" data-act="modal-close">취소</button>
        <button class="btn primary" data-act="pj-save">${p ? '저장' : '만들기'}</button>
      </div>`;
  }
  /* ---------- 할 일 가져오기: 붙여넣은 글·텍스트 파일·스티커 메모 ---------- */
  // 줄 앞의 목록 기호(- * • 1. [ ])는 떼고, 끝난 표시([x] ✅ ~~취소선~~)와 제목(# …)은 건너뛰고,
  // 비밀번호처럼 보이는 줄은 기본으로 빼 둔다(직접 켜면 가져옴)
  const BULLET_RE = /^\s*(?:[-*+•·▪◦‣–]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s*|[☐□]\s*)?/;
  const DONE_RE = /^\s*(?:[-*+]\s*)?(?:\[[xX✓✔]\]|[☑✅✔✓])\s*|^~~.*~~$/;
  const TODO_BOX_RE = /^\s*(?:[-*+]\s*)?\[\s?\]\s*/;
  const SECRET_RE = /(비밀\s*번호|비번|패스워드|password|passwd|\bpw\b|\bpwd\b|계정|아이디\s*[:：]|\bid\s*[:：]|토큰|token|api\s*key|secret)/i;
  const looksSecret = (t) => SECRET_RE.test(t) || /(?=\S*[A-Za-z])(?=\S*\d)(?=\S*[!@#$%^&*?~])\S{6,}/.test(t);
  function importItems(m) {
    const src = (m.text || '').replace(/\r\n?/g, '\n');
    const blocks = src.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const raw = m.split ? blocks.flatMap((b) => b.split('\n')) : blocks.map((b) => b.replace(/\s*\n\s*/g, ' '));
    const out = [];
    raw.forEach((line0, idx) => {
      const line = line0.trim();
      if (!line) return;
      let kind = 'ok';
      let text = line;
      if (/^#{1,6}\s/.test(line) || /^[=\-_*]{3,}$/.test(line)) kind = 'head';
      else if (DONE_RE.test(line)) kind = 'done';
      text = text.replace(TODO_BOX_RE, '').replace(BULLET_RE, '').replace(/^#{1,6}\s+/, '').replace(/^~~|~~$/g, '').replace(DONE_RE, '').trim();
      if (!text) return;
      if (kind === 'ok' && looksSecret(text)) kind = 'secret';
      const key = (m.source === 'sticky' ? 'sticky:' : 'text:') + hash(text);
      const dup = !!S.imported[key] || !!S.imported['sticky:' + hash(text)];
      const r = P.parse(text, now(), S.settings);
      const pv = { text, spans: r.spans, due: r.due, dueSpan: r.dueSpan };
      const chips = [];
      if (r.repeat) chips.push(P.repeatLabel(r.repeat, r.date || todayKey()));
      else if (r.date) chips.push(relDayFull(r.date));
      if (r.start) chips.push(r.end ? `${r.start}–${r.end}` : r.start);
      if (r.due) chips.push(`${relDayFull(r.due.date)}${r.due.time ? ' ' + r.due.time : ''}까지`);
      const tagP = r.project ? findProjectByTag(r.project) : null;
      const pj = (tagP && tagP.name) || r.project || (matchProject(text) && matchProject(text).name);
      if (pj) chips.push('#' + pj);
      const on = m.off && key in m.off ? !m.off[key] : kind === 'ok' && !dup;
      out.push({ key, text, title: plainTitle(pv), chips, kind, dup, on, idx });
    });
    return out;
  }
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function stickyHtml(m) {
    const items = importItems(m);
    const picked = items.filter((i) => i.on);
    const why = { head: '제목 줄', done: '이미 끝남', secret: '비밀번호 같아요', dup: '이미 가져옴' };
    const seg = (v, l) => `<button type="button" class="${m.source === v ? 'on' : ''}" data-act="im-source" data-val="${v}">${l}</button>`;
    const intro =
      m.source === 'sticky'
        ? APP
          ? m.loading
            ? 'Windows 스티커 메모를 읽는 중이에요…'
            : m.error
              ? `${esc(m.error)}. 내용을 직접 붙여넣어도 돼요.`
              : `스티커 메모 ${m.found || 0}개를 불러왔어요.`
          : '앱에서는 Windows 스티커 메모를 바로 읽어와요. 지금은 내용을 붙여넣어 주세요.'
        : '메모장·노션·카톡 등에 적어 둔 할 일을 붙여넣거나 텍스트 파일(.txt, .md)을 열어요. 한 줄이 할 일 하나예요.';
    return `<div class="md-head"><b>할 일 가져오기</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <div class="im-top"><span class="seg sm">${seg('text', '붙여넣기·파일')}${seg('sticky', '스티커 메모')}</span>${m.source === 'text' ? `<button class="pill" data-act="im-file">${icon('upload', 13)}파일 열기</button>` : ''}</div>
      <p class="md-p">${intro}</p>
      <textarea class="paste" data-mbind="text" data-keep="st-text" rows="4" placeholder="예)\n- 내일 10시 팀 회의 #업무\n- 금요일까지 보고서\n- [x] 끝난 일은 건너뛰어요">${esc(m.text)}</textarea>
      <div class="sg-row plain"><span>${m.split ? '한 줄 = 할 일 하나' : '빈 줄로 나눈 덩어리 = 할 일 하나'}</span><button class="switch${m.split ? ' on' : ''}" data-act="st-split" aria-label="줄마다 나누기"><i></i></button></div>
      <div class="st-list">${items
        .map(
          (i) => `<label class="im-item${i.on ? '' : ' off'}"><input type="checkbox" data-im="${i.key}" ${i.on ? 'checked' : ''}>
            <span class="im-t"><b>${esc(i.title)}</b>${i.chips.length ? `<small>${i.chips.map(esc).join(' · ')}</small>` : ''}</span>
            ${i.kind !== 'ok' || i.dup ? `<em class="${i.kind === 'secret' ? 'warn' : ''}">${why[i.dup ? 'dup' : i.kind]}</em>` : ''}</label>`,
        )
        .join('')}</div>
      <div class="md-foot"><span class="muted">${items.length ? `${picked.length}개 가져오기${items.length - picked.length ? ` · ${items.length - picked.length}개 뺌` : ''}` : ''}</span>
        <span class="grow"></span>
        <button class="btn ghost" data-act="modal-close">취소</button>
        <button class="btn primary" data-act="st-import" ${picked.length ? '' : 'disabled'}>가져오기</button></div>`;
  }
  function openImport(text, source) {
    ui.modal = { type: 'sticky', source: source || 'text', text: text || '', split: source !== 'sticky', off: {}, loading: false };
    render();
    const ta = document.querySelector('.modal.sticky textarea');
    if (ta && !text) ta.focus();
  }
  function readTextFile(file) {
    if (!file || file.size > 2 * 1024 * 1024) return snack('2MB보다 작은 텍스트 파일만 열 수 있어요');
    const fr = new FileReader();
    fr.onload = () => {
      const t = String(fr.result || '');
      if (ui.modal && ui.modal.type === 'sticky') {
        if (ui.modal.source !== 'text') {
          ui.modal.texts = ui.modal.texts || {};
          ui.modal.texts[ui.modal.source] = ui.modal.text;
        }
        ui.modal.source = 'text';
        ui.modal.text = t;
        ui.modal.split = true;
        ui.modal.off = {};
        render();
      } else openImport(t, 'text');
    };
    fr.readAsText(file);
  }

  /* ---------- 숨김·종료 ---------- */
  function renderHidden() {
    return `<div class="desktop">
      <div class="desk-center">
        <b>Dayline이 트레이에서 실행 중이에요</b>
        <span>창을 닫아도 미리 알림은 계속 와요. 오른쪽 아래 아이콘을 눌러 다시 열어요.</span>
      </div>
      <div class="taskbar"><span class="grow"></span>
        <div class="tray">
          ${ui.trayMenu ? `<div class="tray-menu"><button data-act="tray-open">Dayline 열기</button><button data-act="tray-quit">종료</button></div>` : ''}
          <button class="tray-ic" data-act="tray" title="Dayline">${unreadCount() ? '<em></em>' : ''}<i></i></button>
          <span class="clock">${fmtHM(now())}</span>
        </div>
      </div>
      ${ui.modal ? modalHtml() : ''}
    </div>`;
  }
  function renderQuit() {
    return `<div class="desktop"><div class="desk-center"><b>Dayline이 종료됐어요</b><span>종료된 동안에는 미리 알림이 오지 않아요.</span>
      <button class="btn primary" data-act="relaunch">다시 실행</button></div></div>`;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    const app = document.getElementById('app');
    const ae = document.activeElement;
    const keep = ae && ae.dataset ? ae.dataset.keep : null;
    let sel = null;
    try {
      if (keep && ae.selectionStart != null) sel = [ae.selectionStart, ae.selectionEnd];
    } catch (e) { /* time/date 입력은 커서 위치가 없음 */ }
    const scroll = {};
    app.querySelectorAll('[data-scroll]').forEach((el) => (scroll[el.dataset.scroll] = el.scrollTop));
    const chipsEl = app.querySelector('[data-chips]');
    if (chipsEl) ui.chipsX = chipsEl.scrollLeft;

    app.className = (ui.quit || ui.hidden ? 'mode-desk' : 'mode-' + S.prefs.mode) + (APP ? ' is-app' : '');
    app.innerHTML = ui.quit ? renderQuit() : ui.hidden ? renderHidden() : S.prefs.mode === 'mini' ? renderMini() : renderBig();

    if (ui.sheet) ui.sheet.shown = true;
    if (ui.modal) ui.modal.shown = true;
    ui.inboxShown = ui.inbox;
    app.querySelectorAll('[data-scroll]').forEach((el) => {
      const k = el.dataset.scroll;
      if (k === 'tl') {
        const key = S.prefs.tlMode + (S.prefs.anchor || '') + S.prefs.view;
        if (ui.scrolledKey !== key) {
          // 처음 볼 때는 업무 시작 시각(설정, 기본 9시)이 맨 위에 오게.
          // 창이 아직 그려지기 전(숨김 상태로 시작 등)이라 스크롤이 안 먹으면 다음 그리기에서 다시 한다
          const want = Math.max(0, (S.settings.workStart || 9) * HOUR - 12);
          el.scrollTop = want;
          if (el.scrollTop > 0 || want === 0) ui.scrolledKey = key;
          else requestAnimationFrame(() => {
            if (!el.isConnected) return;
            el.scrollTop = want;
            if (el.scrollTop > 0) ui.scrolledKey = key;
          });
          return;
        }
      }
      if (scroll[k] != null) el.scrollTop = scroll[k];
      if (k === 'sheet' && ui.sheet && ui.sheet.restoreScroll) {
        el.scrollTop = ui.sheet.scrollBefore || 0;
        ui.sheet.restoreScroll = false;
      }
    });
    syncChips();
    if (hashState.open) {
      const qi = document.activeElement && document.activeElement.classList.contains('qi-input') ? document.activeElement : null;
      if (qi) updateHash(qi);
      else hashState.open = false;
    }
    if (ui.quickNew && ui.quickNew.focus) {
      ui.quickNew.focus = false;
      const qi = app.querySelector('.qn-input');
      if (qi) {
        qi.focus({ preventScroll: true });
        const qn = qi.closest('.qn');
        const sc = qi.closest('[data-scroll]');
        if (qn && sc) {
          const r = qn.getBoundingClientRect();
          const sr = sc.getBoundingClientRect();
          if (r.bottom > sr.bottom) sc.scrollTop += r.bottom - sr.bottom + 12;
        }
      }
    }
    if (ui.sheet && ui.sheet.revealPicker) {
      ui.sheet.revealPicker = false;
      const pkEl = app.querySelector('.pk');
      if (pkEl) {
        const sc = pkEl.closest('[data-scroll]');
        const row = pkEl.previousElementSibling;
        // 판이 길면 고른 칸(시간 줄)부터 위에 보이게
        if (sc && row && pkEl.offsetHeight + row.offsetHeight > sc.clientHeight * 0.8) row.scrollIntoView({ block: 'start' });
        else pkEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    if (keep) {
      const el = app.querySelector(`[data-keep="${keep}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        try {
          if (sel) el.setSelectionRange(sel[0], sel[1]);
        } catch (e) { /* 무시 */ }
      }
    }
    // 시간 목록을 처음 열었을 때만 고른 값(없으면 지금) 근처로 스크롤. 다시 그릴 때는 data-scroll이 위치를 지킨다
    if (ui.tcOpen && ui.tcScrolled !== ui.tcOpen) {
      ui.tcScrolled = ui.tcOpen;
      // 열자마자 바로 칠 수 있게 그 칸에 커서를 둔다
      const inp = app.querySelector(`[data-tc="${ui.tcOpen}"]`);
      if (inp && document.activeElement !== inp) {
        inp.focus({ preventScroll: true });
        inp.select();
      }
      tcScrollToSel();
      requestAnimationFrame(tcScrollToSel); // 창이 막 그려지는 중이면 한 번 더
    } else if (!ui.tcOpen) ui.tcScrolled = null;
    updateHints();
  }

  /* ---------- 동작 ---------- */
  function nextColor() {
    const used = S.projects.map((p) => p.color);
    return Object.keys(COLORS).find((c) => !used.includes(c) && c !== 'gray') || 'gray';
  }
  function createTask(text, opts) {
    const v = text.trim().replace(/\s{2,}/g, ' ');
    if (!v) return null;
    const r = P.parse(v, now(), S.settings);
    let pid = null;
    if (opts && opts.projectId && proj(opts.projectId)) {
      pid = opts.projectId;
    } else if (r.project) {
      let p = findProjectByTag(r.project);
      if (!p) {
        p = { id: uid(), name: r.project, color: nextColor() };
        S.projects.push(p);
      }
      pid = p.id;
    } else if (!(opts && opts.noAuto) && matchProject(v)) {
      pid = matchProject(v).id;
    } else if (S.prefs.filter !== 'all' && S.prefs.filter !== 'none' && !(opts && opts.noFilter)) {
      pid = S.prefs.filter;
    }
    const t = {
      id: uid(), text: v, projectId: pid, date: r.date, start: r.start, end: r.end, duration: null,
      reminder: null, memo: '', done: false, doneAt: null,
      order: S.tasks.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1,
      createdAt: now().toISOString(), spans: r.spans,
    };
    if (r.due) Object.assign(t, { due: r.due, dueSpan: r.dueSpan });
    if (r.repeat) Object.assign(t, { repeat: r.repeat, doneDates: {}, skipDates: [] });
    S.tasks.push(t);
    return t;
  }
  function addFromInput() {
    const t0 = createTask(ui.draft, { projectId: ui.draftProject, noAuto: ui.noAutoPj });
    if (t0) {
      ui.draftProject = null;
      ui.noAutoPj = false;
    }
    if (!t0) return;
    const t = t0.repeat ? inst(t0, t0.date) : t0;
    ui.draft = '';
    ui.freshId = t.id;
    setTimeout(() => {
      if (ui.freshId === t.id) {
        ui.freshId = null;
        render();
      }
    }, 1800);
    if (t.start || t.due) {
      ui.prompt = { id: t.id, until: Date.now() + PROMPT_MS };
      setTimeout(() => {
        if (ui.prompt && ui.prompt.id === t.id && ui.prompt.until <= Date.now() + 50) {
          ui.prompt = null;
          render();
        }
      }, PROMPT_MS);
    }
    if (t0.repeat) snack(`${repLabel(t0)} 반복으로 저장했어요 · 첫 회차 ${relDayFull(t0.date)}`);
    else if (t0.due && !t0.start && dueOver(t0)) snack('마감이 이미 지났어요 · 날짜를 확인해 주세요');
    else if (!matchesFilter(t)) snack('추가했어요 · 지금 보고 있는 목록에는 안 보여요');
    commit();
  }
  function setDone(t, v) {
    const ser = seriesOf(t);
    if (ser) {
      ser.doneDates = ser.doneDates || {};
      if (v) ser.doneDates[t.date] = now().toISOString();
      else delete ser.doneDates[t.date];
    } else {
      if (v) stopWork(t);
      t.done = v;
      t.doneAt = v ? now().toISOString() : null;
      // 시작 시간 없이 완료하면 완료한 시각을 시작 시간으로 저장한다(나중에 상세에서 고칠 수 있게).
      // 작업 기록이 있는 일은 그 기록이 실제 시간이라 건드리지 않는다.
      if (v && !t.start && !(t.sessions && t.sessions.length)) {
        const n = now();
        t.autoTime = { date: t.date || null, start: fmtHM(n) };
        t.date = dateKey(n);
        t.start = fmtHM(n);
      } else if (!v && t.autoTime) {
        // 완료를 취소하면, 그사이 시간을 직접 바꾸지 않았을 때만 되돌린다
        if (t.start === t.autoTime.start && !t.end && !t.duration) {
          t.start = null;
          t.date = t.autoTime.date;
        }
        delete t.autoTime;
      }
    }
    if (v && ui.prompt && ui.prompt.id === t.id) ui.prompt = null;
  }
  function openSheet(id, focus) {
    const t = findTask(id);
    if (!t) return;
    ui.sheet = { id, d: draftFrom(t), focus };
    ui.inbox = false;
    render();
  }
  // 수정 내용(d)을 할 일(t)에 옮긴다. 완료 상태는 따로 처리.
  function applyDraft(t, d, allowRepeat) {
    const startBefore = t.start;
    applyDraftInner(t, d, allowRepeat);
    // 작업 중인 할 일의 시작 시간을 지금보다 이른 시각(오늘)으로 바꾸면, 작업 기록도 그때부터 한 것으로
    if (workingOn(t) && t.start && t.start !== startBefore && t.date === todayKey()) {
      const st = taskStart(t);
      const w = t.sessions.find((x) => !x.e);
      if (st && st <= now() && w) w.s = st.toISOString();
    }
  }
  function applyDraftInner(t, d, allowRepeat) {
    if (d.text.trim() !== d.origTitle) {
      t.text = d.text.trim();
      const pr = P.parse(t.text, now(), S.settings);
      t.spans = pr.spans;
      t.dueSpan = pr.dueSpan;
    }
    t.projectId = d.projectId || null;
    t.start = d.start || null;
    t.date = d.date || (t.start ? todayKey() : null);
    if (d.due) t.due = draftDue(d);
    else delete t.due;
    if (!t.start) {
      t.end = null;
      t.reminder = t.due ? d.reminder : null;
    } else {
      if (d.endMode === 'end') {
        t.end = d.end || null;
        t.duration = null;
      } else {
        t.end = null;
        t.duration = d.duration || null;
      }
      t.reminder = d.reminder;
    }
    t.memo = d.memo;
    if (d.images && d.images.length) t.images = d.images.map((x) => Object.assign({}, x));
    else delete t.images;
    const rp = allowRepeat ? draftRepeat(d) : null;
    if (rp) {
      if (!t.date) t.date = todayKey();
      if (!t.repeat && t.done) {
        // 한 번짜리였는데 반복으로 바꾸면, 이미 끝낸 기록은 그 날짜 회차로 남긴다
        t.doneDates = { [t.date]: t.doneAt || now().toISOString() };
      }
      t.repeat = Object.assign({}, rp, t.repeat && t.repeat.until ? { until: t.repeat.until } : {});
      t.doneDates = t.doneDates || {};
      t.skipDates = t.skipDates || [];
      t.done = false;
      t.doneAt = null;
    } else if (t.repeat) {
      delete t.repeat;
      delete t.doneDates;
      delete t.skipDates;
    }
  }
  const snapshot = () => JSON.stringify(S.tasks);
  function restore(snap) {
    S.tasks.splice(0, S.tasks.length, ...JSON.parse(snap));
  }
  // 반복 회차를 떼어내 한 번짜리 할 일로 만든다(이번 회차만 바꿀 때)
  function detach(i) {
    const ser = seriesOf(i);
    const copy = JSON.parse(JSON.stringify(ser));
    Object.assign(copy, { id: uid(), date: i.date, done: i.done, doneAt: i.doneAt, fromSeries: ser.id });
    delete copy.repeat;
    delete copy.doneDates;
    delete copy.skipDates;
    ser.skipDates = ser.skipDates || [];
    if (!ser.skipDates.includes(i.date)) ser.skipDates.push(i.date);
    if (ser.doneDates) delete ser.doneDates[i.date];
    S.tasks.push(copy);
    return copy;
  }
  function hasEarlier(ser, k) {
    return instancesBetween(ser, fromKey(ser.date), fromKey(k)).length > 0;
  }
  // 이 회차부터 새 시리즈로 나눈다(앞으로 전부 바꿀 때). 이전 회차 기록은 그대로 둔다.
  function splitFrom(i) {
    const ser = seriesOf(i);
    if (!hasEarlier(ser, i.date)) return ser;
    const next = JSON.parse(JSON.stringify(ser));
    next.id = uid();
    next.date = i.date;
    next.doneDates = {};
    for (const [k, v] of Object.entries(ser.doneDates || {})) {
      if (k >= i.date) {
        next.doneDates[k] = v;
        delete ser.doneDates[k];
      }
    }
    next.skipDates = (ser.skipDates || []).filter((k) => k >= i.date);
    ser.repeat.until = dateKey(addDays(fromKey(i.date), -1));
    S.tasks.push(next);
    return next;
  }
  function saveSheet() {
    const sh = ui.sheet;
    const { id, d } = sh;
    const t = findTask(id);
    if (!t) return;
    if (!d.text.trim()) {
      snack('내용을 입력해 주세요');
      render();
      return;
    }
    let saved;
    if (t.seriesId) {
      if (!sh.scope) {
        sh.ask = 'save';
        return render();
      }
      if (sh.scope === 'one') {
        saved = detach(t);
        applyDraft(saved, d, false);
        if (saved.done !== d.done) setDone(saved, d.done);
      } else {
        const ser = splitFrom(t);
        const doneBefore = !!(ser.doneDates || {})[t.date];
        applyDraft(ser, d, true);
        if (ser.repeat) {
          if (doneBefore !== d.done) setDone(inst(ser, t.date), d.done);
          saved = inst(ser, ser.date);
        } else {
          if (d.done !== ser.done) setDone(ser, d.done);
          saved = ser;
        }
      }
    } else {
      applyDraft(t, d, true);
      if (!t.repeat && t.done !== d.done) setDone(t, d.done);
      saved = t.repeat ? inst(t, t.date) : t;
    }
    ui.sheet = null;
    const r = reminderAt(saved);
    if (saved.repeat) snack(`${repLabel(saved)} 반복으로 저장했어요`);
    else if (r) snack(`${dayShort(r)} ${fmtHM(r)}에 알려드려요`);
    if (r) askPermissionOnce();
    commit();
  }
  function deleteTask(id, scope) {
    const t = findTask(id);
    if (!t) return;
    if (t.seriesId && !scope) {
      ui.sheet.ask = 'delete';
      return render();
    }
    const snap = snapshot();
    let msg = '삭제했어요';
    if (t.seriesId) {
      const ser = seriesOf(t);
      if (scope === 'one') {
        ser.skipDates = ser.skipDates || [];
        if (!ser.skipDates.includes(t.date)) ser.skipDates.push(t.date);
        if (ser.doneDates) delete ser.doneDates[t.date];
        msg = '이번 회차를 삭제했어요';
      } else if (hasEarlier(ser, t.date)) {
        ser.repeat.until = dateKey(addDays(fromKey(t.date), -1));
        msg = '이번 회차부터 반복을 끝냈어요';
      } else {
        S.tasks.splice(S.tasks.indexOf(ser), 1);
        msg = '반복 일정을 삭제했어요';
      }
    } else {
      S.tasks.splice(S.tasks.indexOf(t), 1);
    }
    closeSheet();
    if (ui.prompt && ui.prompt.id === id) ui.prompt = null;
    snack(msg, { undo: { snap } });
    commit();
  }

  /* 알림 발송 */
  function notify(t, fireAt, missed) {
    const s0 = taskStart(t);
    const s = s0 || remBase(t);
    const p = proj(t.projectId);
    const n = {
      id: uid(), taskId: t.id, title: plainTitle(t), start: s.toISOString(), project: p ? p.name : '',
      firedAt: (missed ? fireAt : now()).toISOString(), read: false, missed,
    };
    if (!s0) n.body = `${dueText(t, true)} 마감`.replace('까지 마감', ' 마감');
    S.notifications.push(n);
    if (S.notifications.length > 100) S.notifications.splice(0, S.notifications.length - 100);
    if (missed) return;
    if (APP) {
      APP.notify({ id: n.id, taskId: t.id, title: n.title, body: `${n.body || fmtHM(s) + ' 시작'}${n.project ? ' · ' + n.project : ''}` });
      return;
    }
    showSysToast(n);
    if (permState() === 'granted') {
      try {
        const sys = new Notification(n.title, {
          body: `${n.body || fmtHM(s) + ' 시작'}${n.project ? ' · ' + n.project : ''}`,
          tag: n.id,
        });
        sys.onclick = () => {
          window.focus();
          n.read = true;
          openSheet(t.id);
          save();
        };
      } catch (e) {
        n.sysFailed = true;
      }
    }
  }
  function checkReminders() {
    const n = now();
    const T = startOfDay(n);
    let changed = false;
    for (const t of expandRange(addDays(T, -1), addDays(T, 3))) {
      if (t.done) continue;
      const r = reminderAt(t);
      if (!r) continue;
      const key = t.id + '@' + r.getTime();
      if (S.fired[key]) continue;
      if (r <= n) {
        S.fired[key] = true;
        notify(t, r, n - r > 10 * 60000);
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }
  function showSysToast(n) {
    const box = document.getElementById('sys-toasts');
    const el = document.createElement('div');
    el.className = 'sys-toast';
    const s = new Date(n.start);
    el.innerHTML = `<div class="st-app"><i></i>Dayline<span class="grow"></span><span class="muted">지금</span><button class="st-x" aria-label="닫기">${icon('x', 14)}</button></div>
      <div class="st-body"><b>${esc(n.title)}</b><p>${esc(n.body || fmtHM(s) + ' 시작')}${n.project ? ' · ' + esc(n.project) : ''}</p></div>
      <div class="st-btns"><button data-a="done">완료</button><button data-a="ok">확인</button></div>`;
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (e.target.closest('.st-x')) return close();
      n.read = true;
      if (a && a.dataset.a === 'done') {
        const t = findTask(n.taskId);
        if (t) setDone(t, true);
        snack('완료했어요');
      } else if (!a) {
        if (ui.hidden) ui.hidden = false;
        openSheet(n.taskId);
      }
      close();
      commit();
    });
    box.appendChild(el);
    setTimeout(close, 12000);
  }

  function backupJson() {
    return JSON.stringify({ app: 'dayline', version: 1, exportedAt: now().toISOString(), tasks: S.tasks, projects: S.projects }, null, 2);
  }
  // Windows 앱: 하루 한 번 문서\Dayline 백업 폴더에 자동 백업(최근 30일 보관)
  function autoBackup(force) {
    if (!APP || !APP.backup) return;
    const tk = todayKey();
    if (!force && S.backup && S.backup.date === tk) return;
    APP.backup(backupJson()).then((r) => {
      if (r && r.ok) {
        S.backup = { date: tk, at: now().toISOString(), dir: r.dir };
        ui.backupError = null;
        save();
        if (force) snack('백업했어요');
      } else {
        ui.backupError = (r && r.error) || '백업하지 못했어요';
        if (force) snack('백업하지 못했어요');
      }
      render();
    });
  }
  /* ---------- 한 일 내보내기(보고·AI 정리용) ---------- */
  const REPORT_RANGES = [
    ['week', '이번 주'], ['lastweek', '지난주'], ['month', '이번 달'], ['lastmonth', '지난달'], ['3m', '최근 3개월'], ['all', '전체'],
  ];
  function reportRange(key) {
    const T = startOfDay(now());
    const wk = weekDays(T);
    if (key === 'week') return [wk[0], addDays(wk[6], 1)];
    if (key === 'lastweek') return [addDays(wk[0], -7), wk[0]];
    if (key === 'month') return [new Date(T.getFullYear(), T.getMonth(), 1), new Date(T.getFullYear(), T.getMonth() + 1, 1)];
    if (key === 'lastmonth') return [new Date(T.getFullYear(), T.getMonth() - 1, 1), new Date(T.getFullYear(), T.getMonth(), 1)];
    if (key === '3m') return [new Date(T.getFullYear(), T.getMonth() - 2, 1), addDays(T, 1)];
    // 전체: 가장 오래된 기록부터
    let first = T;
    for (const t of S.tasks) {
      const cands = [t.doneAt, t.createdAt, ...(t.sessions || []).map((w) => w.s), ...Object.values(t.doneDates || {})].filter(Boolean);
      for (const c of cands) if (new Date(c) < first) first = startOfDay(new Date(c));
    }
    return [first, addDays(T, 1)];
  }
  // 기간 안의 한 일을 날짜별로 모은다: 완료한 일 + 작업 기록
  function reportData(m) {
    const [a, b] = reportRange(m.range);
    const days = new Map();
    const day = (k) => {
      if (!days.has(k)) days.set(k, new Map());
      return days.get(k);
    };
    const entry = (k, t) => {
      const d = day(k);
      const id = t.id;
      if (!d.has(id)) d.set(id, { t, done: null, sessions: [] });
      return d.get(id);
    };
    for (const t of expandRange(a, b)) {
      if (!matchesFilter(t) || !t.done || !t.doneAt) continue;
      const da = new Date(t.doneAt);
      if (da < a || da >= b) continue;
      entry(dateKey(da), t).done = da;
    }
    for (const t of S.tasks) {
      if (!t.sessions || !matchesFilter(t)) continue;
      for (const w of t.sessions) {
        const s = new Date(w.s);
        if (s < a || s >= b) continue;
        entry(dateKey(s), t).sessions.push({ s, e: w.e ? new Date(w.e) : null });
      }
    }
    const keys = [...days.keys()].sort();
    const open = [];
    if (m.includeOpen) {
      for (const t of S.tasks) {
        if (t.repeat || t.done || !matchesFilter(t)) continue;
        open.push(t);
      }
      const w = (t) => (t.sessions && t.sessions.length ? 0 : t.due ? 1 : t.date ? 2 : 3);
      open.sort((x, y) => w(x) - w(y) || (x.due ? dueMoment(x) - (y.due ? dueMoment(y) : Infinity) : 0) || x.order - y.order);
    }
    return { a, b, keys, days, open };
  }
  const projName = (t) => (proj(t.projectId) ? proj(t.projectId).name : '');
  function timeText(e) {
    const t = e.t;
    if (e.done && !e.sessions.length) {
      const iv = intervalOf(t);
      if (taskStart(t) && iv) return `${fmtHM(iv.s)}–${fmtHM(iv.e)}`;
      return `${fmtHM(e.done)} 완료`;
    }
    return e.sessions.map((w) => `${fmtHM(w.s)}–${w.e ? fmtHM(w.e) : '지금'}`).join(', ');
  }
  function reportMarkdown(m) {
    const R = reportData(m);
    const last = addDays(R.b, -1);
    const f = S.prefs.filter;
    const scope = f === 'all' ? '' : f === 'none' ? ' · 미지정' : ` · ${proj(f) ? proj(f).name : ''}`;
    let doneCount = 0;
    let sessCount = 0;
    const perProj = new Map();
    const body = [];
    for (const k of R.keys) {
      const d = fromKey(k);
      body.push(`\n## ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`);
      for (const e of R.days.get(k).values()) {
        const pn = projName(e.t);
        if (e.done) {
          doneCount++;
          perProj.set(pn || '미지정', (perProj.get(pn || '미지정') || 0) + 1);
        }
        sessCount += e.sessions.length;
        const mark = e.done ? '[x]' : '[ ] ▶';
        const meta = [pn, timeText(e)].filter(Boolean).join(' · ');
        const note = !e.done && !e.t.done ? ' (계속 진행)' : '';
        body.push(`- ${mark} ${plainTitle(e.t)}${meta ? ' — ' + meta : ''}${note}`);
        if (e.t.memo && e.t.memo.trim()) body.push(`  - 메모: ${e.t.memo.trim().replace(/\n+/g, ' / ')}`);
      }
    }
    const lines = [`# 한 일 · ${dayShort(R.a)} – ${dayShort(last)}${scope}`, '', '## 요약'];
    lines.push(`- 완료 ${doneCount}개 · 작업 기록 ${sessCount}건`);
    if (perProj.size) lines.push(`- ${[...perProj.entries()].map(([n, c]) => `${n} ${c}개`).join(' · ')}`);
    if (!R.keys.length) lines.push('- 이 기간에 기록된 한 일이 없어요');
    lines.push(...body);
    if (m.includeOpen && R.open.length) {
      lines.push('', '## 작업 중 · 남은 일');
      for (const t of R.open) {
        const bits = [projName(t)];
        if (t.sessions && t.sessions.length) bits.push(`지금까지 작업 ${durText(workMinutes(t))}`);
        if (t.due) bits.push(`마감 ${dueText(t, true).replace('까지', '')}`);
        else if (t.date) bits.push(`${dayLabel(t.date)}${t.start ? ' ' + t.start : ''}`);
        lines.push(`- ${plainTitle(t)}${bits.filter(Boolean).length ? ' — ' + bits.filter(Boolean).join(' · ') : ''}`);
      }
    }
    return lines.join('\n') + '\n';
  }
  function reportCsv(m) {
    const R = reportData(m);
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['날짜', '요일', '구분', '할 일', '프로젝트', '시작', '끝', '분', '메모']];
    for (const k of R.keys) {
      const d = fromKey(k);
      for (const e of R.days.get(k).values()) {
        const memo = (e.t.memo || '').trim();
        if (e.sessions.length) {
          for (const w of e.sessions) {
            const end = w.e || now();
            rows.push([k, WEEK[d.getDay()], e.done ? '완료(작업)' : '작업', plainTitle(e.t), projName(e.t), fmtHM(w.s), w.e ? fmtHM(w.e) : '', Math.round((end - w.s) / 60000), memo]);
          }
        } else {
          const iv = intervalOf(e.t);
          const st = taskStart(e.t);
          rows.push([k, WEEK[d.getDay()], '완료', plainTitle(e.t), projName(e.t), st ? fmtHM(iv.s) : '', st ? fmtHM(iv.e) : fmtHM(e.done), st ? Math.round((iv.e - iv.s) / 60000) : '', memo]);
        }
      }
    }
    if (m.includeOpen) {
      for (const t of R.open) {
        rows.push(['', '', t.sessions && t.sessions.length ? '작업 중' : '남은 일', plainTitle(t), projName(t), '', t.due ? `마감 ${t.due.date}${t.due.time ? ' ' + t.due.time : ''}` : t.date || '', t.sessions && t.sessions.length ? workMinutes(t) : '', (t.memo || '').trim()]);
      }
    }
    return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  function reportText(m) {
    return m.format === 'csv' ? reportCsv(m) : reportMarkdown(m);
  }
  // 첫 실행 안내(사용법 3가지 + 자동 실행 물어보기)
  function welcomeHtml(m) {
    const step = (n, title, body) => `<div class="wl-step"><i>${n}</i><div><b>${title}</b><span>${body}</span></div></div>`;
    const pill = (v, label) => `<button type="button" class="pill${m.auto === v ? ' on' : ''}" data-act="wl-auto" data-val="${v ? 1 : 0}">${label}</button>`;
    return `<div class="md-head"><b>${m.again ? 'Dayline 사용법' : 'Dayline에 오신 걸 환영해요'}</b><span class="grow"></span>${m.again ? `<button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button>` : ''}</div>
      <div class="wl-steps">
        ${step(1, '문장 그대로 입력해요', '"내일 10시 회의 #프로젝트"라고 쓰면 날짜·시간·프로젝트가 알아서 나뉘어요. "금요일까지 보고서"는 마감, "매주 월요일 9시"는 반복이 돼요.')}
        ${step(2, '계획한 시간과 실제로 한 시간', '할 일에 마우스를 올리고 ▶를 누르면 실제로 한 시간이 타임라인에 초록으로 남아요. 시간이 됐는데 못 하면 ⏰ 미루기를 눌러요.')}
        ${step(3, '작은 메모창과 트레이', '오른쪽 위 버튼으로 늘 위에 뜨는 작은 창으로 바꿀 수 있어요. ×를 눌러도 꺼지지 않고 트레이에서 알림을 보내요. 빠른 입력은 Ctrl + Shift + Space.')}
      </div>
      ${
        m.again || !APP
          ? ''
          : `<div class="wl-auto"><span><b>컴퓨터를 켤 때 Dayline도 켤까요?</b><small>나중에 설정 → 창 → 컴퓨터 켤 때에서 바꿀 수 있어요</small></span><div class="pills">${pill(true, '켜기')}${pill(false, '안 켜기')}</div></div>`
      }
      <div class="md-foot"><button class="btn ghost" data-act="wl-sample">예시 넣고 시작</button><button class="txt hp-link" data-act="wl-full">전체 사용법 보기</button><span class="grow"></span><button class="btn primary" data-act="wl-start">시작하기</button></div>`;
  }
  // 문제 알리기를 받을 메일 주소(만든 사람)
  const FEEDBACK_TO = 'kaeri8970@gmail.com';
  // 만든 사람이 배포한 Google Apps Script 웹 앱 주소(tools/feedback-apps-script.gs). 비어 있으면 메일 앱으로 보낸다
  const FEEDBACK_URL = 'https://script.google.com/macros/s/AKfycbxM1VXyYWFecDK9OFNQFf_f_0rlB9W_TJann8O4hyH8G7JftL9eYDTU4St_0hL0CaVW/exec';
  const FB_MAX_FILES = 10;
  const FB_MAX_BYTES = 15 * 1024 * 1024; // Gmail 첨부 한도(25MB) 안쪽으로
  function feedbackMail(m) {
    const subject = `[Dayline ${appInfo.version || '브라우저'}] 의견`;
    const n = (m.files || []).length;
    let body = `${(m.note || '').trim() || '(내용 없음)'}\n\n${n ? `(첨부 ${n}개: 여기에 붙여 주세요)\n\n` : ''}---\n${feedbackInfo()}`;
    // 메일 주소 줄(mailto)은 길이 제한이 있어서 인코딩한 길이로 자른다(한글은 글자당 9자)
    if (encodeURIComponent(body).length > 1800) {
      const tail = '\n…(길어서 잘림 · 복사해서 붙여넣어 주세요)';
      while (body.length && encodeURIComponent(body + tail).length > 1800) body = body.slice(0, -20);
      body += tail;
    }
    return { subject, body };
  }
  const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // 전체 사용법(설정 → 도움 → 사용법, 첫 안내의 '전체 사용법')
  const ex = (rows) => `<table class="hp-ex">${rows.map(([a, b]) => `<tr><td><code>${a}</code></td><td>${b}</td></tr>`).join('')}</table>`;
  const HELP = [
    ['input', '입력하기', `
      <p>위쪽 입력칸에 문장 그대로 쓰고 Enter. 날짜·시간·반복·마감·프로젝트는 알아서 나뉘고, 제목에는 나머지만 남아요.</p>
      <h4>날짜와 시간</h4>${ex([
        ['3시 회의', '오늘 15:00 · 오전/오후가 없으면 업무시간(기본 9~18시) 기준으로 읽어요'],
        ['내일 10시반 / 10:30 / 10시 30분', '시간 쓰는 방법은 다 돼요'],
        ['모레 · 금요일 · 다음주 수요일', '가까운 그날'],
        ['10/30 · 10월 30일', '그 날짜'],
        ['26일 회의', '가장 가까운 26일 · 이번 달에 지났으면 다음 달'],
        ['3시-4시 · 15:00~16:00 · 3시부터 4시까지', '시작과 끝'],
        ['30분 후 · 1시간 뒤', '지금부터'],
      ])}
      <h4>마감·반복·프로젝트</h4>${ex([
        ['목요일까지 보고서', '마감 · 목록에 D-n으로 보여요'],
        ['10/30 6시까지 · 이번주까지', '마감 날짜와 시각'],
        ['매일 · 평일 · 매주 월요일 · 매주 월·수 · 매월 1일', '반복'],
        ['#프로젝트', '프로젝트 · #을 치면 목록이 나와요. 없으면 새로 만들어요'],
      ])}
      <p class="hp-note">업무시간은 설정 → 업무시간에서 바꿔요. 잘못 읽었으면 할 일을 눌러 상세에서 고치면 돼요.</p>`],
    ['list', '목록', `
      <p>위에서부터 <b>작업 중</b>(▶로 기록 중이거나 이어서 할 일) → <b>할 일</b>(오늘과 지난 것, 날짜 없는 것) → <b>일정</b>(내일 이후, 날짜별) 순서예요. 일정은 그날이 되면 할 일로 올라와요.</p>
      <ul>
        <li>동그라미를 누르면 완료. 지운 일은 바로 뜨는 <b>되돌리기</b>로 살릴 수 있어요.</li>
        <li>시간 색: 초록 = 곧/지금, 주황 <b>시작 전</b> = 시간이 됐는데 아직 안 함, 빨강 <b>지남</b>.</li>
        <li>마우스를 올리면 오른쪽에 <b>▶ 시작 · ⏰ 미루기 · 삭제 · 끌기 손잡이</b>. 미루기는 30분·1시간·2시간 뒤나 내일로 옮기고 알림도 같이 옮겨요.</li>
        <li>'할 일' 제목 옆 <b>오늘 남은 N개 내일로</b>로 한 번에 미룰 수 있어요.</li>
        <li>할 일을 누르면 상세: 프로젝트·날짜(<b>내일로</b> 버튼)·시간·마감·반복·알림·메모. 반복 일정은 <b>이번만 / 앞으로 전부</b>를 골라 바꿔요.</li>
        <li>메모 아래 <b>사진</b>을 눌러 사진을 넣어요. 상세가 열린 채로 <b>Ctrl+V</b>로 캡처를 붙여넣거나 사진 파일을 끌어다 놓아도 돼요. 사진을 누르면 크게 보여요.</li>
        <li>시간 없는 할 일은 끌어서 순서를 바꾸고, 왼쪽 프로젝트 위에 놓으면 그 프로젝트로 옮겨요.</li>
      </ul>`],
    ['work', '작업 시간', `
      <p><b>시간</b>은 언제 하기로 했는지(계획), <b>작업 시간</b>은 실제로 언제 했는지예요. 둘은 따로 기록돼요.</p>
      <ul>
        <li>▶를 누르면 기록 시작, ■ 멈추기를 누르면 끝. 완료 전이라도 타임라인에 초록 블록으로 남아요.</li>
        <li>다른 일의 ▶를 누르면 하던 기록은 자동으로 멈춰요.</li>
        <li>상세의 <b>작업 시간</b>에서 기록 줄을 누르면 시작·끝을 고칠 수 있어요. 늦게 눌렀으면 시작을 앞당기면 돼요.</li>
        <li><b>+ 직접 넣기</b>로 이미 한 작업을 넣어요.</li>
        <li>타임라인에서 초록 블록을 끌어 옮기거나 아래 끝을 끌어 길이를 바꿔요.</li>
      </ul>`],
    ['timeline', '타임라인', `
      <p>위쪽 <b>타임라인</b>에서 일·주·월로 봐요. 파란 테두리는 계획, 채워진 블록은 한 일이에요.</p>
      <ul>
        <li>빈 곳을 위아래로 끌면 그 시간에 할 일을 만들어요. 지난 시간이면 <b>한 일로 완료</b>를 켤 수 있어요.</li>
        <li>블록을 끌어 옮기고, 아래 끝을 끌어 길이를 바꿔요. 왼쪽 <b>시간 미정</b>으로 끌면 시간이 지워져요.</li>
        <li>주 보기: 요일 머리를 누르면 그날 보기, 요일 사이 경계를 끌면 너비 조절(두 번 누르면 원래대로).</li>
        <li>월 보기: 날짜 숫자를 누르면 그날, <b>+N</b>을 누르면 그날 전체 목록. 할 일을 다른 날짜 칸으로 끌면 옮겨져요.</li>
        <li>마우스 뒤로/앞으로 버튼이나 Alt + ← / → 로 보던 화면으로 돌아가요.</li>
        <li>내려받기 아이콘: 한 일을 Markdown/CSV로 내보내요(주간 보고·AI 정리용).</li>
      </ul>`],
    ['cal', '옆 달력', `
      <p>큰 화면 목록에서 위쪽 달력 아이콘으로 켜고 꺼요. 창이 좁으면 숨어요.</p>
      <ul>
        <li>점: 할 일(프로젝트 색) · 마감(주황) · 한 일만 있는 날(빈 점).</li>
        <li>날짜를 누르면 아래에 그날 할 일·마감·한 일. 두 번 누르면 타임라인 그날로.</li>
        <li>맨 아래 칸에 쓰면 고른 날짜로 추가돼요. 목록의 할 일을 날짜 위로 끌면 그날로 옮겨져요.</li>
      </ul>`],
    ['notify', '알림', `
      <ul>
        <li>시간이나 마감이 있는 할 일을 넣으면 <b>미리 알려드릴까요?</b>가 떠요. 고르지 않으면 알림 없이 저장돼요.</li>
        <li>Windows 알림의 <b>완료</b>는 할 일을 완료하고, <b>확인</b>은 알림만 닫아요.</li>
        <li>지난 알림은 위쪽 종 아이콘에 모여요.</li>
        <li>알림이 안 오면: Windows 설정 → 시스템 → 알림에서 Dayline 켜기, 방해 금지 모드 확인.</li>
      </ul>`],
    ['window', '창·단축키', `
      <ul>
        <li>위쪽 작은 창 아이콘: 늘 위에 뜨는 <b>작은 메모창</b>으로 바꿔요(핀으로 고정 끄기). 큰 화면과 작은 창의 위치·크기는 따로 기억해요.</li>
        <li><b>×</b>를 눌러도 꺼지지 않고 오른쪽 아래 트레이로 숨어서 알림을 보내요. 완전히 끄려면 트레이 아이콘 우클릭 → 종료.</li>
        <li><b>Ctrl + Shift + Space</b>: 어디서든 Dayline을 띄우고 바로 입력.</li>
        <li>설정 → 창 → <b>컴퓨터 켤 때</b>: 안 켜기 / 트레이에만 / 창 열기.</li>
        <li>프로젝트 이름·색·자동 연결 단어는 왼쪽 프로젝트를 우클릭하거나 색 점을 눌러 바꿔요.</li>
        <li>프로젝트 순서는 왼쪽 목록(작은 창에서는 위쪽 칩)을 끌어서 바꿔요.</li>
      </ul>`],
    ['data', '데이터·백업', `
      <ul>
        <li>모든 데이터는 이 PC에만 저장돼요. 바뀔 때마다 자동 저장.</li>
        <li>하루 한 번 <b>문서\\Dayline 백업</b> 폴더에 자동 백업(최근 30일).</li>
        <li>설정 → <b>백업 가져오기</b>: 백업을 골라 <b>통째로 되돌리기</b> 또는 <b>합치기</b>. 되돌리기 전 상태도 따로 저장돼요.</li>
        <li><b>한 일 내보내기</b>: 기간을 골라 Markdown/CSV로 복사·저장.</li>
        <li><b>할 일 가져오기</b>: 메모장·노션 등에 적어 둔 목록을 붙여넣거나 .txt/.md 파일을 열면 한 줄씩 할 일이 돼요. 입력칸에 여러 줄을 붙여넣거나 파일을 창에 끌어다 놓아도 열려요. 끝난 줄([x])·제목 줄·비밀번호 같은 줄은 빼 두고, 체크해서 고를 수 있어요. Windows 스티커 메모도 여기서 불러와요.</li>
        <li>업데이트(새 버전 설치)를 해도 데이터는 그대로예요.</li>
      </ul>`],
  ];
  function helpHtml(m) {
    const cur = HELP.find((h) => h[0] === m.sec) || HELP[0];
    return `<div class="md-head"><b>Dayline 사용법</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <div class="hp">
        <nav class="hp-nav">${HELP.map(([id, t]) => `<button class="${id === cur[0] ? 'on' : ''}" data-act="help-sec" data-val="${id}">${t}</button>`).join('')}</nav>
        <div class="hp-body" data-scroll="help"><h3>${cur[1]}</h3>${cur[2]}</div>
      </div>
      <div class="md-foot"><span class="muted rp-hint">더 궁금한 건 설정 → 도움 → 의견 보내기로 물어봐 주세요</span><span class="grow"></span><button class="btn primary" data-act="modal-close">닫기</button></div>`;
  }
  function dataUrlToBlob(url) {
    const [head, b64] = url.split(',');
    const type = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }
  // 메일 앱으로 보낼 때: 첫 사진을 클립보드에 넣어 본문에 Ctrl+V로 붙이게 한다
  async function shotToClipboard(m) {
    const img = ((m && m.files) || []).find((f) => f.type.startsWith('image/'));
    if (!img) return false;
    try {
      if (APP && APP.copyImage) return await APP.copyImage(img.data);
      const blob = dataUrlToBlob(img.data);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch (e) {
      return false;
    }
  }
  // 같이 보내는 정보는 짧게: 버전, Windows, (있으면) 최근 오류
  function feedbackInfo() {
    const lines = [`Dayline ${appInfo.version || '(브라우저)'} · ${appInfo.os || 'Windows'}`];
    if (errLog.length) lines.push(`최근 오류 ${errLog.length}개`, ...errLog.slice(-5).map((x) => `- ${localStamp(new Date(x.at))} ${x.msg.slice(0, 160)}`));
    return lines.join('\n');
  }
  function feedbackHtml(m) {
    const files = m.files || [];
    const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
    const tiles = files
      .map(
        (f) => `<div class="fb-file">${f.type.startsWith('image/') ? `<img src="${f.data}" alt="">` : `<i>${icon('note', 18)}</i>`}<span title="${esc(f.name)}">${esc(f.name)}<small>${kb(f.size)}</small></span><button class="ibtn" data-act="fb-file-del" data-val="${f.id}" aria-label="빼기">${icon('x', 12)}</button></div>`,
      )
      .join('');
    return `<div class="md-head"><b>의견 보내기</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <p class="md-p">문제가 생겼거나 바라는 점이 있으면 적어서 <b>보내기</b>를 눌러 주세요.<br>만든 사람(${FEEDBACK_TO})에게 가요.</p>
      <div class="fb-body${m.sending ? ' sending' : ''}">
        <textarea class="paste" data-mbind="note" data-keep="fb-note" rows="4" placeholder="예) 타임라인에서 블록을 끌었는데 시간이 안 바뀌어요.&#10;예) 할 일에 체크리스트도 넣을 수 있으면 좋겠어요.">${esc(m.note || '')}</textarea>
        <div class="fb-drop${files.length ? ' has' : ''}">
          ${tiles ? `<div class="fb-files">${tiles}</div>` : ''}
          <div class="fb-drop-row"><span class="fb-hint">사진은 <b>Ctrl+V</b> · 파일은 끌어다 놓기${files.length ? ` · ${files.length}/${FB_MAX_FILES}` : ''}</span>
            <button class="pill" data-act="fb-file-add">${icon('upload', 13)}파일 추가</button></div>
        </div>
        <input class="fb-reply" data-mbind="reply" data-keep="fb-reply" type="email" placeholder="답장 받을 메일 (선택)" value="${esc(m.reply || '')}">
        ${m.error ? `<p class="fb-err">${esc(m.error)}</p>` : ''}
        <p class="fb-meta">같이 보내는 정보: ${esc(feedbackInfo().split('\n')[0])}${errLog.length ? ` · 최근 오류 ${errLog.length}개` : ''}</p>
      </div>
      <div class="md-foot fb-foot"><span class="grow"></span>
        <button class="btn ghost" data-act="fb-copy">글만 복사</button>
        <button class="btn primary${m.sending ? ' sk' : ''}" data-act="fb-send" ${m.sending ? 'disabled aria-busy="true"' : ''}>보내기</button></div>`;
  }
  // 문제 알리기 첨부: 사진·파일 여러 개(최대 10개, 합쳐서 15MB)
  async function addFeedbackFiles(list) {
    const m = ui.modal;
    if (!m || m.type !== 'feedback') return;
    m.files = m.files || [];
    let total = m.files.reduce((a, f) => a + f.size, 0);
    let skipped = 0;
    for (const f of list) {
      if (!f || m.files.length >= FB_MAX_FILES || total + f.size > FB_MAX_BYTES) {
        skipped++;
        continue;
      }
      const data = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(f);
      });
      if (!data) continue;
      if (m.files.some((x) => x.size === f.size && x.data === data)) continue; // 같은 걸 또 붙였으면 건너뛴다
      total += f.size;
      const ext = ((f.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
      m.files.push({ id: uid(), name: f.name && f.name !== 'image.png' ? f.name : `스크린샷-${m.files.length + 1}.${ext}`, type: f.type || 'application/octet-stream', size: f.size, data });
    }
    if (skipped) snack(`${skipped}개는 못 넣었어요 · 최대 ${FB_MAX_FILES}개, 합쳐서 15MB까지예요`);
    if (ui.modal === m) render();
  }
  function restoreHtml(m) {
    const x = `<button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button>`;
    if (m.pick) {
      const d = m.pick.data;
      const doneN = d.tasks.filter((t) => t.done).length;
      return `<div class="md-head"><button class="ibtn" data-act="rs-back" aria-label="뒤로">${icon('chevLeft', 16)}</button><b>백업 가져오기</b><span class="grow"></span>${x}</div>
        <div class="rs-sum">
          <b>${esc(m.pick.label)}</b>
          <span>할 일 ${d.tasks.length}개${doneN ? ` (완료 ${doneN})` : ''} · 프로젝트 ${d.projects.length}개</span>
          <small>지금: 할 일 ${S.tasks.length}개 · 프로젝트 ${S.projects.length}개</small>
        </div>
        <div class="rs-opts">
          <button class="rs-opt main" data-act="rs-replace"><b>이 백업으로 되돌리기</b><span>지금 할 일과 프로젝트를 이 백업 내용으로 바꿔요. ${APP ? '바꾸기 전 상태는 백업 폴더에 따로 저장해 둬요.' : '바로 뒤에 나오는 되돌리기로 취소할 수 있어요.'}</span></button>
          <button class="rs-opt" data-act="rs-merge"><b>합치기</b><span>지금 데이터는 그대로 두고, 백업에만 있는 할 일을 더해요.</span></button>
        </div>`;
    }
    let list = '';
    if (APP && APP.listBackups) {
      if (m.loading) list = '<p class="md-p muted">백업을 찾는 중…</p>';
      else if (m.error) list = `<p class="md-p warn">${esc(m.error)}</p>`;
      else if (!m.list || !m.list.length) list = '<p class="md-p muted">아직 자동 백업이 없어요.</p>';
      else
        list = `<div class="rs-list">${m.list
          .map(
            (it) => `<button class="rs-item" data-act="rs-pick" data-val="${esc(it.file)}" ${it.tasks == null ? 'disabled' : ''}>
              <span class="rs-d"><b>${esc(backupLabel(it.at))}</b><small>${it.before ? '되돌리기 직전 상태' : '자동 백업'}</small></span>
              <span class="rs-n">${it.tasks == null ? '읽을 수 없음' : `할 일 ${it.tasks}개`}</span>${icon('chevRight', 14)}
            </button>`
          )
          .join('')}</div>`;
    }
    return `<div class="md-head"><b>백업 가져오기</b><span class="grow"></span>${x}</div>
      <p class="md-p">데이터가 사라지거나 잘못 바뀌었을 때 예전 상태로 되돌려요.${APP ? ' 백업을 고르세요.' : ''}</p>
      ${list}
      <div class="md-foot"><span class="muted rs-hint">${APP ? '내보낸 백업 파일(.json)도 쓸 수 있어요' : '내보낸 백업 파일(.json)을 고르세요'}</span><span class="grow"></span><button class="btn ${APP ? 'ghost' : 'primary'}" data-act="rs-file">파일에서 고르기</button></div>`;
  }
  function reportHtml(m) {
    const txt = reportText(m);
    const preview = m.format === 'csv' ? txt.replace(/^\ufeff/, '') : txt;
    const pill = (act, val, on, label) => `<button type="button" class="pill${on ? ' on' : ''}" data-act="${act}" data-val="${val}">${label}</button>`;
    return `<div class="md-head"><b>한 일 내보내기</b><span class="grow"></span><button class="ibtn" data-act="modal-close" aria-label="닫기">${icon('x', 16)}</button></div>
      <div class="rp-body">
        <div class="rp-row"><span>기간</span><div class="pills">${REPORT_RANGES.map(([v, l]) => pill('report-range', v, m.range === v, l)).join('')}</div></div>
        <div class="rp-row"><span>형식</span><div class="pills">${pill('report-format', 'md', m.format === 'md', 'Markdown · 읽기/AI용')}${pill('report-format', 'csv', m.format === 'csv', 'CSV · 엑셀용')}</div></div>
        <div class="rp-row"><span>포함</span><div class="pills">${pill('report-incl', 'toggle', m.includeOpen, `${m.includeOpen ? icon('check', 12) : ''}작업 중 · 남은 일`)}</div></div>
        ${S.prefs.filter !== 'all' ? `<p class="rp-note">지금 고른 프로젝트(${esc(S.prefs.filter === 'none' ? '미지정' : proj(S.prefs.filter) ? proj(S.prefs.filter).name : '')})만 내보내요. 전체를 원하면 왼쪽에서 '전체'를 고르세요.</p>` : ''}
        <pre class="rp-preview" data-scroll="report">${esc(preview)}</pre>
      </div>
      <div class="md-foot">
        <span class="muted rp-hint">AI에 붙여넣고 "주간 보고로 정리해 줘"처럼 쓰면 돼요</span>
        <span class="grow"></span>
        <button class="btn ghost" data-act="report-copy">복사</button>
        <button class="btn primary" data-act="report-save">파일로 저장</button>
      </div>`;
  }
  function downloadText(text, name, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e2) { /* 무시 */ }
      ta.remove();
      return ok;
    }
  }
  function exportBackup() {
    const blob = new Blob([backupJson()], { type: 'application/json' });
    const a = document.createElement('a');
    const d = now();
    a.href = URL.createObjectURL(blob);
    a.download = `dayline-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    snack('백업 파일을 내려받았어요');
    render();
  }
  // 백업 되살리기: 자동 백업 목록이나 파일에서 고른 뒤 '통째로 되돌리기' 또는 '합치기'
  function parseBackup(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'dayline' || !Array.isArray(data.tasks)) throw new Error('형식');
    // 손상되거나 모양이 다른 항목은 걸러서 앱이 깨지지 않게 한다
    data.tasks = data.tasks
      .filter((t) => t && typeof t === 'object' && t.id != null)
      .map((t) => {
        t.id = String(t.id);
        t.text = String(t.text != null ? t.text : t.title != null ? t.title : '');
        t.spans = Array.isArray(t.spans) ? t.spans : [];
        if (t.memo == null) t.memo = '';
        if (t.repeat) {
          t.doneDates = t.doneDates || {};
          t.skipDates = t.skipDates || [];
        }
        return t;
      });
    data.projects = (Array.isArray(data.projects) ? data.projects : []).filter((x) => x && x.id != null && x.name != null);
    return data;
  }
  function backupLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '날짜 모름';
    const k = dateKey(d);
    const r = relDay(k);
    return `${r.includes('/') ? dayShort(d) : r} ${fmtHM(d)}`;
  }
  function openRestore() {
    ui.modal = { type: 'restore', list: null, loading: !!(APP && APP.listBackups), pick: null };
    render();
    if (!(APP && APP.listBackups)) return;
    const m = ui.modal;
    APP.listBackups().then((r) => {
      m.loading = false;
      if (r && r.ok) m.list = r.items;
      else m.error = (r && r.error) || '백업 목록을 읽지 못했어요';
      if (ui.modal === m) render();
    });
  }
  function pickBackup(text, label) {
    try {
      const data = parseBackup(text);
      if (!ui.modal || ui.modal.type !== 'restore') ui.modal = { type: 'restore', list: null, pick: null, shown: true };
      ui.modal.pick = { data, label };
    } catch (e) {
      snack('가져오지 못했어요 · Dayline 백업 파일이 맞는지 확인해 주세요');
    }
    render();
  }
  function importBackup(file) {
    const fr = new FileReader();
    fr.onload = () => pickBackup(fr.result, file.name);
    fr.readAsText(file);
  }
  function mergeBackup(data) {
    const snap = JSON.stringify({ tasks: S.tasks, projects: S.projects });
    let added = 0;
    let skipped = 0;
    for (const p of data.projects) {
      if (!S.projects.some((x) => x.id === p.id || x.name === p.name)) S.projects.push(p);
    }
    for (const t of data.tasks) {
      if (S.tasks.some((x) => x.id === t.id)) {
        skipped++;
        continue;
      }
      const p = data.projects.find((x) => x.id === t.projectId);
      if (p) {
        const mine = S.projects.find((x) => x.name === p.name);
        if (mine) t.projectId = mine.id;
      }
      S.tasks.push(t);
      added++;
    }
    ui.modal = null;
    snack(`${added}개 더했어요${skipped ? ` · ${skipped}개는 이미 있어서 건너뛰었어요` : ''}`, added ? { undo: { full: snap } } : undefined);
    commit();
  }
  function replaceFromBackup(data, label) {
    const before = backupJson();
    const snap = JSON.stringify({ tasks: S.tasks, projects: S.projects });
    // 바꾸기 전 상태를 백업 폴더에 따로 남긴다(목록에 '되돌리기 직전'으로 보임)
    if (APP && APP.backup && S.tasks.length) APP.backup(before, 'before');
    S.tasks.splice(0, S.tasks.length, ...data.tasks);
    S.projects.splice(0, S.projects.length, ...data.projects);
    const f = S.prefs.filter;
    if (f && f !== 'all' && f !== 'none' && !S.projects.some((p) => p.id === f)) S.prefs.filter = 'all';
    ui.modal = null;
    closeSheet();
    snack(`${label} 백업으로 되돌렸어요`, { undo: { full: snap }, until: Date.now() + 10000 });
    commit();
  }

  const ACTIONS = {
    open: (el) => openSheet(el.dataset.id),
    work: (el) => {
      const t = findTask(el.dataset.id);
      if (!t || t.seriesId || t.repeat) return;
      if (workingOn(t)) {
        const m = stopWork(t);
        snack(m ? `작업 ${durText(m)} 기록했어요 · 타임라인에 남아요` : '1분이 안 돼서 기록하지 않았어요');
      } else {
        if (t.done) setDone(t, false);
        snack(`작업 시작 · 멈추면 그 시간이 타임라인에 남아요${startWork(t)}`);
      }
      commit();
    },
    // 계획 시간이 된 일을 바로 시작(반복 회차면 이번 회차만 떼어 내서)
    'work-go': (el) => {
      const t0 = findTask(el.dataset.id);
      if (!t0 || t0.done) return;
      const t = t0.seriesId ? detach(t0) : t0;
      ui.snooze = null;
      snack(`작업 시작 · 멈추면 그 시간이 타임라인에 남아요${startWork(t)}`);
      commit();
    },
    'snooze-open': (el) => {
      ui.snooze = ui.snooze === el.dataset.id ? null : el.dataset.id;
      render();
    },
    snooze: (el) => {
      const t0 = findTask(el.dataset.id);
      if (!t0) return;
      const snap = snapshot();
      const v = el.dataset.val;
      const t = snoozeTask(t0, v === 'tomorrow' ? v : +v);
      ui.snooze = null;
      const s = taskStart(t);
      snack(v === 'tomorrow' ? `내일(${dayShort(addDays(startOfDay(now()), 1))})로 미뤘어요` : `${t.date === todayKey() ? '' : relDay(t.date) + ' '}${fmtHM(s)}로 미뤘어요${reminderAt(t) ? ' · 알림도 옮겼어요' : ''}`, { undo: { snap } });
      commit();
    },
    // 작업 중인 기록의 시작을 앞당긴다(지금 기준 N분 전부터 한 것으로)
    'work-shift': (el) => {
      const t = findTask(el.dataset.id);
      const w = t && (t.sessions || []).find((x) => !x.e);
      if (!w) return;
      const st = new Date(now().getTime() - +el.dataset.min * 60000);
      w.s = st.toISOString();
      snack(`${fmtHM(st)}부터 작업한 것으로 바꿨어요`);
      commit();
    },
    'work-add': (el) => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      const mins = +el.dataset.min;
      const r = runningWork();
      const end = r && r.t === t ? new Date(r.w.s) : now();
      t.sessions = t.sessions || [];
      t.sessions.push({ id: uid(), s: new Date(end - mins * 60000).toISOString(), e: end.toISOString() });
      t.sessions.sort((a, b) => a.s.localeCompare(b.s));
      snack(`${fmtHM(new Date(end - mins * 60000))}–${fmtHM(end)} 작업을 기록했어요 · 타임라인에서 끌어 고칠 수 있어요`);
      commit();
    },
    'we-open': (el) => {
      const sid = el.dataset.sid;
      ui.sheet.wEdit = ui.sheet.wEdit && ui.sheet.wEdit.sid === sid ? null : { sid, edge: 's' };
      ui.tcOpen = ui.sheet.wEdit ? `ws:${sid}:s` : null;
      ui.sheet.restoreScroll = true;
      render();
    },
    'we-edge': (el) => {
      ui.sheet.wEdit.edge = el.dataset.val;
      ui.sheet.restoreScroll = true;
      render();
    },
    'we-hour': (el) => weSet(el, 'h'),
    'we-min': (el) => weSet(el, 'm'),
    'we-new': (el) => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      const r = runningWork();
      const n5 = new Date(Math.floor(now().getTime() / 300000) * 300000);
      const end = r && r.t === t ? new Date(r.w.s) : n5;
      const w = { id: uid(), s: new Date(end - 30 * 60000).toISOString(), e: end.toISOString() };
      t.sessions = t.sessions || [];
      t.sessions.push(w);
      t.sessions.sort((a, b) => a.s.localeCompare(b.s));
      ui.sheet.wEdit = { sid: w.id, edge: 's' };
      ui.tcOpen = `ws:${w.id}:s`;
      ui.sheet.restoreScroll = true;
      snack(`${fmtHM(new Date(w.s))}–${fmtHM(end)} 작업을 넣었어요 · 시작·끝을 골라 고치세요`);
      commit();
    },
    'work-del': (el) => {
      const t = findTask(el.dataset.id);
      if (!t || !t.sessions) return;
      const snap = snapshot();
      t.sessions = t.sessions.filter((w) => w.id !== el.dataset.sid);
      if (ui.sheet && ui.sheet.wEdit && ui.sheet.wEdit.sid === el.dataset.sid) ui.sheet.wEdit = null;
      snack('작업 기록을 지웠어요', { undo: { snap } });
      commit();
    },
    toggle: (el) => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      const v = !t.done;
      setDone(t, v);
      if (v && t.seriesId) {
        const nx = nextInstance(seriesOf(t), addDays(fromKey(t.date), 1));
        snack(`완료했어요${nx ? ` · 다음 회차 ${relDayFull(nx.date)}` : ''}`);
      } else if (v) snack('완료했어요 · 타임라인에 기록돼요');
      commit();
    },
    'qi-clear': (el) => {
      ui.draft = '';
      ui.draftProject = null;
      ui.noAutoPj = false;
      if (hashState.open) closeHash();
      render();
      const inp = document.querySelector('.qi-input');
      if (inp) inp.focus();
    },
    'qi-auto': (el) => {
      ui.noAutoPj = el.dataset.val === 'off';
      updateHints();
    },
    filter: (el) => {
      S.prefs.filter = el.dataset.val;
      ui.chipsReveal = true;
      commit();
    },
    'chips-nav': (el) => {
      const sc = document.querySelector('[data-chips]');
      if (sc) sc.scrollBy({ left: +el.dataset.val * Math.max(120, sc.clientWidth * 0.7), behavior: 'smooth' });
    },
    fold: (el) => {
      const k = el.dataset.val;
      if (k === 'done') ui.showDone = !ui.showDone;
      else {
        const cur = ui.showLater == null ? true : ui.showLater;
        ui.showLater = !cur;
      }
      render();
    },
    mode: (el) => {
      S.prefs.mode = el.dataset.val;
      if (el.dataset.view) S.prefs.view = el.dataset.view;
      if (APP) APP.setMode(S.prefs.mode);
      closeSheet();
      ui.inbox = false;
      ui.modal = null;
      commit();
    },
    view: (el) => {
      S.prefs.view = el.dataset.val;
      commit();
    },
    pin: () => {
      S.prefs.pinned = !S.prefs.pinned;
      if (APP) APP.setPinned(S.prefs.pinned);
      snack(S.prefs.pinned ? (APP ? '작은 메모창을 항상 위에 고정했어요' : '항상 위에 고정했어요 · 실제 고정은 앱 버전에서 동작해요') : '고정을 풀었어요');
      commit();
    },
    inbox: () => {
      ui.inbox = !ui.inbox;
      closeSheet();
      render();
    },
    'inbox-ack': (el) => {
      const n = S.notifications.find((x) => x.id === el.dataset.nid);
      if (n) n.read = true;
      commit();
    },
    'inbox-ackall': () => {
      S.notifications.forEach((n) => (n.read = true));
      commit();
    },
    'inbox-open': (el) => {
      const n = S.notifications.find((x) => x.id === el.dataset.nid);
      if (n) n.read = true;
      save();
      openSheet(el.dataset.id);
    },
    settings: () => {
      ui.modal = { type: 'settings' };
      ui.inbox = false;
      render();
    },
    'modal-close': () => {
      const back = ui.modal && ui.modal.back;
      ui.modal = back ? { type: back.type, shown: true } : null;
      render();
      if (back && back.scroll) {
        const sc = document.querySelector('.modal.settings .md-scroll');
        if (sc) sc.scrollTop = back.scroll;
      }
    },
    'add-project': () => {
      ui.modal = { type: 'project', id: null, name: '', color: nextColor(), kw: '' };
      render();
    },
    'report-open': () => {
      const tl = S.prefs.view === 'timeline' && S.prefs.mode === 'big';
      const range = tl && S.prefs.tlMode === 'month' ? 'month' : 'week';
      ui.modal = { type: 'report', range, format: 'md', includeOpen: true };
      render();
    },
    'report-range': (el) => {
      ui.modal.range = el.dataset.val;
      render();
    },
    'report-format': (el) => {
      ui.modal.format = el.dataset.val;
      render();
    },
    'report-incl': () => {
      ui.modal.includeOpen = !ui.modal.includeOpen;
      render();
    },
    'report-copy': async () => {
      const m = ui.modal;
      const ok = await copyText(reportText(m).replace(/^\ufeff/, ''));
      snack(ok ? '복사했어요 · AI 채팅창이나 메모에 붙여넣으세요' : '복사하지 못했어요 · 파일로 저장을 써 주세요');
      render();
    },
    'report-save': () => {
      const m = ui.modal;
      const [a, b] = reportRange(m.range);
      const last = addDays(b, -1);
      const k = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      const name = `dayline-done-${k(a)}-${k(last)}.${m.format === 'csv' ? 'csv' : 'md'}`;
      downloadText(reportText(m), name, m.format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8');
      snack('파일로 저장했어요');
      render();
    },
    'edit-project': (el, e) => {
      e.stopPropagation();
      const p = proj(el.dataset.id);
      if (p) ui.modal = { type: 'project', id: p.id, name: p.name, color: p.color, kw: (p.keywords || []).join(', ') };
      render();
    },
    'pj-color': (el) => {
      ui.modal.color = el.dataset.val;
      render();
    },
    'pj-save': () => {
      const m = ui.modal;
      const name = (m.name || '').trim();
      if (!name) {
        snack('프로젝트 이름을 입력해 주세요');
        return render();
      }
      if (S.projects.some((p) => p.name === name && p.id !== m.id)) {
        snack('같은 이름의 프로젝트가 있어요');
        return render();
      }
      const keywords = String(m.kw || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
      if (m.id) Object.assign(proj(m.id), { name, color: m.color, keywords });
      else S.projects.push({ id: uid(), name, color: m.color, keywords });
      ui.modal = null;
      commit();
    },
    'pj-delete': () => {
      const m = ui.modal;
      if (!m.confirmDel) {
        m.confirmDel = true;
        return render();
      }
      S.tasks.forEach((t) => {
        if (t.projectId === m.id) t.projectId = null;
      });
      S.projects = S.projects.filter((p) => p.id !== m.id);
      if (S.prefs.filter === m.id) S.prefs.filter = 'all';
      ui.modal = null;
      snack('프로젝트를 삭제했어요');
      commit();
    },
    'prompt-pick': (el) => {
      const t = findTask(ui.prompt && ui.prompt.id);
      ui.prompt = null;
      if (!t) return render();
      t.reminder = +el.dataset.min;
      target(t).reminder = t.reminder;
      const r = reminderAt(t);
      snack(r < now() ? '알림 시각이 이미 지났어요 · 시간을 확인해 주세요' : `${relDay(dateKey(r))} ${fmtHM(r)}에 알려드려요`);
      askPermissionOnce();
      commit();
    },
    'prompt-more': () => {
      const id = ui.prompt && ui.prompt.id;
      ui.prompt = null;
      if (id) openSheet(id, 'rem');
    },
    'prompt-skip': () => {
      ui.prompt = null;
      render();
    },
    'sheet-close': () => {
      closeSheet();
      render();
    },
    'img-add': () => document.getElementById('file-img').click(),
    'img-del': (el) => {
      const d = ui.sheet && ui.sheet.d;
      if (!d) return;
      d.images = (d.images || []).filter((x) => x.id !== el.dataset.id);
      render();
    },
    'img-view': (el) => {
      ui.lightbox = { id: el.dataset.id };
      render();
    },
    'lb-close': (el, e) => {
      if (el.classList.contains('lightbox') && e && e.target.closest('img, .lb-bar')) return; // 사진·아래 막대를 누른 건 닫기가 아님
      ui.lightbox = null;
      render();
    },
    'lb-step': (el) => {
      const d = ui.sheet && ui.sheet.d;
      if (!d || !ui.lightbox) return;
      const n = d.images.length;
      const i = d.images.findIndex((x) => x.id === ui.lightbox.id);
      ui.lightbox = { id: d.images[(i + +el.dataset.val + n) % n].id };
      render();
    },
    'lb-open': () => {
      const d = ui.sheet && ui.sheet.d;
      const im = d && (d.images || []).find((x) => x.id === (ui.lightbox && ui.lightbox.id));
      if (im && im.file && APP && APP.openImage) APP.openImage(im.file);
    },
    'sheet-save': saveSheet,
    'sheet-delete': () => deleteTask(ui.sheet.id),
    'row-delete': (el) => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      deleteTask(t.id, t.seriesId ? 'one' : undefined);
    },
    'sheet-scope': (el) => {
      const sh = ui.sheet;
      const v = el.dataset.val;
      const ask = sh.ask;
      sh.ask = null;
      if (v === 'cancel') return render();
      if (ask === 'delete') return deleteTask(sh.id, v);
      sh.scope = v;
      saveSheet();
    },
    'sh-rep': (el) => {
      const d = ui.sheet.d;
      d.repeatFreq = el.dataset.val;
      if (d.repeatFreq === 'weekly' && !d.repeatDays.length) d.repeatDays = [(d.date ? fromKey(d.date) : now()).getDay()];
      render();
    },
    'sh-repday': (el) => {
      const d = ui.sheet.d;
      const w = +el.dataset.val;
      d.repeatDays = d.repeatDays.includes(w) ? d.repeatDays.filter((x) => x !== w) : [...d.repeatDays, w];
      if (!d.repeatDays.length) d.repeatDays = [w];
      render();
    },
    'sheet-done': () => {
      ui.sheet.d.done = !ui.sheet.d.done;
      render();
    },
    'sh-clear': (el, e) => {
      e.preventDefault();
      const k = el.dataset.val;
      const sd = ui.sheet.d;
      sd[k] = '';
      if (k === 'time') {
        sd.start = '';
        sd.end = '';
        if (!sd.due) sd.reminder = null;
      }
      if (k === 'due') sd.dueTime = '';
      if ((k === 'start' && !sd.due) || (k === 'due' && !sd.start)) sd.reminder = null;
      if ((k === 'due' || k === 'dueTime') && !sd.start && sd.reminder != null && !dueRemOpts(draftDue(sd)).some(([v]) => v === sd.reminder)) sd.reminder = null;
      if (ui.sheet.picker === k) ui.sheet.picker = null;
      ui.sheet.restoreScroll = true;
      render();
    },
    'sh-apply-recog': () => {
      const d = ui.sheet.d;
      const info = recogInfo(d);
      if (!info) return;
      const r = info.r;
      if (r.start) d.start = r.start;
      if (r.end) {
        d.endMode = 'end';
        d.end = r.end;
      }
      if (r.repeat) {
        d.repeatFreq = r.repeat.freq;
        d.repeatDays = r.repeat.days ? [...r.repeat.days] : [];
        if (!d.date || !P.matchRepeat(r.repeat, fromKey(d.date), d.date)) d.date = r.date;
      } else if (r.date) {
        d.date = r.date;
      }
      if (r.due) {
        d.due = r.due.date;
        d.dueTime = r.due.time || '';
      }
      render();
    },
    'sh-proj': (el) => {
      ui.sheet.d.projectId = el.dataset.val;
      render();
    },
    'sh-pick': (el) => {
      const k = el.dataset.val;
      if (!ui.sheet.picker) {
        const sc = document.querySelector('[data-scroll="sheet"]');
        ui.sheet.scrollBefore = sc ? sc.scrollTop : 0;
      }
      ui.sheet.picker = ui.sheet.picker === k ? null : k;
      if (k === 'time') ui.tcOpen = ui.sheet.picker ? 'start' : null; // 열면 시작 목록부터
      if (k === 'dueTime') ui.tcOpen = ui.sheet.picker ? 'dueTime' : null;
      if (!ui.sheet.picker) ui.sheet.restoreScroll = true;
      else ui.sheet.revealPicker = true;
      ui.sheet.cal = null;
      ui.sheet.ampm = null;
      render();
    },
    'cal-move': (el) => {
      const d = ui.sheet.d;
      const ck = el.dataset.key || 'date';
      const base = ui.sheet.cal ? fromKey(ui.sheet.cal) : d[ck] ? fromKey(d[ck]) : startOfDay(now());
      ui.sheet.cal = dateKey(new Date(base.getFullYear(), base.getMonth() + +el.dataset.val, 1));
      render();
    },
    'pick-date': (el) => {
      ui.sheet.d[el.dataset.key || 'date'] = el.dataset.val;
      ui.sheet.picker = null;
      ui.sheet.restoreScroll = true;
      ui.sheet.cal = null;
      render();
    },
    'pick-ampm': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      ui.sheet.ampm = el.dataset.val;
      if (d[k]) {
        let [h, m] = d[k].split(':').map(Number);
        if (el.dataset.val === 'pm' && h < 12) h += 12;
        if (el.dataset.val === 'am' && h >= 12) h -= 12;
        d[k] = hm(h, m);
      }
      render();
    },
    'pick-hour': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      const prev = d[k] ? d[k].split(':').map(Number) : null;
      if (k === 'start' && !prev && d.due) d.reminder = null;
      const pm = prev ? prev[0] >= 12 : ui.sheet.ampm ? ui.sheet.ampm === 'pm' : k === 'dueTime' || now().getHours() >= 12;
      const h12 = +el.dataset.val;
      const h = (h12 % 12) + (pm ? 12 : 0);
      d[k] = hm(h, prev ? prev[1] : 0);
      if (k === 'start' && !d.date) d.date = todayKey();
      if (k === 'dueTime' && !d.due) d.due = todayKey();
      render();
    },
    'pick-min': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      if (!d[k]) return;
      const h = +d[k].split(':')[0];
      d[k] = hm(h, +el.dataset.val);
      ui.sheet.picker = null;
      ui.sheet.restoreScroll = true;
      render();
    },
    'to-tomorrow': (el) => {
      const t0 = findTask(el.dataset.id);
      if (!t0) return;
      const snap = snapshot();
      moveToTomorrow(t0);
      snack(`내일(${dayShort(addDays(startOfDay(now()), 1))})로 미뤘어요`, { undo: { snap } });
      commit();
    },
    'all-tomorrow': () => {
      const L = listSections();
      const list = [...L.untimed, ...L.past, ...L.upcoming].filter((t) => !t.seriesId && !t.repeat && t.date && t.date <= todayKey());
      if (!list.length) return;
      const snap = snapshot();
      list.forEach(moveToTomorrow);
      snack(`${list.length}개를 내일로 미뤘어요`, { undo: { snap } });
      commit();
    },
    'qi-pj-clear': () => {
      ui.draftProject = null;
      render();
      const q = document.querySelector('.qi-input');
      if (q) q.focus();
    },
    'qn-done': () => {
      ui.quickNew.done = !ui.quickNew.done;
      render();
    },
    'qn-cancel': () => {
      ui.quickNew = null;
      render();
    },
    'qn-save': () => saveQuickNew(),
    'sh-later': () => {
      const d = ui.sheet.d;
      const T = startOfDay(now());
      const base = d.date && d.date > todayKey() ? fromKey(d.date) : T;
      d.date = dateKey(addDays(base, 1));
      if (ui.sheet.picker === 'date') ui.sheet.picker = null;
      render();
    },
    'tc-pick': (el) => tcApply(el.dataset.id, el.dataset.val),
    'tc-clear': (el) => {
      const id = el.dataset.id;
      if (id === 'end' && ui.sheet) {
        ui.sheet.d.end = null;
        ui.tcOpen = null;
        render();
      }
    },
    'rg-edge': (el) => {
      ui.sheet.edge = el.dataset.val;
      render();
    },
    'rg-hour': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      const prev = d[k] ? +d[k].split(':')[1] : 0;
      d[k] = hm(+el.dataset.val, prev);
      if (k === 'start') {
        if (!d.date) d.date = todayKey();
        if (!prev && !d.end) d.reminder = d.due ? null : d.reminder;
      }
      render();
    },
    'rg-min': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      if (!d[k]) return;
      d[k] = hm(+d[k].split(':')[0], +el.dataset.val);
      if (k === 'start' && !d.end) ui.sheet.edge = 'end'; // 시작을 고르면 끝으로 넘어간다
      else if (k === 'end') {
        ui.sheet.picker = null;
        ui.sheet.restoreScroll = true;
      }
      render();
    },
    'rg-dur': (el) => {
      const d = ui.sheet.d;
      if (!d.start) return;
      d.end = minToHM((hmToMin(d.start) + +el.dataset.val) % 1440);
      d.endMode = 'end';
      render();
    },
    'pick-hour24': (el) => {
      const d = ui.sheet.d;
      const k = el.dataset.key;
      const prev = d[k] ? +d[k].split(':')[1] : 0;
      d[k] = hm(+el.dataset.val, prev);
      if (k === 'dueTime' && !d.due) d.due = todayKey();
      render();
    },
    'sh-endmode': (el) => {
      ui.sheet.d.endMode = el.dataset.val;
      render();
    },
    'sh-dur': (el) => {
      const v = +el.dataset.val;
      ui.sheet.d.duration = ui.sheet.d.duration === v ? null : v;
      render();
    },
    'sh-rem': (el) => {
      ui.sheet.d.reminder = el.dataset.val === 'none' ? null : +el.dataset.val;
      render();
    },
    undo: () => {
      const u = ui.snack && ui.snack.undo;
      if (!u) return;
      if (u.full) {
        const f = JSON.parse(u.full);
        S.tasks.splice(0, S.tasks.length, ...f.tasks);
        S.projects.splice(0, S.projects.length, ...f.projects);
      } else if (u.snap) restore(u.snap);
      else S.tasks.splice(Math.min(u.index, S.tasks.length), 0, u.task);
      ui.snack = null;
      snack('되돌렸어요');
      commit();
    },
    'retry-save': () => {
      save();
      snack(ui.saveError ? '아직 저장하지 못했어요' : '저장했어요');
      render();
    },
    'tl-move': (el) => {
      const base = S.prefs.anchor ? fromKey(S.prefs.anchor) : startOfDay(now());
      if (S.prefs.tlMode === 'month') {
        S.prefs.anchor = dateKey(new Date(base.getFullYear(), base.getMonth() + +el.dataset.val, 1));
        return commit();
      }
      const step = S.prefs.tlMode === 'week' ? 7 : 1;
      S.prefs.anchor = dateKey(addDays(base, step * +el.dataset.val));
      commit();
    },
    'wl-auto': (el) => {
      ui.modal.auto = el.dataset.val === '1';
      render();
    },
    'wl-start': () => {
      const m = ui.modal;
      ui.modal = null;
      if (m && !m.again && m.auto != null && APP && APP.setAutostart) {
        APP.setAutostart(m.auto).then((v) => {
          appInfo.autostart = v;
          render();
        });
        snack(m.auto ? '컴퓨터를 켤 때 Dayline도 켜져요' : '자동 실행은 꺼 둘게요 · 설정에서 바꿀 수 있어요');
      }
      render();
    },
    'wl-sample': () => {
      const m = ui.modal;
      for (const text of ['오늘 6시 주간 업무 정리 #업무', '내일 10시 팀 회의 #업무', '다음주 금요일까지 기획서 초안 #업무', '매주 월요일 9시 메일 정리']) createTask(text, { noFilter: true });
      ACTIONS['wl-start']();
      if (!(m && m.auto != null && APP)) snack('예시 할 일을 넣었어요 · 다 보면 지워도 돼요');
      commit();
    },
    'help-open': () => {
      ui.modal = { type: 'help', sec: 'input' };
      render();
    },
    'help-sec': (el) => {
      ui.modal.sec = el.dataset.val;
      render();
      const b = document.querySelector('.hp-body');
      if (b) b.scrollTop = 0;
    },
    'wl-full': () => {
      ACTIONS['wl-start']();
      ui.modal = { type: 'help', sec: 'input' };
      render();
    },
    'fb-open': () => {
      ui.modal = { type: 'feedback', note: '' };
      render();
    },
    'fb-send': async () => {
      const m = ui.modal;
      const files = m.files || [];
      if (!FEEDBACK_URL) {
        // 받는 곳이 아직 없으면 메일 앱으로(첨부는 직접)
        const shot = await shotToClipboard(m);
        const { subject, body } = feedbackMail(m);
        window.open(`mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
        snack(files.length ? `메일 앱을 열었어요 · 첨부 ${files.length}개는 메일 창에 직접 붙여 주세요${shot ? '(첫 사진은 Ctrl+V)' : ''}` : '메일 앱을 열었어요', { until: Date.now() + 8000 });
        return render();
      }
      m.sending = true;
      m.error = null;
      render();
      const payload = JSON.stringify({
        key: 'dayline-fb',
        subject: `[Dayline ${appInfo.version || '브라우저'}] 의견`,
        body: `${(m.note || '').trim() || '(내용 없음)'}\n\n---\n${feedbackInfo()}`,
        replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((m.reply || '').trim()) ? m.reply.trim() : '',
        files: files.map((f) => ({ name: f.name, type: f.type, data: f.data.split(',')[1] })),
      });
      let r;
      try {
        if (APP && APP.sendFeedback) r = await APP.sendFeedback(FEEDBACK_URL, payload);
        else {
          await fetch(FEEDBACK_URL, { method: 'POST', mode: 'no-cors', body: payload });
          r = { ok: true };
        }
      } catch (e) {
        r = { ok: false, error: e.message };
      }
      m.sending = false;
      if (r && r.ok) {
        ui.modal = null;
        // 보내기에 성공했으면 예전 '보내기 실패' 기록은 지운다
        errLog = errLog.filter((x) => !/^(의견 보내기 실패|문제 알리기 전송 실패)/.test(x.msg));
        try {
          localStorage.setItem(ERR_KEY, JSON.stringify(errLog));
        } catch (e) { /* 무시 */ }
        snack('보냈어요 · 고마워요!');
      } else {
        const why = (r && (r.error || r.status)) || '';
        logError(`의견 보내기 실패: ${why}`);
        // 자세한 이유는 오류 기록에만 남기고(다음 의견에 같이 감), 화면에는 짧게
        m.error = "보내지 못했어요. 잠시 뒤 다시 보내 주세요. 계속 안 되면 '글만 복사'로 보내 주세요.";
      }
      render();
    },
    'fb-file-add': () => document.getElementById('file-any').click(),
    'fb-file-del': (el) => {
      ui.modal.files = (ui.modal.files || []).filter((f) => f.id !== el.dataset.val);
      render();
    },
    // 문제 알리기 창을 잠깐 숨기고 Dayline 화면을 찍는다
    'fb-shot-take': async () => {
      const m = ui.modal;
      ui.modal = null;
      render();
      await new Promise((r) => setTimeout(r, 180));
      let url = null;
      try {
        url = await APP.capture();
      } catch (e) {
        logError(`화면 찍기 실패: ${e.message || e}`);
      }
      ui.modal = m;
      if (url) {
        await addFeedbackFiles([new File([dataUrlToBlob(url)], `Dayline-화면-${(m.files || []).length + 1}.png`, { type: 'image/png' })]);
      } else snack('화면을 찍지 못했어요 · Win+Shift+S로 캡처해서 붙여 넣어 주세요');
      render();
    },
    'fb-copy': async () => {
      const m = ui.modal;
      const text = `${(m.note || '').trim() || '(내용 없음)'}\n\n---\n${feedbackInfo()}`;
      const ok = await copyText(text);
      snack(ok ? '복사했어요 · 메신저에 붙여넣어 보내 주세요' : '복사하지 못했어요 · 화면을 캡처해서 보내 주세요');
      render();
    },
    'cal-toggle': () => {
      S.prefs.cal = !S.prefs.cal;
      commit();
    },
    'cal-pick': (el) => {
      // 같은 날짜를 빠르게 두 번 누르면 타임라인 그날로(다시 그리느라 dblclick이 안 잡혀서 직접 센다)
      const tNow = performance.now();
      if (ui.calLast && ui.calLast.k === el.dataset.val && tNow - ui.calLast.at < 450) {
        ui.calLast = null;
        return ACTIONS['cal-open-day'](el);
      }
      ui.calLast = { k: el.dataset.val, at: tNow };
      ui.calSel = el.dataset.val;
      const d = fromKey(el.dataset.val);
      ui.calMonth = dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
      render();
    },
    'cal-move': (el) => {
      const b = ui.calMonth ? fromKey(ui.calMonth) : fromKey(ui.calSel || todayKey());
      ui.calMonth = dateKey(new Date(b.getFullYear(), b.getMonth() + +el.dataset.val, 1));
      render();
    },
    'cal-today': () => {
      ui.calSel = todayKey();
      ui.calMonth = null;
      render();
    },
    'cal-open-day': (el) => {
      S.prefs.view = 'timeline';
      S.prefs.tlMode = 'day';
      S.prefs.anchor = el.dataset.val;
      commit();
    },
    'tl-day': (el) => {
      S.prefs.tlMode = 'day';
      S.prefs.anchor = el.dataset.val;
      commit();
    },
    'tl-today': () => {
      S.prefs.anchor = null;
      ui.scrolledKey = null;
      commit();
    },
    'tl-mode': (el) => {
      S.prefs.tlMode = el.dataset.val;
      commit();
    },
    'win-max': () => APP && APP.toggleMaximize(),
    'backup-now': () => autoBackup(true),
    'backup-open': () => APP && APP.openBackupDir(),
    // 컴퓨터 켤 때: 안 켜기 / 트레이에만 / 창 열기
    'boot-mode': async (el) => {
      if (!APP) return;
      const v = el.dataset.val;
      appInfo.autostart = await APP.setAutostart(v !== 'off');
      if (v !== 'off' && APP.setStartShow) appInfo.startShow = await APP.setStartShow(v === 'show');
      snack({ off: '컴퓨터를 켜도 Dayline은 켜지지 않아요', tray: '컴퓨터를 켜면 트레이에서 조용히 시작해요', show: '컴퓨터를 켜면 Dayline 창이 열려요' }[v]);
      render();
    },
    autostart: () => {
      if (!APP) return;
      APP.setAutostart(!appInfo.autostart).then((v) => {
        appInfo.autostart = v;
        snack(v ? (appInfo.startShow !== false ? 'Windows를 켜면 Dayline 창이 열려요' : 'Windows를 켜면 Dayline이 트레이에서 시작돼요') : '자동 실행을 껐어요');
        render();
      });
    },
    'start-show': () => {
      if (!APP || !APP.setStartShow) return;
      APP.setStartShow(appInfo.startShow === false).then((v) => {
        appInfo.startShow = v;
        snack(v ? '컴퓨터를 켜면 창이 바로 열려요' : '컴퓨터를 켜면 트레이에만 들어가요');
        render();
      });
    },
    'app-quit': () => APP && APP.quit(),
    'win-hide': (el) => {
      if (APP) {
        if (el.dataset.val === 'min') APP.minimize();
        else APP.close();
        return;
      }
      ui.hidden = true;
      closeSheet();
      ui.inbox = false;
      ui.modal = null;
      render();
    },
    tray: () => {
      ui.trayMenu = !ui.trayMenu;
      render();
    },
    'tray-open': () => {
      ui.hidden = false;
      ui.trayMenu = false;
      render();
    },
    'tray-quit': () => {
      ui.trayMenu = false;
      ui.modal = { type: 'quit' };
      render();
    },
    'quit-confirm': () => {
      ui.modal = null;
      ui.quit = true;
      ui.hidden = false;
      render();
    },
    relaunch: () => {
      ui.quit = false;
      checkReminders();
      render();
    },
    'perm-request': () => {
      try {
        Notification.requestPermission().then(() => render());
      } catch (e) {
        render();
      }
    },
    'perm-test': () => {
      const st = permState();
      const t = fmtHM(now());
      if (APP && st === 'granted') {
        APP.notify({ id: 'test-' + uid(), title: 'Dayline 테스트 알림', body: '알림이 이렇게 와요', test: true });
        ui.permTest = { ok: true, msg: `보냈어요 · ${t}` };
      } else if (st === 'granted') {
        try {
          new Notification('Dayline 테스트 알림', { body: '알림이 잘 와요' });
          ui.permTest = { ok: true, msg: `보냈어요 · ${t}` };
        } catch (e) {
          ui.permTest = { ok: false, msg: '보내지 못했어요' };
        }
      } else if (st === 'denied') ui.permTest = { ok: false, msg: '권한이 꺼져 있어 보내지 못했어요' };
      else if (st === 'unsupported') ui.permTest = { ok: false, msg: '이 브라우저는 시스템 알림을 지원하지 않아요' };
      else ui.permTest = { ok: false, msg: '먼저 알림 권한을 허용해 주세요' };
      render();
    },
    export: exportBackup,
    import: openRestore,
    'rs-file': () => document.getElementById('file-import').click(),
    'rs-pick': (el) => {
      const it = (ui.modal.list || []).find((x) => x.file === el.dataset.val);
      if (!it) return;
      APP.readBackup(it.file).then((r) => {
        if (r && r.ok) pickBackup(r.json, backupLabel(it.at));
        else snack('백업 파일을 읽지 못했어요');
      });
    },
    'rs-back': () => {
      ui.modal.pick = null;
      render();
    },
    'rs-replace': () => {
      const p = ui.modal && ui.modal.pick;
      if (p) replaceFromBackup(p.data, p.label);
    },
    'rs-merge': () => {
      const p = ui.modal && ui.modal.pick;
      if (p) mergeBackup(p.data);
    },
    'sticky-open': () => openImport('', 'text'),
    'im-file': () => document.getElementById('file-text').click(),
    'im-source': (el) => {
      const m = ui.modal;
      if (m.source === el.dataset.val) return;
      // 붙여넣기 칸과 스티커 메모 칸의 글은 따로 기억한다(오가도 섞이지 않게)
      m.texts = m.texts || {};
      m.texts[m.source] = m.text;
      m.source = el.dataset.val;
      m.off = {};
      m.text = m.texts[m.source] || '';
      if (m.source === 'text') {
        m.split = true;
        return render();
      }
      if (m.text) {
        m.split = false;
        return render();
      }
      m.split = false;
      m.loading = !!APP;
      render();
      if (APP) {
        APP.readStickyNotes().then((r) => {
          m.loading = false;
          if (r && r.ok) {
            m.found = r.notes.length;
            m.text = r.notes.map((n) => n.text).join('\n\n');
          } else m.error = (r && r.error) || '스티커 메모를 읽지 못했어요';
          if (ui.modal === m) render();
        });
      }
    },
    'st-split': () => {
      ui.modal.split = !ui.modal.split;
      ui.modal.off = {};
      render();
    },
    'st-import': () => {
      const items = importItems(ui.modal).filter((i) => i.on);
      items.forEach((i) => {
        createTask(i.text, { noFilter: true });
        S.imported[i.key] = true;
      });
      ui.modal = null;
      snack(`${items.length}개 가져왔어요`);
      commit();
    },
    reset: () => {
      if (!ui.modal.confirmReset) {
        ui.modal.confirmReset = true;
        snack(APP ? '한 번 더 누르면 할 일과 프로젝트를 모두 지워요(자동 백업은 남아요)' : '한 번 더 누르면 샘플 데이터로 되돌려요');
        return render();
      }
      const fresh = seed();
      Object.keys(S).forEach((k) => delete S[k]);
      Object.assign(S, fresh);
      ui.modal = null;
      ui.prompt = null;
      snack(APP ? '모두 지웠어요' : '샘플 데이터로 되돌렸어요');
      commit();
    },
  };

  /* ---------- 화면 이동 기록: 마우스 뒤로/앞으로 버튼, Alt+←/→ ---------- */
  const nav = { back: [], fwd: [] };
  const navState = () => ({ mode: S.prefs.mode, view: S.prefs.view, tlMode: S.prefs.tlMode, anchor: S.prefs.anchor, filter: S.prefs.filter });
  const sameNav = (a, b) => a && b && ['mode', 'view', 'tlMode', 'anchor', 'filter'].every((k) => a[k] === b[k]);
  function navPush() {
    const cur = navState();
    if (!sameNav(nav.back[nav.back.length - 1], cur)) nav.back.push(cur);
    if (nav.back.length > 50) nav.back.shift();
    nav.fwd = [];
  }
  function navGo(dir) {
    const from = dir < 0 ? nav.back : nav.fwd;
    const to = dir < 0 ? nav.fwd : nav.back;
    let st = from.pop();
    while (st && sameNav(st, navState())) st = from.pop();
    if (!st) return;
    to.push(navState());
    const modeChanged = st.mode !== S.prefs.mode;
    Object.assign(S.prefs, st);
    if (modeChanged && APP) APP.setMode(S.prefs.mode);
    ui.mpop = null;
    ui.scrolledKey = null;
    commit();
  }
  // 이동하는 동작들은 이동 전 화면을 기록해 둔다
  for (const k of ['tl-move', 'tl-day', 'tl-today', 'tl-mode', 'view', 'filter', 'mode', 'cal-open-day']) {
    const fn = ACTIONS[k];
    ACTIONS[k] = (el, e) => {
      navPush();
      ui.mpop = null;
      return fn(el, e);
    };
  }
  ACTIONS.mpop = (el) => {
    ui.mpop = ui.mpop === el.dataset.val ? null : el.dataset.val;
    render();
  };
  ACTIONS['mpop-close'] = () => {
    ui.mpop = null;
    render();
  };
  document.addEventListener('focusin', (e) => {
    const id = e.target.dataset && e.target.dataset.tc;
    if (!id || ui.tcOpen === id) return;
    ui.tcOpen = id;
    render();
    const inp = document.querySelector(`[data-tc="${id}"]`);
    if (inp) inp.select();
  });
  document.addEventListener('focusout', (e) => {
    const id = e.target.dataset && e.target.dataset.tc;
    if (!id) return;
    const raw = e.target.value.trim();
    const cur = raw ? parseTimeText(raw) : null;
    // 목록을 눌러서 포커스가 빠진 경우는 tc-pick이 처리한다
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.tc-list')) return;
    if (raw && cur && e.target.defaultValue !== e.target.value) tcApply(id, cur);
  });
  // 입력칸에 여러 줄을 붙여넣으면 '할 일 가져오기'로 열어서 한 번에 넣는다
  document.addEventListener('paste', (e) => {
    if (!e.target.classList || !e.target.classList.contains('qi-input')) return;
    const t = e.clipboardData && e.clipboardData.getData('text');
    if (!t || !/\S[^\n]*\n+\s*\S/.test(t.trim())) return;
    e.preventDefault();
    openImport(t, 'text');
  });
  // 텍스트 파일을 창에 끌어다 놓으면 가져오기
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    if (ui.modal && ui.modal.type === 'feedback') return addFeedbackFiles([...e.dataTransfer.files]);
    if (ui.sheet && !ui.modal && [...e.dataTransfer.files].some((x) => (x.type || '').startsWith('image/'))) return addSheetImages([...e.dataTransfer.files]);
    if (/\.(txt|md|markdown|csv|text)$/i.test(f.name) || (f.type || '').startsWith('text/')) readTextFile(f);
    else snack('텍스트 파일(.txt, .md)만 가져올 수 있어요');
  });
  // 할 일 상세에서 Ctrl+V: 클립보드에 사진이 있으면 메모 사진으로(글자만 있으면 평소처럼 붙여넣기)
  document.addEventListener('paste', (e) => {
    if (!ui.sheet || ui.modal) return;
    const cd = e.clipboardData;
    let list = [...((cd && cd.files) || [])].filter((f) => (f.type || '').startsWith('image/'));
    if (!list.length) {
      const items = [...((cd && cd.items) || [])].filter((x) => x.kind === 'file' && x.type.startsWith('image/'));
      const pick = items.find((x) => x.type === 'image/png') || items[0];
      const f = pick && pick.getAsFile();
      list = f ? [f] : [];
    }
    if (!list.length) return;
    e.preventDefault();
    addSheetImages(list);
  });
  // 문제 알리기 창에서 Ctrl+V: 클립보드의 사진·파일(여러 개)을 첨부로
  document.addEventListener('paste', (e) => {
    if (!ui.modal || ui.modal.type !== 'feedback') return;
    const cd = e.clipboardData;
    let list = [...((cd && cd.files) || [])];
    if (!list.length) {
      // 캡처 한 번에 같은 그림이 여러 형식(PNG, 비트맵 등)으로 들어 있어서 하나만(PNG 먼저) 쓴다
      const items = [...((cd && cd.items) || [])].filter((x) => x.kind === 'file');
      const pick = items.find((x) => x.type === 'image/png') || items.find((x) => x.type.startsWith('image/')) || items[0];
      const f = pick && pick.getAsFile();
      list = f ? [f] : [];
    }
    if (!list.length) return;
    e.preventDefault();
    addFeedbackFiles(list);
  });
  // 트레이에서 창을 처음 띄울 때 아직 못 맞춘 타임라인 스크롤을 다시 맞춘다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.prefs.view === 'timeline') render();
  });
  window.addEventListener('resize', () => {
    const el = document.querySelector('[data-scroll="tl"]');
    if (el && el.scrollTop === 0 && S.prefs.view === 'timeline') render();
  });
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('.col-rz')) {
      S.prefs.colW = null;
      snack('요일 너비를 원래대로 돌렸어요');
      commit();
    }
  });
  document.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-hash]');
    if (it) {
      e.preventDefault();
      const input = it.closest('.qi').querySelector('.qi-input');
      pickHash(+it.dataset.hash, input);
    } else if (hashState.open && !e.target.closest('.qi')) closeHash();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      navGo(e.button === 3 ? -1 : 1);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      navGo(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  /* ---------- 이벤트 ---------- */
  let suppressUntil = 0;
  document.addEventListener(
    'click',
    (e) => {
      if (performance.now() < suppressUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (ui.trayMenu && !e.target.closest('.tray')) {
        ui.trayMenu = false;
        render();
      }
      if (ui.mpop && !e.target.closest('.mpop, .mmore, .sheet, .modal, .scrim')) {
        ui.mpop = null;
        if (!e.target.closest('[data-act]')) return render();
      }
      // 시간 목록은 바깥을 누르면 닫는다
      if (ui.tcOpen && !e.target.closest('.tcombo, [data-act="sh-pick"], [data-act="we-open"], [data-act="we-new"]')) {
        ui.tcOpen = null;
        if (!e.target.closest('[data-act]')) return render();
      }
      // 미루기 창은 그 창이나 미루기 버튼이 아닌 곳을 누르면 닫는다(다른 곳에서 날짜를 바꿔도 남아 있지 않게)
      if (ui.snooze && !e.target.closest('.prompt.snz, [data-act="snooze-open"], [data-act="snooze"]')) {
        ui.snooze = null;
        if (!e.target.closest('[data-act]')) return render();
      }
      if (e.target.closest('.col-rz')) return; // 너비 조절 손잡이는 날짜 이동으로 치지 않는다
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = ACTIONS[el.dataset.act];
      if (!fn) return;
      // 설정에서 연 창(백업 가져오기, 사용법 등)은 닫으면 설정으로 돌아간다
      const prev = ui.modal;
      const sc = prev && prev.type === 'settings' ? document.querySelector('.modal.settings .md-scroll') : null;
      const top = sc ? sc.scrollTop : 0;
      fn(el, e);
      if (prev && prev.type === 'settings' && ui.modal && ui.modal !== prev && ui.modal.type !== 'settings') {
        ui.modal.back = { type: 'settings', scroll: top, shown: true };
      }
    },
    false,
  );
  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-edit-project]');
    if (!el) return;
    e.preventDefault();
    const p = proj(el.dataset.editProject);
    if (p) {
      ui.modal = { type: 'project', id: p.id, name: p.name, color: p.color, kw: (p.keywords || []).join(', ') };
      render();
    }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form="quick"]');
    if (!f) return;
    e.preventDefault();
    addFromInput();
  });
  function refreshSheetBits() {
    const d = ui.sheet && ui.sheet.d;
    if (!d) return;
    const rc = document.querySelector('[data-recog]');
    if (rc) rc.innerHTML = recogHtml(d);
    const rl = document.querySelector('[data-remline] span');
    if (rl) rl.textContent = remLine(d);
    const en = document.querySelector('[data-endnote]');
    if (en) en.textContent = endNote(d);
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.classList.contains('cp-add')) {
      ui.calDraft = el.value;
      return;
    }
    if (el.classList.contains('qi-input')) {
      ui.draft = el.value;
      if (!el.value.trim()) ui.noAutoPj = false;
      const cx = el.parentElement.querySelector('.qi-clear');
      if (cx) cx.classList.toggle('on', !!el.value || !!ui.draftProject);
      updateHash(el);
      updateHints();
      return;
    }
    const b = el.dataset.bind;
    if (b && ui.sheet) {
      if (el.type === 'date' || el.type === 'time' || el.tagName === 'SELECT') return; // change에서 처리
      let v = el.value;
      if (b === 'duration' || b === 'remCustom') v = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
      ui.sheet.d[b] = v;
      if (b === 'remCustom') ui.sheet.d.reminder = v;
      document.querySelectorAll('.pills.rem .pill').forEach((p) => p.classList.remove('on'));
      refreshSheetBits();
      return;
    }
    if (el.dataset.qn !== undefined && ui.quickNew) {
      ui.quickNew.text = el.value;
      const pj = el.parentElement.querySelector('[data-qn-pj]');
      if (pj) pj.innerHTML = qnProjectHtml(el.value);
      return;
    }
    if (el.dataset.hue !== undefined && ui.modal) {
      const hex = hueToHex(+el.value);
      ui.modal.color = hex;
      const pv = document.querySelector('.pj.big i');
      if (pv) pv.style.setProperty('--c', hex);
      document.querySelectorAll('.swatches .sw').forEach((x) => {
        x.classList.toggle('on', x.classList.contains('custom'));
        if (!x.classList.contains('custom')) x.innerHTML = '';
      });
      const cs = document.querySelector('.sw.custom');
      if (cs) {
        cs.style.setProperty('--c', hex);
        cs.dataset.val = hex;
        cs.innerHTML = icon('check', 14);
      }
      return;
    }
    const mb = el.dataset.mbind;
    if (mb && ui.modal) {
      ui.modal[mb] = el.value;
      if (ui.modal.type === 'sticky') render();
      else {
        const pv = document.querySelector('.pj.big');
        if (pv) pv.lastChild.textContent = el.value || '프로젝트';
      }
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.im && ui.modal && ui.modal.type === 'sticky') {
      ui.modal.off = ui.modal.off || {};
      ui.modal.off[el.dataset.im] = !el.checked;
      return render();
    }
    if (el.id === 'file-img' && el.files.length) {
      addSheetImages([...el.files]);
      el.value = '';
      return;
    }
    if (el.id === 'file-any' && el.files.length) {
      addFeedbackFiles([...el.files]);
      el.value = '';
      return;
    }
    if (el.id === 'file-text' && el.files[0]) {
      readTextFile(el.files[0]);
      el.value = '';
      return;
    }
    if (el.id === 'file-import' && el.files[0]) {
      importBackup(el.files[0]);
      el.value = '';
      return;
    }
    const b = el.dataset.bind;
    if (b && ui.sheet && (el.type === 'date' || el.type === 'time' || el.tagName === 'SELECT')) {
      ui.sheet.d[b] = el.value;
      if (b === 'start' && !el.value) ui.sheet.d.reminder = null;
      render();
      return;
    }
    const s = el.dataset.set;
    if (s) {
      S.settings[s] = +el.value;
      commit();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (hashState.open && e.target.classList && e.target.classList.contains('qi-input') && !e.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = hashState.items.length;
        hashState.sel = (hashState.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        return updateHash(e.target);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return pickHash(hashState.sel, e.target);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return closeHash();
      }
    }
    if (e.key === 'Backspace' && e.target.classList && e.target.classList.contains('qi-input') && ui.draftProject && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      ui.draftProject = null; // 맨 앞에서 지우면 프로젝트 칩이 빠진다
      return render();
    }
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cp-add') && !e.isComposing) {
      e.preventDefault();
      return addOnCalDay(e.target.value);
    }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.qn !== undefined && !e.isComposing) {
      e.preventDefault();
      ui.quickNew.text = e.target.value;
      return saveQuickNew();
    }
    if (e.target.dataset && e.target.dataset.tc && !e.isComposing) {
      const id = e.target.dataset.tc;
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = parseTimeText(e.target.value);
        if (v) {
          e.target.defaultValue = e.target.value;
          tcApply(id, v);
        } else snack('시간을 못 읽었어요 · 930, 9:30, 9시반, 오후 3시처럼 써 주세요');
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 위아래 화살표: 15분씩, Shift를 같이 누르면 1분씩
        e.preventDefault();
        const step = e.shiftKey ? 1 : 15;
        const cur = parseTimeText(e.target.value);
        const base = cur ? hmToMin(cur) : Math.round((now().getHours() * 60 + now().getMinutes()) / 15) * 15;
        const nv = minToHM((base + (e.key === 'ArrowDown' ? step : -step) + 1440) % 1440);
        e.target.value = koTime(nv);
        const it = document.querySelector(`.tc-list [data-val="${nv}"]`);
        document.querySelectorAll('.tc-list .tc-it.kb').forEach((x) => x.classList.remove('kb'));
        if (it) {
          it.classList.add('kb');
          it.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        ui.tcOpen = null;
        render();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (ui.lightbox && ui.sheet) {
        ui.lightbox = null;
        return render();
      }
      if (ui.quickNew && !ui.modal && !ui.sheet) ui.quickNew = null;
      else if (ui.mpop && !ui.modal && !ui.sheet) ui.mpop = null;
      else if (ui.modal) return ACTIONS['modal-close']();
      else if (ui.sheet) closeSheet();
      else if (ui.inbox) ui.inbox = false;
      else if (ui.prompt) ui.prompt = null;
      else return;
      render();
      return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey && e.shiftKey && e.code === 'Space') || (!typing && e.key === '/')) {
      e.preventDefault();
      const q = document.querySelector('.qi-input');
      if (q) q.focus();
    }
    if (e.key === 'Enter' && ui.sheet && e.target.classList.contains('sh-text')) {
      e.preventDefault();
      saveSheet();
    }
  });

  /* ---------- 드래그 ---------- */
  let D = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const src = e.target.closest('[data-drag]');
    if (!src) return;
    const blocker = e.target.closest('button, input, select, textarea, [data-nodrag]');
    if (blocker && blocker !== src && src.dataset.drag !== 'window') return;
    if (src.dataset.drag === 'window' && e.target.closest('button')) return;
    if (src.dataset.drag !== 'window') e.preventDefault(); // 글자 선택 막기
    if (src.dataset.drag === 'create' && (e.target.closest('.qn, .tl-draft, .tl-now') || ui.quickNew)) {
      if (ui.quickNew && !e.target.closest('.qn')) {
        ui.quickNew = null; // 바깥을 누르면 만들던 칸 취소
        suppressUntil = performance.now() + 250;
        render();
      }
      return;
    }
    D = { type: src.dataset.drag, src, id: src.dataset.id, x0: e.clientX, y0: e.clientY, started: false };
    if (D.type === 'colrz') {
      const head = src.closest('.tl-head');
      const dayCols = [...head.children].slice(1);
      const W = dayCols.reduce((a, c) => a + c.getBoundingClientRect().width, 0);
      const w0 = Array.isArray(S.prefs.colW) && S.prefs.colW.length === 7 ? [...S.prefs.colW] : [1, 1, 1, 1, 1, 1, 1];
      Object.assign(D, { i: +src.dataset.i, w0, pxPerFr: W / w0.reduce((a, b) => a + b, 0), grids: [head, document.querySelector('.tl-grid')] });
    }
    if (D.type === 'create') {
      const r = src.getBoundingClientRect();
      D.anchor = clamp(Math.floor(((e.clientY - r.top) / HOUR) * 4) * 15, 0, 1440 - 15);
      D.day = src.dataset.day;
    }
    if (D.type === 'block' || D.type === 'resize') {
      const blk = D.type === 'resize' ? src.closest('.blk') : src;
      const r = blk.getBoundingClientRect();
      Object.assign(D, { blk, id: blk.dataset.id, sid: blk.dataset.sid || null, grabY: e.clientY - r.top, sMin: +blk.dataset.smin, eMin: +blk.dataset.emin, day: blk.dataset.day });
    }
    if (D.type === 'window') {
      const w = src.closest('.win');
      const r = w.getBoundingClientRect();
      Object.assign(D, { win: w, ox: e.clientX - r.left, oy: e.clientY - r.top });
    }
  });
  function clearDropMarks() {
    document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    document.querySelectorAll('.drop-line').forEach((x) => x.remove());
    document.querySelectorAll('.tl-preview').forEach((x) => x.remove());
  }
  function startDrag() {
    D.started = true;
    document.body.classList.add('is-dragging');
    ui.prompt = null;
    if (D.type === 'row' || D.type === 'card') {
      const t = findTask(D.id);
      const g = document.createElement('div');
      g.className = 'drag-ghost row-ghost';
      g.innerHTML = `<i style="--c:${pColor(proj(t && t.projectId))}"></i><span>${esc(t ? plainTitle(t) : '')}</span>`;
      document.body.appendChild(g);
      D.ghost = g;
      D.offX = -14;
      D.offY = 16;
      D.src.classList.add('drag-src');
    } else if (D.type === 'proj') {
      const p = proj(D.id);
      const g = document.createElement('div');
      g.className = 'drag-ghost row-ghost';
      g.innerHTML = `<i style="--c:${pColor(p)}"></i><span>${esc(p ? p.name : '')}</span>`;
      document.body.appendChild(g);
      D.ghost = g;
      D.offX = -14;
      D.offY = 16;
      D.src.classList.add('drag-src');
    } else if (D.type === 'block') {
      const r = D.src.getBoundingClientRect();
      const g = D.src.cloneNode(true);
      g.classList.add('drag-ghost');
      g.removeAttribute('data-act');
      g.style.width = Math.min(r.width, 200) + 'px';
      g.style.height = Math.min(r.height, 120) + 'px';
      document.body.appendChild(g);
      D.ghost = g;
      D.offX = Math.min(D.x0 - r.left, 180);
      D.offY = Math.min(D.y0 - r.top, 40);
      D.src.classList.add('drag-src');
    }
  }
  function previewIn(col, sMin, dur) {
    const pv = document.createElement('div');
    pv.className = 'tl-preview';
    pv.style.top = (sMin / 60) * HOUR + 'px';
    pv.style.height = Math.max(20, (dur / 60) * HOUR - 2) + 'px';
    pv.innerHTML = `<span>${minToHM(sMin)} – ${sMin + dur >= 1440 ? '다음 날 ' : ''}${minToHM(sMin + dur)}</span>`;
    col.appendChild(pv);
  }
  document.addEventListener('pointermove', (e) => {
    if (!D) return;
    if (!D.started) {
      if (Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 5) return;
      startDrag();
    }
    e.preventDefault();
    if (D.type === 'window') {
      const x = clamp(e.clientX - D.ox, 0, window.innerWidth - 120);
      const y = clamp(e.clientY - D.oy, 0, window.innerHeight - 40);
      D.win.style.left = x + 'px';
      D.win.style.top = y + 'px';
      D.win.style.right = 'auto';
      D.pos = { x, y };
      return;
    }
    if (D.type === 'colrz') {
      const dfr = (e.clientX - D.x0) / D.pxPerFr;
      const w = [...D.w0];
      const i = D.i;
      const total = w[i] + w[i + 1];
      w[i] = clamp(w[i] + dfr, 0.35, total - 0.35);
      w[i + 1] = total - w[i];
      D.w = w.map((x) => Math.round(x * 100) / 100);
      const tpl = `56px ${D.w.map((x) => `minmax(0,${x}fr)`).join(' ')}`;
      D.grids.forEach((g) => g && (g.style.gridTemplateColumns = tpl));
      return;
    }
    if (D.type === 'create') {
      const r = D.src.getBoundingClientRect();
      const cur = clamp(Math.ceil(((e.clientY - r.top) / HOUR) * 4) * 15, 0, 1440);
      const a = D.anchor;
      D.sMin = cur <= a ? Math.max(0, cur - 15) : a;
      D.eMin = cur <= a ? a + 15 : Math.max(cur, a + 15);
      clearDropMarks();
      previewIn(D.src, D.sMin, D.eMin - D.sMin);
      return;
    }
    if (D.type === 'resize') {
      const col = D.blk.parentElement;
      const r = col.getBoundingClientRect();
      const eMin = clamp(snap15(((e.clientY - r.top) / HOUR) * 60), D.sMin + 15, 1440);
      D.newE = eMin;
      D.blk.style.height = Math.max(20, ((eMin - D.sMin) / 60) * HOUR - 2) + 'px';
      const bm = D.blk.querySelector('.bm');
      if (bm) bm.textContent = `${minToHM(D.sMin)} – ${minToHM(eMin)} · ${durText(eMin - D.sMin)}`;
      return;
    }
    D.ghost.style.left = e.clientX - D.offX + 'px';
    D.ghost.style.top = e.clientY - D.offY + 'px';
    clearDropMarks();
    D.target = null;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under) return;
    if (D.type === 'proj') {
      // 같은 목록(왼쪽 목록 또는 작은 창 칩) 안의 다른 프로젝트 위에서만
      const box = D.src.parentElement;
      if (box.matches('[data-chips]')) {
        const br = box.getBoundingClientRect();
        if (e.clientX < br.left + 40) box.scrollLeft -= 12;
        else if (e.clientX > br.right - 40) box.scrollLeft += 12;
      }
      const el = under.closest('[data-drag="proj"]');
      if (!el || el === D.src || el.parentElement !== box) return;
      const r = el.getBoundingClientRect();
      const across = el.classList.contains('chip');
      const after = across ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      const line = document.createElement('div');
      line.className = 'drop-line proj' + (across ? ' v' : '');
      if (across) Object.assign(line.style, { left: (after ? r.right + 3 : r.left - 3) - 1 + 'px', top: r.top + 'px', height: r.height + 'px' });
      else Object.assign(line.style, { left: r.left + 'px', width: r.width + 'px', top: (after ? r.bottom + 2 : r.top - 2) - 1 + 'px' });
      document.body.appendChild(line);
      D.target = { kind: 'proj-order', ref: el.dataset.id, after };
      return;
    }
    const t = findTask(D.id);
    if (D.type === 'card' || D.type === 'block') {
      const col = under.closest('.tl-col');
      if (col) {
        const r = col.getBoundingClientRect();
        let dur;
        if (D.type === 'block' && D.sid) {
          const w = t && (t.sessions || []).find((x) => x.id === D.sid);
          dur = w ? Math.max(15, ((w.e ? new Date(w.e) : now()) - new Date(w.s)) / 60000) : D.eMin - D.sMin;
        } else if (D.type === 'block') {
          const iv = intervalOf(t);
          dur = iv ? (iv.e - iv.s) / 60000 : D.eMin - D.sMin;
        } else dur = (t && t.duration) || 30;
        const y = e.clientY - r.top - (D.type === 'block' ? Math.min(D.grabY, ((D.eMin - D.sMin) / 60) * HOUR) : 0);
        const sMin = clamp(snap15((y / HOUR) * 60), 0, 1440 - 15);
        previewIn(col, sMin, dur);
        D.target = { kind: 'col', day: col.dataset.day, sMin, dur };
        return;
      }
    }
    if (D.type === 'block') {
      const un = under.closest('[data-drop-unsched]');
      if (un) {
        un.classList.add('drop-on');
        D.target = { kind: 'unsched' };
        return;
      }
    }
    if (D.type === 'card' || D.type === 'row') {
      const cell = under.closest('[data-mday]');
      if (cell) {
        cell.classList.add('drop-on');
        // 목록 줄: 날짜 없이 마감만 있는 일은 마감 날짜를 옮긴다
        const due = D.type === 'row' ? !!(t && !t.date && t.due) : D.src.dataset.due === '1';
        D.target = { kind: 'mday', day: cell.dataset.mday, due };
        return;
      }
    }
    const pj = under.closest('[data-drop-project]');
    if (pj && (D.type === 'row' || D.type === 'card')) {
      pj.classList.add('drop-on');
      D.target = { kind: 'proj', pid: pj.dataset.dropProject || null };
      return;
    }
    if (D.type === 'row' && D.src.dataset.kind === 'untimed') {
      const row = under.closest('[data-untimed] .trow');
      if (row && row !== D.src) {
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        const line = document.createElement('div');
        line.className = 'drop-line';
        line.style.top = (after ? row.offsetTop + row.offsetHeight : row.offsetTop) - 1 + 'px';
        row.parentElement.appendChild(line);
        D.target = { kind: 'reorder', ref: row.dataset.id, after };
      }
    }
  });
  function endDrag() {
    if (!D) return;
    const d = D;
    D = null;
    document.body.classList.remove('is-dragging');
    if (d.ghost) d.ghost.remove();
    if (d.src) d.src.classList.remove('drag-src');
    clearDropMarks();
    if (d.type === 'colrz') {
      if (d.started && d.w) {
        S.prefs.colW = d.w;
        suppressUntil = performance.now() + 250;
        commit();
      }
      return;
    }
    if (d.type === 'create') {
      const sMin = d.started ? d.sMin : d.anchor;
      const eMin = d.started ? d.eMin : Math.min(1440, d.anchor + 30);
      const end = new Date(fromKey(d.day).getTime() + eMin * 60000);
      const past = end <= now();
      ui.quickNew = { day: d.day, sMin, eMin, text: '', past, done: past, focus: true };
      suppressUntil = performance.now() + 250;
      return render();
    }
    if (!d.started) return;
    suppressUntil = performance.now() + 250;
    if (d.type === 'window') {
      if (d.pos) S.prefs.miniPos = d.pos;
      return save();
    }
    if (d.type === 'proj') {
      const g = d.target;
      if (!g || g.kind !== 'proj-order') return render();
      const from = S.projects.findIndex((x) => x.id === d.id);
      if (from < 0) return render();
      const [moved] = S.projects.splice(from, 1);
      let to = S.projects.findIndex((x) => x.id === g.ref);
      if (to < 0) to = S.projects.length;
      else if (g.after) to += 1;
      S.projects.splice(to, 0, moved);
      return commit();
    }
    const t0 = findTask(d.id);
    if (!t0) return render();
    if (d.sid) return endWorkDrag(t0, d);
    const g0 = d.target;
    if (g0 && g0.kind === 'mday') return endMonthDrop(t0, g0);
    const movesTime = d.type === 'resize' || (g0 && (g0.kind === 'col' || g0.kind === 'unsched'));
    if (movesTime && d.type === 'resize' && d.newE == null) return render();
    if (movesTime && !g0 && d.type !== 'resize') return render();
    // 반복 회차의 시간을 바꾸면 이번 회차만 떼어서 바꾼다
    const t = t0.seriesId ? (movesTime ? detach(t0) : target(t0)) : t0;
    const once = t0.seriesId && movesTime ? ' (이번 회차만)' : '';
    const snackOnce = (m) => snack(m + once);
    if (d.type === 'resize') {
      if (d.newE == null) return render();
      if (!t.start) {
        t.date = d.day;
        t.start = minToHM(d.sMin);
      }
      t.end = null;
      t.duration = d.newE - d.sMin;
      snackOnce(`${durText(t.duration)}으로 바꿨어요`);
      return commit();
    }
    const g = d.target;
    if (!g) return render();
    if (g.kind === 'col') {
      t.date = g.day;
      t.start = minToHM(g.sMin);
      if (g.sMin + g.dur > 1440 && t.end == null && !t.duration && !t.done) {
        /* 끝이 다음 날로 넘어가도 그대로 둔다 */
      }
      if (t.end) t.end = minToHM(g.sMin + g.dur);
      else if (t.done || t.duration || d.type === 'block') {
        if (t.done || t.duration) t.duration = Math.round(g.dur);
      }
      const r = reminderAt(t);
      snackOnce(`${relDay(g.day)} ${t.start}(으)로 옮겼어요${r ? ` · ${fmtHM(r)} 알림` : ''}`);
    } else if (g.kind === 'unsched') {
      t.date = null;
      t.start = null;
      t.end = null;
      snackOnce('시간 미정으로 옮겼어요');
    } else if (g.kind === 'proj') {
      t.projectId = g.pid;
      const p = proj(g.pid);
      snack((p ? `${p.name}(으)로 옮겼어요` : '프로젝트를 뺐어요') + (t0.seriesId ? ' · 반복 전체에 적용' : ''));
    } else if (g.kind === 'reorder') {
      const L = listSections().untimed.filter((x) => x.id !== t0.id);
      const i = L.findIndex((x) => x.id === g.ref);
      L.splice(g.after ? i + 1 : i, 0, t0);
      L.forEach((x, k) => (target(x).order = k));
    }
    commit();
  }
  // 월 보기: 날짜 칸에 놓으면 그날로(시간은 그대로). 마감 항목은 마감일을 옮긴다.
  function endMonthDrop(t0, g) {
    if (g.due) {
      if (!t0.due || t0.due.date === g.day) return render();
      t0.due = Object.assign({}, t0.due, { date: g.day });
      snack(`마감을 ${dueText(t0)}(으)로 옮겼어요`);
      return commit();
    }
    if (t0.date === g.day) return render();
    const t = t0.seriesId ? detach(t0) : t0;
    t.date = g.day;
    const r = reminderAt(t);
    snack(`${dayShort(fromKey(g.day))}(으)로 옮겼어요${t.start ? ' · ' + t.start : ''}${t0.seriesId ? ' (이번 회차만)' : ''}${r ? ` · ${fmtHM(r)} 알림` : ''}`);
    commit();
  }
  // 작업 기록 블록: 옮기기(같은 길이), 아래 끝 끌어 길이 바꾸기, '시간 미정'으로 끌면 기록 지우기
  function endWorkDrag(t, d) {
    const w = (t.sessions || []).find((x) => x.id === d.sid);
    if (!w) return render();
    if (d.type === 'resize') {
      if (d.newE == null || !w.e) return render();
      const e = new Date(fromKey(d.day).getTime() + d.newE * 60000);
      w.e = e.toISOString();
      snack(`작업 시간을 ${durText((e - new Date(w.s)) / 60000)}으로 바꿨어요`);
      return commit();
    }
    const g = d.target;
    if (!g) return render();
    if (g.kind === 'col') {
      const s = new Date(fromKey(g.day).getTime() + g.sMin * 60000);
      if (!w.e && s > now()) {
        snack('작업 중인 기록은 지금보다 늦게 시작할 수 없어요');
        return render();
      }
      if (w.e) w.e = new Date(s.getTime() + (new Date(w.e) - new Date(w.s))).toISOString();
      w.s = s.toISOString();
      snack(`${relDay(g.day)} ${fmtHM(s)}(으)로 옮겼어요`);
      return commit();
    }
    if (g.kind === 'unsched') {
      const snap = snapshot();
      t.sessions = t.sessions.filter((x) => x !== w);
      snack('작업 기록을 지웠어요', { undo: { snap } });
      return commit();
    }
    return render();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /* ---------- 시작 ---------- */
  if (APP) {
    document.documentElement.classList.add('is-app');
    APP.setMode(S.prefs.mode);
    APP.setPinned(S.prefs.pinned);
    APP.getInfo().then((info) => {
      Object.assign(appInfo, info);
      render();
    });
    // 처음 실행: 할 일이 없으면 사용법 + 자동 실행 물어보기(이미 쓰던 사람은 건너뛴다)
    if (!S.prefs.onboarded) {
      if (!S.tasks.length) ui.modal = { type: 'welcome', auto: null };
      S.prefs.onboarded = true;
      save();
    }
    APP.on('set-mode', (m) => {
      if (m !== 'mini' && m !== 'big') return;
      S.prefs.mode = m;
      closeSheet();
      ui.inbox = false;
      ui.modal = null;
      APP.setMode(m);
      commit();
    });
    APP.on('focus-quick', () => {
      const q = document.querySelector('.qi-input');
      if (q) q.focus();
    });
    APP.on('notif-action', (a) => {
      if (!a) return;
      const n = S.notifications.find((x) => x.id === a.notifId);
      if (n) n.read = true;
      const t = findTask(a.taskId || (n && n.taskId));
      if (a.action === 'done' && t) {
        setDone(t, true);
        snack('알림에서 완료했어요');
      } else if (a.action === 'open' && t) {
        save();
        return openSheet(t.id);
      }
      commit();
    });
    APP.on('notif-failed', (f) => {
      if (f && !String(f.id || '').startsWith('test-')) logError(`알림 실패: ${f.error || ''}`);
      if (f && String(f.id || '').startsWith('test-')) {
        ui.permTest = { ok: false, msg: '보내지 못했어요 · Windows 알림 설정을 확인해 주세요' };
        render();
      }
    });
  }
  save();
  checkReminders();
  render();
  autoBackup();
  let composing = false;
  document.addEventListener('compositionstart', () => (composing = true));
  document.addEventListener('compositionend', () => (composing = false));
  let lastMin = Math.floor(now().getTime() / 60000);
  setInterval(() => {
    const changed = checkReminders();
    const m = Math.floor(now().getTime() / 60000);
    if ((changed || m !== lastMin) && !D && !composing) {
      lastMin = m;
      autoBackup();
      render();
    }
  }, 5000);
  window.Dayline = { S, ui, render, now, parseTimeText };
})();
