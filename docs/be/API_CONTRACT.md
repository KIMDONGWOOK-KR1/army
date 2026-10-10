# BE v2 API 계약 — 정문·용봉관·추모의 벽·봉지

2026-10-10 갱신 · FE: 이환희 / BE·Infra: 김종연 / 리뷰·머지: 김동욱

**PR-5에서 추모의 벽 공동 확인·봉지 회고·최종 결과를 연결했다.** [PR-5 적용 안내](PR_5_APPLY.md)를 따른다.

**PR-4에서 용봉관 이동·조사·자료 전달·외부 대체 모드·사초②를 추가했다.** 상세 계약은 11절, 수동 DB·Edge·코스·웹 적용은 [용봉관 적용 안내](YONGBONG_APPLY.md)를 따른다. 기존 정문 fixtures는 유지하며 용봉관의 전체 응답 예시로 사용하지 않는다.

화면 개발 시작 순서·기존 v1 화면의 전환 지점·연결 준비는 [FE 인수인계 README](../fe/README.md)를 먼저 참고한다. 요청·응답 세부 형식은 이 문서가 기준이다.

정식 디자인 전 합성 코스로 요청 흐름을 확인하는 `/verify` UI와 실행 방법은 [정문 확인용 UI 안내](../fe/VERIFY_UI.md)를 참고한다. 이 화면은 실제 API를 호출하며 아래 mock·서버 계약을 변경하지 않는다.

**PR-2는 정문 서버 액션을 구현한다.** 로컬 `/api/game`과 Supabase Edge `game`이 같은 v2 엔진을 사용하며, 배포·DB 적용은 사용자가 별도로 수행한다. 실제 배포 완료를 의미하지 않는다. 2026-10-09 GPS 필수 도착을 추가했고 역할 교환은 사용자 결정으로 금지한다. PR-5의 추모·봉지·최종 결과는 12절의 구현 계약을 따른다. 시간 점수·랭킹은 별도 확정 후 추가한다. 기존 v1 `Snapshot`, 엔진, 데모는 유지한다. 예제의 주파수·숫자·문제·본문은 합성이며 실제 시나리오 값이 아니다.

### 2026-10-09 GPS 도착 계약

- 지정 좌표 중심 **반경 10m**, 유효 표본 3개 평균, 반경 안 5초 유지. 정확도 40m 초과·5초 초과 측위 공백·오류 시 연속 체류를 초기화한다. 위치는 기기 메모리에서만 사용하고 서버·localStorage에 원시 좌표를 저장하지 않는다.
- `report-arrival`: `{action:"report-arrival", game_id, stage_id, request_id, method:"gps"}`. 본인만 기록하며 네 명 모두 도착해야 문제·힌트·보고·자물쇠가 열린다. 응답 형식은 기존 Snapshot과 동일하며 `game.arrival_mask`와 `game.site_phase`로 진행을 확인한다.
- `manual`, `manual:true`, `qr`는 `FORBIDDEN`. 확정 GPS 코스의 `simulated`도 `FORBIDDEN`. GPS 좌표·전원 조건·반경·5초 설정이 유효하지 않으면 `CONTENT_UNCONFIRMED`. 도착 전 미션 액션은 `WRONG_PHASE`.
- `method:"simulated"`는 기존 dev ID의 `demo:true`이면서 `arrival.confirmed:false`인 실내 개발 시연에만 남긴다. `v1-gate-gps`는 문항이 시연용이어도 `arrival.confirmed:true`이므로 모의 도착을 허용하지 않는다.
- 도착 기록은 재접속 시 유지된다. 이번 조건은 미션 최초 개방 조건이며 도착 후 반경을 벗어날 때 미션을 다시 잠그는 기능은 아니다.
- 브라우저가 GPS를 판정하고 서버가 인증된 사용자의 도착 보고를 신뢰한다. 직접 API 호출·위치 조작을 서버에서 물리적으로 인증하는 방식은 아니다.
- 확정 좌표·현장 시험 및 새 코스 리비전 적용은 [GPS 적용 안내](GPS_APPLY.md)를 따른다. 합성 fixtures는 계속 합성 좌표·상태를 사용한다.

## 1. 전송·권한·재접속

2026-10-09 UI 복원 추가: `game.completion`, `self.journal`, 완료된 장소의 선택형 공개 사초 보상을 추가했다. 아래 합성 fixtures 12개에도 반영했다. 로컬 구현과 별개로 기존 Supabase 응답에 적용하려면 Edge 재배포가 필요하다. [UI 복원 안내](../fe/UI_RESTORATION.md)를 참고한다.

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
| `game.completion` | 현재 단계 완료 전 `null`, 완료 후 `{at, method:"field"\|"explained", label}`. label은 `조사 후 복원` 또는 `해설 확인 후 복원`. 새로고침·다른 역할 조회에도 유지 |
| `self.journal` | 완료 전 `[]`. 완료된 단계별 `{stage_id, name, completed_at, method, sections, entries}`. entries는 본인 역할만 포함하며 `{step_id, prompt, verified, method, record?, source?, explanation, reward?}`. source는 `{text, source_id?}`. 정답 배열·해시·숫자·전달 단서는 포함하지 않음 |
| `current_site.sacho`, `course.sites[].sacho`, `game.acquired_sites[].sacho` | 이름·ID에 더해 완료된 장소에만 선택형 `char`, `body` 공개 보상 제공. 개인 자유 기록과 다른 공통 본문이며 미완료 장소에는 공개하지 않음 |
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

위 단계 구성은 기본 정문 시나리오 기준이다. 별도 dev용 [`v1-gate` preset](LEGACY_GATE_DEV.md)은 기존 v1처럼 역할별 한 문제를 병렬로 풀며 지휘관 문제에 `requiresReports`를 두지 않는다. FE는 문제 ID·개수·선행 조건을 고정하지 않고 응답의 `mission.steps`와 진행 상태를 따른다. 자물쇠의 전원 보고 조건은 동일하다.

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

최상위에는 기존 필수 필드 `server_now`, `version`, `course`, `current_site`, `game`, `self`와 신규 `stage`를 넣었다. `version`과 `game.version`은 같으며 조회 응답의 `result`는 생략했다. `stage.schema_version`은 2다. `self.clue`는 v2에서 `null`로 유지하고 본인 단계는 `self.mission`으로 표시한다. `SiteInfo`의 `sacho.char`·`body`는 미완료 위치에서 빈 문자열로 남긴다. 완료 후에는 `current_site`, `course.sites`, `game.acquired_sites`의 해당 장소에 같은 합성 공개 보상을 넣었다. 실제 코스에서 선택형 보상이 없으면 완료 후에도 빈 문자열이다. `course.sites`의 다음 거점은 호환용 기본 정보뿐이며 미래 미션을 포함하지 않는다.

추가 필드의 mock 구조는 다음과 같다. 역할 마스크는 `commander, scout, signal, cipher` 순서의 boolean 배열이고, 역할별 수치는 역할 이름을 키로 하는 객체다. 방장은 정찰원으로 설정해 `is_host`와 지휘관 권한을 구분한다.

| 필드 | mock 구조 / 의미 |
|---|---|
| `game.step_done_count`, `game.hint_level` | `Record<Role, number>` / 완료한 문제 수, 역할별 해제한 힌트 단계 |
| `game.arrival_mask`, `game.confirm_mask` | boolean 4개 / 도착 여부, 단계 확인 여부. 일반 자물쇠 경로인 정문 예시에서는 확인 마스크가 모두 false |
| `game.swap` | 호환용 비활성 필드. 실제 응답은 `{window_ends_at:null, used:false, pending:null}`. 2026-10-09 사용자 결정으로 참가자 간 역할 교환을 금지하며 pending 요청을 구현하지 않음 |
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

`match/map-hash`는 **1:1 연결만** 지원한다. 용봉관의 `classification/map-hash`는 필드 ID→선택 번호 객체로 보내되 여러 문장에 같은 분류를 사용할 수 있다. 이 예외가 기존 match의 중복 선택을 허용하지는 않는다. G-01의 실제 근거 선택지·정답 짝은 미확정이다. 주파수 UI는 소수점 한 자리 이하의 문자열을 보내야 하며 `12.30` 같은 두 자리 입력도 거절한다.

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

사초①은 `games_private.state.v2.sacho.gate`에 저장한다. `eventOrder`는 순서 검증 여부·확인 방식만 저장하고 정답 배열은 저장하지 않는다(사용자 확정). 정찰원의 조형물 관찰은 `observations`, 사건 기록은 `eventRecords`, 사용 자료·확인 방식은 `sources`로 분리한다. 개인 기록 본문은 game_public·타 역할 self·game_events에 포함하지 않는다. 정문 완료 후 `self.journal`은 본인 역할의 검증 결과·기록·출처·해설만 조회한다. 공통 사초 보상 본문은 별도의 공개 콘텐츠다. 추모의 벽·봉지 공동 기록과 전체 코스 최종 결과는 아래 12절의 PR-5 계약을 따른다.

## 6. 추가 액션 계약

**참가자 간 역할 교환 금지:** 최초 배정 역할을 유지한다. `propose-swap`/`respond-swap`은 구현 목록에서 제외했고 현재 v2 서버도 지원하지 않는다(`INVALID_ACTION`). `game.swap`은 비활성 호환 필드로 유지한다. 로컬 v1 혼자 시연의 보직 전환과 구분한다.

**2026-10-09 구현 변경:** 실제 4인 코스는 전원 GPS 도착이 필수다. v2 수동·QR 대체 요청은 서버에서 거절한다. 방 합류 QR과 GPS 미확정 dev 코스의 모의 도착은 별개다. GPS 필수 적용·미도착 상태의 API 접근 범위를 구현하고 검증했다. 클라우드 적용은 [GPS 적용 안내](GPS_APPLY.md)를 따른다.

모든 쓰기에 공통 키 game_id/request_id, 단계 액션에는 stage_id를 보낸다. 응답은 갱신된 Snapshot + result이며 아래는 각 액션의 추가 부분이다.

| PR / action | 추가 요청 예시 | 서버 권한·전이 / result 초안 |
|---|---|---|
| PR-3 set-ready | `{"ready":true}` | 본인 출발 확인 문구 확인 / `{ready:true}` |
| 구현 report-arrival | `{"method":"gps"}` | 본인 도착만 기록. 전원 도착 후 미션, 원시 좌표 없음 / `{arrived:true}` |
| 기존 depart-next-site | 없음 | 지휘관·현재 단계 완료. 다음 이동으로 전환, 문제 화면 잠금 |
| PR-4 select-alt-mode — 구현 | `{"mode_id":"outdoor"}` | 지휘관·용봉관 전원 도착 후 완료 전. 이전 초안의 outside는 사용하지 않는다. 아래 11절 참고 |
| PR-5 draft-memorial-record — 구현 | `draft_version:0, words:[…], text, reason` | 지휘관·전원 보고 후. 문장 변경 시 확인 초기화 / `{draft_version:1}` |
| PR-5 confirm-stage | `{"draft_version":1}` | 본인이 현재 추모 기록 읽음 확인. 4명 확인 후 사초③ |
| PR-5 submit-retro | `{"text":"확인한 기록과 남은 질문"}` | 본인의 봉지 회고 / `{saved:true}` |
| PR-5 draft-joint-record — 구현 | `draft_version:0, words:[…], text, reason` | 지휘관·전원 회고 후. 변경 시 동의 초기화 / `{draft_version:1}` |
| PR-5 consent-joint-record | `{"draft_version":1}` | 본인·현재 초안 버전 동의. 4명 동의 후 종료 |
| PR-5 get-result | 없음(request_id 불필요) | 종료 후. 사초·확인 방식·힌트·보고·개방 통계, 정답 평문 없음 |
| PR-6 create-upload-url | 미확정 | D3·D6 확정 전 요청·저장·업로드 기능 없음 |

추모의 벽은 `self.memorial_record` 전용 상태를 사용한다. 봉지의 `self.joint_record`와 공유하지 않는다. 양쪽 모두 문장·근거·낱말·버전·확인 상태를 포함하며 도착 후 해당 거점에서만 제공한다. 완료 결과·기록첩의 공통 기록 재조회는 아래 12절을 따른다. 추모에서는 점수·감점·숫자·자물쇠·카운트다운·진동을 표시하지 않는다. 정책 미확정 사진 업로드를 준비 완료의 필수 조건으로 삼지 않는다(D6).

## 7. 오류와 FE 처리

기존과 동일한 최상위 오류 형식:

```json
{"code":"STEP_LOCKED","message":"선행 단계 또는 보고가 완료되지 않았다.","retry_at":null}
```

아래 HTTP 상태는 PR-2에서 공통 오류 매핑으로 연결했다. STALE_DRAFT는 PR-5에서 연결했다. 역할 교환은 지원하지 않는다. FE는 code를 우선 사용하며 retry_at은 대기 시간이 있을 때만 제공된다. 비공개 거점·역할·판정 자료 누락은 답안이나 내부 예외를 반사하지 않는 CONTENT_UNCONFIRMED(503)로 처리한다.

| HTTP | code | FE 처리 |
|---|---|---|
| 400 | BAD_REQUEST / BAD_ANSWER / BAD_RECORD / SOURCE_REQUIRED | 입력 형식·필수 항목 안내. 원문 답안 반사 금지 |
| 401 | UNAUTHENTICATED | 익명 세션 복원 후 같은 요청 재전송 |
| 403 | FORBIDDEN | 권한 없는 액션 숨김. role 변경 요청으로 재시도 금지 |
| 404 | NO_GAME / NO_STAGE / NO_STEP | 현재 게임 조회, 만료/잘못된 ID 안내 |
| 409 | WRONG_PHASE / STALE_STAGE | get-game 후 현재 단계로 이동 |
| 409 | STEP_LOCKED / REPORTS_REQUIRED | 선행 진행·구두 보고 완료 기다림 |
| 409 | HINT_ORDER / EXPLANATION_REQUIRED | 현재 힌트 단계·해설 읽음 상태 다시 조회 |
| 409 | IDEMPOTENCY_CONFLICT | 다른 본문 재사용 오류. 새 사용자 동작만 새 ID로 전송 |
| 409 | STALE_DRAFT | 최신 공동 문장·근거·버전을 다시 읽고 확인 |
| 409 | RECORD_REQUIRED / RETROS_REQUIRED | 공동 기록·전원 회고 저장 완료 대기 |
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
- 기본값 적용 — 확정 필요(D1~D7): 자유 서술은 형식 검사, 진행자 기능 제외, 기존 자물쇠 규칙, 점수 미정, 사진 업로드 꺼짐, 4인 고정. 도착 설정은 2026-10-09 사용자 지정 전원 도착·반경 10m·체류 5초로 대체했다. D5 미확정 수치는 null로 표시하고 운영 시드에서 거절한다.
- 확정: 정규화 옵션은 단계별 선택 적용, 기본 판정 유지. 힌트 3단계는 대상 역할 미완료 문제 전체. 사초 사건 순서는 검증 결과만 보존한다.
- 결정 대기: 공개 코스의 정답 문장 노출 처리, G-01 근거·1:1 짝, D5·D8·D9 수치/시간 점수/팀 랭킹 범위. 기존 병합 여부가 이 결정을 확정한 것은 아니다. PR-6은 D3·D6 확정 전 시작하지 않는다.

## 10. PR-2 실행 범위

현재 v2는 기존 4인 로비→역할 배정→준비→출발 흐름으로 정문에 진입한다. 최초 역할을 유지하며 역할 교환은 금지한다. `report-arrival`은 본인 도착만 기록한다. 2026-10-09 추가 구현은 위 GPS 도착 계약을 따른다. 지정 GPS 코스는 네 명 모두 GPS 도착이 필요하며 수동·QR·모의 도착으로 우회하지 않는다. GPS 미확정 dev 시연만 모의 도착을 제공한다.

정문 완료 뒤 get-stage는 출발 전까지 정문을 반환한다. 기존 정문 전용 코스는 다음 거점이 없고, PR-4의 새 `gate-yongbong` / `gate-yongbong-gps` 코스는 지휘관의 `depart-next-site`로 용봉관에 진입한다. PR-5의 새 full-course는 추모·봉지·전체 종료까지 이어진다. 랭킹·시간 점수는 별도 확정 후 구현한다. 서버 이벤트에는 시각·역할·액션과 제한된 판정 메타데이터만 저장한다. 합성 수치는 정책 확정을 뜻하지 않는다.

## 11. PR-4 용봉관

정문 완료 후 `{"action":"depart-next-site","stage_id":"gate","request_id":"<새 ID>"}`를 보낸다. 용봉관 이동 상태가 되며 본인 문제·힌트·숫자는 다시 숨긴다. 기존 정문 도착은 용봉관 도착으로 인정하지 않는다. 지정 GPS 코스는 용봉관 10m 안 5초·네 명 도착을 요구하고 개발용 코스는 각자 모의 도착한다. 이후 단계 요청의 `stage_id`는 `yongbong`이다. 기존 두 거점 코스는 용봉관 완료 후 `NO_STAGE`다. PR-5 full-course는 추모의 벽으로 이어진다.

| 역할 | 단계 ID / 동작 |
|---|---|
| scout | `Y-01.features` 외형 2개 선택 → `Y-01.use` 과거 용도 |
| signal | `Y-02.functions` 1:1 연결 → `Y-02.choice` 선택 → `Y-02.record` 자료 기록 |
| cipher | `Y-03.sources` 1:1 연결 → `Y-03.verdict` OX → `Y-03.limits` 자료 확인 범위·한계·질문 |
| commander | 나머지 세 역할 보고 → `Y-04.classify` 3분류 → `Y-04.evidence` 근거 연결 → `Y-04.revision` 수정 기록 |

`Y-02.record`는 `title/type/created_at/provider/known` 다섯 필드가 필수이며 각 칸에 `확인 불가`를 허용한다. 고정 정답이 없고 기존처럼 출처·확인 방식·300자 상한 등 형식만 검사한다. `Y-04.revision`은 `verified/follow_up` 두 칸이 모두 필요하다. `Y-03.limits`는 `checked/missing/limit/question`을 기록하며 본인의 OX와 통신원 기록 완료가 선행 조건이다.

### 개인 기록 전달 예외

`Step.recordFrom:{role,stepId}`는 같은 거점의 다른 역할이 완료한 `record` 필드만 지정할 수 있고 `requires`에도 같은 참조가 있어야 한다. 정답형 단계·다른 거점·같은 역할·빠진 선행 참조는 seed가 거절한다. 용봉관에서는 **통신원 자료 기록 → 암호해독관 self**에만 선언했다. 지휘관은 기록 본문 대신 구두 보고를 듣는다.

도착 후 암호해독관의 `self.shared_records`에 다음 항목이 추가된다(아래는 합성 예시). 통신원 기록 완료 전에는 빈 배열이며 다른 역할과 이동 상태 응답에는 필드 자체가 없다.

```json
{
  "step_id": "Y-03.limits",
  "from_role": "signal",
  "from_step_id": "Y-02.record",
  "status": "recorded",
  "fields": [{"id":"title","label":"자료 제목"}],
  "record": {"title":"[합성] 자료 가"},
  "method": "official_digital",
  "source": {"text":"[합성] 연습 자료"}
}
```

실제 `fields/record`에는 선언된 다섯 필드가 들어간다. 통신원이 3단계 힌트로 기록 없이 완료하면 `status:"explained_without_record"`, `record:null`, `source:null`, `method:"explained"`다. 자료를 임의로 생성하지 않고 ‘기록 없음·추가 확인 필요’를 표시한다. 힌트의 대상 역할 전체 해설 처리 규칙은 유지한다. 전달 항목에는 다른 문제의 기록·숫자·정답·해시·힌트가 없다. 완료 뒤 같은 항목은 암호해독관의 해당 `self.journal[].shared_records`에만 남는다.

### 외부 대체 모드와 결과

```json
{"action":"select-alt-mode","game_id":"<게임 ID>","stage_id":"yongbong","mode_id":"outdoor","request_id":"<새 ID>"}
```

지휘관만 용봉관 `mission` 중 선택할 수 있다. 도착 전·완료 후는 `WRONG_PHASE`, 타 역할은 `FORBIDDEN`, 미지원 모드는 `BAD_REQUEST`다. 중간에 선택해도 기존 답안 처리·기록·보고·감점·자물쇠 시도를 초기화하지 않는다. 같은 요청 재전송은 멱등하며 다른 본문에 같은 ID를 쓰면 `IDEMPOTENCY_CONFLICT`다. 실내 모드로 되돌리는 액션은 없다.

대체 모드 지원 거점에만 `game.visit:{mode:"onsite"|"outdoor",label}`을 추가한다. 선택 전 label은 `현장 조사`로, 실내 관람 완료를 보장하지 않는다. 외부 모드 label은 `외부 대체 조사 · 실내 관람 아님`이다. 완료 결과·`game.completion.visit`·해당 `self.journal[].visit`에도 표시하고 재접속 후 유지한다. 개방 방식 label(`조사 후 복원`/`해설 확인 후 복원`)과 구분한다.

사초②는 private `v2.sacho.yongbong`에 기존 출처·기록과 함께 `visitMode`, `research:{material,assessment,revision}`을 저장한다. 각각 통신원 자료 정보, 암호해독관 확인 범위·추가 질문, 지휘관 수정 기록이다. 기록 없이 해설 완료한 부분은 null이다. 전체 research를 공개하거나 지휘관 self에 제공하지 않는다. `game_events`에는 `select-alt-mode`의 `mode_id`만 남긴다. [새 마이그레이션·적용 절차](YONGBONG_APPLY.md)를 따른다.


## 12. PR-5 추모의 벽·봉지·결과 — 구현 계약

2026-10-10 사용자 확정: **개인 조사·회고 본문은 본인만**, 공동 낱말·문장·근거는 같은 팀에 공개한다. 용봉관 signal→cipher 명시적 전달 예외는 그대로이며 추모 단계에는 적용하지 않는다. 추모·봉지 상태는 독립 저장소다. [적용 안내](PR_5_APPLY.md)를 따른다.

### 추모의 벽

`stage_id:"wall"`, `kind:"memorial"`, `quiet:true`, `scoring.enabled:false`, `completion.type:"confirm"`이다. 단계별 개인 조사→보고는 기존 submit-step/submit-report를 사용한다. 정찰원 두 인물 이름은 해시 검증 후 평문을 저장하지 않는다. 개인 기록은 인물 A/B의 활동·출처를 기록한다. 통신원의 활동·가치 연결은 자유 기록이며 1:1 map-hash 정답으로 제한하지 않는다. 선행 보고를 기다리는 유형과 의존성은 self.mission에서 읽는다.

전원 보고 후 지휘관이 `draft-memorial-record`로 공동 기록을 작성한다. `stage.recordTemplate`은 `prompt, wordChoices, wordCount`이며 이번 코스는 낱말 세 개다. 답이 정해진 채점 문제가 아니고 선택·필수 본문 형식만 검사한다. words는 템플릿 선택지의 문자열 배열(순서 유지, 반복 허용), text/reason은 각각 1~600자다. **최초 작성도 `draft_version:0`을 전송**한다. 수정은 현재 버전을 보낸다. 정규화한 본문·근거·낱말이 같으면 버전·확인을 유지하고, 달라지면 버전 +1 및 네 확인 초기화다.

각 역할은 `confirm-stage`에 자신이 읽은 `draft_version`을 전송한다. 전원 조사·보고 및 동일 버전 네 확인 후 사초③를 저장하고 `playing/cleared`가 된다. 완료 후 초안 수정은 거절한다. 공통 기록의 self 예시(합성):

```json
{
  "memorial_record": {
    "draft_version": 1,
    "words": ["[합성] 살피기", "[합성] 비교하기", "[합성] 이어가기"],
    "text": "[합성] 팀이 함께 작성한 문장",
    "reason": "[합성] 서로 비교한 근거",
    "confirm_mask": [true, false, false, false]
  }
}
```

확인 배열 순서는 commander/scout/signal/cipher다. 초안 전에는 `null`. 본문은 game_public·game_events에 포함하지 않는다. `self.journal[].memorial_record`는 해당 추모 완료 후 팀 공통 기록을 제공하고, 개인 entries는 계속 본인만 조회한다.

추모 단계에는 숫자·자물쇠·감점·점수·카운트다운·진동을 표시하지 않는다. `self.lock:null`, `self.digit:null`, 호환 필드 `attempts_left:0`이며 개방 액션과 confirm-explanation은 거절한다. 역할별 힌트는 무료이고 해설 처리 후에도 전원 보고·공동 확인이 필요하다. 화면의 10초 머무르기는 선택형 로컬 휴식으로 언제든 끝낼 수 있고 숫자 카운트다운이나 서버 완료 조건이 아니다. 도착부터 자동 효과음·배경음을 차단하고 이후 봉지에서도 자동으로 음량을 복구하지 않는다.

### 봉지

`stage_id:"bongji"`, `kind:"epilogue"`, `completion.type:"joint-record"`다. 새 전원 도착 후 역할별 본인 회고를 `submit-retro:{text}`로 저장·수정한다(1~600자). `self.retro`는 본문 또는 null, `game.retro_mask`는 네 역할 작성 상태다. 타인에게 본문을 보내지 않는다. 이 단계는 submit-step/submit-report/request-hint를 사용하지 않는다. 저장 시 본인 단계·보고 상태를 함께 완료한다.

전원 회고 후 지휘관이 `draft-joint-record`를 작성한다. 입력·버전 정책은 위와 같다. `self.joint_record`의 형태도 동일하며 **추모의 벽 기록을 재사용하지 않는다**. 회고 본문이 달라지면 기존 공동 초안이 있는 경우 버전 +1 및 전체 동의를 초기화한다. 같은 본문의 재저장은 동의를 초기화하지 않는다. 기존 공동 문장은 남겨 두므로 새 회고를 구두로 반영해 필요하면 지휘관이 다시 수정한다.

각자가 `consent-joint-record:{draft_version}`로 읽은 버전에 동의한다. 네 명 동의 후 `game.status:"done"`, `site_phase:"cleared"`, `stage_phase:"done"`, `ended_at`이 설정된다. 봉지는 사초 네 번째를 만들지 않는다. 이후 새 쓰기는 WRONG_PHASE. 이미 성공한 동일 request_id/본문 재전송은 저장된 영수증만 반환하고 종료 상태를 변경하지 않는다.

### 최종 결과

종료된 팀의 인증 멤버만 `get-result`로 조회한다(쓰기 아님, request_id 불필요). 응답은 Snapshot + `result`이며, 새로고침 복원을 위해 동일한 결과가 **완료 상태의 `self.result`**에도 있다. 종료 전 get-result는 WRONG_PHASE, 타팀은 FORBIDDEN이다. get-stage는 진행 중에만 사용하고 종료 상태에서는 get-game/get-result를 사용한다.

- `investigation:{completed,total}`, `sacho:{completed,total}`: 전체 개발 코스는 각각 3/3. 시작 안내·봉지 회고는 조사·사초 개수에 포함하지 않는다.
- `stages[]`: stage_id/name/summary/quiet/completion/visit_mode/arrival_method, 역할별 통계 `roles[]`, 공통 `memorial_record` 또는 null. summary는 완료 공개 사초 설명이다.
- `roles[]`: role, completed/total, reported, hint_level, explained, records, cross_checks, methods. records는 자유 기록을 제출한 **문제 수**이며 칸 수가 아니다. cross_checks는 선행 보고 또는 recordFrom 연결이 있는 문제를 **직접 done으로 완료한 수**다. 의미의 적절성을 자동 평가한 점수가 아니다. explained는 교차 확인 건수에서 제외한다.
- `methods`: field/official_digital/explained/simulated 등 실제 저장된 방식의 중복 없는 목록. `arrival_method`는 gps 또는 simulated. `visit_mode`는 onsite/outdoor다.
- `joint_records[]`: stage_id와 최종 draft_version/words/text/reason/confirm_mask, retro_mask. 개인 본문은 없으며 본인의 회고만 self.retro에서 조회한다.
- `supplementary_score`: 기존 잠금 단계 점수. `time_score:null`, `ranking:null`은 미구현 표시로 0점·순위 없음이라는 확정 정책을 뜻하지 않는다. D8/D9 확정 후 별도 추가한다.

CAS 충돌 시 서버는 최신 상태로 다시 판정한다. 초안 버전이 달라지면 STALE_DRAFT(409)를 반환하며 FE는 갱신된 문장·근거를 다시 보여준 후 사용자가 확인하도록 한다. 새 쓰기마다 새 request_id, 응답 유실 재전송에는 기존 ID와 본문을 그대로 사용한다. 이벤트는 확인/초안의 draft_version만, 회고 저장은 빈 data만 기록한다.
