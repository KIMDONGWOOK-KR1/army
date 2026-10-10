# PR-5 적용 안내 — 추모의 벽·봉지

`feat/stage-wall-bongji`는 PR #12가 병합된 `main`에서 시작한다. 정문 → 용봉관 → 추모의 벽 → 봉지 회고·공동 동의 → 결과를 연결한다. 사용자는 용봉관 웹 배포와 개발 코스의 두 거점 연결을 확인했다. **이 PR-5의 클라우드 적용은 별도이며 에이전트가 실행하지 않았다.**

## 후속 수정: 문제풀이 공통 확인 옵션 제거

2026-10-10 사용자 요청으로 `확인 방식`·`확인한 출처`·`연결할 자료` 입력을 제거했다. 문제 자체의 선택지·기록 필드와 용봉관 자동 자료 전달은 유지한다. 자세한 계약은 [API 4절](API_CONTRACT.md#4-submit-step--pr-2)을 따른다.

**PR-5 최초 적용을 마친 환경이라면 이번 수정은 Edge → 웹 재배포만 필요하다.** 새 마이그레이션·코스 재등록·비밀값 변경·새 방 생성은 필요 없다. 기존 코스의 `sourceRequired:true`도 새 서버가 생략을 허용하므로 기존 방을 계속 사용할 수 있다. 새 웹을 구 Edge에 먼저 연결하면 출처 누락으로 거절될 수 있어 배포 순서를 지킨다.

```powershell
# 수정 코드가 있는 저장소의 web/에서
npx.cmd supabase functions deploy game --project-ref '<DEV_PROJECT_REF>'
if ($LASTEXITCODE -ne 0) { throw 'Edge 배포 실패: 웹 배포 중지' }
```

이후 아래 3절과 같은 전체 저장소 배포 방식으로 기존 Vercel dev 프로젝트를 재배포한다. 이미 등록한 코스의 seed·ACTIVE_COURSE_ID 설정을 반복하지 않는다. 기존 방을 새로고침하고 공통 세 입력 없이 제출되는지 확인한다. 확인 방식이 미수집인 직접 완료를 결과에 현장 확인·해설 완료로 표시하지 않아야 한다. GPS 도착 조건·문제 본문 기록 필드·용봉관 전달 기록은 유지한다.

사용자의 배포 완료 보고는 있었으나 에이전트가 DB·활성 코스·Edge·웹 버전을 각각 재확인한 것은 아니다. PR-5를 처음 적용하는 환경만 아래 최초 적용 절차를 수행한다.

## 코스와 범위

### 2026-10-10 임시 이미지와 힌트 감점 후속 변경

정문·용봉관 정찰원의 자료사진은 임시 SVG로 먼저 확인할 수 있다. 실제 사진이 없거나 로드되지 않으면 임시 자료라는 안내를 표시한다. 실제 사진 수령 후 코스의 자료 URL을 교체한다. 임시 이미지 파일은 웹과 함께 배포하며 이 변경은 새 DB 스키마·비밀값을 요구하지 않는다.

새로 생성하는 개발 코스의 힌트 감점은 0/10/10이다. **기존 등록 코스와 방은 예전 점수를 유지한다.** 새 점수로 시험하려면 아래 seed 절차에서 사용하지 않은 새 리비전 ID로 등록하고, `ACTIVE_COURSE_ID` 전환·필요한 Edge 배포 후 새 방을 만든다. 기존 행을 덮어쓰지 않는다. 웹 재배포만으로 감점 수치가 바뀌지 않는다.

실제 원문 코스의 준비 파일에는 같은 힌트 감점을 반영하지만 무힌트 보너스 등 남은 미확정 항목을 임의 확정하지 않는다. 이 변경을 실제 코스 등록 완료로 해석하지 않는다. PR-5 DB 최초 마이그레이션이 빠진 환경은 아래 DB 적용도 별도로 필요하다.

- 새 dev preset `full-course`: 기존 시연 정문 + 합성 용봉관·추모의 벽·봉지. 장소와 무관하게 네 명 각각 모의 도착한다.
- 추모의 벽 좌표는 `null`, `confirmed:false`를 유지한다. 전체 GPS 코스는 좌표 확정·현장 검증 후 새 리비전으로 등록한다. 기존 `gate-yongbong-gps`는 두 거점 GPS 시험에 계속 사용한다.
- 실제 시나리오·정답은 이 PR에 없다. 로컬 용봉관 콘텐츠 준비 파일이 전체 정식 코스 완성을 뜻하지 않으며, `confirmed:true`만 바꿔 실제 코스로 전환하지 않는다.
- 시간 점수·랭킹은 D8·D9 확정 후 별도 구현한다. 현재 결과는 조사·기록·보고·확인 방식·공동 기록과 기존 보조 점수다. 요구를 취소한 것이 아니다.

## 사용자 수동 적용

PR-4까지 적용한 dev 프로젝트, 이 브랜치의 `web/`에서 PowerShell로 진행한다. 비밀값은 사용자가 직접 입력한다. 클라우드의 기존 코스 행·salt·사용자 배포용 파일은 유지한다.

### 1. DB

```powershell
npx.cmd supabase migration list
npx.cmd supabase db push --dry-run
```

새 `202610100001_wall_bongji.sql` **한 개**가 나오는지 확인한다. 다른 마이그레이션이 나오면 연결 프로젝트와 기존 적용 상태부터 확인한다.

```powershell
npx.cmd supabase db push
```

새 테이블은 없다. 비공개 `games_private.state.v2`에 기록을 저장하고 `commit_game_v2`의 이벤트 허용 목록만 확장한다. CAS와 요청 영수증은 기존 방식이다. 과거 SQL을 수정하거나 migration repair로 건너뛰지 않는다.

### 2. 새 dev 리비전

**dev 전용** 설정을 사용한다. `DEV_ALLOW_SYNTHETIC_COURSE`의 기본값은 꺼짐이며 prod에서는 켜지 않는다. seed와 Edge는 **같은 기존 ANSWER_SALT**를 사용한다.

```powershell
$devRef = '<DEV_PROJECT_REF>'
$courseId = 'jnu-demo-dev-full-r1' # 이미 등록했다면 r2 등 새 ID
$env:NEXT_PUBLIC_SUPABASE_URL = "https://$devRef.supabase.co"
$serviceKeyInput = Read-Host 'dev service_role 키' -AsSecureString
$saltInput = Read-Host '기존 Edge ANSWER_SALT와 같은 값' -AsSecureString
try {
  $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $serviceKeyInput).Password
  $env:ANSWER_SALT = [System.Net.NetworkCredential]::new('', $saltInput).Password
  npm.cmd run seed:demo -- --dev-project-ref $devRef --course-id $courseId --schema-version 2 --preset full-course
  if ($LASTEXITCODE -ne 0) { throw '등록 실패: 다음 단계 중지' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:ANSWER_SALT -ErrorAction SilentlyContinue
  $serviceKeyInput.Dispose()
  $saltInput.Dispose()
}
```

같은 ID를 덮어쓰지 않는다. 새 비밀값 종류나 새 웹 환경변수는 필요 없다.

### 3. Edge·웹 배포 후 활성화

```powershell
npx.cmd supabase functions deploy game --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'Edge 배포 실패' }
```

이 브랜치의 **커밋된 전체 저장소**로 기존 Vercel dev 프로젝트를 재배포한다. 저장소 루트에서 CLI를 실행하며 프로젝트 Root Directory는 `web`을 유지한다. 기존처럼 `git archive` 배포 복사본에 기존 dev 프로젝트의 `.vercel/project.json`만 연결하는 방식을 권장한다. `private/`, 실제 시나리오, GPS CSV, 비밀 환경 파일은 업로드하지 않는다. Git 자동 배포는 연결하지 않는다.

```powershell
# 안전한 배포 복사본의 저장소 루트에서, 기존 dev 프로젝트 연결 확인 후
npx.cmd vercel --prod
```

기존 Vercel 빌드의 루트 `codex-handoff-v2/` 참조를 유지하므로 `web/`만 떼어서 배포하지 않는다. 새 외부 디렉터리 의존성은 없다. `Not authorized`면 같은 dev 프로젝트의 권한 있는 계정으로 `npx.cmd vercel login` 후 다시 확인한다.

DB·Edge·웹이 모두 준비된 다음 새 방의 코스를 전환한다.

```powershell
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$courseId" --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw '활성 코스 설정 실패' }
npx.cmd supabase functions deploy game --project-ref $devRef
```

**새 방**으로 시험한다. 기존 방은 원래 코스 리비전에 고정된다. 두 거점 GPS 코스로 돌아가려면 기존 GPS ID로 전환하고 새 방을 만든다. 지원 웹 배포 후에는 코스 전환만으로 Vercel을 다시 배포할 필요가 없다.

## 적용 후 확인

1. `courses_private`에 새 ID와 네 단계가 있는지 확인한다. 저장된 비공개 자료·해시를 공유하지 않는다.
2. 네 세션으로 정문·용봉관을 완료하고 지휘관이 추모의 벽으로 출발한다. 매 거점 도착은 초기화되고 전원이 도착해야 조사·공동 기록이 열린다.
3. 추모의 벽에서 점수·자물쇠·숫자·카운트다운·진동·자동 효과음이 없어야 한다. 오답과 힌트 사용으로 점수가 변하지 않는다.
4. 개인 조사 본문은 본인만 본다. 지휘관은 구두 보고 후 공동 낱말 세 개·문장·근거를 작성한다. 네 명은 같은 기록 버전을 확인한다. 수정 시 기존 확인이 초기화된다.
5. 사초③ 뒤 조용히 머무르기 또는 즉시 이동 준비를 선택할 수 있다. 머무르기는 선택 사항이며 점수·서버 진행 조건이 아니다.
6. 봉지에 전원 도착 후 각자 회고를 저장한다. 지휘관은 전원 회고 완료 후 별도의 공동 기록을 작성한다. 개인 회고 수정 또는 공동 기록 수정 시 네 동의가 초기화된다.
7. 최종 동의 후 조사 3/3·사초 3/3, 역할별 완료·보고·힌트·해설·기록·확인 방식, 공동 문장·근거를 확인한다. 다른 사람의 개인 본문은 보이지 않는다. 새로고침과 `/verify`에서도 같은 결과가 복구된다.
8. `games_private`의 `memorialRecords`와 `jointRecords`가 분리되어야 한다. `game_public`은 완료 상태만, `game_events`는 제한된 메타데이터만 포함한다. 본문을 이벤트에 넣지 않는다.

| 오류 | 조치 |
|---|---|
| `STALE_DRAFT` (409) | 최신 Snapshot의 문장·근거·버전을 다시 읽고 새 사용자 동작으로 확인 |
| `RECORD_REQUIRED` / `RETROS_REQUIRED` / `REPORTS_REQUIRED` (409) | 공동 기록·전원 회고·선행 보고 완료 확인 |
| `BAD_RECORD` (400) | 필수 낱말·문장·근거 및 600자 상한 확인 |
| `WRONG_PHASE` / `STALE_STAGE` (409) | 도착 전·종료 후·이전 거점 요청인지 확인하고 새 상태 조회 |
| `FORBIDDEN` (403) | 본인 역할 권한 확인. 지휘관만 초안 작성·출발 가능 |
| `INVALID_GAME_EVENT` | 새 마이그레이션과 Edge 버전 일치 확인 |
| `NO_STAGE` | 기존 두 거점 코스 방인지 확인. 전체 코스로 새 방 생성 |

## 로컬 재현

`NEXT_PUBLIC_BACKEND=local`, `LOCAL_V2_PRESET=full-course`, 새로운 `LOCAL_V2_COURSE_ID=jnu-demo-dev-…`, 무작위 개발 salt를 설정하고 `web/`에서 실행한다. 실제 비밀값을 테스트 설정에 넣지 않는다.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npx.cmd playwright test --config playwright.full.config.ts
```

네 브라우저 세션 자동화는 휴대폰 네 대의 현장 검증을 대신하지 않는다. PR-6은 D3·D6 결정 및 사용자 지시 전까지 시작하지 않는다.
