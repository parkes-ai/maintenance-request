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
