// 로그인한 고객사 담당자에게 본인이 남긴 요청과 처리 상태만 보여 준다
const { SB_URL, SB_KEY, TABLE, sbHeaders, getUser, signImages } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요.' });
  const fields = 'id,created_at,company,program,kind,urgency,message,images,status,updated_at';
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=${fields}&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`, { headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
  return res.status(200).json({ email: user.email, rows: await signImages(await r.json()) });
};
