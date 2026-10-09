# 지정 좌표 GPS 도착 적용

2026-10-09 사용자 결정. 정문·용봉관·봉지의 목표 좌표와 시험 반경을 지정했다. 원시 GPS CSV와 참가자 위치 기록은 저장소에 넣지 않는다.

| 거점 | 위도 | 경도 | 반경 |
|---|---:|---:|---:|
| 정문 | 35.172851 | 126.905149 | 10m |
| 용봉관 | 35.175722 | 126.906345 | 10m |
| 봉지 | 35.177269 | 126.906604 | 10m |

공통 설정은 `web/supabase/functions/_shared/jnu-gps.ts`다. 현재 미션 구현은 정문까지이므로 새 dev 코스에도 정문만 들어간다. 용봉관·봉지는 후속 미션에서 같은 설정을 사용한다. 추모의 벽은 좌표 미정이다. 반경 10m는 사용자 지정 시험값이며 실기기 4대 현장 통과를 주장하지 않는다.

## 동작

1. 각자 위치 권한을 허용하고 이동 화면에서 GPS를 켠다. 권한 거부 시 정확한 위치 허용 후 ‘위치 확인’을 다시 누른다.
2. 기기에서 accuracy 40m 이하인 최근 3개 좌표의 평균 거리를 계산한다. 10m 안에 5초간 머무르면 본인 도착을 보고한다. 40m 초과, 5초 초과 측위 공백, 오류·재시작 시 체류를 초기화한다. 5초보다 오래된 위치는 사용하지 않는다.
3. 1~3명만 도착하면 모두 이동 화면에서 대기한다. 네 번째가 도착하면 서버가 미션을 열고 개인 문제를 제공한다.
4. GPS 코스는 수동·QR·모의 도착을 거절한다. 도착 결과와 역할은 새로고침 후 복원한다. 도착 뒤 반경 이탈 시 미션을 다시 잠그지는 않는다.

원시 사용자 좌표는 브라우저 메모리에서만 사용한다. API에는 `method:gps` 도착 결과만 보내며 DB·localStorage에 원시 좌표를 저장하지 않는다. 서버는 인증된 사용자의 클라이언트 판정을 신뢰하므로 직접 API 호출이나 GPS 조작을 물리적으로 검증하는 기능은 아니다.

## dev 적용 절차

새 마이그레이션·새 비밀값은 없다. 기존 `ANSWER_SALT`를 유지하며 seed와 Edge가 같은 값을 사용해야 한다. 기존 코스 행은 수정하지 않고 새 리비전으로 등록한다. 아래 명령은 저장소의 `web`에서 사용자가 직접 실행한다. `v1-gate-gps`는 기존 시연 문제를 재사용하는 dev 전용 preset이며 운영용 콘텐츠 확정이 아니다. prod에서는 합성 코스 허용 설정을 켜지 않는다.

```powershell
# 아래 값은 해당 dev 환경에 맞게 입력한다. 비밀값을 채팅·스크린샷에 공유하지 않는다.
$devRef = '<DEV_PROJECT_REF>'
$courseId = 'jnu-demo-dev-v1gps-r1' # 이미 등록됐다면 r2 등 새 ID
$env:NEXT_PUBLIC_SUPABASE_URL = "https://$devRef.supabase.co"

# 사용자가 직접 입력: dev service role key 및 현재 Edge의 기존 ANSWER_SALT
$secretKey = Read-Host 'dev service role key' -AsSecureString
$secretSalt = Read-Host '현재 Edge ANSWER_SALT' -AsSecureString
try {
  $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secretKey).Password
  $env:ANSWER_SALT = [System.Net.NetworkCredential]::new('', $secretSalt).Password
  npm.cmd run seed:demo -- --dev-project-ref $devRef --course-id $courseId --schema-version 2 --preset v1-gate-gps
  if ($LASTEXITCODE -ne 0) { throw '코스 등록 실패: 활성화하지 말고 오류를 확인한다.' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ANSWER_SALT -ErrorAction SilentlyContinue
  $secretKey.Dispose()
  $secretSalt.Dispose()
}
```

등록 성공을 확인한 뒤 아래를 실행한다. 기존 dev 프로젝트의 `DEV_ALLOW_SYNTHETIC_COURSE` 설정은 유지한다. 최초 Edge 재배포가 실패하면 활성화하지 않는다.

```powershell
npx.cmd supabase functions deploy game --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'Edge 배포 실패' }
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$courseId" --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw '코스 활성화 실패' }
npx.cmd supabase functions deploy game --project-ref $devRef
```

웹도 이 변경을 포함한 새 배포본으로 Vercel dev에 재배포한다. 기존 `.deploy/ui-61c6195-20261009`에는 GPS 변경이 없으므로 재사용하지 않는다. 기존 프로젝트 연결·Root Directory=web을 유지하고, private·GPS 원본·로컬 환경파일을 제외한 새 배포 폴더를 준비한다. 신규 코드는 `web/` 내부 공통 모듈에 있고 새로운 저장소 외부 빌드 의존성은 없다.

배포 후 반드시 **새 방**을 만든다. 기존 방은 생성 시 지정된 불변 코스를 계속 사용한다. 기존 v1-gate/synthetic 코스의 모의 도착 버튼이 보인다면 새 GPS 리비전의 활성화 여부와 새 방인지 확인한다.

## 확인 항목

- 정문 이동 화면에 ‘반경 10m’와 전원 도착 수가 표시되고 수동·모의 도착 버튼이 없는지 확인한다. GPS 신호가 없을 때 캐릭터가 시연처럼 자동 이동하거나 도착 표시되지 않아야 한다.
- 권한 거부·반경 밖·GPS 오차가 큰 상태에서는 문제를 볼 수 없어야 한다. 권한을 켜고 다시 측정하면 복구되어야 한다.
- 3명만 도착하면 3/4로 대기하고 네 번째의 GPS 판정 뒤 미션이 열린다. 새로고침해도 역할과 도착 결과가 유지된다.
- 개발자 도구 요청에서 사용자 좌표가 전송되지 않는지 확인한다. `game_public`의 도착 마스크와 `games_private`의 본인 도착 결과만 바뀌어야 한다.
- 정확도·진입·스치기·경계 시험을 휴대폰 4대에서 시행한 뒤 10m 유지 여부를 판단한다. 시험 전에는 현장 검증 완료라고 표시하지 않는다.

로컬 브라우저 검증: `npx playwright test --config playwright.gps.config.ts`. 브라우저 위치는 합성이며 실제 측위 시험과 구분한다. API·단위 검증은 `npm test`, 타입 검사는 `npm run typecheck`다. 기존 실내 시연은 `v1-gate` preset으로 유지한다.

## 같은 Vercel 주소에서 개발용·GPS 모드 전환

[dev 웹](https://hoguk-dev-web.vercel.app/)에서 두 코스를 번갈아 시험할 수 있다. **전환은 담당 개발자가 Supabase의 `ACTIVE_COURSE_ID`를 변경해서 한다.** 참가자용 웹 토글이나 Vercel 환경변수 전환 기능은 없다. `NEXT_PUBLIC_BACKEND=supabase`를 유지한다.

| 시험 모드 | 등록할 때 사용한 preset | 도착 방식 |
|---|---|---|
| 개발용(실내·교외) | `v1-gate` | 각 참가자의 모의 도착 버튼. 전남대에 없어도 정문 문제를 시험할 수 있다. |
| GPS(현장) | `v1-gate-gps` | 각자 위치 권한을 허용하고 정문 10m 안에서 5초 체류. 네 명 모두 도착해야 문제가 열린다. |

두 모드 모두 정문 v2의 4인 방과 기존 시연 문항을 사용한다. 개발용에서도 다른 참가자의 역할로 바꾸거나 혼자 네 명의 도착을 대신할 수 없다. 자동 시연·보직 전환·장면 건너뛰기는 별도의 **로컬 v1 혼자 체험**에만 있다.

### 최초 준비

1. 개발용 코스는 [기존 정문 dev 코스 안내](LEGACY_GATE_DEV.md), GPS 코스는 이 문서의 dev 적용 절차로 각각 등록한다. 같은 기존 `ANSWER_SALT`를 사용하며 코스 ID는 서로 달라야 한다.
2. `courses_private`에서 **ID만** 확인하고 두 코스 ID를 기록한다. 문서의 `jnu-demo-dev-v1gate-r2`, `jnu-demo-dev-v1gps-r1`은 예시다. 실제 등록한 리비전이 r1/r3 등이라면 그 ID를 사용한다. 등록 내용을 바꾸려면 새 리비전을 만든다.
3. GPS 변경을 포함한 Edge와 웹을 한 번 배포한다. 웹은 2026-10-09 코드 `76550a5`를 위 dev 주소에 배포했고 `/`, `/verify` HTTP 200을 확인했다. Supabase 코스 등록·Edge 준비는 사용자 완료 보고 기준이며, 이 기록으로 현재 활성 코스나 실기기 4대 완주를 보장하지 않는다.

### 준비 후 전환 명령

이 변경을 포함한 저장소의 `web`에서 실행한다. 아래 ID는 실제 등록된 값으로 직접 입력한다. 기존 `ANSWER_SALT`·키와 Vercel 공개 환경변수는 바꾸지 않는다.

```powershell
$devRef = '<DEV_PROJECT_REF>'
$indoorCourseId = Read-Host '등록된 개발용 v1-gate 코스 ID'
$gpsCourseId = Read-Host '등록된 GPS v1-gate-gps 코스 ID'
```

GPS 모드로 전환:

```powershell
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$gpsCourseId" --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'GPS 코스 전환 실패' }
npx.cmd supabase functions deploy game --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'Edge 재배포 실패: 새 방 시험 전에 배포 상태를 확인한다.' }
```

개발용 모드로 복귀(위 변수가 설정된 같은 터미널에서 실행):

```powershell
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$indoorCourseId" --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw '개발용 코스 전환 실패' }
npx.cmd supabase functions deploy game --project-ref $devRef
if ($LASTEXITCODE -ne 0) { throw 'Edge 재배포 실패: 새 방 시험 전에 배포 상태를 확인한다.' }
```

전환 후 같은 Vercel 주소에서 **새 방**을 만들고 네 명이 합류한다. GPS 모드에는 모의 도착 버튼이 없어야 하고, 개발용 모드에는 있어야 한다. 코스 전환만 할 때는 Vercel을 다시 배포하거나 코스를 다시 등록할 필요가 없다.

`ACTIVE_COURSE_ID` 변경은 해당 Supabase 프로젝트에서 이후 만드는 **모든 새 방**에 적용된다. 기존 방은 생성 당시 코스를 유지하므로 새로고침만으로 모드가 바뀌지 않는다. 두 모드의 방을 미리 만들어 입장 코드를 따로 보관하면 각각의 기존 방에 다시 합류해 비교할 수도 있다. 기존 방·코스 행을 삭제하지 않는다.

GPS 캐릭터는 지도 범위 안에서 유효한 현재 위치가 잡히면 그 위치를 따라간다. 용봉관에서 접속해도 첫 미션 목표는 정문이다. 지도 밖이거나 위치를 얻지 못하면 캐릭터가 보이지 않을 수 있다. 후속 거점 미션은 아직 구현 범위가 아니다.
