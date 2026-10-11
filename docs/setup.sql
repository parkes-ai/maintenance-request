-- 유지보수 요청 표 + 화면 캡처 저장소 (Supabase SQL Editor에서 한 번 실행)
create table if not exists public.maintenance_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  company text not null,
  name text not null,
  contact text not null,
  program text not null,
  kind text not null check (kind in ('오류', '수정 요청', '사용 문의')),
  urgency text not null check (urgency in ('보통', '급함', '업무 중단 중')),
  message text not null,
  images text[] not null default '{}',
  consent boolean not null default false,
  status text not null default '새 요청' check (status in ('새 요청', '처리 중', '완료')),
  updated_at timestamptz
);
create index if not exists maintenance_requests_user_idx on public.maintenance_requests (user_id);
alter table public.maintenance_requests enable row level security;
revoke all on public.maintenance_requests from anon, authenticated;
-- 정책은 만들지 않는다: 브라우저(공개 키)로는 접근 불가, 서버(/api)만 접근

-- 화면 캡처: 비공개 저장소. 정책이 없으니 서버(/api)만 올리고 읽는다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-images', 'request-images', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- 2026-10-11 추가: 완료한 날 (완료 후 1년 지나면 /api/cleanup 이 매일 지운다)
alter table public.maintenance_requests add column if not exists completed_at timestamptz;
create index if not exists maintenance_requests_completed_idx on public.maintenance_requests (completed_at) where status = '완료';

-- 2026-10-11 추가: 관리자 메모 (관리자 화면에서만 보인다. /api/my-requests 는 이 칸을 내려주지 않는다)
alter table public.maintenance_requests add column if not exists memo text;

-- 2026-10-11 추가: 관리자가 요청 내용을 고친 시각 (관리자 화면에 "관리자 수정"으로 보인다)
alter table public.maintenance_requests add column if not exists edited_at timestamptz;

-- 2026-10-11 추가: 요청 수정 기록 (어느 칸을 무엇에서 무엇으로). 요청을 지우면 기록도 함께 지워진다
create table if not exists public.request_edits (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.maintenance_requests(id) on delete cascade,
  edited_at timestamptz not null default now(),
  changes jsonb not null
);
create index if not exists request_edits_request_idx on public.request_edits (request_id, edited_at desc);
alter table public.request_edits enable row level security;
revoke all on public.request_edits from anon, authenticated;
-- 정책은 만들지 않는다: 서버(/api)만 접근

-- 2026-10-11 추가: 마지막으로 변경 기록(request_edits)을 남긴 시각. 관리자 화면에서 [변경 기록 보기]를 보일지 정한다
-- request_edits.changes 에는 내용 수정(company 등)과 상태 변경(status)이 함께 남는다
alter table public.maintenance_requests add column if not exists last_logged_at timestamptz;

-- 2026-10-11 추가: 고객사 전용 링크 · 등록 고객사/신규 문의 구분 · 회원의 회사 연결
-- 고객사: 등록하면 전용 링크(token)가 생긴다. 링크로 들어온 요청은 그 고객사로 묶인다
create table if not exists public.customers (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  token text not null unique,
  active boolean not null default true
);
create unique index if not exists customers_name_idx on public.customers (lower(name));
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;

-- 요청 ↔ 고객사 (비어 있으면 '신규 문의')
alter table public.maintenance_requests add column if not exists customer_id bigint references public.customers(id) on delete set null;
create index if not exists maintenance_requests_customer_idx on public.maintenance_requests (customer_id);

-- 회원 ↔ 고객사 (전용 링크에서 가입·로그인하면 연결된다. 그 회사 요청을 모두 볼 수 있다)
create table if not exists public.customer_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id bigint not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.customer_members enable row level security;
revoke all on public.customer_members from anon, authenticated;
-- 정책은 만들지 않는다: 서버(/api)만 접근

-- 2026-10-11 설계도 v2
-- 설계도 v2 데이터 구조 (2026-10-11)

-- 고객사: 코드(접수번호 앞자리) · 청구 방식 · 월 정액 포함 시간 · 연락처 · 계약 메모
alter table public.customers add column if not exists code text;
alter table public.customers add column if not exists billing text not null default '무상';
alter table public.customers add column if not exists monthly_hours numeric;
alter table public.customers add column if not exists contact text;
alter table public.customers add column if not exists scope_note text;
alter table public.customers drop constraint if exists customers_billing_check;
alter table public.customers add constraint customers_billing_check check (billing in ('무상', '건당', '시간당', '월 정액', '계약 범위 안'));
alter table public.customers drop constraint if exists customers_code_check;
alter table public.customers add constraint customers_code_check check (code is null or code ~ '^[A-Z0-9]{2,8}$');
create unique index if not exists customers_code_idx on public.customers (code) where code is not null;

-- 인력 (로그인하지 않음, 퇴사해도 이력 보존)
create table if not exists public.staff (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  status text not null default '재직' check (status in ('재직', '퇴사')),
  email text,
  phone text,
  availability text,
  joined_at date,
  left_at date
);
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;

-- 요청: 새 칸
alter table public.maintenance_requests add column if not exists phone text;
alter table public.maintenance_requests add column if not exists body jsonb;
alter table public.maintenance_requests add column if not exists attachments jsonb not null default '[]';
alter table public.maintenance_requests add column if not exists channel text not null default '웹';
alter table public.maintenance_requests add column if not exists public_no text;
alter table public.maintenance_requests add column if not exists priority text;
alter table public.maintenance_requests add column if not exists category text;
alter table public.maintenance_requests add column if not exists cause text;
alter table public.maintenance_requests add column if not exists assigned_to bigint references public.staff(id) on delete set null;
alter table public.maintenance_requests add column if not exists respond_by timestamptz;
alter table public.maintenance_requests add column if not exists first_response_at timestamptz;
alter table public.maintenance_requests add column if not exists minutes_spent integer not null default 0;
alter table public.maintenance_requests add column if not exists billing_override text;
alter table public.maintenance_requests add column if not exists hold_reason text;
alter table public.maintenance_requests add column if not exists ip_hash text;
alter table public.maintenance_requests add column if not exists approval_status text;
alter table public.maintenance_requests add column if not exists approval_minutes integer;
alter table public.maintenance_requests add column if not exists approval_note text;
alter table public.maintenance_requests add column if not exists approval_requested_at timestamptz;
alter table public.maintenance_requests add column if not exists approval_decided_at timestamptz;
alter table public.maintenance_requests add column if not exists approval_by text;
alter table public.maintenance_requests add column if not exists mail_status text;
alter table public.maintenance_requests add column if not exists mail_at timestamptz;
alter table public.maintenance_requests add column if not exists mail_error text;
create unique index if not exists maintenance_requests_public_no_idx on public.maintenance_requests (public_no) where public_no is not null;
create index if not exists maintenance_requests_ip_idx on public.maintenance_requests (ip_hash, created_at);

alter table public.maintenance_requests drop constraint if exists maintenance_requests_status_check;
alter table public.maintenance_requests add constraint maintenance_requests_status_check check (status in ('새 요청', '배정', '처리 중', '완료', '보류'));
alter table public.maintenance_requests drop constraint if exists mr_channel_check;
alter table public.maintenance_requests add constraint mr_channel_check check (channel in ('웹', '유선', '이메일', '기타'));
alter table public.maintenance_requests drop constraint if exists mr_priority_check;
alter table public.maintenance_requests add constraint mr_priority_check check (priority is null or priority in ('긴급', '보통', '낮음'));
alter table public.maintenance_requests drop constraint if exists mr_category_check;
alter table public.maintenance_requests add constraint mr_category_check check (category is null or category in ('장애', '서비스 요청', '변경 요청'));
alter table public.maintenance_requests drop constraint if exists mr_cause_check;
alter table public.maintenance_requests add constraint mr_cause_check check (cause is null or cause in ('우리 결함', '사용 문의·교육', '추가 요청', '고객 환경'));
alter table public.maintenance_requests drop constraint if exists mr_billing_check;
alter table public.maintenance_requests add constraint mr_billing_check check (billing_override is null or billing_override in ('무상', '건당', '시간당', '월 정액', '계약 범위 안'));
alter table public.maintenance_requests drop constraint if exists mr_approval_check;
alter table public.maintenance_requests add constraint mr_approval_check check (approval_status is null or approval_status in ('요청함', '동의', '거절'));

-- 작업 기록 (한 요청에 여러 줄, 처리 시간은 합계)
create table if not exists public.work_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  request_id bigint not null references public.maintenance_requests(id) on delete cascade,
  worked_on date not null default ((now() at time zone 'Asia/Seoul')::date),
  mode text not null check (mode in ('원격', '방문', '개발', '전화·메일')),
  minutes integer not null check (minutes > 0 and minutes <= 1440),
  note text,
  staff_id bigint references public.staff(id) on delete set null
);
create index if not exists work_logs_request_idx on public.work_logs (request_id);
alter table public.work_logs enable row level security;
revoke all on public.work_logs from anon, authenticated;

-- 접수번호 카운터: (코드, 년도)마다 1부터
create table if not exists public.request_counters (
  prefix text not null,
  year integer not null,
  last integer not null default 0,
  primary key (prefix, year)
);
alter table public.request_counters enable row level security;
revoke all on public.request_counters from anon, authenticated;
create or replace function public.next_request_no(p_prefix text, p_year integer) returns integer
language sql as $$
  insert into public.request_counters (prefix, year, last) values (p_prefix, p_year, 1)
  on conflict (prefix, year) do update set last = public.request_counters.last + 1
  returning last
$$;
revoke execute on function public.next_request_no(text, integer) from public, anon, authenticated;
grant execute on function public.next_request_no(text, integer) to service_role;

-- 파일 올리기 횟수 제한용 기록
create table if not exists public.upload_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text not null
);
create index if not exists upload_log_idx on public.upload_log (ip_hash, created_at);
alter table public.upload_log enable row level security;
revoke all on public.upload_log from anon, authenticated;

-- 본문 이미지·첨부파일 저장소 (비공개, 파일당 10MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-files', 'request-files', false, 10485760, array[
  'image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-hwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx', 'application/zip'
])
on conflict (id) do nothing;
