# 웹앱 구현·검증 기록

기준: 2026-10-06 한국시간, 작업 브랜치 `codex/jnu-web-demo`. Next.js 16.3.8, React 19.3.0, Node 24.15.0, Supabase JS 2.117.2. 모든 실행은 합성 코스와 로컬 환경이다.

## 구현 범위

F01~F11의 방·QR·4인 보직·준비·도착·역할 미션·보고·자물쇠·사초·종료·복구와 서버 권한 구조를 구현했다. F12의 로컬 검증과 배포 설정을 준비했으며 외부 운영 배포는 수행하지 않았다. 원본 데모·논문·원시 GPS를 변경하거나 새로 업로드하지 않았다.

## 실행된 검증

- Vitest: GPS 3표본/5초·오차/공백/이탈/유효성, 역할·게임 접근, 수동도착30초, 단서 조회 단계·거점, 자물쇠3회/60초/추가1회/중복감점, 호출명/슬롯 제한, 답 정규화, 시드 미확정 값 거절.
- PostgreSQL/PGlite: SQL 마이그레이션 실행, private table/RPC 접근 거절, 멤버의 자기 팀 투영만 조회, CAS stale update 거절, public/private atomic commit, 생성 receipt 중복/충돌, 합류5회 차단.
- Playwright API: 4개 독립 세션·동시 마지막 합류·다섯째 거절, 역할4종, 준비/출발, 30초 이전 수동도착 거절, 두 거점 완주, 개인 숫자/잠금 복구, 동시 재전송 감점1회, 종료 후 변경 거절.
- Playwright UI: 모바일 실제 클릭으로 혼자 체험의 4역할·두 거점 완주, 매 미션 뒤 새로고침 숫자 복구, 360/390/430/768px 가로 넘침 없음, 첫 화면 WCAG A/AA 자동 검사, 1440px/390px 캡처.
- 비동기 회귀: 최종 변경 응답 지연→조회로 먼저 종료→새 작전 준비→늦은 응답이 홈 화면을 되돌리지 않음. 초기 연결 실패 안내와 재연결 후 안내 해제.
- 네 개의 독립 브라우저 창: 방 생성·QR 경로 합류·무작위 보직 공개·위치 거부 후 준비·지휘관 출발·30초 수동 도착·역할별 UI 미션·두 거점 자물쇠·사초2개 동기화 시험. 최종 실행 결과는 PR에 기록한다.
- `npm run typecheck`, `npm run build`, Deno `check`로 Next와 Edge 함수 검증.
- npm 의존성 감사: Vitest의 확인된 취약점을 4.1.11로 갱신했다. 최종 재검사 결과는 PR에 기록한다.
- 독립 코드 리뷰: 보직 공개 종료 조회, 코스 리비전 생성 재전송, 진행 중 조회 알림 유실, 늦은 변경 응답의 화면 복귀를 수정했다. 연결 오류 배너 복구도 회귀 시험으로 확인했다.

## 아직 실행하지 않은 검증

- 실제 Supabase 프로젝트의 익명 인증·Edge 배포·Realtime 구독과 채널 정책.
- 실제 폰 4대의 iOS Safari·Android Chrome 완주와 현장 네트워크 지연 측정.
- 답사 좌표·반경·문항 확정, 실측 GPS CSV와 원본 판정기 교차 검증.
- Vercel HTTPS 운영 배포, 외부 클라우드 사용 승인·계정 명의·보관 정책 확정.
- 교육 효과, 현장 성공률, 1초 이내 실시간 동기화 달성.

브라우저/합성 시험 성공을 실기기·현장 시험 성공이나 논문 평가 결과로 쓰지 않는다.

## 작업 후반 추가 확인한 GPS 원본

작업 중 루트 `index.html`·`analyze_gps.py`와 `GPS/` 자료가 추가되어 읽기 전용으로 확인했다. 원본 `judgeState`/`smoothed_track`은 3개가 모이기 전에도 부분 창으로 평균을 계산하고, 고오차 표본을 제외한 뒤 체류를 이어 가며, 측위 공백의 상한이 없다. 앱은 개정 PRD에 따라 유효 표본3개부터 시작하고 고오차·5초 초과 공백을 보수적으로 초기화한다.

따라서 원본과 완전히 같은 결과라고 보고하지 않는다. G01 회의에서 세 구현의 표본 준비·오차·공백 규칙을 통일하고 실제 CSV를 교차 검증해야 한다. 원본 도구를 임의로 수정·커밋하지 않았다.

## 최종 실행 결과

- 단위/DB 테스트: 4개 파일, 16개 통과.
- 전체 Playwright: API·응답 지연·연결 복구·네 브라우저 창 완주·모바일 혼자 체험, 5개 통과(2.7분).
- 독립 작업 공간의 배포 빌드: 빌드/타입/Edge 검사 통과. production 서버에서 UI/복구 3개 재확인 통과.
- 클라이언트 번들에 서버 답 모듈·해시·시연 주파수 단서가 포함되지 않음을 확인.
- 전체 의존성 감사: 취약점 0개.
- 독립 최종 리뷰: 미해결 Critical/Important 없음.

![합성 코스 데스크톱 첫 화면](screenshots/home-desktop.png)

![합성 코스 모바일 완료 화면](screenshots/completed-mobile.png)

## 화면 단위 게임 UI 개편

2026-10-06 사용자 피드백 반영: 사이드바·소개 페이지를 게임 캔버스로 교체했다. 타이틀·입장·로비·보직·장비·이동·미션·숫자 획득·자물쇠·사초·종료를 한 장면씩 표시하고, 팀·기록·안내는 모달에서 연다. 전체 페이지를 스크롤하지 않고 모바일 화면 높이에 맞춘다. 서버 규칙과 개인 응답 분리를 유지한다.

- 단위/DB 테스트16개·타입·빌드 통과.
- 전체 브라우저 시험6개 통과: 네 창 두 거점 완주, 모바일 체험, 숫자/자물쇠 별도 장면, 페이지 높이, 메뉴 Escape, 응답 지연과 연결 복구 포함.
- 실제 production 주소3001의 UI/복구4개 재검증 통과.
- 독립 읽기 전용 리뷰에 Critical/Important 회귀 없음.
- 아래 이미지는 개편된 장면의 합성 코스 캡처다.

![자물쇠 게임 장면](screenshots/lock-mobile.png)

![사초 획득 장면](screenshots/sacho-mobile.png)

## PR-0: dev 배포 준비와 CI

2026-10-08 한국시간, `infra/deploy-dev`. Node 24.19.0, npm 12.2.0, Deno 2.9.7, Next.js 16.3.8. 아래 결과는 로컬 Windows 환경과 합성 데이터의 검증이다.

- `npm ci` 성공. 이 PC에 npm·Deno가 없어 Git에서 제외된 `private/tools`에 공식 도구를 받아 실행했다. npm 12가 esbuild 설치 스크립트를 기본 차단했으나 아래 테스트·빌드는 통과했다. 앱 의존성·lockfile은 변경하지 않았다.
- `npm run typecheck` 통과.
- `npm test`: 6개 파일, 41개 테스트 통과. CORS 단일·복수 출처 호환, 잘못된 출처 거절, dev opt-in 기본 차단, 실제 코스와 합성 코스 구분, seed 대상 ref·URL·salt 검사, seed salt를 사용하는 네 역할 두 거점 완주·개인 응답 분리·자물쇠 재전송/감점/대기를 포함한다.
- `npm run build` 통과. 저장소 밖 사용자 홈의 lockfile을 무시한다는 Next 경고는 있었으며 빌드는 성공했다.
- `deno check --no-lock supabase/functions/game/index.ts` 통과. 출력: `Check supabase/functions/game/index.ts`.
- 빌드된 클라이언트 chunk에서 `answerHash`, 기존 로컬 전용 salt 표식, dev 허용 변수명이 발견되지 않았다. 이는 실제 프로젝트의 응답 검증을 대신하지 않는다.
- `npm run seed:demo`에 인자를 주지 않으면 사용법을 출력하고 종료 코드 1로 거절함을 확인했다. 실제 Supabase에 seed하지 않았다.
- Playwright: 기존 9개 시나리오 확인. API 1개(네 독립 세션의 두 거점 완주) 통과 후 필요한 Chromium 1243이 없어 UI 8개는 시작 전 실패했다. 해당 브라우저를 Git에서 제외된 도구 폴더에 설치하고 `npm run test:e2e -- --last-failed`로 UI 8개 모두 통과(1.8분)했다. 최초 시도에는 임시 npm launcher의 경로 문제도 있었으며 도구 경로를 보정했다. 샌드박스에서 시험 서버 종료가 지연되어 해당 시험의 서버만 종료했고, UI 재실행은 자식 프로세스 정리가 가능한 환경에서 수행했다. 앱·시험 코드를 바꾸어 실패를 회피하지 않았다.
- 부록 A의 제목 수준 외 원문 일치, `private/` 및 `*.private.local.json` Git 제외를 확인했다. 공통 엔진·기존 마이그레이션·실제 코스 검증기와 seed는 수정하지 않았다.

### 미수행과 후속 확인

- GitHub PR 생성·Actions CI 실행: gh 미로그인으로 브랜치 push 후 사용자가 브라우저에서 PR을 만들어야 한다. 로컬 통과를 GitHub CI 통과로 표시하지 않는다.
- Supabase dev 생성·설정·DB 적용·실제 seed·Edge 배포·익명 인증/Realtime/RLS 서비스 검증.
- Vercel 배포·실제 Preview 출처·폰 4대 시험·현장 GPS 시험. 담당자가 [DEPLOY.md](../../docs/be/DEPLOY.md)의 체크리스트를 수행하고 PR에 별도로 기록한다.
- PR-1 이후 v2 콘텐츠·엔진 기능과 D3·D6 확정 이후 PR-6은 이번 검증 범위에 포함하지 않는다.

## PR-1: 코스 v2 스키마·정문 콘텐츠·API 계약

2026-10-08 한국시간, `feat/course-v2-schema` (`infra/deploy-dev` 위에 생성). Node 24.19.0 / npm 12.2.0 / Deno 2.9.7, 로컬 Windows와 합성 데이터로 확인했다.

- `npm test`: 7개 파일, **79개 통과**. 기존 41개와 신규 38개. NFC·공백·선택 번호·주파수·집합/순열/매핑 해시, salt/courseId/stepId 구분, 역할 누락·중복 ID·선행/보고 순환, 힌트 개수·좌표·점수·사진·근거 문항 미확정 거절, 비공개 자료 TODO·필수 항목 일치 검사를 포함한다.
- 지휘관 전달형 주파수는 지휘관 self에만 들어가고 다른 세 역할 및 공개 투영에는 들어가지 않는다. 직렬화한 응답에서 해시·미해제 힌트/해설/보상·완료 숫자를 검사했다. 저장 객체에 허용되지 않은 필드가 추가된 경우도 투영에서 제외했다.
- `npm run typecheck`, `npm run build` 통과. 마지막 코드 보강 후 다시 통과했다. 저장소 밖 홈 lockfile 무시 경고는 있었으며 빌드는 성공했다.
- `deno check --no-lock supabase/functions/game/index.ts supabase/functions/_shared/prepare-seed-course.ts supabase/functions/_shared/project-course-v2.ts` 통과. CI도 아직 엔진에서 import하지 않는 v2 모듈을 검사하도록 확장했다.
- `npm run test:e2e`: 기존 Playwright **9개 모두 통과(3.0분)**. 네 독립 API 세션·네 브라우저 창 두 거점 완주, 자물쇠 초안 유지, 재접속/응답 지연, 모바일 합성 데모 포함. 실제 폰 시험이나 수동 현장 시험이 아니다.
- `seed:course --validate-only`에 저장소의 v2 공개 초안과 합성 private 예시를 전달하자 `운영 코스 confirmed=true 확정이 필요하다`로 종료 코드 1을 반환했다. 의도된 거절이며 DB 등록을 하지 않았다. 검증용 salt는 실행 시 임시 생성했다.
- 클라이언트 `.next/static/chunks`에서 `relay-frequency`, `transfer_clue`, `answerHashV2`, 합성 비공개 낱말·해설 표식이 발견되지 않았다. 실제 서비스의 응답 격리 시험을 대신하지 않는다.
- `git diff --check` 통과. 시나리오 원문과 `*.private.local.json`의 Git 제외 및 추적 파일에 비공개 원문이 없음을 확인했다.

### 검증 중 수정과 미수행

- 첫 신규 테스트 실행에서 동기 throw를 Promise 거절로 검사한 라우팅 함수 테스트가 실패했다. seed 라우팅 함수의 비동기 계약을 통일한 뒤 전체 테스트가 통과했다. TypeScript/Deno에서 발견한 never 함수의 제어 흐름 추론·JSON 튜플 캐스팅 오류도 수정했다.
- PR-1에는 엔진 액션 연결·새 마이그레이션·DB 적용·클라우드 seed·Supabase/Vercel 배포가 없다. get-stage/submit-step/request-hint의 실제 HTTP 시험은 PR-2에서 수행한다.
- GitHub Actions 실행·실기기 4대·현장 GPS·사진 사용 권한·역사 콘텐츠 현장 대조를 수행하지 않았다. gh 미로그인 절차에 따라 브랜치를 push하고 PR은 사용자가 생성한다.
- 사용자 결정대로 역할별 힌트 3단계를 유지하고 G-01 근거 선택지·짝은 미확정으로 남겼다. 좌표·D5 수치·사진·실제 비공개 값도 운영 투입 전 확정해야 한다. 역할 힌트 3단계의 다단계 해설 범위는 PR-2에서 확인한다.
