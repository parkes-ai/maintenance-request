# 이 사이트에 쓴 스킬 체크리스트

조사한 날: 2026-10-30
근거: 스킬 폴더의 설치 날짜, 프로젝트 안 `skills-lock.json`, 지난 작업 대화 기록, Git 기록.
이 사이트 코드는 2026-10-10 ~ 10-11에 만들었어요. 그 뒤에 설치한 스킬은 이 코드에 쓰이지 않았어요.

## 이 사이트에 쓴 스킬

- [x] **frontend-design** (Anthropic 공식)
  - 출처: https://github.com/anthropics/skills/tree/main/skills/frontend-design
  - 설치: `~/.claude/skills/frontend-design` (2026-10-10)
  - 쓴 곳: 디자인 시안·에디토리얼 스타일 통일(종이색 바탕·명조 제목·Space Mono 라벨)
- [x] **leaderpl-site-prd** (leaderpl-skills)
  - 출처: https://github.com/naknakfishing/leaderpl-skills
  - 설치: `~/.claude/skills/leaderpl-site-prd` (2026-10-10)
  - 쓴 곳: 설계도 `docs/PRD.md` (v1, v2)
- [x] **leaderpl-admin** (leaderpl-skills)
  - 출처: https://github.com/naknakfishing/leaderpl-skills
  - 설치: `~/.claude/skills/leaderpl-admin` (2026-10-10)
  - 쓴 곳: 요청 폼 저장(`/api` + Supabase), 회원가입·로그인, `/admin` 관리자 화면(상태·48시간 알림·30일 추이·CSV·회원 탭)
- [x] **supabase** (Supabase 공식 agent-skills) ← 기억에 없던 것
  - 출처: https://github.com/supabase/agent-skills
  - 설치: 이 프로젝트 안 `.claude/skills/supabase`, `.agents/skills/supabase` (2026-10-11 00:03)
  - 기록: `skills-lock.json`
  - 설치 명령: `npx skills add supabase/agent-skills` (Supabase 연결 도구가 권하는 명령)
  - 쓴 곳: Supabase 테이블·보안 규칙(`docs/setup.sql`) 만들 때 참고용

## 설치는 되어 있지만 이 사이트에는 안 쓴 것

모두 사이트 완성(10-11) 뒤에 설치했어요. 다른 작업(영상 등)용이에요.

- [ ] **design-taste-frontend** (tasteskill v2) — 2026-10-24 설치
- [ ] **hyperframes**, **hyperframes-cli**, **hyperframes-registry**, **media-use**, **slideshow** — 2026-10-24 설치 (영상)
- [ ] **motionmaxxing**, **sound-effects**, **explainer-default** — 2026-10-24 설치 (영상)
- [ ] **find-skills** — 2026-10-24 설치 (스킬 찾기 도우미)
- [ ] **frontend-design 플러그인**, **code-review 플러그인** — 2026-10-25 설치 (공식 플러그인)

## 앞으로

새 스킬을 이 사이트에 쓰면 위 첫 목록에 한 줄 추가해 두면 다음에 헷갈리지 않아요.
