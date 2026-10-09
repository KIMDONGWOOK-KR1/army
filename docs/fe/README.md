# FE 인수인계 — PR-2 정문 v2

2026-10-09 통합 브랜치 갱신 · FE 이환희 / BE·Infra 김종연 / 리뷰·머지 김동욱

**이 통합 브랜치에서는 PR #8 디자인의 `/`와 `/verify` 모두 정문 v2를 지원한다.** 메인 화면은 서버 응답에 따라 v1/v2를 구분한다. [UI 통합 안내](UI_INTEGRATION.md)에서 실행 방법과 연결 범위를 확인한다. 아래 PR-2 서버 계약과 12개 mock은 계속 사용한다. 새 DB·Edge·합성 코스와 웹의 dev 적용 준비를 맞춘 뒤 활성 코스를 전환한다. 이 문서는 배포 완료를 의미하지 않는다.

## 1. 먼저 볼 자료

| 자료 | 용도 |
|---|---|
| [메인 UI 통합 안내](UI_INTEGRATION.md) | PR #8 디자인과 PR #9 API의 연결 범위·로컬 실행·dev 적용 조건 |
| [GPS 적용·개발용 모드 전환](../be/GPS_APPLY.md) | 같은 Vercel 주소에서 실내 모의 도착/GPS 현장 시험, Supabase 코스 전환과 새 방 생성 |
| [API_CONTRACT.md](../be/API_CONTRACT.md) | 요청·전체 Snapshot·역할별 공개 범위·입력 형식·오류의 기준 문서 |
| [역할별 mock 12개](../be/API_CONTRACT.md#31-fe용-전체-snapshot-mock) | commander/scout/signal/cipher × 힌트 전/후/정문 완료 후 전체 JSON. FE 화면·Storybook·테스트에 사용 가능 |
| [확정 사항·결정 대기](../be/DECISIONS.md) | 정규화·힌트 3단계·해설 개방·사초 저장 방식과 미확정 항목 |
| [PR-2 적용 안내](../be/PR_2_APPLY.md) | BE 담당의 DB 적용·Edge 재배포·새 코스 등록 및 FE 연결 순서 |
| [정문 확인용 UI](VERIFY_UI.md) | 정식 디자인 전 `/verify`에서 로컬 4인 동작을 확인하는 방법과 dev 연결 절차 |
| [웹앱 README](../../web/README.md) | 기본 설치·기존 v1 실행·테스트 방법 |
| [공통 타입](../../web/supabase/functions/_shared/types.ts), [SnapshotV2](../../web/supabase/functions/_shared/engine-v2.ts) | type-only import용 타입. 서버 엔진·코스·비공개 자료를 클라이언트 런타임에 import하지 않는다 |
| [API 계약 테스트](../../web/tests/api-v2.test.ts) | 실제 Next POST 핸들러와 로컬 저장소를 이용한 네 세션·12종 응답 비교 예시 |

PR-2 서버 기준 브랜치는 `feat/engine-v2-gate`이며 PR-0 #6·PR-1 #7을 포함한 main에서 시작했다. UI 통합 작업은 `feat/ui-v2-integration`에서 PR #8 `14c105f`와 PR #9 `8441e76`을 연결한다. **PR의 병합·배포 여부는 별도로 확인**한다. 아래 dev 상태는 사용자가 마지막으로 보고한 내용이며 이 문서 갱신으로 적용 완료를 뜻하지 않는다.

## 2. 현재 구현과 실제 배포 상태

| 구분 | 현재 상태 |
|---|---|
| dev 웹 | [hoguk-dev-web.vercel.app](https://hoguk-dev-web.vercel.app). 2026-10-09 GPS 통합 코드 `76550a5` 배포, `/`·`/verify` HTTP 200 확인 |
| dev 백엔드 | Supabase 프로젝트 ref `vmadbgniurfzqygqidzw`, Edge Function `game`. PR-2 적용 및 GPS 코스 등록·Edge 준비는 사용자 완료 보고 기준. 현재 활성 코스 ID는 담당자가 확인 |
| PR-2 서버 | get-stage, submit-step, 역할별 힌트, 보고, 일반 자물쇠, 전원 해설 확인 후 별도 개방, 사초① 저장 구현 |
| PR-2 검증 | 단위·DB·계약 테스트 94개, 타입 검사·빌드·Deno 검사/lint 통과. 기존 v1 E2E 9개 시나리오 통과 |
| UI 연결 | `/verify`를 유지하고 통합 브랜치의 `/`에도 v2 문제·별도 보고·힌트·읽음 확인·두 개방 경로 연결. [통합 안내](UI_INTEGRATION.md) 참고 |
| 별도 확인할 것 | 현재 활성 코스와 새 방의 모드, 클라우드 4인 정문 완주, 실기기 GPS 현장 시험. 웹 배포 성공과 전체 흐름 검증을 구분한다 |
| 후속 범위 | 프롤로그 문구 연결의 잔여 부분, 후속 거점·추모·봉지·최종 결과, 시간 점수·랭킹. 역할 교환·QR·수동 도착은 사용자 결정으로 제외 |

처음 연결하는 환경은 [PR-2 적용 안내](../be/PR_2_APPLY.md)를 따른다. 기존 dev 환경은 [GPS 적용 안내](../be/GPS_APPLY.md)대로 등록된 개발용/GPS 코스 사이에서 `ACTIVE_COURSE_ID`를 전환하고 **새 방**을 만든다. 기존 방은 기존 코스에 고정되며 행을 덮어쓰지 않는다. FE가 임의로 DB·시드·Edge 비밀값을 바꿀 필요는 없다. 전환은 BE 담당과 맞추며 두 모드 모두 같은 Vercel 주소를 사용한다.

## 3. FE에서 바꿔야 하는 부분

인증과 HTTP 전송은 [lib/client.ts](../../web/lib/client.ts)에서 공유한다. 기존 `requestGame`은 v1 전용이며 `requestGameV2`는 응답의 `stage.schema_version === 2`를 확인한다. 확인 UI는 `useGameV2`, 통합 메인은 `useGameAny`/`requestGameAny`와 `isV2Response`로 버전을 구분한다. 공통 훅이 로비·이동 조회, 도착 후 get-stage, private Realtime 갱신과 재접속을 처리한다. 아래는 v1에서 v2로 연결할 때 지켜야 하는 계약이며 통합 UI에도 반영했다.

| 기존 v1 | v2에서 연결할 내용 |
|---|---|
| self.clue로 단일 문제 표시 | self.clue는 null. self.mission.steps와 self.step_progress로 다단계 문제 표시 |
| submit-report에 answer/role/site_id 전달 | submit-step에 answer/step_id/stage_id 전달 → 전부 done/explained 후 submit-report. role·demo_role은 보내지 않는다 |
| 문제 풀이와 숫자 보고를 한 번에 처리 | 문제 완료와 구두 보고 확인을 분리. 본인 self.digit은 보고 후 공개 |
| game.demo를 보고 혼자 체험 도구 표시 | v2 합성 4인 코스도 demo=true다. 이 값만으로 solo 기능을 켜지 않는다. v2의 create-demo/demo-role/demo-arrival/demo-time은 지원하지 않는다 |
| 거점 완료 시 다음 거점/전체 종료로 이동 | gate 완료는 playing + site_phase:cleared + stage_phase:done. 현재 dev v2에는 다음 거점이 없어 이동은 NO_STAGE. 정문 완료 화면을 유지한다 |

타입 참조 예시(확인용 UI의 공통 타입은 [game-snapshot.ts](../../web/lib/game-snapshot.ts) 참조):

```ts
import type { SnapshotV2 } from "@/supabase/functions/_shared/engine-v2";

// get-stage에는 result가 없고 쓰기 응답에는 액션별 result가 붙는다.
type V2ActionResponse = SnapshotV2 & { result?: Record<string, unknown> };
```

타입 단언만으로 v1 응답을 v2처럼 취급하지 않는다. v1의 `self.clue` 화면은 v1 응답에만 사용하고 v2에서는 `self.mission`을 사용한다.

## 4. 정문 화면과 액션 연결 순서

모든 게임 요청에는 game_id, 단계 요청에는 stage_id를 사용한다. 쓰기에는 request_id가 필수다. 새 사용자 동작에는 새 ID를 만들고, 응답 유실 재전송에는 **같은 ID와 같은 본문**을 유지한다.

1. 기존 4인 로비→방장 start-game→각자 set-ready→지휘관 begin-operation으로 출발한다. 방장과 지휘관은 다를 수 있다.
2. 본인 report-arrival 후 팀 도착 상태를 조회한다. 지정 GPS 코스는 반경 10m 안에서 5초 체류 후 `method:"gps"`를 보내며, 네 명 모두 도착해야 미션이 열린다. GPS 미확정 dev 시연에만 `method:"simulated"`를 사용한다. QR·수동 대행은 거절한다. 기존 시연 문항을 현장에서 시험하는 새 `v1-gate-gps` preset과 재배포 절차는 [GPS 적용 안내](../be/GPS_APPLY.md)를 따른다.
3. get-game으로 현재 stage_id·site_phase를 확인한다. mission/cleared에서 get-stage를 호출해 본인의 미션·힌트·진행 상태를 받는다. travel에서 get-stage는 409 WRONG_PHASE다.
4. self.step_progress[stepId].status가 open인 문제를 submit-step으로 제출한다. locked는 선행 문제/보고를 기다린다. HTTP 200이어도 result.accepted=false이면 채점 오답이다.
5. 본인의 모든 문제가 done/explained이고 선행 보고 조건을 충족하면 submit-report를 보낸다. 본인 숫자를 표시하고 구두 전달을 안내한다. 타인 화면에는 보고 ✓만 표시한다.
6. 일반 경로는 지휘관이 네 숫자를 직접 입력해 open-lock. 해설 경로는 각자 confirm-explanation→전원 confirm_mask 확인→지휘관 open-after-explanation이다. 두 버튼을 별도로 둔다.
7. 완료 후에도 get-stage로 현재 정문 상태를 복구한다. 별도 개방 result.label은 `해설 확인 후 복원`이다. 사초 본문 통합 조회와 최종 결과 화면은 후속 PR 범위다.

아래 예시의 `<...>`는 실제 ID로 바꾼다. 조회 요청 예시:

```json
{"action":"get-stage","game_id":"<현재 게임 ID>","stage_id":"gate"}
```

힌트 요청 예시(지휘관):

```json
{"action":"request-hint","request_id":"<새 요청 ID>","game_id":"<현재 게임 ID>","stage_id":"gate","target_role":"signal","level":1}
```

전체 요청 형식과 입력 유형별 예시는 [API 계약 4·5절](../be/API_CONTRACT.md#4-submit-step--pr-2)을 따른다. 원시 GPS 좌표·정답 해시·salt·서비스 키는 보내지 않는다.

## 5. 화면에서 꼭 지켜야 할 규칙

- 지휘관 전달형 개인 단서는 commander의 self.transfer_clue에만 있다. 공통 상태로 복사하거나 다른 역할 화면에 자동 전달하지 않는다.
- 힌트는 역할별 1→2→3 순서다. 지휘관은 대상/레벨을 요청하지만 본문은 대상 역할 self.hints에만 온다. 3단계는 그 역할의 미완료 문제 전체를 explained로 처리한다. 이미 done인 기록은 유지한다.
- self.explanations는 본인이 done/explained 조건을 충족한 문제만, self.rewards는 정답을 맞혀 done인 문제만 포함한다. 미공개 키를 임의의 본문으로 채우지 않는다.
- confirm-explanation은 본인의 모든 문제가 done/explained일 때 허용한다. 별도 개방에는 전원 조사·보고·읽음 확인이 모두 필요하다. 일반 자물쇠의 3회/오답 −10/소진 후 60초 규칙은 그대로다.
- 주파수는 소수점 한 자리 이하의 **문자열**이다. 두 자리 소수를 반올림해 보내지 않는다. 선택 번호도 `"1"`부터 시작하는 문자열이며 truefalse는 JSON boolean 대신 `"true"`/`"false"` 문자열 배열이다.
- 정규화는 서버 step.normalize 옵션을 따른다. 기본은 대소문자·내부 공백을 구분한다. FE가 자유 기록이나 선택 번호·주파수에 텍스트 정규화를 일괄 적용하지 않는다.
- map-hash는 1:1 연결이다. 실제 G-01 근거 선택지·짝은 미확정이며 빈 choices를 임의로 채우지 않는다. 합성 테스트용 근거는 실제 콘텐츠가 아니다.
- 보고·도착·확인 마스크는 commander/scout/signal/cipher 순서다. 자물쇠 입력·locked_mask·correct_mask는 stage.completion.order 순서다.
- game.score는 서버 값을 표시한다. 실제 시간 점수식·힌트 수치·랭킹 정책은 미확정이므로 FE에서 계산식을 하드코딩하지 않는다.

## 6. mock 사용과 한계

`docs/be/fixtures/get-stage.gate.<역할>.<상태>.json`은 파일 하나가 전체 Snapshot이다. 별도 wrapper 없이 mock 응답으로 사용할 수 있다. 문제·안내·기록은 합성 문구이고 실제 시나리오가 아니다.

- before-hint: 전원 도착, 진행/보고 없음. 지휘관 문제는 다른 세 역할 보고를 기다린다.
- after-hint: 통신원 힌트 1단계만 해제. 다른 역할 self.hints는 비어 있다.
- stage-completed: 일반 자물쇠를 연 직후이며 전체 게임 종료가 아니다.

**완료 예시도 self.digit와 self.lock.digits는 null로 가렸다.** 이는 실제 보고 후 숫자가 null이라는 뜻이 아니다. 전달형 단서 value도 표시용 placeholder다. 이 파일을 정답 데이터·seed·실제 완주 입력으로 쓰지 않는다. 숫자 복원·해설 개방·다단계 제출은 합성 서버 API 시험으로 별도 확인한다.

예시는 서버 구현 전 작성한 초안이다. 실제 PR-2 응답과 필수 필드·타입·역할 격리·상태를 대조하는 테스트는 추가했다. 실제 응답에는 earned 해설이 들어갈 수 있고 PR-2 swap.window_ends_at은 null이다. fixture의 고정 시각·문구·가린 값을 운영 규칙으로 해석하지 않는다.

## 7. 인증·Realtime·환경 설정

- FE 공개 환경변수는 `NEXT_PUBLIC_BACKEND`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 세 개다. 실제 값은 BE 담당과 프로젝트 설정으로 확인한다. service role key·Edge ANSWER_SALT는 FE 전달 대상이 아니다.
- 클라우드는 익명 로그인 Bearer JWT로 `<SUPABASE_URL>/functions/v1/game`에 POST한다. requestGame/requestGameV2가 공통 전송부에서 익명 세션·apikey·Authorization 헤더를 처리한다. Vercel에서 로컬 `/api/game`은 차단된다.
- FE 로컬 주소나 새 Vercel Preview로 dev Edge에 접속할 경우 정확한 origin을 BE에게 전달해 허용 목록에 추가해야 한다. 이때 origin에는 경로나 와일드카드를 넣지 않는다.
- 기존 private `game:<gameId>` Realtime 구독을 재사용할 수 있다. game_public 변경/Broadcast 후 자기 get-game/get-stage를 다시 조회한다. game_public에는 self·개인 단서가 없다. 낮은 version의 늦은 응답은 버리고 네트워크 복구 시 재조회한다.
- 네 명 검증은 서로 다른 브라우저 프로필/Playwright context/기기를 사용한다. 같은 프로필의 탭 네 개는 같은 익명 참가자로 인식될 수 있다.
- 순수 mock 개발에는 서버 비밀값이 필요 없다. 로컬 v2 API 실행이 필요하면 [로컬 API 개발 안내](../be/PR_2_APPLY.md#로컬-api-개발)에 따라 로컬 전용 salt와 새 dev 리비전 ID를 사용한다. 실제 Edge salt를 FE 작업용으로 복사하지 않는다.

오류는 ApiError.code로 분기한다. 409는 현재 상태 재조회, 429는 retry_at 기준 대기, 503 CONTENT_UNCONFIRMED는 콘텐츠 준비 필요 안내다. 오류 객체·전체 Snapshot·입력 답안·개인 단서를 콘솔이나 분석 로그에 남기지 않는다.

## 8. FE가 먼저 진행할 작업과 BE에 알려줄 사항

1. mock 12개와 통합된 메인 UI를 참고해 역할별 미션/진행/힌트/정문 완료 디자인을 다듬는다.
2. 통합 코드의 v1/v2 분기, submit-step과 submit-report 분리, 일반 자물쇠와 해설 개방 분리를 유지한다.
3. 정문만 네 세션으로 연결할 준비가 되면 BE에게 **테스트 origin과 v2 연결 준비 여부**를 전달한다. DB/Edge/새 코스 준비를 맞춘 뒤 새 방으로 통합 시험한다.
4. 활성 코스 전환 전에 지휘관 개인 단서 격리, 힌트 전후의 역할 격리, 중복 요청 감점 1회, 보고 전 잠금 거절, 전원 확인 전 해설 개방 거절, 재접속 복원을 확인한다.

결정 대기는 공개 코스 정답 문장 노출 처리, 실제 G-01 근거·짝, D5/D8/D9 점수·랭킹 정책, GPS 후보/현장 반경 확정이다. 실제 원문·정답 파일·GPS CSV를 FE mock이나 클라이언트 번들에 넣지 않는다. PR-3 이후 액션 표는 화면 논의용 초안이며 현재 동작하는 API로 취급하지 않는다.
