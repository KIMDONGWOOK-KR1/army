# 기존 v1 정문 콘텐츠로 v2 시연하기

2026-10-09 사용자 결정: 기존 v1 정문 문항과 무전기·달력·퀴즈 입력 UI를 임시 dev v2 코스로 재사용하고 이후 수정한다. 실제 시나리오 완성이나 운영 코스 확정을 뜻하지 않는다.

## 포함 범위

- 통합 브랜치의 `39526ed` 시점 v1 데모 문항·선택지·완료 숫자를 서버 시드 입력에서 재사용한다. 지휘관 문항은 PR #8에서 바뀌었으므로 이전 클라우드 r1과 문구가 완전히 같다고 보장하지 않는다.
- 정문만 포함한다. 지휘관 선택 문제, 정찰원 관찰 입력, 통신원 주파수, 암호해독관 요일 선택을 각각 한 문제로 옮긴다. 용봉관과 새 시나리오의 다단계 문제는 포함하지 않는다.
- 메인 화면에서는 기존 선택 버튼·관찰 입력·무전기 다이얼/파형/조작음·달력을 재사용한다. 서버의 본인 문항만 렌더링하며 무전기 효과는 정답과 무관하게 조작에만 반응한다. 주파수 직접 입력은 v2 형식을 따르며 반올림하지 않는다. `/verify`는 계속 일반 입력 UI다.
- 달력의 요일 답은 v2 선택 번호로 변환한다. 판정 해시는 새 코스 ID와 **Edge의 기존 ANSWER_SALT**로 다시 생성한다. v1 해시를 복사하지 않는다.
- 기존 힌트는 본인에게만 제공한다. 주파수가 포함된 기존 통신원 힌트는 전달 절차 안내로 바꾼다. 주파수는 지휘관의 비공개 전달 단서에만 둔다.
- 추가 2·3단계 힌트와 해설은 임시 안내다. 현장 검증이나 공식 해설 확정으로 보지 않는다. 출처 목록의 주소도 시연용 자리표시자다.
- 네 명 도착 → 문제 제출 → 별도 보고 → 기존 자물쇠 규칙을 유지한다. 해설 경로는 전원 보고·읽음 확인 후 지휘관의 별도 개방이며 감점·시도 규칙을 바꾸지 않는다.
- 기본 v2 다단계 시나리오와 달리 지휘관 문제에 `requiresReports`를 두지 않아 네 역할이 병렬로 푼다. 기존 v1 흐름을 유지하는 이 preset의 예외이며 자물쇠는 여전히 전원 보고를 요구한다.
- `demo:true`, `confirmed:false`, dev 전용 ID를 유지한다. prod 사용 금지. 기존 dev 허용 설정을 prod에 복사하지 않는다.

기본 `--schema-version 2`는 기존 합성 API 시험 코스를 계속 만든다. 기존 방·코스는 변경하지 않고 명시적으로 `--preset v1-gate`를 선택할 때만 이 코스를 생성한다.

## 현재 dev 적용 순서 (사용자 실행)

PR-2 마이그레이션·Edge가 이미 적용된 환경 기준이다. 추가 마이그레이션·비밀값은 없다. 개인 기록첩·완료 방식 재조회를 위해 **이 브랜치의 Edge와 웹을 다시 배포한다.** 최초 콘텐츠 이관 커밋 `b5d6d5b`의 데이터 등록만으로 화면 디자인이 바뀌지는 않는다. 입력 UI만 바뀐 `1bea8bf` 이후 사초·기록첩 연결이 추가된 데 따른 절차다.

기존 `v1-gate` 코스도 계속 읽을 수 있다. 기존 행에 없는 사초 본문·도장을 표시하려면 아래 절차로 **새 리비전**을 등록하고 활성 코스를 전환한다. 기존 행과 salt는 변경하지 않는다. 배포된 Edge는 저장된 v2 코스를 읽으며 변환 코드를 실행하지 않는다. 사초 본문은 기존 공개 보상만 옮기며 완료 전에 응답하지 않는다.

아래 명령은 수정된 통합 작업 폴더의 `web`에서 PowerShell로 실행한다. `<DEV_PROJECT_REF>`는 기존 dev 프로젝트 ref로 바꾼다. 예시 ID도 이미 있다면 r3 등 **새 리비전**을 사용한다. 키와 salt는 사용자가 마스킹 입력하고 공유하지 않는다.

```powershell
$legacyDevRef = '<DEV_PROJECT_REF>'
$legacyCourseId = 'jnu-demo-dev-v1gate-r2'
$env:NEXT_PUBLIC_SUPABASE_URL = "https://$legacyDevRef.supabase.co"
try {
  $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new(
    '', (Read-Host 'dev service_role 키' -AsSecureString)
  ).Password
  $env:ANSWER_SALT = [System.Net.NetworkCredential]::new(
    '', (Read-Host 'Edge와 동일한 기존 ANSWER_SALT' -AsSecureString)
  ).Password
  npm.cmd run seed:demo -- --dev-project-ref $legacyDevRef --course-id $legacyCourseId --schema-version 2 --preset v1-gate
  if ($LASTEXITCODE -ne 0) { throw '코스 등록 실패. 활성 코스를 전환하지 마세요.' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ANSWER_SALT -ErrorAction SilentlyContinue
}
```

등록 성공을 확인한 다음 별도로 실행한다.

```powershell
npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$legacyCourseId" --project-ref $legacyDevRef
npx.cmd supabase functions deploy game --project-ref $legacyDevRef
```

기존 ANSWER_SALT를 바꾸면 다른 코스의 검증도 실패할 수 있으므로 유지한다. 키·salt는 Vercel이나 공개 환경변수에 넣지 않는다.

## 적용 후 확인

1. Table Editor의 `courses_private`에서 새 ID 행과 기존 ID 행이 함께 있는지 확인한다. `state` 전체를 공유하거나 캡처하지 않는다.
2. 통합 웹에서 **새 방**을 만들고 네 세션이 합류한다. 기존 방은 생성 당시 코스를 계속 사용한다.
3. 각자 준비·도착한 뒤 각 역할에 기존 정문 한 문제씩 보이는지 확인한다. 주파수 전달 단서는 지휘관에게만 보여야 한다.
4. 확인 방식은 모의 확인을 선택한다. 문제 제출 후 별도 보고로 자기 숫자를 받고, 말로 모아 지휘관이 자물쇠를 연다.
5. 별도 새 방에서 힌트 3단계 → 전원 보고·해설 읽음 → 지휘관 개방도 확인한다. 정문 이후 이동은 이번 범위 밖이다.

코스 ID 중복은 새 ID로 등록한다. `UNCONFIRMED_COURSE`는 dev 대상·기존 dev 허용 설정을 확인한다. 모든 답이 거절되면 seed 때 입력한 salt와 Edge의 기존 salt 일치를 사용자가 확인한다. 잘못 입력해 등록했으면 salt를 바꾸거나 행을 덮어쓰지 않고 새 리비전으로 등록한다.

되돌릴 때는 `ACTIVE_COURSE_ID`를 이전 ID로 전환한다. 진행 중 방이나 기존 코스 행을 삭제하지 않는다.

## 로컬 확인

`NEXT_PUBLIC_BACKEND=local`, 새 `LOCAL_V2_COURSE_ID`, 임의의 32자 이상 로컬 `ANSWER_SALT`와 함께 **`LOCAL_V2_PRESET=v1-gate`**를 설정하고 기존 실행 절차대로 시작한다. 이 preset 변수는 로컬에서만 쓰며 Supabase/Vercel에는 추가하지 않는다. 저장된 리비전은 계속 같은 내용이므로 preset을 바꿀 때도 새 ID가 필요하다.

로컬 브라우저 회귀 명령은 `npm.cmd run test:e2e:legacy`다. 네 독립 세션이 실제 메인 UI로 정문을 완료하며 개인 응답의 trace·캡처·동영상은 저장하지 않는다. 로컬 v2 설정에서도 **혼자 데모 체험**은 별도 v1 시연을 만들며 자동 시연·보직 전환·장면 건너뛰기를 사용할 수 있다. 실제 4인 v2 방에는 시연 우회를 적용하지 않는다.

## 확정 필요/결정 사항

- 확정: v1 정문만 임시 이관, 원본은 현재 통합 브랜치의 v1 데모, 별도 dev 리비전 사용. 기존 합성 코스 기본값은 유지.
- 유지: 지휘관 주파수 전달 단서 예외, 3단계 힌트, 별도 해설 개방, 동일 salt, dev 허용 기본값 꺼짐·prod 금지.
- 결정 대기: 실제 시나리오의 근거 짝·공개 정답 문구·공식 출처·GPS·운영 수치 및 정식 힌트/해설. 이 이관으로 확정하거나 운영 검증을 우회하지 않는다.
