// 여러 /api 함수가 같이 쓰는 도구. 키 값은 적지 않고 환경변수 이름으로만 읽는다.
// 파일 이름이 _ 로 시작해서 주소(/api/_lib)로는 열리지 않는다.
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLE = 'maintenance_requests';
const BUCKET = 'request-images';
const STATUSES = ['새 요청', '처리 중', '완료'];
const KINDS = ['오류', '수정 요청', '사용 문의'];
const URGENCIES = ['보통', '급함', '업무 중단 중'];

const sbHeaders = () => ({
  apikey: SB_KEY,
  ...(String(SB_KEY).startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
  'Content-Type': 'application/json',
});

const readBody = (req) => {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b;
};

// 로그인한 손님이면 그 사람 정보, 아니면 null
async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SB_URL || !SB_ANON) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// 비공개 저장소의 캡처를 1시간짜리 임시 주소로 바꿔 준다
async function signImages(rows) {
  const paths = [...new Set(rows.flatMap((r) => r.images || []))];
  if (!paths.length) return rows;
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 3600, paths }),
  });
  const map = {};
  if (r.ok) {
    for (const s of await r.json()) {
      if (s.signedURL) map[s.path] = `${SB_URL}/storage/v1${s.signedURL}`;
    }
  }
  return rows.map((row) => ({ ...row, images: (row.images || []).map((p) => map[p]).filter(Boolean) }));
}

module.exports = { SB_URL, SB_KEY, SB_ANON, TABLE, BUCKET, STATUSES, KINDS, URGENCIES, sbHeaders, readBody, getUser, signImages };
