# 용봉관 적용 안내 — PR-4

`feat/stage-yongbong`은 GPS 도착 PR #11 위에 쌓은 작업이다. 정문 완료 → 용봉관 이동·전원 재도착 → 역할별 11단계 → 보고·개방 → 사초②까지 구현한다. 추모의 벽·봉지·전체 결과는 포함하지 않는다. 이 문서는 **적용 방법**이며 클라우드 배포 완료 보고가 아니다.

## 코스와 콘텐츠

| dev preset | 구성 | 도착 |
|---|---|---|
| `gate-yongbong` | 기존 시연 정문 + 합성 용봉관 | 각자 모의 도착, 장소 무관 |
| `gate-yongbong-gps` | 같은 문항 | 정문·용봉관 각각 GPS 반경 10m·5초·전원 도착 |

기존 `v1-gate` / `v1-gate-gps` 코스는 정문까지만 진행하며 그대로 남는다. 새 preset의 용봉관 문구·정답은 합성이다. 코스 리비전은 불변이므로 기존 ID를 덮어쓰지 않는다. 두 모드는 다른 새 ID로 등록한다.

사용자가 요청한 실제 원문 등록 준비 파일은 로컬의 gitignore된 `private/yongbong-authoring/`에만 있다. 사진·공식 디지털 자료, 정찰원 외형 선택지와 정답 연결, 점수 정책, 실제 정문과 합칠 코스 리비전 검토가 남아 운영 등록을 차단한다. 폴더의 README를 참고하며 실제 문구·정답 파일은 GitHub·FE mock·Vercel에 올리지 않는다. 준비 파일 생성은 실제 콘텐츠 등록 완료가 아니다.

## 사용자 수동 적용 순서

명령은 **이 브랜치의 저장소 `web/`**에서 PowerShell로 실행한다. 기존 Supabase dev 프로젝트 연결과 PR-2 마이그레이션 적용을 전제로 한다. 비밀값은 사용자가 직접 입력한다. 에이전트는 이 절차를 실행하지 않았다.

### 1. 새 DB 마이그레이션

```powershell
npx.cmd supabase migration list
npx.cmd supabase db push --dry-run
```

이미 PR-2까지 적용한 환경에서는 새 `202610090001_yongbong_alt_mode.sql` 한 개가 나와야 한다. 다른 변경이 나오면 연결 프로젝트·브랜치·기존 적용 상태를 먼저 확인한다. 확인 후:

```powershell
npx.cmd supabase db push
```

이 변경은 `commit_game_v2`의 이벤트 허용 목록에 외부 대체 모드를 추가한다. CAS·멱등성·기존 감점 규칙은 유지한다. 기존 두 마이그레이션을 수정하거나 다시 등록하지 않는다.

### 2. dev 코스 새 리비전 등록

다음은 **dev 전용**이다. 기존 Edge의 `DEV_ALLOW_SYNTHETIC_COURSE`와 dev 프로젝트 설정을 유지하며 prod에서 켜지 않는다. seed에는 Edge가 사용 중인 **동일한 `ANSWER_SALT`**를 입력한다. 새 salt로 바꾸지 않는다. 키·salt는 명령 문자열이나 파일에 붙이지 않고 마스킹 입력한다.

```powershell
$devRef = '<DEV_PROJECT_REF>'
$courseId = 'jnu-demo-dev-yong-r1' # 이미 사용했다면 새 리비전 ID
$preset = 'gate-yongbong' # GPS 코스는 gate-yongbong-gps + 별도의 새 ID
$env:NEXT_PUBLIC_SUPABASE_URL = "https://$devRef.supabase.co"
$serviceKeyInput = Read-Host 'dev service_role 키' -AsSecureString
$saltInput = Read-Host '기존 Edge ANSWER_SALT와 같은 값' -AsSecureString
try {
  $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $serviceKeyInput).Password
  $env:ANSWER_SALT = [System.Net.NetworkCredential]::new('', $saltInput).Password
  npm.cmd run seed:demo -- --dev-project-ref $devRef --course-id $courseId --schema-version 2 --preset $preset
  if ($LASTEXITCODE -ne 0) { throw '코스 등록 실패: 다음 단계를 실행하지 마세요.' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:ANSWER_SALT -ErrorAction SilentlyContinue
  $serviceKeyInput.Dispose()
  $saltInput.Dispose()
}
```

실패 시 원인을 확인한다. 같은 ID를 덮어쓰거나 확인되지 않은 실제 코스의 `confirmed` 값을 일괄 변경하지 않는다.

### 3. Edge 배포와 활성 코스 전환

```powershell
npx.cmd supabase functions deploy game --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'Edge 배포 실패' }
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$courseId" --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw '활성 코스 설정 실패' }
npx.cmd supabase functions deploy game --project-ref $devRef
```

새 비밀값 종류는 필요 없다. 기존 `ALLOWED_ORIGIN`과 웹의 공개 환경변수도 그대로 사용한다. 활성 코스 전환은 프로젝트의 **새 방 전체**에 영향을 준다. 이미 생성한 방은 예전 코스로 유지된다.

### 4. 웹 재배포

이 브랜치 코드를 기존 Vercel dev 프로젝트에 재배포한다. 기존과 같이 저장소 루트에서 CLI로 배포하고 프로젝트 Root Directory는 `web`을 유지한다. 예전 GPS 배포용 복사본으로 배포하면 용봉관 버튼·기록 전달 UI가 빠진다.

```powershell
Set-Location ..
npx.cmd vercel --prod
```

위 명령은 **기존에 연결한 dev 웹 프로젝트**인지 먼저 확인하고 실행한다. 배포 제외 설정으로 `private/`, 비밀 환경 파일, 원시 GPS, 테스트 산출물을 제외한다. `.vercelignore`, `.vercel/`, `web/.vercel/`, `web/.env.local`은 기존 로컬 배포 설정이며 커밋하지 않는다. 기존 빌드가 참조하는 루트 `codex-handoff-v2/`는 필요하다. 이번 변경은 새 외부 디렉터리 의존성이나 웹 환경변수를 추가하지 않는다.

이후 이미 등록한 두 용봉관 코스 사이의 전환은 `ACTIVE_COURSE_ID` 변경·Edge 재배포 후 새 방 생성으로 가능하며 웹 재배포는 필요 없다. 참가자의 화면에서 모드를 바꾸는 기능은 제공하지 않는다.

## 적용 후 확인

- Table Editor의 `courses_private`에서 새 코스 ID가 생겼는지 확인한다. 실제 정답·해시·키를 화면 공유나 로그로 내보내지 않는다.
- 네 세션으로 새 방에 입장하고 정문을 완료한다. 지휘관에게만 **용봉관으로 출발** 버튼이 활성화된다.
- 용봉관 이동 시 도착 상태가 초기화되고 새 전원 도착 전에는 문제가 숨겨진다. GPS 코스는 모의 도착을 거절한다.
- 통신원의 자료 기록은 암호해독관에게만 전달된다. 모든 필드에 `확인 불가`를 쓸 수 있다. 기록 없이 해설 완료한 경우 기록 부재 안내가 나온다.
- 지휘관은 다른 세 역할의 보고 후 조사하며 수정 기록 두 칸을 모두 채워야 한다. 같은 분류를 여러 문장에 선택할 수 있다.
- 미션 중 외부 대체 모드를 선택하고 새로고침한다. 기록·점수·진행은 유지되고 사초·결과·기록첩에 **실내 관람 아님**이 보인다.
- 용봉관 완료 뒤에는 다음 거점 버튼이 없다. 사초②까지 확인한 뒤 멈춘다.
- DB `game_events`의 대체 모드 이벤트에는 `mode_id`만 기록된다. 자료 본문은 공개 이벤트가 아닌 기존 서버 비공개 상태에 저장한다.

| 대표 오류 | 확인·조치 |
|---|---|
| `NO_STAGE` | 정문 전용 코스인지 확인. 새 용봉관 코스로 새 방을 만든다. 용봉관 완료 뒤에는 정상적인 범위 종료 |
| `STALE_STAGE` | 이동 직전 화면의 요청. 최신 Snapshot을 조회하고 현재 stage_id로 새 동작 |
| `STEP_LOCKED` | 선행 문제 또는 다른 역할의 자료 기록·보고 대기 |
| `WRONG_PHASE` / `FORBIDDEN` | 전원 도착 전·완료 후 대체 모드 선택 또는 지휘관 외 선택 여부 확인 |
| `INVALID_GAME_EVENT` | 새 DB 마이그레이션 적용 여부 확인. 기존 SQL을 고치지 않는다 |
| `CONTENT_UNCONFIRMED` | 미확정 실제 자료·정답·점수 검토. 검증을 끄거나 임의 확정하지 않는다 |

## 로컬 재현

`web/`에서 `NEXT_PUBLIC_BACKEND=local`, `LOCAL_V2_PRESET=gate-yongbong`, 새 dev ID의 `LOCAL_V2_COURSE_ID`, 32자 이상의 개발용 `ANSWER_SALT`를 설정해 실행한다. 이미 저장된 코스는 preset을 바꿔도 그대로이므로 새 코스 ID와 새 방을 사용한다. 상태는 기존 `.demo-data/state.json`에 저장한다. 전체 환경 설정은 [웹 안내](../../web/README.md)를 따른다.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npx.cmd playwright test --config playwright.yongbong.config.ts
```

자동화는 합성 4세션 시험이며 휴대폰 4대 GPS 현장 검증을 대신하지 않는다. [API 계약 11절](API_CONTRACT.md#11-pr-4-용봉관), [결정 기록](DECISIONS.md), [검증 기록](../../web/docs/VALIDATION.md) 참고.
