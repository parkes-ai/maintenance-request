// 로그인한 고객사 담당자에게 요청과 처리 상태를 보여 준다
// 고객사에 연결된 회원이면 그 회사 요청 전부, 아니면 본인이 로그인하고 남긴 요청만
const { SB_URL, SB_KEY, TABLE, sbHeaders, getUser, signImages, membershipOf } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요.' });
  const company = await membershipOf(user.id);
  const fields = 'id,created_at,company,program,kind,urgency,message,images,status,updated_at';
  const who = company ? `customer_id=eq.${company.id}` : `user_id=eq.${encodeURIComponent(user.id)}`;
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=${fields}&${who}&order=created_at.desc&limit=200`, { headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
  return res.status(200).json({ email: user.email, company: company ? company.name : null, rows: await signImages(await r.json()) });
};
