// 관리자 API (비밀번호 x-admin-password 확인 뒤에만)
// 요청: 목록 · 처리(우선순위·유형·원인·담당자·청구 예외) · 상태(5가지) · 메모 · 내용 수정 · 유상 승인 요청 · 삭제 · 직접 등록
// 그 밖: 작업 기록 · 인력 · 고객사 · 월 요약 · 회원 · 변경 기록
const crypto = require('node:crypto');
const L = require('./_lib');
const { sendDoneMail } = require('./_mail');
const { SB_URL, SB_KEY, TABLE, BUCKET, FILE_BUCKET, STATUSES, KINDS, URGENCIES, PRIORITIES, CATEGORIES, CAUSES, BILLINGS, MODES, CHANNELS, sbHeaders, readBody } = L;

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enc = encodeURIComponent;
const db = (path, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders(), ...(init.headers || {}) } });
const json = async (r) => (r.ok ? r.json() : null);
const filePaths = (rows) => rows.flatMap((r) => [
  ...(Array.isArray(r.body) ? r.body.filter((s) => s.t === 'img').map((s) => s.p) : []),
  ...((r.attachments || []).map((a) => a.p)),
]).filter(Boolean);
const kstMonthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1) - 9 * 3600000);
  const end = new Date(Date.UTC(y, mo, 1) - 9 * 3600000);
  return [start.toISOString(), end.toISOString()];
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'Vercel 환경변수에 ADMIN_PASSWORD를 넣고 Redeploy 해 주세요.' });
  if (!same(req.headers['x-admin-password'] || '', pass)) return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const view = req.query && req.query.view;
  const b = req.method === 'GET' ? {} : readBody(req);
  const now = new Date().toISOString();
  const fail = (code, error) => res.status(code).json({ error });

  // ───── 회원 목록: 이메일·가입일·마지막 로그인·연결된 회사·요청 수 ─────
  if (view === 'members' && req.method === 'GET') {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: sbHeaders() });
    if (!r.ok) return fail(500, '회원 목록을 불러오지 못했어요.');
    const d = await r.json();
    const q = await json(await db(`${TABLE}?select=user_id,status&user_id=not.is.null&limit=10000`));
    if (!q) return fail(500, '회원별 요청 수를 세지 못했어요.');
    const companyOf = {};
    for (const x of (await json(await db('customer_members?select=user_id,customers(name)'))) || []) companyOf[x.user_id] = x.customers && x.customers.name;
    const count = {};
    for (const x of q) { const c = (count[x.user_id] ||= { total: 0, open: 0 }); c.total++; if (x.status !== '완료') c.open++; }
    const members = (d.users || []).map((u) => ({
      id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null, confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      requests: (count[u.id] || {}).total || 0, open: (count[u.id] || {}).open || 0, company: companyOf[u.id] || null,
    })).sort((a, b2) => String(b2.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ members });
  }

  // ───── 고객사 ─────
  if (view === 'customers') {
    const FIELDS = 'id,name,code,token,active,billing,monthly_hours,contact,scope_note,created_at';
    if (req.method === 'GET') {
      const [c, q, m] = await Promise.all([
        db(`customers?select=${FIELDS}&order=name.asc`),
        db(`${TABLE}?select=customer_id,status&customer_id=not.is.null&limit=10000`),
        db('customer_members?select=customer_id'),
      ]);
      if (!c.ok || !q.ok || !m.ok) return fail(500, '고객사 목록을 불러오지 못했어요.');
      const reqs = {}, open = {}, mem = {};
      for (const x of await q.json()) { reqs[x.customer_id] = (reqs[x.customer_id] || 0) + 1; if (x.status !== '완료') open[x.customer_id] = (open[x.customer_id] || 0) + 1; }
      for (const x of await m.json()) mem[x.customer_id] = (mem[x.customer_id] || 0) + 1;
      return res.status(200).json({ customers: (await c.json()).map((x) => ({ ...x, requests: reqs[x.id] || 0, open: open[x.id] || 0, members: mem[x.id] || 0 })) });
    }
    // 고객사 정보 확인 (추가·수정 공통)
    const info = (src) => {
      const out = {};
      // 코드는 DB가 C001처럼 자동으로 붙이고 바꾸지 않는다 (docs/setup.sql v2.1)
      if ('billing' in src) { if (!BILLINGS.includes(src.billing)) return { error: '청구 방식을 골라 주세요.' }; out.billing = src.billing; }
      if ('monthly_hours' in src) { const h = src.monthly_hours === '' || src.monthly_hours === null ? null : Number(src.monthly_hours); if (h !== null && !(h >= 0 && h <= 1000)) return { error: '월 정액 포함 시간을 확인해 주세요.' }; out.monthly_hours = h; }
      if ('contact' in src) out.contact = clip(src.contact, 200) || null;
      if ('scope_note' in src) out.scope_note = clip(src.scope_note, 1000) || null;
      if ('name' in src) { const n = clip(src.name, 100); if (!n) return { error: '회사 이름을 적어 주세요.' }; out.name = n; }
      return { out };
    };
    if (req.method === 'POST') {
      // 고객사 추가. fromRequest가 있으면 '신규 문의'를 고객사로 등록하면서 같은 회사 이름의 신규 문의를 함께 묶는다
      const name = clip(b.name, 100);
      if (!name) return fail(400, '회사 이름을 적어 주세요.');
      const v = info({ ...b, name });
      if (v.error) return fail(400, v.error);
      const like = name.replace(/[\\%_*]/g, (ch) => '\\' + ch);
      let [cust] = (await json(await db(`customers?name=ilike.${enc(like)}&select=${FIELDS}`))) || [];
      const existed = !!cust;
      if (!cust) {
        const r = await db(`customers?select=${FIELDS}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v.out, name, token: L.newToken() }) });
        if (!r.ok) return fail(500, '고객사를 만들지 못했어요.');
        [cust] = await r.json();
      } else if (b.fromRequest === undefined) {
        return fail(409, `이미 등록된 고객사예요: ${cust.name}`);
      }
      let linked = 0;
      if (b.fromRequest !== undefined) {
        const id = Number(b.fromRequest);
        if (!Number.isInteger(id)) return fail(400, '잘못된 요청이에요.');
        const attach = (filter) => db(`${TABLE}?customer_id=is.null&${filter}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ customer_id: cust.id }) });
        const p1 = await attach(`id=eq.${id}`);
        const p2 = await attach(`company=ilike.${enc(like)}`);
        if (!p1.ok || !p2.ok) return fail(500, '고객사는 만들었지만 요청을 묶지 못했어요.');
        linked = (await p1.json()).length + (await p2.json()).length;
      }
      return res.status(200).json({ ok: true, customer: cust, existed, linked });
    }
    if (req.method === 'PATCH') {
      // 링크 새로 만들기 / 사용 중지·다시 사용 / 정보 고치기(코드·청구 방식·포함 시간·연락처·메모)
      const id = Number(b.id);
      if (!Number.isInteger(id)) return fail(400, '잘못된 요청이에요.');
      let change;
      if (b.rotate === true) change = { token: L.newToken() };
      else if (typeof b.active === 'boolean') change = { active: b.active };
      else if (b.info && typeof b.info === 'object') {
        const v = info(b.info);
        if (v.error) return fail(400, v.error);
        change = v.out;
      } else return fail(400, '잘못된 요청이에요.');
      const r = await db(`customers?id=eq.${id}&select=${FIELDS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(change) });
      if (!r.ok) return fail(500, '바꾸지 못했어요.');
      const [cust] = await r.json();
      if (!cust) return fail(404, '없는 고객사예요.');
      return res.status(200).json({ ok: true, customer: cust });
    }
    return fail(405, '지원하지 않는 요청이에요.');
  }

  // ───── 인력 (로그인하지 않음, 퇴사해도 이력 보존) ─────
  if (view === 'staff') {
    const FIELDS = 'id,name,status,email,phone,availability,joined_at,left_at';
    if (req.method === 'GET') {
      const s = await json(await db(`staff?select=${FIELDS}&order=status.asc,name.asc`));
      if (!s) return fail(500, '인력 목록을 불러오지 못했어요.');
      return res.status(200).json({ staff: s });
    }
    const v = {};
    const src = b.info || b;
    if ('name' in src) { v.name = clip(src.name, 50); if (!v.name) return fail(400, '이름을 적어 주세요.'); }
    if ('email' in src) { v.email = clip(src.email, 100) || null; if (v.email && !EMAIL_RE.test(v.email)) return fail(400, '이메일 주소를 확인해 주세요.'); }
    if ('phone' in src) v.phone = clip(src.phone, 20) || null;
    if ('availability' in src) v.availability = clip(src.availability, 200) || null;
    if ('status' in src) {
      if (!['재직', '퇴사'].includes(src.status)) return fail(400, '재직·퇴사 중에서 골라 주세요.');
      v.status = src.status;
      v.left_at = src.status === '퇴사' ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) : null;
    }
    if (req.method === 'POST') {
      if (!v.name) return fail(400, '이름을 적어 주세요.');
      const r = await db(`staff?select=${FIELDS}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v, joined_at: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) }) });
      if (!r.ok) return fail(500, '인력을 추가하지 못했어요.');
      return res.status(200).json({ ok: true, staff: (await r.json())[0] });
    }
    if (req.method === 'PATCH') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || !Object.keys(v).length) return fail(400, '잘못된 요청이에요.');
      const r = await db(`staff?id=eq.${id}&select=${FIELDS}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(v) });
      if (!r.ok) return fail(500, '바꾸지 못했어요.');
      return res.status(200).json({ ok: true, staff: (await r.json())[0] });
    }
    return fail(405, '지원하지 않는 요청이에요.');
  }

  // ───── 작업 기록 (처리 시간은 합계로 요청에 저장) ─────
  if (view === 'worklogs') {
    const total = async (rid) => {
      const logs = (await json(await db(`work_logs?request_id=eq.${rid}&select=minutes`))) || [];
      const sum = logs.reduce((s, x) => s + x.minutes, 0);
      await db(`${TABLE}?id=eq.${rid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ minutes_spent: sum, updated_at: now }) });
      return sum;
    };
    if (req.method === 'GET') {
      const rid = Number(req.query.id);
      if (!Number.isInteger(rid)) return fail(400, '잘못된 요청이에요.');
      const logs = await json(await db(`work_logs?request_id=eq.${rid}&select=id,worked_on,mode,minutes,note,staff_id,created_at&order=worked_on.desc,created_at.desc`));
      if (!logs) return fail(500, '작업 기록을 불러오지 못했어요.');
      return res.status(200).json({ logs });
    }
    if (req.method === 'POST') {
      const rid = Number(b.request_id), minutes = Number(b.minutes);
      if (!Number.isInteger(rid)) return fail(400, '잘못된 요청이에요.');
      if (!MODES.includes(b.mode)) return fail(400, '작업 방식을 골라 주세요.');
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return fail(400, '처리 시간을 분 단위로 입력해 주세요. (1~1440)');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.worked_on)) ? b.worked_on : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const row = { request_id: rid, worked_on: day, mode: b.mode, minutes, note: clip(b.note, 500) || null, staff_id: Number.isInteger(Number(b.staff_id)) && b.staff_id ? Number(b.staff_id) : null };
      const r = await db('work_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!r.ok) return fail(500, '작업 기록을 저장하지 못했어요.');
      const before = (((await json(await db(`${TABLE}?id=eq.${rid}&select=minutes_spent`))) || [])[0] || {}).minutes_spent || 0;
      const sum = await total(rid);
      await db('request_edits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ request_id: rid, edited_at: now, changes: { minutes: { from: before, to: sum } } }) });
      await db(`${TABLE}?id=eq.${rid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_logged_at: now }) });
      return res.status(200).json({ ok: true, minutes_spent: sum });
    }
    if (req.method === 'DELETE') {
      const id = Number(b.id);
      if (!Number.isInteger(id)) return fail(400, '잘못된 요청이에요.');
      const [log] = (await json(await db(`work_logs?id=eq.${id}&select=request_id`))) || [];
      if (!log) return fail(404, '이미 지워진 기록이에요.');
      const before = (((await json(await db(`${TABLE}?id=eq.${log.request_id}&select=minutes_spent`))) || [])[0] || {}).minutes_spent || 0;
      await db(`work_logs?id=eq.${id}`, { method: 'DELETE' });
      const sum = await total(log.request_id);
      await db('request_edits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ request_id: log.request_id, edited_at: now, changes: { minutes: { from: before, to: sum } } }) });
      return res.status(200).json({ ok: true, minutes_spent: sum });
    }
    return fail(405, '지원하지 않는 요청이에요.');
  }

  // ───── 월 요약 (고객사별, 접수한 달 기준 · 한국 시간) ─────
  if (view === 'summary' && req.method === 'GET') {
    const m = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? req.query.month : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    const [from, to] = kstMonthRange(m);
    const [rows, custs] = await Promise.all([
      json(await db(`${TABLE}?created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=id,public_no,created_at,completed_at,status,customer_id,company,message,kind,category,cause,priority,minutes_spent,billing_override,respond_by,first_response_at,approval_status&order=created_at.asc&limit=5000`)),
      json(await db('customers?select=id,name,code,billing,monthly_hours')),
    ]);
    if (!rows || !custs) return fail(500, '월 요약을 만들지 못했어요.');
    const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
    const groups = {};
    for (const r of rows) {
      const c = r.customer_id ? cmap[r.customer_id] : null;
      const key = c ? `c${c.id}` : 'new';
      const g = (groups[key] ||= { customer_id: c ? c.id : null, name: c ? c.name : '신규 문의(미등록)', code: c ? c.code : 'NEW', billing: c ? c.billing : null, monthly_hours: c ? c.monthly_hours : null, total: 0, done: 0, minutes: 0, free_minutes: 0, by_cause: {}, by_category: {}, by_kind: {}, responded: 0, on_time: 0, approvals: { 요청함: 0, 동의: 0, 거절: 0 }, rows: [] });
      const billing = r.billing_override || (r.cause === '우리 결함' ? '무상' : (c ? c.billing : '무상'));
      const free = billing === '무상' || billing === '계약 범위 안';
      g.total++; if (r.status === '완료') g.done++;
      g.minutes += r.minutes_spent || 0; if (free) g.free_minutes += r.minutes_spent || 0;
      g.by_cause[r.cause || '미분류'] = (g.by_cause[r.cause || '미분류'] || 0) + 1;
      g.by_category[r.category || '미분류'] = (g.by_category[r.category || '미분류'] || 0) + 1;
      g.by_kind[r.kind] = (g.by_kind[r.kind] || 0) + 1;
      if (r.first_response_at) { g.responded++; if (r.respond_by && r.first_response_at <= r.respond_by) g.on_time++; }
      if (r.approval_status) g.approvals[r.approval_status]++;
      g.rows.push({ no: r.public_no || `#${r.id}`, created_at: r.created_at, completed_at: r.completed_at, status: r.status, summary: String(r.message).replace(/\s+/g, ' ').slice(0, 80), kind: r.kind, cause: r.cause, minutes: r.minutes_spent || 0, billing, free });
    }
    return res.status(200).json({ month: m, groups: Object.values(groups).sort((a, b2) => b2.minutes - a.minutes || b2.total - a.total) });
  }

  // ───── 변경 기록 ─────
  if (view === 'edits') {
    if (req.method === 'POST') { // 여러 요청 한 번에 (CSV용)
      const ids = [...new Set((b.ids || []).map(Number))];
      if (!ids.length) return res.status(200).json({ edits: [] });
      if (ids.length > 500 || !ids.every(Number.isInteger)) return fail(400, '잘못된 요청이에요.');
      const e = await json(await db(`request_edits?request_id=in.(${ids.join(',')})&select=request_id,edited_at,changes&order=edited_at.desc&limit=10000`));
      return e ? res.status(200).json({ edits: e }) : fail(500, '변경 기록을 불러오지 못했어요.');
    }
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return fail(400, '잘못된 요청이에요.');
    const e = await json(await db(`request_edits?request_id=eq.${id}&select=edited_at,changes&order=edited_at.desc&limit=100`));
    return e ? res.status(200).json({ edits: e }) : fail(500, '수정 기록을 불러오지 못했어요.');
  }

  // ───── 요청 직접 등록 (전화·이메일로 받은 건) ─────
  if (view === 'create' && req.method === 'POST') {
    const row = {
      channel: b.channel, name: clip(b.name, 30), contact: clip(b.email, 100), phone: clip(b.phone, 20) || null,
      program: clip(b.program, 100), kind: b.kind, urgency: b.urgency || '보통', consent: true,
    };
    if (!['유선', '이메일', '기타'].includes(row.channel)) return fail(400, '접수 경로를 선택해 주세요.');
    if (!row.name) return fail(400, '이름을 입력해 주세요.');
    if (!EMAIL_RE.test(row.contact)) return fail(400, '이메일 주소를 확인해 주세요.');
    if (!row.program) return fail(400, '프로그램을 적어 주세요.');
    if (!KINDS.includes(row.kind) || !URGENCIES.includes(row.urgency)) return fail(400, '요청 종류와 급한 정도를 골라 주세요.');
    let cust = null;
    if (b.customer_id) {
      [cust] = (await json(await db(`customers?id=eq.${Number(b.customer_id)}&select=id,name,code`))) || [];
      if (!cust) return fail(400, '고객사를 다시 골라 주세요.');
      row.customer_id = cust.id; row.company = cust.name;
    } else {
      row.company = clip(b.company, 100);
      if (!row.company) return fail(400, '고객을 선택하거나 회사 이름을 적어 주세요.');
    }
    const bd = L.cleanBody(b.body, 0);
    if (bd.error) return fail(400, bd.error);
    const fl = L.cleanFiles(b.attachments);
    if (fl.error) return fail(400, fl.error);
    row.body = bd.body; row.attachments = fl.files;
    row.message = L.bodyText(bd.body) || `[이미지 ${bd.imgs}장]`;
    row.priority = L.priorityOf(row.urgency);
    row.respond_by = L.respondBy(new Date(), row.priority);
    row.public_no = await L.nextPublicNo(L.codeOf(cust));
    const r = await db(`${TABLE}?select=id,public_no`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!r.ok) return fail(500, '저장하지 못했어요.');
    const [saved] = await r.json();
    return res.status(200).json({ ok: true, id: saved.id, no: saved.public_no });
  }

  // ───── 요청 목록 ─────
  if (req.method === 'GET') {
    const r = await db(`${TABLE}?select=*,customers(name,code,billing)&order=created_at.desc&limit=500`);
    if (!r.ok) return fail(500, '불러오지 못했어요.');
    let rows = await r.json();
    rows = await L.signImages(rows);
    rows = await L.signFiles(rows);
    return res.status(200).json({ rows });
  }

  // ───── 요청 바꾸기 ─────
  if (req.method === 'PATCH') {
    const id = Number(b.id);
    if (!Number.isInteger(id)) return fail(400, '잘못된 요청이에요.');
    const getCur = async (fields) => ((await json(await db(`${TABLE}?id=eq.${id}&select=${fields}`))) || [])[0];
    // 요청을 바꾸고 변경 기록(request_edits)을 남긴다
    const saveLogged = async (change, diff, logFail, extra = {}) => {
      Object.assign(change, { updated_at: now, last_logged_at: now });
      const u = await db(`${TABLE}?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(change) });
      if (!u.ok) return fail(500, '바꾸지 못했어요.');
      const l = await db('request_edits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ request_id: id, edited_at: now, changes: diff }) });
      if (!l.ok) return fail(500, logFail);
      return res.status(200).json({ ok: true, changed: Object.keys(diff), ...extra });
    };
    const diffOf = (cur, change) => { const d = {}; for (const k of Object.keys(change)) if ((cur[k] ?? null) !== (change[k] ?? null)) d[k] = { from: cur[k] ?? null, to: change[k] ?? null }; return d; };

    // 처리 항목: 우선순위 · 유형 · 원인 · 담당자 · 청구 예외 (우선순위가 바뀌면 응답 목표를 다시 계산)
    if (b.process && typeof b.process === 'object') {
      const p = b.process, change = {};
      if ('priority' in p) { if (!PRIORITIES.includes(p.priority)) return fail(400, '우선순위를 선택해 주세요.'); change.priority = p.priority; }
      if ('category' in p) { if (p.category && !CATEGORIES.includes(p.category)) return fail(400, '유형이 맞지 않아요.'); change.category = p.category || null; }
      if ('cause' in p) { if (p.cause && !CAUSES.includes(p.cause)) return fail(400, '원인이 맞지 않아요.'); change.cause = p.cause || null; }
      if ('billing_override' in p) { if (p.billing_override && !BILLINGS.includes(p.billing_override)) return fail(400, '청구 방식이 맞지 않아요.'); change.billing_override = p.billing_override || null; }
      if ('assigned_to' in p) {
        const sid = p.assigned_to ? Number(p.assigned_to) : null;
        if (sid !== null) { const [s] = (await json(await db(`staff?id=eq.${sid}&status=eq.${enc('재직')}&select=id`))) || []; if (!s) return fail(400, '재직 중인 인력을 골라 주세요.'); }
        change.assigned_to = sid;
      }
      const cur = await getCur('priority,category,cause,billing_override,assigned_to,status,created_at,first_response_at');
      if (!cur) return fail(404, '이미 지워진 요청이에요.');
      const diff = diffOf(cur, change);
      if (!Object.keys(diff).length) return res.status(200).json({ ok: true, unchanged: true });
      if (diff.priority) change.respond_by = L.respondBy(cur.created_at, change.priority);
      // 담당자를 정하면 '새 요청' → '배정'
      if (diff.assigned_to && change.assigned_to && cur.status === '새 요청') {
        change.status = '배정'; diff.status = { from: '새 요청', to: '배정' };
        if (!cur.first_response_at) change.first_response_at = now;
      }
      return saveLogged(change, diff, '바꿨지만 변경 기록을 남기지 못했어요.', { respond_by: change.respond_by });
    }

    // 상태 (완료: 처리 시간과 원인이 있어야 · 보류: 사유 필수 · 완료되면 완료 안내 메일)
    if (STATUSES.includes(b.status)) {
      const cur = await getCur('status,minutes_spent,cause,first_response_at,contact,name,public_no,message');
      if (!cur) return fail(404, '이미 지워진 요청이에요.');
      if (cur.status === b.status) return res.status(200).json({ ok: true, unchanged: true });
      const change = { status: b.status, completed_at: b.status === '완료' ? now : null };
      const diff = { status: { from: cur.status, to: b.status } };
      if (b.status === '완료') {
        if (!(cur.minutes_spent > 0)) return fail(400, '완료하려면 작업 기록(처리 시간)을 먼저 남겨 주세요.');
        if (!cur.cause) return fail(400, '완료하려면 원인을 먼저 골라 주세요.');
      }
      if (b.status === '보류') {
        const reason = clip(b.reason, 300);
        if (!reason) return fail(400, '보류 사유를 적어 주세요.');
        change.hold_reason = reason; diff.hold_reason = { from: null, to: reason };
      }
      if (cur.status === '새 요청' && !cur.first_response_at) change.first_response_at = now;
      let mail = null;
      if (b.status === '완료') {
        mail = await sendDoneMail({ id, ...cur });
        change.mail_status = mail.status; change.mail_at = mail.status === '발송됨' ? now : null; change.mail_error = mail.error || null;
      }
      return saveLogged(change, diff, '상태는 바꿨지만 변경 기록을 남기지 못했어요.', mail ? { mail: mail.status } : {});
    }

    // 유상 작업 승인 요청 / 취소
    if (b.approval && typeof b.approval === 'object') {
      const cur = await getCur('approval_status,approval_minutes,approval_note');
      if (!cur) return fail(404, '이미 지워진 요청이에요.');
      if (b.approval.cancel === true) {
        if (!cur.approval_status) return res.status(200).json({ ok: true, unchanged: true });
        return saveLogged({ approval_status: null, approval_minutes: null, approval_note: null, approval_requested_at: null, approval_decided_at: null, approval_by: null },
          { approval: { from: cur.approval_status, to: null } }, '바꿨지만 변경 기록을 남기지 못했어요.');
      }
      const minutes = Number(b.approval.minutes), note = clip(b.approval.note, 1000);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000) return fail(400, '예상 작업 시간을 분 단위로 적어 주세요.');
      if (!note) return fail(400, '어떤 작업인지 고객이 알 수 있게 설명을 적어 주세요.');
      return saveLogged({ approval_status: '요청함', approval_minutes: minutes, approval_note: note, approval_requested_at: now, approval_decided_at: null, approval_by: null },
        { approval: { from: cur.approval_status, to: '요청함' } }, '승인 요청은 저장했지만 변경 기록을 남기지 못했어요.');
    }

    // 요청 내용 고치기 (고객사 고르기 포함). 본문(글·이미지)은 손님이 쓴 그대로 둔다 — 예전 글만 있는 요청은 글 수정 가능
    if (b.edit && typeof b.edit === 'object') {
      const e = b.edit;
      const change = {
        name: clip(e.name, 50), contact: clip(e.contact, 100), phone: clip(e.phone, 20) || null,
        program: clip(e.program, 100), kind: clip(e.kind, 20), urgency: clip(e.urgency, 20),
      };
      if (!change.name || !change.contact) return fail(400, '이름과 이메일(연락처)은 비울 수 없어요.');
      if (!change.program) return fail(400, '프로그램은 비울 수 없어요.');
      if (!KINDS.includes(change.kind) || !URGENCIES.includes(change.urgency)) return fail(400, '요청 종류나 급한 정도가 맞지 않아요.');
      if (e.customer_id) {
        const [c] = (await json(await db(`customers?id=eq.${Number(e.customer_id)}&select=id,name`))) || [];
        if (!c) return fail(400, '고객사를 다시 골라 주세요.');
        change.customer_id = c.id; change.company = c.name;
      } else {
        change.customer_id = null; change.company = clip(e.company, 100);
        if (!change.company) return fail(400, '회사 이름은 비울 수 없어요.');
      }
      const cur = await getCur('company,customer_id,name,contact,phone,program,kind,urgency,message,body');
      if (!cur) return fail(404, '이미 지워진 요청이에요.');
      if (typeof e.message === 'string' && !Array.isArray(cur.body)) { change.message = clip(e.message, 3000); if (!change.message) return fail(400, '요청 내용은 비울 수 없어요.'); }
      const diff = diffOf(cur, change);
      if (!Object.keys(diff).length) return res.status(200).json({ ok: true, unchanged: true });
      change.edited_at = now;
      return saveLogged(change, diff, '내용은 고쳤지만 수정 기록을 남기지 못했어요.');
    }

    // 관리자 메모 (고객에게는 보이지 않는다)
    if (typeof b.memo === 'string') {
      const memo = b.memo.trim().slice(0, 2000) || null;
      const cur = await getCur('memo');
      if (!cur) return fail(404, '이미 지워진 요청이에요.');
      if ((cur.memo || null) === memo) return res.status(200).json({ ok: true, unchanged: true });
      return saveLogged({ memo }, { memo: { from: cur.memo || null, to: memo } }, '메모는 저장했지만 변경 기록을 남기지 못했어요.');
    }
    return fail(400, '잘못된 요청이에요.');
  }

  // ───── 요청 삭제 ({id} 또는 {ids}, 최대 100건): 파일을 먼저 지우고 성공하면 요청을 지운다 ─────
  if (req.method === 'DELETE') {
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(Number))];
    if (!ids.length || ids.length > 100 || !ids.every(Number.isInteger)) return fail(400, '잘못된 요청이에요.');
    const found = await json(await db(`${TABLE}?id=in.(${ids.join(',')})&select=id,images,body,attachments`));
    if (!found) return fail(500, '지우지 못했어요.');
    if (!found.length) return fail(404, '이미 지워진 요청이에요.');
    const old = found.flatMap((r) => r.images || []);
    const files = filePaths(found);
    for (const [bucket, paths] of [[BUCKET, old], [FILE_BUCKET, files]]) {
      if (!paths.length) continue;
      const s = await fetch(`${SB_URL}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: sbHeaders(), body: JSON.stringify({ prefixes: paths }) });
      if (!s.ok) return fail(500, '첨부 이미지·파일을 지우지 못해서 요청도 지우지 않았어요. 잠시 뒤 다시 시도해 주세요.');
    }
    const d = await db(`${TABLE}?id=in.(${found.map((r) => r.id).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!d.ok) return fail(500, '지우지 못했어요.');
    return res.status(200).json({ ok: true, deleted: found.map((r) => r.id), images: old.length + files.length });
  }
  return fail(405, '지원하지 않는 요청이에요.');
};
