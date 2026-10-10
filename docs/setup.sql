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
