// 로그인 창구용 공개 정보만 내려 준다. 서버 키는 절대 여기 넣지 않는다.
const { SB_URL, SB_ANON } = require('./_lib');

module.exports = (req, res) => {
  if (!SB_URL || !SB_ANON) return res.status(500).json({ error: 'Supabase 공개 키가 없어요. Vercel Storage 연결 후 다시 배포해 주세요.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ url: SB_URL, key: SB_ANON });
};
