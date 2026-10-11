// 완료 안내 이메일 (Resend). 환경변수 RESEND_API_KEY 와 MAIL_FROM 이 있을 때만 보낸다.
// 본문에는 접수번호·완료 시각·요약만 담고, 내부 정보(메모·처리 시간·담당자)는 넣지 않는다.
const SITE = process.env.SITE_URL || 'https://maintenance-request-sable.vercel.app';

async function sendDoneMail(row) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) return { status: '설정 전' };
  if (!row.contact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact)) return { status: '실패', error: '받는 사람 이메일이 없어요' };
  const no = row.public_no || `#${row.id}`;
  const done = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const summary = String(row.message || '').replace(/\s+/g, ' ').slice(0, 100);
  const text = [
    `${row.name || '고객'}님, 남겨 주신 유지보수 요청이 완료됐어요.`,
    '',
    `접수번호: ${no}`,
    `완료 시각: ${done}`,
    `요청 요약: ${summary}`,
    '',
    `요청 현황은 받으신 전용 링크나 ${SITE}/my 에서 볼 수 있어요.`,
    '이 메일에 회신하면 담당자에게 전달돼요. 추가 요청은 새 요청으로 남겨 주세요.',
  ].join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [row.contact], subject: `[${no}] 요청이 완료됐어요`, text, ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}) }),
    });
    if (!r.ok) return { status: '실패', error: `발송 서비스 오류 ${r.status}` };
    return { status: '발송됨' };
  } catch (e) {
    return { status: '실패', error: '발송 서비스에 연결하지 못했어요' };
  }
}

module.exports = { sendDoneMail };
