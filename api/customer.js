// 전용 링크 확인: 링크 토큰으로 고객사 이름만 알려 준다 (요청 폼에 회사 이름을 미리 넣기 위해)
const { SB_URL, SB_KEY, customerByToken } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const c = await customerByToken(req.query && req.query.t);
  if (!c) return res.status(404).json({ error: '링크가 맞지 않거나 더 이상 쓰지 않는 링크예요.' });
  return res.status(200).json({ name: c.name });
};
