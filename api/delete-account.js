// 회원 탈퇴: 로그인 확인 + 비밀번호 다시 확인 → 계정 삭제.
// 남긴 요청은 지우지 않고 계정 연결만 끊긴다(user_id → null, 표 설정 on delete set null).
const { SB_URL, SB_KEY, SB_ANON, sbHeaders, readBody, getUser } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY || !SB_ANON) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요.' });

  const { password } = readBody(req);
  if (!password) return res.status(400).json({ error: '비밀번호를 적어 주세요.' });
  const check = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: String(password) }),
  });
  if (!check.ok) return res.status(400).json({ error: '비밀번호가 맞지 않아요.' });

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '탈퇴하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  return res.status(200).json({ ok: true });
};
