// 전용 링크에서 가입·로그인한 회원을 그 고객사에 연결한다. 이미 다른 회사에 연결돼 있으면 바꾸지 않는다
const { SB_URL, SB_KEY, sbHeaders, readBody, getUser, customerByToken, membershipOf } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요.' });
  const c = await customerByToken(readBody(req).t);
  if (!c) return res.status(404).json({ error: '링크가 맞지 않거나 더 이상 쓰지 않는 링크예요.' });
  const cur = await membershipOf(user.id);
  if (cur) return res.status(200).json({ ok: true, customer: cur.name, already: true, same: cur.id === c.id });
  const r = await fetch(`${SB_URL}/rest/v1/customer_members`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: user.id, customer_id: c.id }),
  });
  if (!r.ok) return res.status(500).json({ error: '회사와 연결하지 못했어요.' });
  return res.status(200).json({ ok: true, customer: c.name });
};
