# 호국실록 웹앱

환희의 전남대 데모와 [PRD](../codex-handoff-v2/PRD.md)를 바탕으로 만든 Next.js 웹앱이다. 기존 원본 자료는 그대로 두었다. 합성 시연 코스로 두 거점을 완주할 수 있으며, 실제 코스는 확정된 공개 자료와 비공개 정답을 Supabase에 등록한다. 실제 클라우드·폰 4대·현장 GPS 검증은 별도로 필요하다.

## 바로 실행

정문 v2 화면 개발은 **[FE 인수인계](../docs/fe/README.md)**와 [API 계약](../docs/be/API_CONTRACT.md)을 먼저 본다. 아래 기본 실행·기존 화면은 v1 데모이며, PR-2의 v2 서버 구현과 구분한다.

Node.js 22.9 이상(검증 환경 24.15), npm이 필요하다.

```powershell
cd C:\dev\army\web
npm ci
npm run dev
```

[로컬 데모](http://localhost:3000)에서 **혼자 데모 체험**을 누른다. 보직 버튼을 차례로 선택해 각 미션을 해결한다. 미션 다음의 숫자 획득 화면에서 보고한 뒤, 지휘관의 「팀 자물쇠로」 버튼으로 자물쇠 장면에 들어간다. 타이틀·입장·로비·보직·장비·이동·미션·숫자 획득·자물쇠·사초·종료는 한 화면씩 진행하고, 팀·기록·안내는 메뉴에서 연다. 시연 코스·모의 도착임을 화면과 서버 기록에 표시한다.

4인 시험은 방 만들기→다른 기기의 코드/QR 합류→방장의 보직 공개→각자 준비→지휘관 출발 순서다. 한 브라우저의 탭들은 같은 인증 세션을 쓰므로 독립 기기 시험에는 서로 다른 브라우저 프로필 또는 Playwright context를 사용한다. 로컬 4인 방도 역할·3회·감점·60초·수동도착30초 규칙을 우회하지 않는다. 실제 좌표가 없는 시연 코스에서는 지휘관이 30초 후 수동 도착한다.

로컬 파일 저장은 **단일 서버 프로세스의 합성 데모 전용**이다. `.demo-data/state.json`에 상태를 저장해 새로고침과 서버 재시작 후 복구한다. Vercel에서는 로컬 API를 차단한다. 운영에는 아래 Supabase 구성을 사용한다.

## 실제 데이터 연결

10/9 네 기기 합성 코스 점검은 [Supabase dev·Vercel 배포 안내](../docs/be/DEPLOY.md)를 따른다. 실제 코스 seed와 분리된 dev 전용 등록 명령, 정확한 Preview 출처 설정, 비밀값 입력·현장 시험 체크리스트가 있다. 아래는 확정된 실제 코스의 연결 절차다.

1. PM이 외부 클라우드 사용·계정 명의·보관 정책을 확인한다. 이 PR은 운영 배포를 수행하지 않는다.
2. Supabase 프로젝트에서 `supabase/migrations/202610060001_game.sql`을 적용하고 익명 로그인을 활성화한다. Realtime의 private channel과 DB 변경 구독을 사용한다. 공개 Realtime 채널 접근을 허용하지 않는 설정으로 운영한다.
3. `.env.example`을 `.env.local`로 복사한다. `NEXT_PUBLIC_BACKEND=supabase`, URL, anon key를 입력한다. **service role key와 ANSWER_SALT에는 NEXT_PUBLIC_ 접두사를 붙이지 않는다.** seed를 실행하는 로컬 환경에만 비밀키를 설정한다.
4. 공개 코스 JSON은 기존 `codex-handoff-v2/data/courses/jnu.json`의 구조를 사용한다. 코스와 각 단서의 `confirmed=true`, 현장에서 확인한 좌표·반경·문항·선택지·사초 본문(`sacho.body`)을 채운다. 문항에는 `type`, `title`, `question`, `hint`, 선택형의 `choices`, 주파수의 `min/max`를 사용한다. 기존 `target`도 관찰형 질문으로 변환된다. 선택 답은 1부터 시작하는 번호, 달력은 요일 이름, 주파수는 소수 첫째 자리 문자열이다.
5. 비공개 `jnu.answers.local.json`은 기존 예시의 `{siteId: {role: {answer, digit}}}` 형식으로 만든다. 실제 정답·좌표 측위 기록을 Git에 추가하지 않는다. `ANSWER_SALT`는 32자 이상 무작위 비밀값으로 만들고 Edge와 seed에 같은 값을 설정한다.

```powershell
npm run seed:course -- ..\codex-handoff-v2\data\courses\jnu.json ..\codex-handoff-v2\data\courses\jnu.answers.local.json
```

시드는 미확정 좌표, 중복 거점, 빈 문항, 잘못된 선택 번호, 빠진 역할, 범위 밖 숫자·주파수, 짧은 salt를 거절한다. 정답 원문은 저장하지 않고 해시를 저장한다. 숫자와 역할별 단서는 서버 전용 코스에만 저장한다. 기존 코스를 덮어쓰지 않으며 변경 시 새로운 `courseId`로 리비전을 등록한다. 진행 중 게임은 원래 코스를 사용한다.

v2 콘텐츠·입력·응답 형식은 [BE v2 API 계약](../docs/be/API_CONTRACT.md)에 정리했다. PR-2 브랜치에는 정문 서버 엔진을 연결했지만 기존 FE는 v1 방식이다. **FE 대응과 새 마이그레이션·Edge 배포 준비 전에는 ACTIVE_COURSE_ID를 v2로 바꾸지 않는다.** 적용 순서는 [PR-2 적용 안내](../docs/be/PR_2_APPLY.md)를 따른다. 저장소의 실제 v2 콘텐츠 초안은 미확정 자료가 있어 운영 시드에서 거절한다.

6. Edge 함수의 비밀 환경변수 `ANSWER_SALT`, `ACTIVE_COURSE_ID`, `ALLOWED_ORIGIN`(정확한 HTTPS 웹앱 출처)을 설정하고 `game` 함수를 배포한다. `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Supabase 함수 환경에서 제공된다. `verify_jwt=false`는 인증 생략이 아니다. 함수가 매 요청의 Bearer JWT를 `auth.getUser()`로 검증한다.

```powershell
npx supabase link --project-ref <프로젝트-ID>
npx supabase db push
npx supabase functions deploy game
```

7. Vercel 프로젝트의 Root Directory는 `web`이며, 공개 환경변수 3개만 설정한다. 서비스 키·salt는 Vercel 클라이언트 환경에 필요 없다. 배포 전 `npm run build`를 다시 수행한다. HTTPS에서 iOS Safari·Android Chrome 포함 폰 4대로 완주·권한·위치 거부·재접속을 확인한다.

## 데이터와 API

- 공통 서버 엔진: `supabase/functions/_shared/engine.ts`. 로컬·Edge가 같은 규칙을 사용한다.
- 공개 투영: 보고 ✓, 잠김 여부, 점수, 단계, 호출명. 다른 역할의 단서·숫자가 없다.
- 개인 응답: 본인 단서·본인 숫자. 지휘관에게만 자신이 맞춰 잠근 숫자를 복구한다.
- 변경 요청: `request_id`. 응답 불명확 시 동일 ID·동일 내용으로 재시도한다. 서버 receipt와 클라이언트 sessionStorage에 미확인 요청을 보관한다.
- Supabase는 private game snapshot을 version 조건으로 갱신하고 공개 투영·멤버 권한·Broadcast를 같은 DB 트랜잭션에서 반영한다. 충돌 시 다시 읽어 최대 12회 재판정한다.
- GPS는 `lib/arrival.ts`에서만 판정한다. 고오차 또는 5초 초과 공백에서 표본·체류를 초기화하는 임시 보수 규칙이며, 원본 실측 도구와의 일치 확인은 아직 없다. 좌표는 기기에서만 계산하고 도착 결과만 보낸다.
- Presence/Broadcast는 private channel, 진행 공유는 RLS가 적용된 `game_public` 구독이다. 위치 증명은 클라이언트 판정이며 서버가 실제 위치를 인증한 것은 아니다.
- 같은 브라우저 세션 유지 범위만 복귀를 보장한다. 데이터 삭제·다른 기기 복구는 별도 기능이다. 로컬 파일에는 호출명과 해시 세션 식별자가 남고 서버 원시 위치는 남지 않는다.

## 검증

```powershell
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

`tests/database.test.ts`는 실제 PostgreSQL 엔진인 PGlite에서 RLS·원자 갱신·receipt를 실행한다. Supabase의 auth/realtime 함수만 최소 시험 스텁으로 제공한다. 이 결과는 실제 Supabase Realtime 서비스 시험을 대체하지 않는다. 전체 실행 증거와 미수행 항목은 [검증 기록](docs/VALIDATION.md)에 있다.

개발 보조 도구는 `/?dev=1`의 **혼자 체험 합성 방에만** 보인다. 보직 전환, 합성 GPS 거리 슬라이더, 시연 대기 건너뛰기를 제공한다. 일반 4인 방이나 Edge 운영 방에는 적용할 수 없다.

기존 v1 데모의 초기 점수 100·최저 0·4인 필수·익명 인증·팀원 한 명 GPS 도착·보고 전체 완료 후 자물쇠 정책은 PRD의 회의 제안을 구현한 시연 설정이다. 조직의 최종 정책 확정이나 교육 효과·현장 수치를 뜻하지 않는다. PR-2 v2 엔진에는 코스 설정에 따른 역할 힌트 감점을 구현했으며 정문 기본 도착 조건은 전원이다. 시간 점수·랭킹과 실제 점수 수치는 계속 확정·구현해야 한다(PRD 4.4, MVP F13).
