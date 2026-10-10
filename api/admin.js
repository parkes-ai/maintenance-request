// 관리자: 비밀번호 확인 → 요청 목록(캡처 임시 주소 포함) / 상태 바꾸기
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, TABLE, STATUSES, sbHeaders, readBody, signImages } = require('./_lib');

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
    const members = (d.users || [])
      .map((u) => ({ email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null, confirmed: Boolean(u.email_confirmed_at || u.confirmed_at) }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ members });
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
    let change;
    if (typeof b.memo === 'string') {
      // 관리자 메모 (고객에게는 보이지 않는다)
      change = { memo: b.memo.trim().slice(0, 500) || null, updated_at: now };
    } else if (STATUSES.includes(b.status)) {
      // 완료로 바꾸면 완료한 날을 남기고, 다시 다른 상태로 돌리면 지운다 (자동 삭제 기준일)
      change = { status: b.status, updated_at: now, completed_at: b.status === '완료' ? now : null };
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
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
};
