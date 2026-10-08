# BE v2 API 계약 — PR-2 정문 구현 / 후속 액션 초안

2026-10-08 · FE: 이환희 / BE·Infra: 김종연 / 리뷰·머지: 김동욱

화면 개발 시작 순서·기존 v1 화면의 전환 지점·연결 준비는 [FE 인수인계 README](../fe/README.md)를 먼저 참고한다. 요청·응답 세부 형식은 이 문서가 기준이다.

**PR-2는 정문 서버 액션을 구현한다.** 로컬 `/api/game`과 Supabase Edge `game`이 같은 v2 엔진을 사용하며, 배포·DB 적용은 사용자가 별도로 수행한다. 실제 배포 완료를 의미하지 않는다. PR-3의 역할 교환·도착 확장, PR-5의 추모·봉지 액션은 아직 구현하지 않았다. 기존 v1 `Snapshot`, 엔진, 데모는 유지한다. 예제의 주파수·숫자·문제·본문은 합성이며 실제 시나리오 값이 아니다.

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

v2 데이터의 저장 버전은 `schemaVersion: 2`, 응답 버전 표시는 `stage.schema_version: 2`다. 신규 응답은 기존 Snapshot에 `stage`와 `self.mission`, 진행 필드 등을 **추가**한다. 정적 투영과 현재 게임 상태를 결합하며, 인증·현재 단계 제한·힌트/보상 공개 조건을 서버가 확인한다. 코스 전체나 미래 단계 JSON을 브라우저 번들에 import하지 않는다. `course.sites`에는 기존 호환용 장소 메타데이터만 둔다.

## 2. 콘텐츠와 공개 범위

정의 원본: [types.ts](../../web/supabase/functions/_shared/types.ts). 전체 v2 응답 타입은 [engine-v2.ts](../../web/supabase/functions/_shared/engine-v2.ts)의 `SnapshotV2`를 **type-only import**로 참조할 수 있다. 서버 엔진을 FE 런타임에서 import하지 않는다.

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

역할별 보고·도착·확인 마스크 순서는 `commander, scout, signal, cipher`다. 자물쇠 숫자·locked_mask·correct_mask는 `stage.completion.order` 순이며 정문에서는 같은 순서다. 지휘관은 타인의 도착·진행·보고 ✓를 받으며 타인 문제, 답안 원문, 힌트, 보상을 받지 않는다. 타인 완료 숫자는 구두 전달 후 지휘관이 직접 입력해 맞힌 잠금 칸으로만 복원되며 자동 공유하지 않는다. `answerHash`, 비공개 rubric, QR 토큰은 모든 클라이언트 응답에서 제외한다. 알려진 필드만 복사하는 공개/개인 투영 함수를 사용한다.

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

### 3.1 FE용 전체 Snapshot mock

아래 12개 JSON은 **서버 구현 전의 응답 계약 초안**이며, FE가 `get-stage` 응답을 대체하는 mock으로 사용할 수 있다. 실제 API에서 수집한 응답이나 실행 가능한 코스 seed가 아니다. 각 파일 자체가 하나의 전체 Snapshot 객체다. 공통 파일 병합이나 별도 `snapshot` wrapper 없이 JSON을 그대로 응답 본문으로 사용한다.

| 역할 | 힌트 사용 전 | 힌트 사용 후 | 정문 단계 완료 후 |
|---|---|---|---|
| commander | [before-hint](fixtures/get-stage.gate.commander.before-hint.json) | [after-hint](fixtures/get-stage.gate.commander.after-hint.json) | [stage-completed](fixtures/get-stage.gate.commander.stage-completed.json) |
| scout | [before-hint](fixtures/get-stage.gate.scout.before-hint.json) | [after-hint](fixtures/get-stage.gate.scout.after-hint.json) | [stage-completed](fixtures/get-stage.gate.scout.stage-completed.json) |
| signal | [before-hint](fixtures/get-stage.gate.signal.before-hint.json) | [after-hint](fixtures/get-stage.gate.signal.after-hint.json) | [stage-completed](fixtures/get-stage.gate.signal.stage-completed.json) |
| cipher | [before-hint](fixtures/get-stage.gate.cipher.before-hint.json) | [after-hint](fixtures/get-stage.gate.cipher.after-hint.json) | [stage-completed](fixtures/get-stage.gate.cipher.stage-completed.json) |

같은 상태의 파일 4개는 동일한 팀을 각 역할에서 조회한 응답이다.

- `before-hint`: 전원 도착했고 보고·완료 문제는 없으며 힌트를 사용하지 않았다. 지휘관 첫 단계는 다른 세 역할의 보고를 기다리며 잠겨 있다.
- `after-hint`: 지휘관이 **통신원에게만 1단계 힌트**를 해제한 직후다. 모든 역할의 `game.hint_level.signal`은 1이지만, 힌트 표시 문구는 통신원의 `self.hints`에만 있다. 다른 세 역할의 `self.hint_level`은 0, `self.hints`는 빈 배열이다. 힌트 사용만으로 단계가 완료되거나 보고되지 않는다.
- `stage-completed`: 전원 단계 완료·보고·일반 자물쇠 개방을 마치고 다음 거점으로 출발하기 전이다. `game.status`는 `playing`, `site_phase`는 `cleared`, `stage_phase`는 `done`이며 현재 거점은 여전히 `gate`다. 통신원 힌트 1단계 사용 이력도 유지한다. 전체 게임 종료나 해설 개방 경로의 예시는 아니다. PR-2는 거점 완료 후에도 `get-stage`로 이 상태를 재조회한다.

최상위에는 기존 필수 필드 `server_now`, `version`, `course`, `current_site`, `game`, `self`와 신규 `stage`를 넣었다. `version`과 `game.version`은 같으며 조회 응답의 `result`는 생략했다. `stage.schema_version`은 2다. `self.clue`는 v2에서 `null`로 유지하고 본인 단계는 `self.mission`으로 표시한다. 기존 `SiteInfo`의 `sacho.body`는 미해제 위치에서 빈 문자열로 남기고, 완료 후 `game.acquired_sites`에만 합성 표시 문구를 넣었다. `course.sites`의 다음 거점은 호환용 기본 정보뿐이며 미래 미션을 포함하지 않는다.

추가 필드의 mock 구조는 다음과 같다. 역할 마스크는 `commander, scout, signal, cipher` 순서의 boolean 배열이고, 역할별 수치는 역할 이름을 키로 하는 객체다. 방장은 정찰원으로 설정해 `is_host`와 지휘관 권한을 구분한다.

| 필드 | mock 구조 / 의미 |
|---|---|
| `game.step_done_count`, `game.hint_level` | `Record<Role, number>` / 완료한 문제 수, 역할별 해제한 힌트 단계 |
| `game.arrival_mask`, `game.confirm_mask` | boolean 4개 / 도착 여부, 단계 확인 여부. 일반 자물쇠 경로인 정문 예시에서는 확인 마스크가 모두 false |
| `game.swap` | `{window_ends_at:number\|null, used:boolean, pending:null}` / 교환 창이 닫힌 예시. pending 요청 구조는 PR-3에서 확정 |
| `self.step_progress` | 본인 step ID만 키로 사용. 필수 `status`, `attempts`; 완료 시 `method`, 자유 기록 단계만 `record`를 추가 |
| `self.hints` | 해제된 본인 힌트의 문자열 배열. 아직 해제되지 않은 단계의 placeholder도 넣지 않음 |
| `self.explanations`, `self.rewards` | 해설은 빈 객체. 보상은 완료 후 통신원에게만 `G-03.freq` 키의 합성 표시 문구를 넣고 나머지는 빈 객체. 미해제 항목의 키는 생략 |

**값을 가린 범위:** 정답·정답 해시·rubric·QR 토큰·salt·서비스 키·비공개 원본·실제 시나리오 문구를 넣지 않았다. 문제·선택지·안내·자유 기록·힌트 표시 문구는 모두 새로 만든 합성 문구다. 단계 ID·필드 이름·역할 enum만 계약과 맞췄다. `grading`의 `hash` 등은 채점 방식 이름이며 해시 값이 아니다.

- `self.digit`와 지휘관의 `self.lock.digits`는 **완료 후 파일에서도 전부 null로 가렸다.** 실제 서버의 보고 후 본인 숫자 공개 및 지휘관이 직접 제출해 잠근 숫자 복구 규칙을 바꾸는 결정이 아니다. 이 fixture만으로 숫자 획득·숫자 재접속 복구를 시험할 수는 없다. 완료 UI는 공개 상태의 `locked_mask`·`site_phase`·`acquired_sites`로 확인한다.
- 지휘관 `self.transfer_clue.value`는 주파수 대신 합성 표시 문자열이다. 입력 정답으로 사용할 수 없다. 다른 역할 파일과 공통 상태에는 이 필드가 없다.
- `confirmed:false`, null 좌표·D5 미정 수치를 유지한다. 점수 100·고정 시각·호출명·자료 URL·완료 상태는 화면 연습용이다. G-01 근거 선택지는 빈 배열이며 완료 예시를 만들었다고 운영 자료가 확정되거나 seed 검증을 통과하는 것은 아니다.

FE의 테스트/Storybook/mock 핸들러에서는 예를 들어 다음과 같이 사용할 수 있다. 이는 `web/` 기준 경로이며 실제 앱에 mock 라우트를 추가한 것은 아니다. 역할은 mock 시나리오 선택에만 쓰고 실제 요청의 권한 입력으로 보내지 않는다.

```ts
import signalAfterHint from "../docs/be/fixtures/get-stage.gate.signal.after-hint.json";

// get-stage mock 핸들러의 응답 본문. 변경할 때는 원본 fixture를 복제한다.
const snapshot = structuredClone(signalAfterHint);
// 핸들러 안에서: return Response.json(snapshot);
```

`server_now` 등은 고정된 Unix 밀리초이므로 화면 시간도 fixture의 서버 시각을 기준으로 모의한다. 이 파일은 서버 구현 전에 작성한 **문서 초안이며 FE mock으로 계속 사용 가능**하다. PR-2의 `web/tests/api-v2.test.ts`는 실제 Next POST 핸들러와 로컬 저장소를 통해 받은 `get-stage` JSON을 12개 예시의 필수 필드·타입·역할별 공개 범위·상태 구조와 대조한다. 가린 숫자·문구·시각·선택지 수는 실값 비교 대상이 아니다. 예시의 교환 종료 시각은 후속 화면 초안으로, PR-2 실제 `game.swap.window_ends_at`은 null이다. 클라우드·실기기 시험과는 구별한다. [결정 기록](DECISIONS.md) 참조.

### 3.2 개인 필드 발췌

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

각 문자열은 NFC·양끝 공백 제거·연속 공백 1칸 정규화 후 기본 300 Unicode 문자 이하다. **기본 판정은 대소문자·내부 공백을 구분한다.** 단계에 `normalize:{caseInsensitive:true,ignoreSpaces:true}`를 지정하면 텍스트·관찰 이름의 hash, 낱말의 set-hash에만 선택적으로 적용한다. 두 옵션은 각각 생략 가능하며 기본 false다. 자유 기록·선택 번호·주파수에는 적용하지 않는다. seed와 제출 판정은 같은 함수를 쓰며, 정규화 후 같은 낱말이 중복되면 거절한다. 정규화 설정을 변경하는 코스는 새 리비전으로 등록한다.

`sourceRequired:true`면 source.text와 method가 필요하다. source_id는 코스에 존재하고 해당 단계의 sourceIds 범위에 있어야 한다. record의 source 필드와 별도의 source는 각각 관찰 기록과 확인 방식 메타데이터이며 FE는 같은 사용자 입력에서 함께 채워도 된다. 같은 미완료 문제의 제출은 최소 1초 간격이며 형식 오류는 시도 횟수에 포함하지 않는다. 채점 오답은 문제 시도 횟수만 늘리고 자물쇠 시도·감점에는 영향을 주지 않는다.

`map-hash`는 **1:1 연결만** 지원한다. G-01의 실제 근거 선택지·정답 짝은 미확정이며 같은 선택지를 여러 사건에 쓰는 구성은 등록할 수 없다. 주파수 UI는 소수점 한 자리 이하의 문자열을 보내야 하며 `12.30` 같은 두 자리 입력도 거절한다.

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

3단계 힌트는 **대상 역할의 미완료 문제 전체**를 explained로 처리하고 본인에게만 해설을 공개한다(2026-10-08 사용자 확정). 이미 done인 문제의 기록·시도·방식은 유지한다. done/explained 문제의 해설만 공개하고, **보상은 정답을 맞혀 done인 문제만 본인에게 공개**한다. 미완료 역할이나 선행 보고를 건너뛰어 보고할 수 없다. 전원 해설 읽음 확인 뒤 지휘관이 별도 개방하며 일반 open-lock의 시도·감점 규칙은 유지한다.

| action | 추가 요청 필드 | 조건·결과 |
|---|---|---|
| submit-report | 없음 | 본인 단계 완료 뒤 구두 보고 확인. ✓ 갱신, 본인 self.digit만 공개 |
| open-lock | `digits:[8,6,0,9]` (합성 예시) | 지휘관·전원 보고 후. 3회/−10/60초 기존 규칙 유지(D4 기본값) |
| confirm-explanation | 없음 | 본인이 필요한 해설을 읽었다고 확인. 서버의 해설 공개 조건 충족 필요 |
| open-after-explanation | 없음 | 전원 읽음 확인 뒤 지휘관 실행. 일반 자물쇠의 시도·감점 계산을 변경하지 않음 |

별도 개방 결과는 `{"opened":true,"method":"explained","label":"해설 확인 후 복원","sacho_id":"<현재 사초 ID>"}`다. 각 역할은 본인 모든 문제가 done/explained로 해설이 공개된 뒤 confirm-explanation을 호출한다. 서버는 읽음 버튼 확인 사실을 저장하며 실제 독해를 판별하지 않는다. 공개 game.confirm_mask는 commander/scout/signal/cipher 순이다. 개방에는 전원 조사·보고와 네 역할 확인이 모두 필요하다. 별도 개방은 자물쇠 시도·감점·무힌트 보너스를 추가하지 않는다. 일반 개방은 3회/오답 −10/소진 후 60초마다 1회를 그대로 적용한다.

사초①은 `games_private.state.v2.sacho.gate`에 저장한다. `eventOrder`는 순서 검증 여부·확인 방식만 저장하고 정답 배열은 저장하지 않는다(사용자 확정). 정찰원의 조형물 관찰은 `observations`, 사건 기록은 `eventRecords`, 사용 자료·확인 방식은 `sources`로 분리한다. 기록 본문은 game_public·타 역할 self·game_events에 포함하지 않는다. 사초 통합 조회·최종 결과 화면은 PR-5 범위다.

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

아래 HTTP 상태는 PR-2에서 공통 오류 매핑으로 연결했다. SWAP_CLOSED/SWAP_USED/STALE_DRAFT는 후속 PR의 초안이다. FE는 code를 우선 사용하며 retry_at은 대기 시간이 있을 때만 제공된다. 비공개 거점·역할·판정 자료 누락은 답안이나 내부 예외를 반사하지 않는 CONTENT_UNCONFIRMED(503)로 처리한다.

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
| 429 | COOLDOWN / RATE_LIMITED | retry_at이 있으면 서버 기준 대기. 새로고침으로 초기화 금지 |
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

**PR-2 마이그레이션·Edge 재배포·FE의 v2 대응 전에는 ACTIVE_COURSE_ID를 전환하지 않는다.** 적용 순서는 [PR-2 적용 안내](PR_2_APPLY.md)를 따른다. 기존 r1은 v1이며 그대로 유지한다. 정문 API 검증용 새 v2 합성 리비전은 dev 전용 seed의 `--schema-version 2`로 등록한다. 실제 공개 초안은 confirmed:false이며 G-01 근거 선택지·짝이 없어 검증 실패가 정상이다. dev 허용 플래그도 잘못된 답안 형식 검증을 생략하지 않는다.

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
- 확정: 정규화 옵션은 단계별 선택 적용, 기본 판정 유지. 힌트 3단계는 대상 역할 미완료 문제 전체. 사초 사건 순서는 검증 결과만 보존한다.
- 결정 대기: 공개 코스의 정답 문장 노출 처리, G-01 근거·1:1 짝, D5·D8·D9 수치/시간 점수/팀 랭킹 범위. 기존 병합 여부가 이 결정을 확정한 것은 아니다. PR-6은 D3·D6 확정 전 시작하지 않는다.

## 10. PR-2 실행 범위

현재 v2는 기존 4인 로비→역할 배정→준비→출발 흐름으로 정문에 진입한다. 프롤로그 문제와 30초 교환 창은 PR-3에서 연결한다. `report-arrival`은 본인 도착만 기록하며 dev 합성 코스에서 `method:"simulated"`로 네 명 모두 도착을 검증할 수 있다. `gps`는 확정된 도착 설정에서만, `manual`은 지휘관 본인에게 출발 30초 후 허용한다. QR·target_member_id 대행은 PR-3 이전에 사용하지 않는다. 실제 GPS 후보와 반경은 이번 PR에서 변경하지 않았다.

정문 완료 뒤 get-stage는 계속 정문을 반환한다. 이 단계에서 전체 게임을 종료하지 않으며 dev 합성 코스에는 다음 거점이 없다. FE 화면·랭킹·시간 점수 계산·추모·봉지는 이번 PR에 포함되지 않는다. 서버 이벤트에는 시각·역할·액션과 제한된 판정 메타데이터만 저장해 후속 통계를 준비한다. 합성 수치는 정책 확정을 뜻하지 않는다.
