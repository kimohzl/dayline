/*
 * Dayline 시간 인식
 * - 입력 문장은 그대로 두고, 날짜·시작·종료 시간과 "인식한 부분의 위치(spans)"만 돌려준다.
 * - 오전/오후가 없으면 업무시간(기본 9~18시) 기준으로 읽는다.
 */
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const hm = (h, m) => `${pad(h)}:${pad(m)}`;
  const at = (day, h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

  const AM_WORDS = ['오전', '아침', '새벽'];
  const PM_WORDS = ['오후', '저녁', '밤'];
  const DAYS = '일월화수목금토';

  // 시간 하나: (오전|오후…)? 13:30 | 1시 | 1시 30분 | 1시반   ("1시간"은 제외)
  const TIME_SRC =
    '(?:(오전|오후|아침|점심|저녁|밤|새벽)\\s*)?(?:(\\d{1,2}):(\\d{2})|(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?)';

  function readTime(m, offset) {
    // m: match array whose groups start at offset (mer, hh, mm, h, min, half)
    const mer = m[offset] || null;
    if (m[offset + 1] != null) {
      return { mer, h: +m[offset + 1], min: +m[offset + 2], raw: m[offset + 1], colon: true };
    }
    const min = m[offset + 4] != null ? +m[offset + 4] : m[offset + 5] ? 30 : 0;
    return { mer, h: +m[offset + 3], min, raw: m[offset + 3], colon: false };
  }

  function valid(t) {
    return t.h >= 0 && t.h <= 24 && t.min >= 0 && t.min < 60;
  }

  /**
   * 오전/오후가 정해진 경우의 시(0~23). 정해지지 않으면 null.
   */
  function fixedHour(t) {
    const { mer, h, raw } = t;
    if (mer) {
      if (AM_WORDS.includes(mer)) return h === 12 ? 0 : h;
      if (mer === '점심') return h === 12 ? 12 : h < 6 ? h + 12 : h;
      if (PM_WORDS.includes(mer)) return h === 12 ? (mer === '밤' ? 0 : 12) : h < 12 ? h + 12 : h;
    }
    if (h >= 13 || h === 0) return h === 24 ? 0 : h;
    if (/^0\d/.test(raw)) return h; // 09:00 처럼 앞에 0을 붙이면 그대로
    return null;
  }

  /**
   * 시작 시각을 실제 날짜·시간으로 정한다.
   * 반환: { day: Date(00:00), h, min, rule }
   */
  function resolveStart(t, baseDay, explicitDate, now, ws, we) {
    let h = fixedHour(t);
    let rule = 'fixed';
    if (h == null) {
      if (t.h >= ws && t.h < 12) {
        h = t.h;
        rule = 'work';
      } else if (t.h === 12) {
        h = 12;
        rule = 'work';
      } else if (t.h + 12 > 12 && t.h + 12 <= we) {
        h = t.h + 12;
        rule = 'work';
      } else {
        // 업무시간 밖(예: 7·8시) → 지금 이후 가장 가까운 시각
        for (const cand of [t.h, t.h + 12]) {
          if (at(baseDay, cand, t.min) > now) {
            return { day: baseDay, h: cand, min: t.min, rule: 'nearest' };
          }
        }
        return { day: addDays(baseDay, 1), h: t.h, min: t.min, rule: 'nearest' };
      }
    }
    let day = baseDay;
    if (!explicitDate && at(day, h, t.min) <= now) day = addDays(day, 1);
    return { day, h, min: t.min, rule };
  }

  function resolveEnd(t, startH, startMer, startMin) {
    let h = fixedHour(t);
    if (h == null && startMer && !t.mer) h = fixedHour({ ...t, mer: startMer });
    if (h == null) {
      // 시작보다 뒤에 오는 가장 가까운 시각
      const cands = [t.h, t.h + 12].filter((x) => x <= 23);
      h = cands.find((x) => x * 60 + t.min > startH * 60 + (startMin || 0)) ?? t.h;
    }
    return h;
  }

  /* ---------- 반복 ---------- */
  // rep: { freq: 'daily'|'weekdays'|'weekly'|'monthly', days?: [0..6], monthDay?: 1..31 }
  function matchRepeat(rep, d, anchorKey) {
    if (!rep) return false;
    const wd = d.getDay();
    if (rep.freq === 'daily') return true;
    if (rep.freq === 'weekdays') return wd >= 1 && wd <= 5;
    if (rep.freq === 'weekly') {
      const days = rep.days && rep.days.length ? rep.days : [fromKey(anchorKey).getDay()];
      return days.includes(wd);
    }
    if (rep.freq === 'monthly') {
      const md = rep.monthDay || fromKey(anchorKey).getDate();
      return d.getDate() === md;
    }
    return false;
  }
  function firstMatch(rep, fromDay, anchorKey, maxDays) {
    let d = new Date(fromDay);
    for (let i = 0; i < (maxDays || 400); i++) {
      if (matchRepeat(rep, d, anchorKey || dateKey(fromDay))) return d;
      d = addDays(d, 1);
    }
    return null;
  }
  const DAY_NAMES_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
  function repeatLabel(rep, anchorKey) {
    if (!rep) return '';
    if (rep.freq === 'daily') return '매일';
    if (rep.freq === 'weekdays') return '평일';
    if (rep.freq === 'weekly') {
      const days = rep.days && rep.days.length ? rep.days : [fromKey(anchorKey).getDay()];
      return '매주 ' + DAY_NAMES_MON_FIRST.filter((d) => days.includes(d)).map((d) => DAYS[d]).join('·');
    }
    if (rep.freq === 'monthly') return `매월 ${rep.monthDay || fromKey(anchorKey).getDate()}일`;
    return '';
  }
  function readRepeat(text) {
    let m;
    if ((m = /매주\s*((?:[월화수목금토일](?:요일)?\s*[,·、/]?\s*)+)/.exec(text))) {
      const days = [...new Set([...m[1].replace(/요일/g, '').replace(/[^월화수목금토일]/g, '')].map((c) => DAYS.indexOf(c)))];
      const raw = m[0].replace(/[\s,·、/]+$/, '');
      return { rep: { freq: 'weekly', days }, span: [m.index, m.index + raw.length] };
    }
    if ((m = /(매월|매달)\s*(\d{1,2})\s*일/.exec(text))) {
      return { rep: { freq: 'monthly', monthDay: +m[2] }, span: [m.index, m.index + m[0].length] };
    }
    if ((m = /(매일|날마다)/.exec(text))) return { rep: { freq: 'daily' }, span: [m.index, m.index + m[0].length] };
    if ((m = /(평일마다|매\s*평일|평일)/.exec(text))) return { rep: { freq: 'weekdays' }, span: [m.index, m.index + m[0].length] };
    if ((m = /매주/.exec(text))) return { rep: { freq: 'weekly', days: null }, span: [m.index, m.index + m[0].length] };
    if ((m = /(매월|매달)/.exec(text))) return { rep: { freq: 'monthly', monthDay: null }, span: [m.index, m.index + m[0].length] };
    return null;
  }

  /* ---------- 마감(~까지) ---------- */
  const WEEK_PRE = '(?:다음\\s*주|담주|차주|이번\\s*주|이번주)';
  const DUE_DATE_SRC =
    '(?<![\\d/])(오늘|내일|모레|글피|' +
    WEEK_PRE + '?\\s*[월화수목금토일]요일|' +
    WEEK_PRE + '\\s*(?:말|주말)?|주말|이번\\s*달\\s*(?:말)?|월말|' +
    '\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|\\d{1,2}\\/\\d{1,2}|\\d{1,2}\\s*일)';
  const DUE_RE = new RegExp(DUE_DATE_SRC + '(?:\\s*' + TIME_SRC + ')?\\s*(?:까지|마감)');
  const DUE_TIME_RE = new RegExp(TIME_SRC + '\\s*까지');

  function dueDay(word, today) {
    const w = word.replace(/\s+/g, '');
    const mon = (d) => (d + 6) % 7; // 월=0 … 일=6
    const wd = mon(today.getDay());
    const rel = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };
    if (w in rel) return addDays(today, rel[w]);
    let m;
    if ((m = /^(다음주|담주|차주|이번주)?([월화수목금토일])요일$/.exec(w))) {
      const target = mon(DAYS.indexOf(m[2]));
      if (!m[1]) return addDays(today, (target - wd + 7) % 7);
      if (m[1] === '이번주') return addDays(today, target - wd);
      return addDays(today, 7 - wd + target);
    }
    if ((m = /^(다음주|담주|차주|이번주)(말|주말)?$/.exec(w)) || w === '주말') {
      const next = m && m[1] !== '이번주' ? 7 : 0;
      const weekend = w === '주말' || (m && m[2]);
      // 이번 주까지 = 이번 주 금요일(이미 지났으면 일요일)
      let target = weekend ? 6 : 4;
      if (!next && !weekend && wd > 4) target = 6;
      return addDays(today, next + target - wd);
    }
    if (/^(이번달말?|월말)$/.test(w)) return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if ((m = /^(\d{1,2})월(\d{1,2})일$/.exec(w)) || (m = /^(\d{1,2})\/(\d{1,2})$/.exec(w))) {
      const mo = +m[1];
      const d = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      let cand = new Date(today.getFullYear(), mo - 1, d);
      if (cand < addDays(today, -60)) cand = new Date(today.getFullYear() + 1, mo - 1, d);
      return cand;
    }
    if ((m = /^(\d{1,2})일$/.exec(w))) {
      const d = +m[1];
      if (d < 1 || d > 31) return null;
      let cand = new Date(today.getFullYear(), today.getMonth(), d);
      if (cand < today) cand = new Date(today.getFullYear(), today.getMonth() + 1, d);
      return cand;
    }
    return null;
  }

  // 마감 시각: 오전/오후가 없으면 업무시간 기준(1~6시는 오후, 7·8시는 저녁)
  function dueHour(t, ws, we) {
    const h = fixedHour(t);
    if (h != null) return h;
    if (t.h >= ws && t.h <= 12) return t.h;
    if (t.h + 12 <= 23) return t.h + 12;
    return t.h;
  }

  function readDue(text, today, now, ws, we) {
    let m = DUE_RE.exec(text);
    if (m) {
      const day = dueDay(m[1], today);
      if (day) {
        const t = m[3] != null || m[5] != null ? readTime(m, 2) : null;
        const time = t && valid(t) ? hm(dueHour(t, ws, we) % 24, t.min) : null;
        const lead = m[0].length - m[0].trimStart().length;
        return { due: { date: dateKey(day), time }, span: [m.index + lead, m.index + m[0].length] };
      }
    }
    // "6시까지" — 시간 범위(3시부터 6시까지)의 끝이 아닐 때만
    const re = new RegExp(DUE_TIME_RE.source, 'g');
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      if (/(?:-|~|–|부터)\s*$/.test(before)) continue;
      const t = readTime(m, 1);
      if (!valid(t)) continue;
      const h = dueHour(t, ws, we) % 24;
      let day = today;
      if (at(day, h, t.min) <= now) day = addDays(day, 1);
      return { due: { date: dateKey(day), time: hm(h, t.min) }, span: [m.index, m.index + m[0].length] };
    }
    return null;
  }

  function parse(text, now, opts) {
    now = now || new Date();
    opts = opts || {};
    const ws = opts.workStart ?? 9;
    const we = opts.workEnd ?? 18;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const spans = [];
    const out = { date: null, start: null, end: null, project: null, spans, rule: null, repeat: null, due: null, dueSpan: null };

    const pm = /#([^\s#]+)/.exec(text);
    if (pm) out.project = pm[1];

    // 마감(목요일까지, 10/23까지, 6시까지) — 시작 시간과 따로 저장
    if (!opts.noDue && !opts.noRepeat && !readRepeat(text)) {
      const dd = readDue(text, today, now, ws, we);
      if (dd) {
        const masked = text.slice(0, dd.span[0]) + ' '.repeat(dd.span[1] - dd.span[0]) + text.slice(dd.span[1]);
        const inner = parse(masked, now, Object.assign({}, opts, { noDue: true }));
        Object.assign(out, inner, { project: out.project, due: dd.due, dueSpan: dd.span });
        out.spans = [dd.span, ...inner.spans].sort((a, b) => a[0] - b[0]);
        return out;
      }
    }

    // 반복(매주 수요일, 매일, 평일, 매월 1일)
    const rr = opts.noRepeat ? null : readRepeat(text);
    if (rr) {
      spans.push(rr.span);
      const masked = text.slice(0, rr.span[0]) + ' '.repeat(rr.span[1] - rr.span[0]) + text.slice(rr.span[1]);
      const inner = parse(masked, now, Object.assign({}, opts, { noRepeat: true }));
      spans.push(...inner.spans);
      spans.sort((a, b) => a[0] - b[0]);
      out.repeat = rr.rep;
      out.start = inner.start;
      out.end = inner.end;
      out.rule = inner.rule;
      // 첫 회차: 오늘부터 규칙에 맞는 날. 오늘인데 시간이 지났으면 다음 회차
      const from = inner.date && inner.rule === 'date' ? fromKey(inner.date) : today;
      const anchor = dateKey(from);
      if (!rr.rep.days && rr.rep.freq === 'weekly') rr.rep.days = null;
      let first = firstMatch(rr.rep, from, anchor);
      if (first && out.start) {
        const [h, mi] = out.start.split(':').map(Number);
        if (at(first, h, mi) <= now) first = firstMatch(rr.rep, addDays(first, 1), anchor);
      }
      out.date = first ? dateKey(first) : dateKey(today);
      if (rr.rep.freq === 'weekly' && !rr.rep.days) rr.rep.days = [fromKey(out.date).getDay()];
      if (rr.rep.freq === 'monthly' && !rr.rep.monthDay) rr.rep.monthDay = fromKey(out.date).getDate();
      return out;
    }

    // 30분 후 / 1시간 뒤
    let m = /(\d+)\s*(분|시간)\s*(후|뒤)/.exec(text);
    if (m) {
      const mins = +m[1] * (m[2] === '시간' ? 60 : 1);
      const t = new Date(now.getTime() + mins * 60000);
      out.date = dateKey(t);
      out.start = hm(t.getHours(), t.getMinutes());
      out.rule = 'relative';
      spans.push([m.index, m.index + m[0].length]);
      return out;
    }

    // 날짜
    let baseDay = today;
    let explicitDate = false;
    if ((m = /(오늘|내일|모레)/.exec(text))) {
      baseDay = addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m[1]]);
      explicitDate = true;
      spans.push([m.index, m.index + m[0].length]);
    } else if ((m = /(다음\s*주\s*|이번\s*주\s*)?([월화수목금토일])요일/.exec(text))) {
      const target = DAYS.indexOf(m[2]);
      const mon = (d) => (d + 6) % 7; // 월=0 … 일=6
      let diff;
      if (m[1] && /다음/.test(m[1])) diff = 7 - mon(today.getDay()) + mon(target);
      else if (m[1]) diff = mon(target) - mon(today.getDay());
      else diff = (target - today.getDay() + 7) % 7;
      baseDay = addDays(today, diff);
      explicitDate = true;
      spans.push([m.index, m.index + m[0].length]);
    } else if ((m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text)) || (m = /(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d])/.exec(text))) {
      const mo = +m[1];
      const d = +m[2];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        let cand = new Date(today.getFullYear(), mo - 1, d);
        if (cand < today) cand = new Date(today.getFullYear() + 1, mo - 1, d);
        baseDay = cand;
        explicitDate = true;
        spans.push([m.index, m.index + m[0].length]);
      }
    }

    // 시간 범위 (3시-4시, 15:00~16:00, 3시부터 4시까지)
    const rangeRe = new RegExp(TIME_SRC + '\\s*(?:-|~|–|부터)\\s*' + TIME_SRC + '(?:\\s*까지)?');
    const singleRe = new RegExp(TIME_SRC);
    let t1 = null;
    let t2 = null;
    if ((m = rangeRe.exec(text))) {
      t1 = readTime(m, 1);
      t2 = readTime(m, 7);
      spans.push([m.index, m.index + m[0].length]);
    } else if ((m = singleRe.exec(text))) {
      t1 = readTime(m, 1);
      spans.push([m.index, m.index + m[0].length]);
    }

    if (t1 && valid(t1)) {
      const s = resolveStart(t1, baseDay, explicitDate, now, ws, we);
      out.date = dateKey(s.day);
      out.start = hm(s.h, s.min);
      out.rule = s.rule;
      if (t2 && valid(t2)) {
        const eh = resolveEnd(t2, s.h, t1.mer, s.min);
        out.end = hm(eh % 24, t2.min);
        // 시작은 지났어도 끝이 아직이면(진행 중) 오늘로 둔다
        if (!explicitDate && dateKey(s.day) !== dateKey(baseDay)) {
          let endToday = at(baseDay, eh % 24, t2.min);
          if (endToday <= at(baseDay, s.h, s.min)) endToday = addDays(endToday, 1);
          if (endToday > now) out.date = dateKey(baseDay);
        }
      }
    } else if (explicitDate) {
      out.date = dateKey(baseDay);
      out.rule = 'date';
    }

    spans.sort((a, b) => a[0] - b[0]);
    return out;
  }

  const api = { parse, matchRepeat, firstMatch, repeatLabel, util: { pad, dateKey, fromKey, addDays, hm, at } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DaylineParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
