# PR-0: Supabase dev + Vercel 배포 안내

PR-2를 적용할 때는 [정문 엔진 v2 적용 안내](PR_2_APPLY.md)를 함께 따른다. 기존 적용 마이그레이션은 수정하지 않고 새 파일을 추가했으며 기존 dev r1 코스도 유지한다.

목표는 기존 두 거점 **합성 코스**를 네 기기로 완주하는 것이다. 시나리오 v1.0의 정문·용봉관·추모의 벽·봉지 전체 구현을 뜻하지 않는다. 계정 생성, 프로젝트 선택, 비밀값 입력, 실제 배포와 폰 4대 시험은 김종연이 수행한다. 이 문서에는 실제 키·salt·정답이 없다.

## 1. 준비와 환경 분리

- Node.js 24, npm, Deno 2, Supabase CLI를 준비한다. 아래 터미널 예시는 PowerShell 7. 실제 체크아웃의 `web` 디렉터리에서 실행한다.
- Supabase **dev 전용 프로젝트**와 Vercel dev 프로젝트를 사용한다. 실제 코스용 prod 프로젝트의 ref·URL·키와 섞지 않는다. 계정 명의·클라우드 사용 조건은 담당자가 확인한다.
- Vercel의 환경 이름 `Production`은 해당 Vercel 프로젝트의 대표 배포를 의미한다. 이번에는 dev 프로젝트이므로 대표 배포와 Preview 모두 Supabase dev를 연결한다. 실제 서비스 prod는 별도 프로젝트다.
- 현장 좌표·정답·QR을 만들거나 원문을 업로드하지 않는다. 좌표 없는 합성 코스는 `confirmed=false`, `demo=true`를 유지하고 지휘관 수동 도착을 사용한다.
- [추가 결정](DECISIONS.md)과 [전체 계획](BE_V2_PLAN.md)을 함께 확인한다.

```powershell
Set-Location <army-체크아웃-경로>/web
node --version
npm --version
deno --version
npm ci
npm run typecheck
npm test
npm run build
deno check --no-lock supabase/functions/game/index.ts
```

## 2. Supabase dev 생성과 DB

1. Supabase Dashboard에서 새 dev 프로젝트를 만들고 리전을 **Northeast Asia (Seoul), ap-northeast-2**로 선택한다. 일반 Asia 리전과 구분해 실제 선택 결과를 확인한다. [리전 공식 문서](https://supabase.com/docs/guides/platform/regions)
2. 프로젝트 ref, API URL, legacy anon key, service_role key를 담당자가 확인한다. service_role은 로컬 seed와 Edge 전용이며 Vercel에 넣지 않는다.
3. Authentication 설정에서 Anonymous Sign-Ins를 활성화한다. 익명 사용자는 로그인 후 authenticated 역할로 RLS를 적용받는다. [익명 인증 공식 문서](https://supabase.com/docs/guides/auth/auth-anonymous)
4. Realtime 설정에서 서비스는 켜고 **Allow public access to channels**는 끈다. private 채널의 소속 검사는 기존 `realtime.messages` 정책이 담당한다. DB `public` 스키마 이름과 공개 채널 허용 설정은 별개다. [Realtime 설정 공식 문서](https://supabase.com/docs/guides/realtime/settings)
5. 로그인·링크·마이그레이션을 실행한다. DB 비밀번호는 CLI의 프롬프트에 직접 입력한다. 다른 프로젝트에 이미 link되어 있다면 dev ref로 다시 연결한 결과를 확인한 뒤 진행한다.

```powershell
npx supabase login
npx supabase projects list
$devProjectRef = Read-Host '목록에서 확인한 dev 프로젝트 ref'
npx supabase link --project-ref $devProjectRef
npx supabase migration list --linked
npx supabase db push --dry-run
# dry-run의 대상과 SQL을 확인한 다음 실행
npx supabase db push
```

적용 대상은 `supabase/migrations/202610060001_game.sql`이다. 기존 SQL을 수정하지 않는다. `courses_private`, `games_private`, `game_public`, `member_access`와 RPC·RLS·Broadcast 트리거가 만들어지고 `game_public`이 Realtime publication에 포함되어야 한다. 이미 적용한 환경에서는 중복 SQL을 직접 실행하지 않는다. [배포 공식 문서](https://supabase.com/docs/guides/functions/deploy)

## 3. dev Edge 설정과 합성 seed

**이 절의 합성 코스 허용 설정·seed는 prod에서 사용 금지다. prod 문서·환경 예시로 복사하지 않는다.**

dev 프로젝트의 Edge Function Secrets 화면에서 다음을 직접 설정한다. 비밀값을 파일·명령 기록·PR·로그에 붙여 넣지 않는다. [Secrets 공식 문서](https://supabase.com/docs/guides/functions/secrets)

| 이름 | dev에 설정할 내용 |
|---|---|
| `ANSWER_SALT` | 담당자가 생성·보관하는 무작위 32자 이상 값. 아래 seed 입력과 정확히 같아야 한다 |
| `ACTIVE_COURSE_ID` | 새 합성 리비전 ID. `jnu-demo-dev-`로 시작하며 영문 소문자·숫자·하이픈·밑줄, 총 40자 이내 |
| `ALLOWED_ORIGIN` | 실제 Vercel dev 대표 주소의 출처. 예: `https://your-dev-app.vercel.app` |
| `ALLOWED_ORIGINS` | 필요한 Preview 주소의 출처를 쉼표로 나열. 선택 사항 |
| `DEV_ALLOW_SYNTHETIC_COURSE` | **dev에서만** 정확히 `true`. 미설정·그 밖의 값은 모두 꺼짐 |

Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 Edge에서 사용한다. 이 값을 다른 프로젝트 값으로 덮어쓰지 않는다. `supabase/config.toml`의 `verify_jwt=false`는 함수 내부의 `auth.getUser()` 검증을 대체하지 않는다. 모든 게임 요청은 실제 익명 사용자 JWT가 필요하다.

합성 허용 설정은 미확정 실제 코스를 허용하지 않는다. 등록된 dev ID의 합성 코스로만 일반 4인 방을 만들 수 있다. `create-demo`, `demo-role`, `demo-time`, `demo-arrival`은 Edge에서 계속 거절한다. 설정을 끄면 이미 만든 합성 게임의 후속 요청도 거절한다.

다음 seed 명령은 `.env.local`을 자동으로 읽지 않고 실제 코스·정답 파일 인자도 받지 않는다. 명시한 dev ref와 URL이 다르면 DB 접근 전에 실패한다. ref 일치는 dev 여부를 자동 인증하는 기능이 아니므로 담당자가 Dashboard에서 dev 프로젝트임을 먼저 확인해야 한다.

```powershell
# 위에서 확인한 devProjectRef를 사용한다. 새 터미널이면 2절부터 대상을 다시 확인한다.
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://' + $devProjectRef + '.supabase.co'
$devCourseId = Read-Host 'Edge ACTIVE_COURSE_ID와 같은 새 합성 리비전 ID'
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host 'dev service_role key' -MaskInput
$env:ANSWER_SALT = Read-Host 'dev Edge에 설정한 동일 ANSWER_SALT' -MaskInput
try {
  npm run seed:demo -- --dev-project-ref $devProjectRef --course-id $devCourseId
  if ($LASTEXITCODE -ne 0) { throw '합성 seed 실패: 배포 점검 전에 원인을 해결하세요.' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ANSWER_SALT -ErrorAction SilentlyContinue
}
```

seed는 합성 콘텐츠만 `courses_private`에 INSERT한다. 정답은 위 salt로 해시하며, salt와 정답 평문은 DB에 저장하지 않는다. 완료 숫자·역할 단서는 서버 비공개 코스에만 저장한다. 같은 ID가 있으면 덮어쓰지 않고 실패한다. 재등록·salt 변경에는 새 리비전 ID를 사용하고 `ACTIVE_COURSE_ID`를 맞춘다. 진행 중 게임의 salt를 바꾸면 정답 검증이 실패하므로 기존 시험을 종료한 뒤 변경한다.

로컬 `/api/game` 데모의 기존 합성 전용 기본값은 클라우드 seed에 사용되지 않는다. 실제 코스용 `npm run seed:course -- <공개코스> <비공개정답>`와 그 확정 좌표·문항 검증은 그대로 유지한다.

## 4. Vercel 설정, 출처 등록, Edge 배포

1. Vercel에서 저장소를 연결하고 **Root Directory = `web`**, Framework = Next.js, Node.js = 24.x를 선택한다. Install Command는 `npm ci`, Build Command는 `npm run build`다. [Vercel 빌드 설정](https://vercel.com/docs/builds/configure-a-build)
2. 배포할 브랜치 `infra/deploy-dev`의 Preview를 만들거나 dev 프로젝트의 배포 대상을 명시적으로 선택한다. Git main에 직접 push하지 않는다. Root Directory 밖의 원문·비공개 파일을 업로드하지 않는다.
3. Vercel 환경변수에는 아래 **공개 변수 3개만** 입력한다. 이 dev 프로젝트에서 사용할 Preview와 대표 배포 범위에 모두 맞춘다.

| 이름 | 값 |
|---|---|
| `NEXT_PUBLIC_BACKEND` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | dev 프로젝트의 HTTPS API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 dev 프로젝트의 anon key |

4. 배포 주소가 정해지면 Supabase dev의 허용 출처를 갱신한다. 출처는 `https://호스트` 형태로 경로·마지막 슬래시·와일드카드가 없어야 한다. 이전 `ALLOWED_ORIGIN`과 새 목록의 합집합을 허용한다. `*.vercel.app`처럼 다른 프로젝트까지 여는 설정은 거절한다. Preview 주소가 바뀌면 정확한 새 주소를 목록에 추가하고 사용을 마친 주소는 제거한다.
5. 허용 출처가 없거나 잘못되면 503, 등록되지 않은 브라우저 출처는 403이다. 응답은 허용된 요청 출처 하나만 반사하고 `Vary: Origin`을 둔다. Origin 없는 도구 요청에도 JWT 인증은 필수다.
6. dev ref를 다시 확인한 후 Edge를 배포한다.

```powershell
npx supabase functions deploy game --project-ref $devProjectRef
npx supabase functions list --project-ref $devProjectRef
```

Next의 공개 환경변수는 빌드에 반영되므로 값을 바꾸면 Vercel에서 다시 배포한다. Supabase 설정 변경 후에는 새로고침하고 익명 로그인·요청·Realtime 재연결을 확인한다. 로컬 `/api/game`은 Vercel에서 비활성화되며 이 경로에 서비스 키를 넣어 해결하지 않는다.

## 5. 네 기기 점검 체크리스트

이 체크박스는 시험 계획이며 완료 기록이 아니다. 동일 브라우저 탭은 인증 세션을 공유하므로 폰 4대 또는 독립 브라우저 프로필 4개를 쓴다. 시연용 문항의 화면 단서로 풀며 시나리오 원문 정답을 입력하거나 캡처에 노출하지 않는다.

- [ ] HTTPS 주소, 배포 커밋, dev 프로젝트 ref, 합성 코스 ID, 시험 일시·기기·브라우저를 기록한다. 키·salt·정답은 기록하지 않는다.
- [ ] `혼자 데모 체험`이 아닌 `작전 시작`으로 방을 생성하고 네 명이 코드/QR로 합류한다. 다섯 번째 기기는 거절된다.
- [ ] 보직 공개 → 네 명 준비 → 지휘관 출발이 공유된다. 위치 거부 후에도 준비할 수 있다.
- [ ] 좌표 없는 합성 코스에서는 지휘관이 이동 시작 30초 뒤 수동 도착한다. GPS 현장 성공·도착 시뮬레이션으로 기록하지 않는다.
- [ ] 각 기기에 자기 단서·완료 숫자만 보이고 지휘관의 다른 역할 보고에는 ✓만 보인다. 팀 공동 응답·Realtime에 정답·숫자가 없다.
- [ ] 네 역할 보고 후 자물쇠 일부 오답에서 맞은 칸 유지, 오답 −10, 세 번 소진 후 60초 대기·추가 한 번을 확인한다. 새로고침·같은 요청 재전송으로 횟수·대기가 초기화되거나 감점이 중복되지 않는다.
- [ ] 정문 → 사초 → 용봉관 → 사초 2개·종료까지 완주한다. v2의 사초 3개 완료로 기록하지 않는다.
- [ ] 새로고침·잠깐의 네트워크 단절 후 동일 역할과 진행 상태가 복원된다. 브라우저 데이터 삭제·기기 교체 복구는 보장 범위가 아니다.
- [ ] Presence/Broadcast/private 채널과 `game_public` 변경 구독을 실제로 확인한다. 폴링만 성공한 결과를 Realtime 성공으로 기록하지 않는다.
- [ ] 다른 팀의 공개 상태·채널 접근, 비공개 테이블 읽기, 익명 JWT 없는 API, 등록되지 않은 Origin, Edge의 시연 우회 요청이 거절된다.
- [ ] 로컬/합성 시험, 실제 Supabase/Vercel 연결, 실기기 시험, 현장 GPS 결과를 구분해 PR에 추가한다. 동기화 1초 달성은 측정 전 표시하지 않는다.

기본값 적용 — 확정 필요(D4): 기존 자물쇠 3회·−10·60초를 유지한다. 좌표·반경·사진 정책·힌트 점수는 이 PR에서 확정하지 않는다.

## 6. 오류와 운영 환경 분리

| 증상 | 확인할 항목 |
|---|---|
| 503 / 출처 설정 오류 | 정확한 HTTPS origin, 공백·쉼표 정리, 경로·와일드카드 제거 |
| Preview만 403 | 요청 Origin과 명시 목록 일치 여부 |
| UNAUTHENTICATED | 익명 로그인 활성화, 같은 프로젝트 URL·anon key·사용자 JWT |
| UNCONFIRMED_COURSE | seed 성공·ID 일치·dev 절의 조건 충족 여부 |
| 모든 합성 답이 실패 | seed와 Edge salt 불일치·기존 코스 리비전 재사용 여부 |
| 화면은 갱신되나 Realtime 실패 | private 채널, membership RLS, publication, 연결 상태 |
| 로컬 API 비활성 오류 | Vercel 변수의 BACKEND 설정·재빌드 여부 |

실제 운영 prod는 별도 프로젝트에서 확정된 실제 코스만 기존 `seed:course`로 등록한다. **dev 합성 허용 기능·합성 seed 사용 금지**이며, 실제 서비스 설정 예시에 dev 활성화 변수를 넣지 않는다. prod 배포·키 입력·데이터 이관은 PR-0에서 수행하지 않는다.

## 7. CI와 PR 제출

GitHub Actions는 `pull_request`에서만 Node 24의 `npm ci → typecheck → test → build`와 Deno 2의 Edge 검사를 실행한다. `pull_request_target`, 배포 단계, 클라우드 비밀값 주입은 없다. [Node 설정 Action](https://github.com/actions/setup-node), [Deno 설정 Action](https://github.com/denoland/setup-deno)

gh 미로그인 상태에서는 작업 브랜치만 push한 뒤 GitHub 브라우저에서 base `main`, compare `infra/deploy-dev`로 PR을 만든다. PR 생성 전에는 Actions의 PR CI가 실행되지 않는다. 로컬 통과를 GitHub CI 통과로 기록하지 않는다. 김동욱이 검토·머지하며 작성자가 main에 직접 push하거나 머지하지 않는다.
