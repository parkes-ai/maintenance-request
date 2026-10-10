// 관리자: 비밀번호 확인 → 요청 목록(캡처 임시 주소 포함) / 상태·메모·내용 바꾸기 / 요청 삭제 / 회원 목록
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, TABLE, BUCKET, STATUSES, KINDS, URGENCIES, sbHeaders, readBody, signImages } = require('./_lib');

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'Vercel 환경변수에 ADMIN_PASSWORD를 넣고 Redeploy 해 주세요.' });
  if (!same(req.headers['x-admin-password'] || '', pass)) return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });

  // 회원 목록: 이메일·가입일·마지막 로그인만 내려 준다
  if (req.method === 'GET' && req.query && req.query.view === 'members') {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: '회원 목록을 불러오지 못했어요.' });
    const d = await r.json();
    // 회원별 요청 수 (로그인하고 남긴 요청만 회원과 이어져 있다)
    const q = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=user_id,status&user_id=not.is.null&limit=10000`, { headers: sbHeaders() });
    if (!q.ok) return res.status(500).json({ error: '회원별 요청 수를 세지 못했어요.' });
    const count = {};
    for (const x of await q.json()) {
      const c = (count[x.user_id] ||= { total: 0, open: 0 });
      c.total++;
      if (x.status !== '완료') c.open++;
    }
    const members = (d.users || [])
      .map((u) => ({
        id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null, confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
        requests: (count[u.id] || {}).total || 0, open: (count[u.id] || {}).open || 0,
      }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ members });
  }

  // 요청 하나의 수정 기록 (최근 것이 위)
  if (req.method === 'GET' && req.query && req.query.view === 'edits') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const r = await fetch(`${SB_URL}/rest/v1/request_edits?request_id=eq.${id}&select=edited_at,changes&order=edited_at.desc&limit=100`, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: '수정 기록을 불러오지 못했어요.' });
    return res.status(200).json({ edits: await r.json() });
  }

  if (req.method === 'GET') {
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=*&order=created_at.desc&limit=500`, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
    return res.status(200).json({ rows: await signImages(await r.json()) });
  }
  if (req.method === 'PATCH') {
    const b = readBody(req);
    const id = Number(b.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const now = new Date().toISOString();
    // 요청을 바꾸고 변경 기록(request_edits)을 남긴다
    const saveLogged = async (change, diff, logFail) => {
      Object.assign(change, { updated_at: now, last_logged_at: now });
      const u = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}`, { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(change) });
      if (!u.ok) return res.status(500).json({ error: '바꾸지 못했어요.' });
      const l = await fetch(`${SB_URL}/rest/v1/request_edits`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ request_id: id, edited_at: now, changes: diff }) });
      if (!l.ok) return res.status(500).json({ error: logFail });
      return res.status(200).json({ ok: true, changed: Object.keys(diff) });
    };
    let change;
    if (b.edit && typeof b.edit === 'object') {
      // 요청 내용 고치기 (접수할 때와 같은 기준으로 확인). 화면 캡처·접수 일시는 고치지 않는다
      const clip = (v, n) => String(v ?? '').trim().slice(0, n);
      const e = b.edit;
      change = {
        company: clip(e.company, 100), name: clip(e.name, 50), contact: clip(e.contact, 100),
        program: clip(e.program, 100), kind: clip(e.kind, 20), urgency: clip(e.urgency, 20), message: clip(e.message, 3000),
      };
      if (!change.company || !change.name || !change.contact) return res.status(400).json({ error: '회사 이름, 이름, 연락처는 비울 수 없어요.' });
      if (!change.program) return res.status(400).json({ error: '프로그램은 비울 수 없어요.' });
      if (!change.message) return res.status(400).json({ error: '요청 내용은 비울 수 없어요.' });
      if (!KINDS.includes(change.kind) || !URGENCIES.includes(change.urgency)) return res.status(400).json({ error: '요청 종류나 급한 정도가 맞지 않아요.' });
      // 실제로 바뀐 칸만 기록한다. 바뀐 게 없으면 아무것도 하지 않는다
      const fields = Object.keys(change);
      const g = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}&select=${fields.join(',')}`, { headers: sbHeaders() });
      if (!g.ok) return res.status(500).json({ error: '바꾸지 못했어요.' });
      const [cur] = await g.json();
      if (!cur) return res.status(404).json({ error: '이미 지워진 요청이에요.' });
      const diff = {};
      for (const k of fields) if (cur[k] !== change[k]) diff[k] = { from: cur[k], to: change[k] };
      if (!Object.keys(diff).length) return res.status(200).json({ ok: true, unchanged: true });
      change.edited_at = now;
      return saveLogged(change, diff, '내용은 고쳤지만 수정 기록을 남기지 못했어요.');
    } else if (typeof b.memo === 'string') {
      // 관리자 메모 (고객에게는 보이지 않는다, 기록하지 않는다)
      change = { memo: b.memo.trim().slice(0, 500) || null, updated_at: now };
    } else if (STATUSES.includes(b.status)) {
      // 상태 바꾸기 + 변경 기록. 완료로 바꾸면 완료한 날을 남기고, 다른 상태로 돌리면 지운다 (자동 삭제 기준일)
      const g = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}&select=status`, { headers: sbHeaders() });
      if (!g.ok) return res.status(500).json({ error: '바꾸지 못했어요.' });
      const [cur] = await g.json();
      if (!cur) return res.status(404).json({ error: '이미 지워진 요청이에요.' });
      if (cur.status === b.status) return res.status(200).json({ ok: true, unchanged: true });
      change = { status: b.status, completed_at: b.status === '완료' ? now : null };
      return saveLogged(change, { status: { from: cur.status, to: b.status } }, '상태는 바꿨지만 변경 기록을 남기지 못했어요.');
    } else {
      return res.status(400).json({ error: '잘못된 요청이에요.' });
    }
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(change),
    });
    if (!r.ok) return res.status(500).json({ error: '바꾸지 못했어요.' });
    return res.status(200).json({ ok: true });
  }
  // 요청 삭제 ({id} 한 건 또는 {ids} 여러 건, 최대 100건)
  // 화면 캡처를 먼저 지우고, 성공하면 요청을 지운다 (캡처만 남는 일을 막기 위해)
  if (req.method === 'DELETE') {
    const b = readBody(req);
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(Number))];
    if (!ids.length || ids.length > 100 || !ids.every(Number.isInteger)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const g = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=in.(${ids.join(',')})&select=id,images`, { headers: sbHeaders() });
    if (!g.ok) return res.status(500).json({ error: '지우지 못했어요.' });
    const found = await g.json();
    if (!found.length) return res.status(404).json({ error: '이미 지워진 요청이에요.' });
    const paths = found.flatMap((r) => r.images || []);
    if (paths.length) {
      const s = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: sbHeaders(), body: JSON.stringify({ prefixes: paths }) });
      if (!s.ok) return res.status(500).json({ error: '화면 캡처를 지우지 못해서 요청도 지우지 않았어요. 잠시 뒤 다시 시도해 주세요.' });
    }
    const d = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=in.(${found.map((r) => r.id).join(',')})`, { method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' } });
    if (!d.ok) return res.status(500).json({ error: '지우지 못했어요.' });
    return res.status(200).json({ ok: true, deleted: found.map((r) => r.id), images: paths.length });
  }
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
};
