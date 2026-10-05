# 호국실록 웹앱 Implementation Plan

> 실행: superpowers:executing-plans로 이 세션에서 구현한다. 사용자 요청의 PRD와 시작 지시를 실행 승인으로 적용한다.

**Goal:** 시연 코스로 두 거점 완주가 가능한 모바일 웹앱과 실제 데이터 연결 경로를 만든다.
**Architecture:** 공통 서버 게임 엔진, 로컬 영속 저장 어댑터, Supabase Edge/DB 어댑터, 개인 투영 API, 반응형 화면.
**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, Supabase, Vitest, Playwright.
**Spec:** ../specs/2026-10-06-jnu-web-demo-design.md 및 ../../../codex-handoff-v2/PRD.md.

## Global Constraints

- 실제 정답·salt·원시 GPS·원본 데모·논문을 커밋하지 않는다.
- 공개 투영에는 다른 역할의 단서·숫자가 없다. 서버에서 권한·단계·거점·요청 ID를 검사한다.
- GPS 판정은 web/lib/arrival.ts. 4인, 시도3회, 감점10, 대기60초, 수동도착30초.
- 기본 브랜치 푸시·임의 머지 금지. 한국어 커밋과 검증 증거 PR.

## Review Focus

- 동시에 마지막 자리를 차지하는 요청: 최대 4명 유지.
- 응답 유실·중복 요청: 같은 ID 감점 한 번, 다른 내용 거절.
- 다른 게임·보직·이전 거점: 정보 노출과 상태 변경 거절.
- 위치 오류·공백·거부: 오래된 표본으로 도착 인정 금지, 수동 대안.
- 종료·만료·세션 복귀: 결과 유지, 신규 합류 거절.

## Task 1: 서버 규칙과 GPS

Files: web/lib/arrival.ts, web/supabase/functions/_shared/{types,engine,course}.ts, web/tests/*.test.ts.
Interfaces: judgeArrival(samples,target) / dispatch(state,course,user,action,now) / project(game,user,course,now).
- [ ] Vitest 구성과 보안·자물쇠·GPS 실패 테스트를 작성하고 실패를 확인한다.
- [ ] 서버 권한·미션·자물쇠·복구 엔진과 GPS 판정을 구현한다.
- [ ] `npm test`로 시간·권한·정규화·투영 테스트 통과를 확인한다.

## Task 2: 영속 API와 실제 데이터 연결

Files: web/lib/server/store.ts, web/app/api/game/route.ts, web/supabase/migrations/*.sql, web/supabase/functions/game/index.ts, web/scripts/seed-course.ts.
Interfaces: Task1 dispatch/project를 로컬 직렬 쓰기 및 Supabase CAS에 연결. FE는 동일 Response 타입을 소비한다.
- [ ] HTTP 네 세션의 생성·합류·동시 요청·재조회 시나리오를 Playwright에 작성한다.
- [ ] 로컬 쿠키 세션·시연 체험, 익명 JWT Edge 함수, RLS·공개 상태, 시드 검증을 구현한다.
- [ ] 서버 재시작·오류·보안 헤더와 실제 모드 시드 거절을 검증한다.

## Task 3: 화면과 통합

Files: web/components/*, web/lib/client.ts, web/app/{page,layout,globals.css}, web/app/j/[code]/page.tsx.
Interfaces: Task2 개인 응답·오류·서버시각, Task1 GPS 판정.
- [ ] 홈·대기실·보직·준비·이동·4역할 미션·자물쇠·기록·종료를 구현한다.
- [ ] 미션 답은 서버 검증. 연결 실패 시 화면 유지하고 같은 요청 ID로 재시도한다.
- [ ] `npm run typecheck`, `npm run build`, `npm run test:e2e` 및 모바일/데스크톱 화면 점검.

## Task 4: 검토와 전달

Files: web/README.md, web/docs/VALIDATION.md, 루트 README.md.
- [ ] fresh-context 전체 코드 리뷰를 수행하고 중요한 문제를 수정·재검증한다.
- [ ] 실데이터 시드·Supabase·Vercel 실행 안내와 실제/미실행 검증을 기록한다.
- [ ] 필요한 파일만 커밋하고 계정 확인 후 작업 브랜치 PR을 제출한다.
