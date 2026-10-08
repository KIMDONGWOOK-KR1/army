# PR-2 정문 엔진 v2 적용 안내

이 문서는 사용자가 검토 후 실행할 절차다. PR 작성 중 Supabase/Vercel에 배포하거나 마이그레이션·시드를 적용하지 않았다. 기존 dev `jnu-demo-dev-r1`은 v1 코스다. 기존 `/` UI는 새로운 mission 입력을 표시하지 않는다. **v2 확인용 `/verify` UI와 새 DB·Edge·코스 적용 준비를 맞춘 뒤 활성 코스를 전환한다.** [확인 UI 실행 안내](../fe/VERIFY_UI.md)를 참고한다.

PR-0 #6, PR-1 #7이 main에 병합되어 PR-2의 실제 base는 main이다. 브랜치는 `feat/engine-v2-gate`, 시작 커밋은 `a08593c`다. PR-1의 변경을 포함한 이 base 위에 PR-2 변경만 검토한다. 작성자는 브랜치만 push하고 PR은 사용자가 연다.

## 적용 절차 (dev 전용)

1. 저장소에서 `web`로 이동하고 연결 대상을 다시 확인한다. 이미 적용된 `202610060001_game.sql`은 수정하지 않는다. 새 파일은 `202610080001_game_v2.sql` 하나다. 아래는 PowerShell이며 `<...>`는 자리표시자다.

```powershell
Set-Location web
$pr2DevRef = '<DEV_PROJECT_REF>'
npx supabase link --project-ref $pr2DevRef
npx supabase db push --dry-run
# 목록이 새 PR-2 마이그레이션인지 확인한 후 사용자가 실행
npx supabase db push
```

새 DB 변경은 `game_events`와 `commit_game_v2`다. 원래 `commit_game`은 그대로 둔다. v2는 CAS가 성공할 때만 private/public 상태와 이벤트를 한 트랜잭션으로 저장한다. 플레이어는 이벤트 테이블과 쓰기 RPC에 접근할 수 없다. service_role도 이벤트를 직접 수정·삭제하지 않고 RPC로만 추가한다. 롤백은 기존 v1 활성 코스·이전 Edge 배포로 되돌리는 방식으로 하고, 진행 중 게임·이벤트를 삭제하지 않는다.

2. 필요한 경우 새 **불변 v2 합성 리비전**을 등록한다. r1을 덮어쓰지 않는다. 새 revision ID와 dev 프로젝트임을 Dashboard에서 확인한다. 합성 정문 하나만 포함하며 실제 시나리오·GPS·운영 수치가 아니다. seed에는 Edge와 같은 기존 ANSWER_SALT가 필요하다. 키·salt를 명령 기록·로그·PR에 적지 않는다.

```powershell
$pr2CourseId = '<NEW_DEV_COURSE_REVISION_ID>' # jnu-demo-dev-로 시작
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://' + $pr2DevRef + '.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host 'dev service_role key' -MaskInput
$env:ANSWER_SALT = Read-Host 'Edge와 같은 ANSWER_SALT' -MaskInput
try {
  npm run seed:demo -- --dev-project-ref $pr2DevRef --course-id $pr2CourseId --schema-version 2
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ANSWER_SALT -ErrorAction SilentlyContinue
}
```

3. DB 적용 후 사용자가 Edge를 재배포한다. 새 비밀값 이름은 없다. 기존 ANSWER_SALT와 ALLOWED_ORIGIN을 유지하며, 합성 허용 설정은 dev에서만 사용한다. 기본값 꺼짐·prod 금지 원칙은 [DEPLOY.md](DEPLOY.md)의 6절을 따른다. 함수 배포만으로 기존 r1 게임이 v2로 바뀌지 않는다.

```powershell
npx supabase functions deploy game --project-ref $pr2DevRef
```

4. FE v2 또는 별도 인증 API 시험 준비 후 Dashboard에서 `ACTIVE_COURSE_ID`를 새 revision ID로 바꿔 **새 방**을 만든다. 기존 방은 원래 courseId에 고정된다. 네 익명 세션의 역할 배정·준비·본인 모의 도착→get-stage→문제 제출/힌트→보고→개방을 확인한다. 모의 도착은 각자 `report-arrival`에 `stage_id:"gate",method:"simulated"`를 보내며 solo 우회는 없다. 전원 읽음 확인이 없는 해설 개방도 실패해야 한다.

5. 정식 디자인 전 검증을 위해 추가한 `/verify` UI를 사용하려면 사용자가 Vercel을 재배포한다. 기존 `/` 화면의 r1 방은 계속 사용할 수 있으며 v2 새 방은 `/verify`에서 만든다. 새 공개 환경변수는 없고, 이번에 추가한 런타임 모듈은 모두 `web/` 안에 있다. 기존 PR-1의 코스 검증 테스트·seed 경로는 저장소 루트 `codex-handoff-v2/`를 참조하므로 **기존 Vercel 루트 배포 구성은 유지**한다. 배포용 로컬 파일과 private 원문은 커밋하지 않는다.

## 로컬 API 개발

기본 실행은 v1 데모다. v2 시험은 별도 터미널에서 `NEXT_PUBLIC_BACKEND=local`, `LOCAL_V2_COURSE_ID=<새 dev revision ID>`, `ANSWER_SALT=<임의의 32자 이상 로컬 전용 비밀값>`을 환경변수로 설정한 뒤 `npm run dev`로 시작한다. 고정 salt 기본값이 없고 Edge 모드에서는 로컬 `/api/game`이 차단된다. 합성 코스 리비전·이벤트·스냅샷은 커밋 제외된 `.demo-data/state.json`에 저장한다. 기존 리비전의 정규화·콘텐츠를 바꾸려면 새 ID로 방을 만든다. 이 설정을 Vercel/prod에 넣지 않는다.

## 검증 및 남은 범위

- 단위/저장소: `npm test`, `npm run typecheck`, `npm run build`. 새 테스트는 v2 네 역할 완주·의존성·격리·힌트/개방 멱등성과 PGlite CAS/롤백/RLS를 검증한다.
- 계약: `tests/api-v2.test.ts`는 실제 로컬 POST 핸들러 응답 12종을 문서 mock과 대조한다. 가린 숫자·텍스트를 정답으로 사용하지 않는다. Supabase 실서비스 HTTP 검증은 적용 후 별도 수행한다.
- 기존 회귀: `NEXT_PUBLIC_BACKEND=local`과 v2 선택 환경변수 해제 상태에서 `npm run test:e2e`. 로컬 HTTP 서버와 브라우저를 사용하며 클라우드에 연결하지 않는다.
- 확인 UI: `npm run test:e2e:v2`. 독립 브라우저 네 개로 정상/해설 개방, 본인 정보 격리, 보고 분리, 재접속 및 응답 유실 재시도를 검증한다. 전용 설정이 새 합성 리비전과 임의 salt를 준비한다.
- 새 Edge 모듈은 Deno check/lint로 검사한다. 저장소에 npm lint 스크립트는 아직 없다.
- PR-3의 프롤로그·교환·QR·수동 대행, 후속 거점·최종 결과, 시간 점수/팀 랭킹은 이번 구현 범위 밖이다. 완료 후 PR-3로 자동 진행하지 않는다.

## 확정 필요/결정 사항

- 확정: 정식 FE 디자인 전 합성 정문을 확인하는 `/verify` 임시 UI를 추가한다. 기존 v1 화면과 서버 판정 규칙을 유지하며 PR-3로 범위를 넓히지 않는다.
- 확정: 정규화는 단계별 옵션·기본 판정 유지. 역할별 3단계 힌트 중 3단계는 해당 역할 미완료 문제 전체를 해설 처리한다.
- 확정: 전원 해설 읽음 확인 뒤 지휘관의 별도 개방. 기존 자물쇠 3회/−10/60초 유지, 결과 `해설 확인 후 복원`. 보상은 정답을 맞힌 본인만 받는다.
- 확정: 사초① 사건 순서는 검증 결과·출처·방식만 보존하고 정답 배열은 저장하지 않는다. 관찰 기록과 사건 기록은 별도 항목이다.
- 유지: 지휘관 전달형 개인 단서의 self 전용 예외, dev 합성 허용 기본값 꺼짐·prod 금지, seed/Edge 동일 salt, 불변 코스 리비전.
- 결정 대기: 공개 코스 정답 문장 노출 처리(동욱), 실제 G-01 근거·1:1 정답 짝, D5 감점/보너스 수치, D8 시간 점수식, D9 팀 랭킹 범위·공개 시점. 합성 수치는 실제 정책으로 확정하지 않는다.
- GPS 후보는 이전 사용자 전달 사항이며 현장 확정이 아니다. 이번 PR은 좌표·반경·GPS 원본을 변경/추가하지 않는다.
