// 로그인한 고객사 담당자: 요청과 처리 상태 보기(GET) · 유상 작업 동의/거절(POST)
// 고객사에 연결된 회원이면 그 회사 요청 전부, 아니면 본인이 로그인하고 남긴 요청만
// 고객에게는 내부 정보(우선순위·응답 목표·담당자·처리 시간·작업 기록·원인·청구·메모)를 보내지 않는다
const { SB_URL, SB_KEY, TABLE, sbHeaders, readBody, getUser, signImages, signFiles, membershipOf, custStatus } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '다시 로그인해 주세요.' });
  const company = await membershipOf(user.id);
  const who = company ? `customer_id=eq.${company.id}` : `user_id=eq.${encodeURIComponent(user.id)}`;

  if (req.method === 'GET') {
    const fields = 'id,public_no,created_at,completed_at,company,program,kind,urgency,message,body,attachments,images,status,approval_status,approval_minutes,approval_note,approval_requested_at,approval_decided_at';
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=${fields}&${who}&order=created_at.desc&limit=200`, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
    let rows = await r.json();
    rows = await signFiles(await signImages(rows));
    rows = rows.map((x) => ({ ...x, status: custStatus(x.status), no: x.public_no || `#${x.id}` }));
    return res.status(200).json({ email: user.email, company: company ? company.name : null, rows });
  }

  if (req.method === 'POST') {
    // 유상 작업 동의/거절: 그 회사(또는 본인) 요청이고, 승인 요청 중일 때만
    const b = readBody(req);
    const id = Number(b.id);
    if (!Number.isInteger(id) || !['동의', '거절'].includes(b.decision)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const g = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}&${who}&select=id,approval_status`, { headers: sbHeaders() });
    const [row] = g.ok ? await g.json() : [];
    if (!row) return res.status(404).json({ error: '요청을 찾을 수 없어요.' });
    if (row.approval_status !== '요청함') return res.status(409).json({ error: '이미 답한 요청이에요.' });
    const now = new Date().toISOString();
    const u = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=eq.${id}&approval_status=eq.${encodeURIComponent('요청함')}`, {
      method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ approval_status: b.decision, approval_decided_at: now, approval_by: user.email, updated_at: now, last_logged_at: now }),
    });
    if (!u.ok) return res.status(500).json({ error: '저장하지 못했어요.' });
    await fetch(`${SB_URL}/rest/v1/request_edits`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ request_id: id, edited_at: now, changes: { approval: { from: '요청함', to: `${b.decision} (${user.email})` } } }) });
    return res.status(200).json({ ok: true, decision: b.decision });
  }
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
};
