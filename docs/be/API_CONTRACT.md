# BE v2 API 계약 초안 — PR-1

2026-10-08 · FE: 이환희 / BE·Infra: 김종연 / 리뷰·머지: 김동욱

**PR-1은 콘텐츠 타입·검증·투영 함수까지 구현한다. 아래 신규 HTTP 액션은 아직 작동하지 않는다.** PR-2에서 정문 액션, PR-3에서 역할 교환·도착, PR-5에서 추모·봉지 액션을 연결한다. 기존 v1 `Snapshot`, 엔진, 데모는 유지한다. 예제의 주파수·숫자·문제·본문은 합성이며 실제 시나리오 값이 아니다.

## 1. 전송·권한·재접속

| 항목 | 계약 |
|---|---|
| 클라우드 | `POST /functions/v1/game`, Supabase 익명 로그인 Bearer JWT |
| 로컬 | `POST /api/game`, 기존 로컬 세션 쿠키 |
| 요청 | `Content-Type: application/json`, 8KB 이하. 원시 GPS 좌표·salt·서비스 키를 보내지 않는다 |
| 공통 키 | 모든 게임 액션에 `game_id`, 단계 액션에 `stage_id`. 쓰기에는 `request_id` 필수 |
| 멱등성 | UUID 등 영문·숫자·`_`·`-` 1~128자. 동일 요청 재전송은 같은 ID와 본문을 사용한다. 다른 사용자 동작에는 새 ID를 쓴다. 같은 ID로 다른 본문을 보내면 충돌 |
| 권한 | 서버가 인증된 멤버의 역할을 조회한다. 본인 역할을 바꾸기 위한 `role`, 타인의 member ID를 요청에 넣지 않는다 |
| 시간 | `server_now`, `retry_at`, `reveal_at` 등은 Unix 밀리초. 서버 시각 기준 |
| 상태 동기화 | `game_public`은 팀 공통 진행 상태만 제공한다. Realtime 변경 후 `get-game`/`get-stage`로 본인 응답을 다시 조회한다 |
| 재접속 | 새 게임/새 역할을 만들지 않고 기존 세션으로 조회. 답안·힌트·보고 상태는 서버에서 복원 |
| UI 판정 | 해시나 정답을 내려받아 브라우저에서 채점하지 않는다. 제출 결과와 서버 상태를 표시한다 |

v2 데이터의 저장 버전은 `schemaVersion: 2`, 응답 버전 표시는 `schema_version: 2`다. 신규 응답은 기존 Snapshot에 `stage`와 `self.mission`, 진행 필드 등을 **추가**한다. PR-1 `projectStageV2()`는 이 중 정적 `stage`/`self` 조각만 만든다. 인증·현재 단계 제한·진행 상태 결합·힌트/보상 해제는 PR-2의 책임이다. 코스 전체나 미래 단계 JSON을 브라우저 번들에 import하지 않는다.

## 2. 콘텐츠와 공개 범위

정의 원본: [types.ts](../../web/supabase/functions/_shared/types.ts). 파일 경로와 타입 이름은 그대로 FE가 참조할 수 있다.

| 응답 필드 | 내용 |
|---|---|
| `stage` | 현재 단계의 ID·순서·이름·종류·도착 기준·quiet·scoring·공통 나레이션·completion·출처·사초 항목 이름 |
| `self.mission` | 본인의 `intro`, `scenes`, `steps`, `digit`(완료 숫자를 사용하는지 여부인 boolean), `asset`(있을 때). null이면 해당 역할 문제 없음 |
| `self.transfer_clue` | **지휘관 self만**. `{kind:"relay-frequency", label, value, target_step_id}`. 전달형 개인 단서이며 자동 공유하지 않는다 |
| `self.digit` | 기존 필드 유지. 보고 전 null, 보고 완료 후 본인의 완료 숫자. 다른 사람의 숫자는 제공하지 않는다 |
| `self.step_progress` | PR-2: 단계 ID별 `{status, attempts, method, record}`. status는 `locked/open/done/explained` |
| `self.hint_level`, `self.hints` | PR-2: 역할별 0~3, 해제된 힌트 본문만. 지휘관도 타 역할의 본문을 받지 않는다 |
| `self.explanations`, `self.rewards` | PR-2: 본인이 공개 조건을 충족한 단계의 본문만. 미공개 항목은 키 자체를 생략 |
| `game` 신규 필드 | PR-2/3: `stage_id`, `stage_kind`, `stage_phase`, `quiet`, 역할별 `step_done_count`, `hint_level`, `arrival_mask`, `confirm_mask`, `swap` |

역할 배열과 마스크 순서는 항상 `commander, scout, signal, cipher`다. 지휘관은 타인의 도착·진행·보고 ✓를 받으며 타인 문제, 답안 원문, 숫자, 힌트, 보상을 받지 않는다. `answerHash`, 비공개 rubric, QR 토큰은 모든 클라이언트 응답에서 제외한다. 알려진 필드만 복사하는 공개/개인 투영 함수를 사용한다.

`SceneText`의 `channel`은 narration/guide/screen, `trigger`는 다음 이벤트다. 동일한 텍스트를 자막으로 제공한다. 조회할 때마다 모든 장면을 재생하지 않는다.

| trigger | 표시 시점 |
|---|---|
| enter | 안전하게 멈춘 뒤 해당 단계/역할 진입 |
| role-reveal / ready | 보직 공개 / 출발 준비 |
| retry | 해당 역할 재시도 안내 |
| role-complete | 본인 역할 조사 완료 |
| scout-reported | 정찰원 보고 뒤 통신원에게만 재생 |
| reports-ready | 전원 보고 완료 |
| stage-complete | 자물쇠 등 해당 단계 완료 조건 충족 |

`requires`는 같은 거점의 `{role,stepId}` 참조다. `requiresReports`는 지정 역할의 **보고 완료** 조건이며 `requires`와 AND로 적용한다. 배열 배치 자체는 선행 조건이 아니므로 실제 조건을 명시한다. 지휘관 첫 판정은 나머지 세 역할의 보고 뒤 열린다. 통신원 단어 단계는 본인 주파수 단계 뒤 열리며 정찰원 보고를 선행 조건으로 삼지 않는다. 정찰원 보고는 해당 나레이션만 제어한다.

## 3. get-stage — PR-2

읽기 액션이므로 request_id는 필요 없다. 현재 진행 중인 단계와 본인 역할만 조회 가능하다. 먼저 기존 get-game으로 stage_id를 얻는다.

```json
{"action":"get-stage","game_id":"game-example","stage_id":"gate"}
```

아래는 응답의 **신규 개인 필드 부분 예시**다. 실제 응답에는 기존 Snapshot과 위 표의 stage 메타데이터가 함께 들어간다. 이 예시는 지휘관에게만 제공된다.

```json
{
  "self": {
    "role": "commander",
    "transfer_clue": {
      "kind": "relay-frequency",
      "label": "통신원에게 말로 전달할 가상 주파수",
      "value": "12.3",
      "target_step_id": "G-03.freq"
    },
    "hint_level": 0,
    "hints": [],
    "explanations": {},
    "rewards": {},
    "digit": null
  }
}
```

`self.mission.steps[]` 렌더링 형식 예시(합성):

```json
{
  "id": "T-01.words",
  "confirmed": true,
  "type": "words",
  "prompt": "합성 낱말 세 개를 입력하십시오.",
  "grading": "set-hash",
  "answerCount": 3,
  "sourceRequired": true,
  "sourceIds": ["S1"],
  "maxLen": 300,
  "requires": [{"role":"signal","stepId":"T-01.freq"}]
}
```

`confirmed:false`, `asset.url:null`, `scoring`의 null 수치는 초안 상태다. 이를 FE에서 임의의 사진·좌표·점수로 보완하지 않는다. 운영 시드는 이 상태를 거절한다.

## 4. submit-step — PR-2

```json
{
  "action": "submit-step",
  "request_id": "example-submit-001",
  "game_id": "game-example",
  "stage_id": "gate",
  "step_id": "G-03.words",
  "answer": ["가상낱말다", "가상낱말가", "가상낱말나"],
  "source": {"text":"확인한 자료의 이름과 위치", "source_id":"S1"},
  "method": "official_digital"
}
```

| 유형/채점 | answer 형식과 UI |
|---|---|
| truefalse/hash | statements 순서대로 `"true"`/`"false"` 문자열 배열. JSON boolean 아님 |
| choice/hash | 선택 번호 문자열 `"1"` … `"N"`. 0부터 세지 않는다 |
| frequency/hash | `"12.3"` 등 소수점 한 자리 이하의 문자열. 서버는 잘못된 소수를 반올림하지 않는다 |
| words/set-hash | 단어 문자열 배열, 순서 무관. answerCount개, 중복 금지 |
| multi-choice·spot-correct/set-hash | 선택 번호 문자열 배열, 순서 무관·중복 금지 |
| order/order-hash | 모든 선택 번호를 정렬한 문자열 배열. 누락·중복 금지 |
| match/map-hash | fields의 ID→선택 번호 객체. 각 필드와 서로 다른 선택지를 연결. 키 누락·추가 금지 |
| text·observation/hash | 문자열 입력. 관찰 단계 중 이름만 해시 검증 |
| record-form/record | 필드 ID→문자열 객체. 필수 필드와 글자 수만 검사 |
| text/open·record | 문자열. 내용의 정오 판정 없음 |
| fill-blank/open·record | fields가 있으면 필드 ID→문자열 객체 |
| confirm/confirm | `"confirmed"` 문자열. 프롤로그는 PR-3 set-ready에 연결 |

자유 서술 예제:

```json
{
  "action":"submit-step", "request_id":"example-record-001",
  "game_id":"game-example", "stage_id":"gate", "step_id":"G-02.record",
  "answer":{"shape":"관찰한 형태 메모","source":"확인한 안내 위치","memo":"관찰 메모"},
  "source":{"text":"확인한 안내 위치"}, "method":"field"
}
```

각 문자열은 NFC·양끝 공백 제거·연속 공백 1칸 정규화 후 기본 300 Unicode 문자 이하다. 대소문자를 바꾸거나 단어 사이 공백을 삭제하지 않는다. `sourceRequired:true`면 source.text와 method가 필요하다. source_id는 제공할 경우 코스에 있는 ID여야 한다. record의 source 필드와 별도의 source는 각각 관찰 기록과 확인 방식 메타데이터이며 FE는 같은 사용자 입력에서 함께 채워도 된다.

`method`: 참가자는 `field`(현장 확인), `official_digital`(공식 디지털 자료 확인)만 선택한다. `simulated`는 dev 전용 검증, `explained`는 서버의 해설 경로, `proxy`는 D3 확정 뒤 PR-6에서만 생성한다. 클라이언트가 explained를 보내 정답 검증을 우회할 수 없다.

성공은 갱신된 Snapshot과 아래 result를 반환한다. 채점 오답은 통신 오류가 아니라 `accepted:false`; 공개 상태에 제출 답을 넣지 않는다.

```json
{"result":{"step_id":"G-03.words","accepted":true,"status":"done"}}
```

```json
{"result":{"step_id":"G-03.words","accepted":false,"status":"open"}}
```

## 5. request-hint·보고·개방 — PR-2

```json
{"action":"request-hint","request_id":"example-hint-001","game_id":"game-example","stage_id":"gate","target_role":"signal","level":1}
```

지휘관만 요청한다. 힌트 단계는 **거점 내 역할별** 0→1→2→3이며 문제마다 초기화하지 않는다. 단계 건너뛰기를 거절하고 같은 request_id 재전송은 감점을 반복하지 않는다. 응답 result는 `{"target_role":"signal","level":1}`이며 본문은 대상 통신원이 get-stage로 가져온 self에만 들어간다. 프롤로그에는 힌트 요청을 허용하지 않는다. 단계별 감점과 무힌트 보너스는 확정된 코스 설정만 사용한다(D5 미확정).

3단계 힌트에 따른 다단계 해설 처리와 읽음 확인의 세부 범위는 PR-2에서 확정한다. **전원 해설 읽음 확인 뒤 지휘관이 별도 개방**한다는 사용자 결정은 확정이며 일반 open-lock의 시도·감점 규칙은 유지한다.

| action | 추가 요청 필드 | 조건·결과 |
|---|---|---|
| submit-report | 없음 | 본인 단계 완료 뒤 구두 보고 확인. ✓ 갱신, 본인 self.digit만 공개 |
| open-lock | `digits:[8,6,0,9]` (합성 예시) | 지휘관·전원 보고 후. 3회/−10/60초 기존 규칙 유지(D4 기본값) |
| confirm-explanation | 없음 | 본인이 필요한 해설을 읽었다고 확인. 서버의 해설 공개 조건 충족 필요 |
| open-after-explanation | 없음 | 전원 읽음 확인 뒤 지휘관 실행. 일반 자물쇠의 시도·감점 계산을 변경하지 않음 |

별도 개방 결과에는 `method:"explained"`, 표시 문구 `해설 확인 후 복원`을 남긴다. 최종 API 키/읽음 확인 대상은 PR-2에서 검증과 함께 고정한다. 미완료 조사를 일반 숫자 입력으로 생략할 수 없다.

## 6. 후속 액션 계약 초안

모든 쓰기에 공통 키 game_id/request_id, 단계 액션에는 stage_id를 보낸다. 응답은 갱신된 Snapshot + result이며 아래는 각 액션의 추가 부분이다.

| PR / action | 추가 요청 예시 | 서버 권한·전이 / result 초안 |
|---|---|---|
| PR-3 propose-swap | `{"target_member_id":"member-b"}` | 30초 창·팀 1회. pending 생성 / `{swap_pending:true}` |
| PR-3 respond-swap | `{"accept":true}` | 제안받은 당사자만. 동의 후 두 역할 교환 / `{swapped:true}` |
| PR-3 set-ready | `{"ready":true}` | 본인 출발 확인 문구 확인 / `{ready:true}` |
| PR-3 report-arrival | `{"method":"gps"}` 또는 `{"method":"qr","qr_token":"<개인 현장 토큰>"}` | 본인 도착만 기록. 원시 좌표 없음 / `{arrived:true}` |
| PR-3 report-arrival 수동 | `{"method":"manual","target_member_id":"member-b"}` | 지휘관·서버 30초 대기 뒤 대체 도착. 대행 사실 보존 |
| 기존 depart-next-site | 없음 | 지휘관·현재 단계 완료. 다음 이동으로 전환, 문제 화면 잠금 |
| PR-4 select-alt-mode | `{"mode_id":"outside"}` | 지휘관·코스에 정의된 용봉관 모드. 결과에 ‘실내 관람 아님’ |
| PR-5 draft-memorial-record | `{"text":"팀이 함께 남길 추모 기록"}` | 지휘관 초안, 수정 때 추모 확인 초기화 / `{draft_version:1}` |
| PR-5 confirm-stage | `{"draft_version":1}` | 본인이 현재 추모 기록 읽음 확인. 4명 확인 후 사초③ |
| PR-5 submit-retro | `{"text":"확인한 기록과 남은 질문"}` | 본인의 봉지 회고 / `{saved:true}` |
| PR-5 draft-joint-record | `{"words":["가치 가","가치 나"],"text":"공동 문장","reason":"선택 이유"}` | 지휘관, 봉지 초안 변경마다 동의 초기화 / `{draft_version:1}` |
| PR-5 consent-joint-record | `{"draft_version":1}` | 본인·현재 초안 버전 동의. 4명 동의 후 종료 |
| PR-5 get-result | 없음(request_id 불필요) | 종료 후. 사초·확인 방식·힌트·보고·개방 통계, 정답 평문 없음 |
| PR-6 create-upload-url | 미확정 | D3·D6 확정 전 요청·저장·업로드 기능 없음 |

추모의 벽은 `memorial_record:{draft_version,text,confirm_mask}` 전용 상태를 사용한다. 봉지의 `joint_record`와 공유하지 않는다. 봉지에만 joint_record를 공개한다. 추모에서는 점수·감점·숫자·자물쇠·카운트다운·진동을 표시하지 않는다. 정책 미확정 사진 업로드를 준비 완료의 필수 조건으로 삼지 않는다(D6).

## 7. 오류와 FE 처리

기존과 동일한 최상위 오류 형식:

```json
{"code":"STEP_LOCKED","message":"선행 단계 또는 보고가 완료되지 않았다.","retry_at":null}
```

아래 신규 코드와 HTTP 상태는 후속 구현 시 고정할 목표 계약이다. 현재 v1 일부 오류의 HTTP 400 처리와 신규 409 처리 차이는 연결 PR에서 조정하며 FE는 code를 우선 사용한다.

| HTTP | code | FE 처리 |
|---|---|---|
| 400 | BAD_REQUEST / BAD_ANSWER / SOURCE_REQUIRED | 입력 형식·필수 항목 안내. 원문 답안 반사 금지 |
| 401 | UNAUTHENTICATED | 익명 세션 복원 후 같은 요청 재전송 |
| 403 | FORBIDDEN | 권한 없는 액션 숨김. role 변경 요청으로 재시도 금지 |
| 404 | NO_GAME / NO_STAGE / NO_STEP | 현재 게임 조회, 만료/잘못된 ID 안내 |
| 409 | WRONG_PHASE / STALE_STAGE | get-game 후 현재 단계로 이동 |
| 409 | STEP_LOCKED / REPORTS_REQUIRED | 선행 진행·구두 보고 완료 기다림 |
| 409 | HINT_ORDER / EXPLANATION_REQUIRED | 현재 힌트 단계·해설 읽음 상태 다시 조회 |
| 409 | IDEMPOTENCY_CONFLICT | 다른 본문 재사용 오류. 새 사용자 동작만 새 ID로 전송 |
| 409 | SWAP_CLOSED / SWAP_USED / STALE_DRAFT | 서버 창·교환 여부·초안 버전 재조회 |
| 429 | COOLDOWN | retry_at까지 서버 기준 대기. 새로고침으로 초기화 금지 |
| 503 | CONTENT_UNCONFIRMED | 운영 콘텐츠 미확정. 임의 대체 정답·수치 사용 금지 |
| 500 | SERVER_ERROR | 답안/개인 단서를 로그에 남기지 않고 재조회·재시도 |

## 8. 시드·정규화와 미확정 자료

공개 파일은 `codex-handoff-v2/data/courses/jnu-v2.course.json`, 합성 형식 예시는 `jnu-v2.private.example.json`이다. 실제 값은 사용자가 같은 디렉터리의 `jnu-v2.private.local.json`에 작성하며 커밋하지 않는다. 예시는 synthetic:true라서 운영 시드에 사용할 수 없다.

비공개 파일은 schemaVersion/courseId/synthetic/stages를 갖고, 거점별 roles에 완료 숫자·역할별 힌트 3개·지휘관 전달형 개인 단서, steps에 정답·해설·보상·자유 서술 필수 항목을 둔다. seed 결과에는 answer 대신 answerHash만 저장한다. 전달형 단서의 평문 주파수는 승인된 예외이며 통신원 검증 해시와 같은 값인지 seed에서 대조한다. 실제 private 파일은 에이전트가 만들지 않았다.

`web`에서 실행:

```sh
npm run seed:course -- --validate-only ../codex-handoff-v2/data/courses/jnu-v2.course.json ../codex-handoff-v2/data/courses/jnu-v2.private.local.json
```

검증 전용은 ANSWER_SALT만 필요하며 DB에 접속하지 않는다. 옵션을 빼면 기존처럼 service role로 courses_private에 불변 리비전을 INSERT한다. 확정한 실제 코스에만 사용한다. seed와 Edge의 ANSWER_SALT는 동일하고 고정 기본값은 없다. 이 명령은 합성 코스의 DB 등록을 거절한다. PR-0의 dev 전용 seed 경로만 허용하며 prod에서 합성 코스를 사용하지 않는다.

**PR-2 연결 전에는 v2 코스를 ACTIVE_COURSE_ID로 설정하지 않는다.** PR-1에는 v2 실행 엔진·새 테이블·클라우드 적용이 없다. 저장소 초안은 confirmed:false이므로 검증 실패가 정상이다. G-01 근거 선택지는 비어 있으며 실제 근거·짝의 확정 없이 통과시킬 수 없다. 시연 플래그도 잘못된 선택지·비공개 답안 형식 검증을 생략하지 않는다.

해시는 `sha256(UTF-8(salt + courseId + stepId + canonicalAnswer))`다. v1 해시는 그대로 유지한다.

| 채점 | canonicalAnswer |
|---|---|
| hash 문자열/주파수 | 정규화된 문자열의 JSON 직렬화(따옴표 포함). 주파수는 소수 한 자리 |
| hash 진위 | 문장 순서대로 문자열 배열 JSON |
| set-hash | 정규화 후 중복 거절, JS 기본 문자열 정렬(로케일 무관), 배열 JSON |
| order-hash | 제출 순서 그대로 배열 JSON |
| map-hash | fields.id를 JS 기본 문자열 정렬 후 `[[key,value],...]` JSON. 객체 삽입 순서는 무관 |

courseId는 소문자로 시작하는 ID, stepId는 `G-03.freq` 형태의 대문자 장면 ID로 구분한다. 선택 번호는 1부터 시작하는 십진 문자열이며 선행 0은 거절한다. map은 정확한 필드 집합, order는 전체 선택지의 순열, set은 중복 없는 집합이어야 한다. 숫자·true/false를 JSON number/boolean으로 보내는 자동 형변환은 지원하지 않는다.

## 9. 확정 필요/결정 사항

- 확정: 전달형 개인 단서는 서버 비공개 자료와 지휘관 self에만 둔다. 공개/다른 역할 응답 제외 테스트를 추가했다.
- 확정: 힌트는 역할별 3단계. 주파수 전달은 별도 개인 단서다.
- 확정: G-01 근거 선택지·짝은 만들지 않고 미확정으로 남겨 운영 시드를 차단한다.
- 확정: 해설 확인 후 개방은 별도 액션. 추모의 벽 공동 기록은 봉지와 분리한다.
- 기본값 적용 — 확정 필요(D1~D7): 자유 서술은 형식 검사, 전원 도착 15m/20m/5초, 진행자 기능 제외, 기존 자물쇠 규칙, 점수 미정, 사진 업로드 꺼짐, 4인 고정. D5 미확정 수치는 null로 표시하고 운영 시드에서 거절한다.
- PR-2에서 확인: 역할 힌트 3단계가 미완료 여러 문제를 처리하는 범위, 해설 읽음 확인 대상. PR-6은 D3·D6 확정 전 시작하지 않는다.
