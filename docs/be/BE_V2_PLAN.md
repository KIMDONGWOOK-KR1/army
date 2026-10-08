# 호국실록 BE v2 기본 설계 — 시나리오 v1.0(전남대편) 대응

> 문서 상태: 초안 / 2026-10-08 / 작성: 김종연(BE·Infra)
> 이 문서에는 **정답·완료 숫자·힌트 본문·해설이 없다.** 저장소에 커밋해도 된다.
> 시나리오 원문(`GPS_MINO_1st_scenario.md`)에는 정답이 들어 있으므로 **저장소에 커밋하지 않는다** (저장소가 공개 상태다).

## 0. 이번에 확정한 것 (2026-10-08, 김종연)

| 항목 | 결정 |
|---|---|
| 역할 | 시나리오 v1.0을 따른다. `commander` 지휘관, `scout` 정찰원, `signal` 통신원, `cipher` 암호해독관. 보직을 공개한 뒤 30초 안에 팀이 1회 역할을 교환할 수 있다(상대 동의 필요, 설정으로 끌 수 있음). |
| BE 실행 위치 | 기존 Supabase Edge Function `game`과 공통 엔진(`_shared/engine.ts`)을 유지한다. Vercel은 Next.js(`web/`) 호스팅만 맡는다. |
| 개발 범위 순서 | 정문 1거점의 v1.0 흐름을 끝까지 완성한다 → 같은 구조로 용봉관 → 추모의 벽 → 봉지 순으로 확장한다. |
| 담당 | 김종연(GitHub `JongYoun0216`)이 BE와 Infra를 모두 맡는다. FE는 이환희, 리뷰·머지는 김동욱이 맡는다. 김종연은 자기 계정으로 `KIMDONGWOOK-KR1/army` main에 PR을 올린다. |

10/9 중간 점검 기준은 "폰 4대 실시간 동기화와 서버 자물쇠"다. 이 둘은 **기존 코드를 실제 Supabase와 Vercel에 배포하기만 하면** 확인할 수 있다. 그래서 v2 개발보다 배포(PR-0)를 먼저 한다.

---

## 1. 기존 구조에서 그대로 유지하는 것

PR-2 구현 시 추가 확정(2026-10-08): 텍스트·낱말 정규화는 단계별 옵션으로만 적용하고 기본 판정은 유지한다. 역할 힌트 3단계는 해당 역할 미완료 문제 전체에 적용한다. 사초①의 사건 순서는 정답 배열 대신 검증 결과·출처·방식만 저장하며 관찰 기록과 사건 기록을 분리한다. 상세 요청·오류·구현 범위는 [API 계약](API_CONTRACT.md), 적용 명령은 [PR-2 적용 안내](PR_2_APPLY.md)를 따른다. 이 추가 결정은 D1~D9 전체 확정을 뜻하지 않는다.

- **단일 명령 API**: `POST /functions/v1/game`에 `{ action, request_id, ... }`를 보낸다. 로컬 개발에서는 `/api/game`을 쓴다. 두 경로가 같은 `dispatch()`를 사용한다.
- **스냅샷 + version CAS**: `games_private.state`(jsonb) 전체를 `commit_game(p_expected)`로 원자 갱신한다. 충돌하면 다시 읽어 재판정한다(최대 12회).
- **공개 투영과 개인 응답 분리**: `game_public`(팀 공통, RLS)과 `Snapshot.self`(본인 단서·숫자)로 나눈다.
- **멱등성**: 모든 쓰기 요청에 `request_id`가 붙고 결과는 `receipts`에 남는다.
- **정답 해시**: 서버 salt를 섞은 sha256만 저장한다. 정답 평문은 DB·클라이언트·응답 어디에도 두지 않는다.
- **익명 인증 + `auth.getUser()` 검증**, `ALLOWED_ORIGIN` 확인, 8KB 요청 제한.
- **GPS 판정은 `web/lib/arrival.ts` 한 곳에서만** 한다. 서버에는 좌표를 보내지 않고 도착 결과만 보낸다.

v2는 v1의 **상위집합**으로 만든다. 기존 합성 데모 코스와 FE가 쓰는 `Snapshot` 필드(`self.clue`, `self.digit`, `game.report_mask` 등)는 FE가 v2로 넘어갈 때까지 유지한다. 새 필드는 기존 필드를 바꾸지 않고 **추가하는 방식**으로만 넣는다.

## 2. 전체 구조

```
[폰 x4: Next.js on Vercel]
   │  POST {action, request_id, ...}  (Bearer = 익명 JWT)
   ▼
[Edge Function game] ── engine.dispatch(game, course, userId, cmd, now)
   │        │
   │        ├─ courses_private (코스 v2: 공개 콘텐츠 + 서버 전용 정답해시·힌트·해설)
   │        ├─ games_private   (게임 스냅샷 v2, version CAS)
   │        └─ commit_game_v2  → game_public 갱신 + game_events 추가(같은 트랜잭션)
   ▼
[Realtime] game_public postgres_changes(RLS) + private Broadcast(stage) + Presence(접속)
```

## 3. 콘텐츠 모델 v2

### 3.1 파일 분리

| 파일 | 커밋 여부 | 들어가는 내용 |
|---|---|---|
| `codex-handoff-v2/data/courses/jnu-v2.course.json` | 커밋 가능 | 단계 구조, 나레이션·안내 통신·화면 문구, 문제 문구, 선택지, 출처 링크(S1~S4), 반경, 표시용 설정 |
| `codex-handoff-v2/data/courses/jnu-v2.private.local.json` | **커밋 금지** (`*.local.json`) | 정답, 완료 숫자, 힌트 1~3단계 본문, 해설, 채점 기준, 정답을 맞힌 뒤 열리는 보상 콘텐츠(예: 복원된 통신문), QR 토큰 |
| `codex-handoff-v2/data/courses/jnu-v2.private.example.json` | 커밋 가능 | 비공개 파일의 **형식 예시**. 값은 합성 더미로만 채운다. |

seed 스크립트가 두 파일을 합쳐 `courses_private`에 저장한다. 정답은 해시로, 힌트·해설·보상은 서버 전용 평문으로 저장한다(`courses_private`는 service_role만 읽을 수 있다).

### 3.2 타입 초안 (`_shared/types.ts`에 추가)

```ts
type StageKind = "prologue" | "mission" | "memorial" | "epilogue";

type Stage = {
  id: string;                 // "prologue" | "gate" | "yongbong" | "wall" | "bongji"
  seq: number;
  kind: StageKind;
  name: string;
  arrival: { mode: "gps" | "qr" | "manual" | "none"; radiusM?: number; noticeM?: number;
             dwellSec?: number; require: "all" | "any"; lat: number | null; lng: number | null };
  quiet?: boolean;            // 추모의 벽: 효과음·점수·카운트다운·진동 끔
  scoring: { enabled: boolean; hintPenalty: Record<1 | 2 | 3, number>; noHintBonus?: number };
  narration: SceneText[];     // 장면 ID(G-00 등)별 나레이션·안내 통신·화면 문구
  roles: Record<Role, RoleMission | null>;
  completion:                  // 거점 완료 방식
    | { type: "lock"; order: Role[] }                  // 정문·용봉관
    | { type: "confirm"; labels: Record<Role, string> } // 추모의 벽
    | { type: "joint-record" };                         // 봉지
  altModes?: { id: string; label: string }[];          // X-07 용봉관 외부 대체 모드
  sacho?: { id: string; name: string; template: string };
};

type RoleMission = { intro: SceneText; steps: Step[]; digit?: boolean };

type Step = {
  id: string;                 // "G-03.freq", "G-03.words" ...
  type: StepType;
  prompt: string;
  choices?: string[];         // 선택지·카드
  fields?: FieldSpec[];       // 기록형 입력 칸(제목/유형/작성시기/소장처/알 수 있는 내용 ...)
  requires?: StepRef[];       // 열리기 위한 선행 단계(다른 역할 포함)
  grading: "hash" | "set-hash" | "order-hash" | "map-hash" | "record" | "open" | "confirm";
  sourceRequired?: boolean;   // 출처·확인 방식 입력 필수
  maxLen?: number;            // 자유 서술 글자 수 상한(기본 300)
};
type StepType =
  | "truefalse" | "order" | "match" | "choice" | "multi-choice" | "frequency"
  | "words" | "spot-correct" | "text" | "observation" | "record-form"
  | "fill-blank" | "confirm";
type StepRef = { role: Role; stepId: string };
type VerifyMethod = "field" | "official_digital" | "explained" | "simulated" | "proxy";
```

서버 전용 부분(private 파일 → `courses_private`에만 저장):

```ts
type StepPrivate = {
  answerHash?: string;          // grading이 *-hash일 때
  rubric?: { required: string[] }; // record형의 필수 항목 이름(정답 아님)
  explanation: string;          // 3단계 힌트 사용 또는 제출 후 공개
  reward?: string;              // 정답 후 열리는 콘텐츠(예: G-03 복원된 통신문)
};
type RolePrivate = {
  digit?: number;
  hints: [string, string, string]; // 2026-10-08 사용자 결정: 역할별 3단계 유지
  transferClue?: { kind: "relay-frequency"; label: string; value: string; targetStepId: string };
};
```

#### PR-1 구현 결정과 비공개 예외 (2026-10-08 사용자 확인)

- 지휘관 주파수는 **정답이 아닌 전달형 개인 단서**로 취급한다. `RolePrivate.transferClue`에 저장하고 지휘관 `self.transfer_clue`에만 제공한다. 통신원의 목표값 표시는 하지 않는다. 통신원 정답은 기존 원칙대로 해시만 저장하되 seed가 전달값과 해시 입력의 일치를 확인한다. 이 평문 개인 단서가 "정답 계열 평문을 저장/응답하지 않는다" 원칙의 명시적 예외다. `game_public`, 공개 투영, 타 역할 응답에는 넣지 않으며 직렬화 테스트로 검사한다.
- 원문에 있는 **역할별 힌트 3단계**를 유지한다. StepPrivate에 같은 힌트를 복제하지 않는다. 단계별 explanation/reward는 여전히 비공개다. 통신원 주파수 문제도 역할 힌트 정책에 속하며 전달 안내는 위 개인 단서로 분리한다. 힌트 3단계의 다단계 해설 처리 범위는 PR-2에서 확인한다.
- G-01의 사건 카드–근거 연결은 원문에 근거 선택지와 정답 짝이 없다. 사용자가 **연결 유형·필드만 구현하고 미확정으로 남기기**를 선택했다. `confirmed:false`, 빈 choices로 두며 운영 seed를 차단한다. 합성 비공개 예시의 짝은 실제 정답이 아니다.
- `requiresReports`로 지휘관 판정이 나머지 세 역할 보고 뒤 열리게 표현한다. 같은 거점 내 requires와 보고 조건을 합쳐 순환을 검사한다. G-03.words는 본인 주파수 단계만 선행하며 정찰원 보고는 나레이션 trigger에만 사용한다.
- Stage/Step/arrival/scoring/asset의 confirmed, null 점수, 명시적 scene trigger·입력 fields 등을 타입에 추가했다. 확정된 GPS 코스만 운영 seed를 통과하며 시연은 명시적 demo 플래그와 dev ID가 필요하다. 합성 입력은 seed:course의 DB 등록 대상에서 제외한다.
- 실제 타입은 `_shared/types.ts`, 직렬화·액션별 FE 계약은 [API_CONTRACT.md](API_CONTRACT.md)를 따른다. 이 문서의 나머지 게임 상태/API 모델은 후속 PR용 초안이며 PR-1에서 엔진·DB를 변경하지 않았다.

### 3.3 시나리오 장면과 단계 유형 대응

| 장면 | 역할 | 단계 유형 | 채점 |
|---|---|---|---|
| G-01 | 지휘관 | truefalse(4문장) → order(사건 카드 4장) → match(카드–근거) | hash / order-hash / map-hash |
| G-02 | 정찰원 | observation(작품 이름·형태·출처 + 메모/사진) | 이름은 hash, 나머지는 record |
| G-03 | 통신원 | frequency → (보상: 복원 통신문) → words(세 단어, 순서 무관) | hash / set-hash. 두 번째 문제는 `requires: scout G-02` 없이 열고, 나레이션만 정찰원 보고 뒤에 재생한다(시나리오: "정찰원 발견 전에도 통신 복원은 완료 가능") |
| G-04 | 암호해독관 | spot-correct(바뀐 표현 3곳 선택 + 수정 입력 + 출처) | 선택은 set-hash, 수정 입력은 record |
| Y-01 | 정찰원 | multi-choice(외형 2개) + text(과거 용도) | set-hash / hash |
| Y-02 | 통신원 | match(자료–기능 4쌍) → choice → record-form(자료 1점 기록, '확인 불가' 허용) | map-hash / hash / record |
| Y-03 | 암호해독관 | match(카드 A~D) → truefalse(OX) → text(통신원 자료의 한계 보고, `requires: signal Y-02.record`) | map-hash / hash / record |
| Y-04 | 지휘관 | truefalse 3분류(사실/거짓/근거 부족) + match(근거) → text(초안 수정) | map-hash / record |
| W-01~W-04 | 4역할 | observation, match+text, text, fill-blank | 이름은 hash, 나머지는 record/open. **점수 없음, 숫자 없음** |
| W-05 | 4역할 | confirm | confirm |
| B-01 | 4역할 | text(회고) | open |
| B-02 | 지휘관 초안 → 4명 동의 | fill-blank + text(이유) | open + 전원 동의 |

**자유 서술(record·open)은 서버가 정답 여부를 판정하지 않는다.** 서버는 빈칸, 글자 수 상한, 필수 항목(출처·확인 방식) 입력 여부만 검사한다. 내용은 지휘관이 보고를 듣고 확인한다(시나리오 G-05 "지휘관이 보고의 핵심과 근거를 확인한다"). → 결정 D1

## 4. 게임 상태 v2 (`Game`에 추가하는 필드)

```ts
stageIndex: number;
stagePhase: "travel" | "arrival" | "mission" | "closing" | "record" | "done";
swap: { windowEndsAt: number | null; used: boolean; pending?: { from: string; to: string; at: number } };
readyChecks: Record<string /*memberId*/, { at: number }>;   // P-03 역할별 출발 확인
progress: Record<string /*stageId*/, Record<Role, {
  steps: Record<string /*stepId*/, {
    status: "locked" | "open" | "done" | "explained";
    attempts: number; lastAt: number | null;
    method?: VerifyMethod;        // 현장 확인 / 공식 디지털 자료 확인 / 해설 확인 후 복원 ...
    record?: Record<string, string>; // 자유 서술·관찰 메모 (글자 수 상한 적용)
  }>;
  hintLevel: 0 | 1 | 2 | 3;
  reported: boolean;              // 보고 완료
}>>;
altMode: Record<string /*stageId*/, string | null>;          // X-07
confirms: Record<string /*stageId*/, Partial<Record<Role, number>>>; // W-05
retros: Partial<Record<Role, { text: string; at: number }>>; // B-01
jointRecord: { draftVersion: number; words: string[]; text: string; reason: string;
               consents: Partial<Record<Role, number>> } | null; // B-02, 초안을 고치면 동의 초기화
sacho: Record<string /*stageId*/, { completedAt: number; summary: Record<string, unknown> }>;
```

- 스냅샷이 커지므로 자유 서술은 항목당 300자, 요청은 8KB 상한을 유지한다.
- 완료 숫자는 그 역할을 완료한 본인에게만 `self`로 내려준다. 공개 투영에는 `report_mask`(✓)만 넣는다.

## 5. API 액션

기존 액션: `create-game`, `join-game`, `get-game`, `get-clue`, `start-game`, `begin-operation`, `set-ready`, `depart-next-site`, `report-arrival`, `submit-report`, `open-lock`, 데모 전용 `demo-*`

| 액션 | 누가 | 언제 | 효과 | 신규/변경 |
|---|---|---|---|---|
| `start-game` | 방장 | lobby, 4명 | 무작위 보직 배정, `reveal_at`, 교환 창(30초) 시작 | 변경 |
| `propose-swap` / `respond-swap` | 팀원 | 교환 창 안 | 두 사람의 역할 교환, 팀당 1회, 상대 동의 필요 | 신규 |
| `set-ready` | 각자 | equip | 역할별 출발 확인 문구에 체크 | 변경 |
| `depart-next-site` | 지휘관 | 거점 완료 후 | 다음 단계로, 이동 화면 잠금 | 유지 |
| `report-arrival` | 각자 / 지휘관 | travel | `method: gps\|qr\|manual\|simulated`, QR은 서버가 토큰 검증, `require: all`이면 4명 모두 도착해야 미션 시작 | 변경 |
| `select-alt-mode` | 지휘관 | 용봉관 도착 후 | 외부 대체 모드, 결과에 "실내 관람 아님" 표시 | 신규 |
| `get-stage` | 각자 | mission | 본인 역할의 단계·열린 힌트·보상 반환 (`get-clue`의 v2판) | 신규 |
| `submit-step` | 해당 역할 | mission | 단계 채점 또는 기록 저장, 다음 단계 열기, `method` 기록 | 신규 |
| `request-hint` | 지휘관 | mission | `{target_role, level}`, 단계 순서대로만, 대상 팀원에게만 힌트 공개, 거점 설정에 따라 감점, 3단계는 해설 공개 후 `explained` 처리 | 신규 |
| `submit-report` | 해당 역할 | 역할 단계 완료 후 | 보고 완료 ✓, 본인에게 완료 숫자 공개 | 변경(완료 조건이 v2 단계 기반) |
| `open-lock` | 지휘관 | 4명 보고 후 | 칸별 검증, 3회·감점·60초 규칙(설정값) | 유지 |
| `confirm-stage` | 각자 | 추모의 벽 | W-05 확인 버튼, 4명이 확인하면 사초③ | 신규 |
| `submit-retro` | 각자 | 봉지 | B-01 회고 | 신규 |
| `draft-joint-record` | 지휘관 | 봉지 | 공동 문장 초안·이유, 수정하면 동의 초기화 | 신규 |
| `consent-joint-record` | 각자 | 봉지 | 동의, 4명이 동의하면 종료 | 신규 |
| `get-result` | 각자 | done | 결과 화면 통계(시나리오 B-03 목록) | 신규 |
| `create-upload-url` | 정찰원 등 | mission | 사진용 Storage 서명 업로드 URL (P1, 결정 D6 뒤) | 신규 |

공개 투영(`game_public`)에 추가하는 필드: `stage_id`, `stage_kind`, `stage_phase`, `quiet`, 역할별 `step_done_count`(숫자·정답 없음), 역할별 `hint_level`, `arrival_mask`, `confirm_mask`, `joint_record`(초안 문장과 동의 마스크, 봉지에서만), `swap` 상태

## 6. DB 변경 (새 마이그레이션, 기존 파일 수정 금지)

1. `game_events` (append-only): `id bigserial, game_id uuid, at timestamptz, actor_member text, action text, stage_id text, role text, data jsonb`. 결과 화면 통계와 논문 지표에 쓴다. 정답 평문·좌표는 넣지 않는다. RLS를 켜고 service_role만 접근한다.
2. `commit_game_v2(p_id, p_expected, p_state, p_public, p_events jsonb)`: 기존 `commit_game`에 이벤트 삽입을 같은 트랜잭션으로 추가한다. 기존 함수는 남겨 둔다.
3. (P1) Storage 비공개 버킷 `evidence`: `games/{gameId}/{memberId}/{uuid}.jpg`. 업로드는 Edge가 발급한 서명 URL로만 받고, 보관 기간은 D6에서 정한 뒤 정리 작업을 둔다.
4. Realtime 정책: 기존 private channel 정책을 유지하고, 공개 채널 접근을 꺼 둔다.

## 7. 점수·힌트·랭킹 정책 (설정값, 수치는 미확정)

> **2026-10-08 PM 정정:** 상무대가 랭킹 시스템을 필수로 요구했다. **시간에 따른 점수, 힌트 사용 감점, 팀 랭킹은 반드시 구현한다.** 이전의 "속도를 점수에 반영하지 않음" 방침은 추모 거점에만 남긴다.

- 시나리오: 힌트 1단계는 감점 없음, 2단계는 정문·용봉관에서만 소폭 감점, 3단계는 해설 후 통과(그 거점의 무힌트 보너스 없음), 추모의 벽은 점수 없음. 힌트 감점 수치는 상무대 회신에 맞춰 조정한다(제안서 원안 0/−10/−30).
- 시간 점수: 서버 시작·종료 시각으로 계산한다. 추모 거점(`quiet: true`)에 머문 시간은 빼는 안(시간 정지)을 상무대에 확인한다. 계산식(조기 완주 가산 또는 초과 감점, 제한 시간)은 D8에서 정한다.
- 랭킹: 서버가 완료 팀의 점수·소요 시간으로 순위를 만든다. 비교 범위와 공개 시점은 D9에서 정한다. 공개 응답에는 팀 표시명·점수·소요 시간·순위만 넣고 개인 답안·숫자는 넣지 않는다.
- 수치는 "별도 운영 결정 사항"이다. 코드에는 `course.scoring` 설정으로 두고, 시연값에는 `TODO(확인필요)`와 `confirmed: false`를 붙인다.
- 점수에 반영하지 않는 것: 추모 거점에서의 시간, 선택한 가치, 감정 표현.

## 8. 인프라 (Vercel + Supabase)

| 항목 | 설정 |
|---|---|
| Supabase | 서울 리전 프로젝트. 익명 로그인 켜기. Realtime 공개 채널 끄기(private only). `supabase db push`, `functions deploy game` |
| Edge 비밀값 | `ANSWER_SALT`(32자 이상), `ACTIVE_COURSE_ID`, `ALLOWED_ORIGIN` → 프리뷰 배포 때문에 `ALLOWED_ORIGINS`(쉼표 목록)로 확장 검토 |
| Vercel | Root Directory `web`, 공개 환경변수 3개(`NEXT_PUBLIC_BACKEND`, URL, anon key)만. 서비스 키·salt는 넣지 않는다 |
| 환경 | `dev`(시연·합성 코스)와 `prod`(실제 코스)를 분리한다. 무료 플랜이면 Supabase 프로젝트 2개 |
| CI | GitHub Actions: PR마다 `npm ci → typecheck → test → build`, `deno check`. 배포 자동화는 main 머지 뒤에만(김동욱 머지) |
| 남용 방지 | 익명 로그인 남용 대비: 방 생성 한도(기존 5개) 유지, 필요하면 Supabase Auth CAPTCHA |

## 9. 작업 순서 (PR 단위)

| PR | 브랜치 | 내용 | 완료 기준 |
|---|---|---|---|
| PR-0 | `infra/deploy-dev` | 기존 데모를 실제 Supabase dev + Vercel에 배포, CI 추가, `private/` gitignore | HTTPS 주소에서 폰 4대로 합성 코스 완주, 서버 자물쇠 3회·감점 확인 (10/9 점검) |
| PR-1 | `feat/course-v2-schema` | 코스 v2 타입, 공개/비공개 파일 분리, seed 검증기 확장, 정문 공개 콘텐츠 JSON | seed가 미확정 값·빠진 역할·형식 오류를 거절, 단위 테스트 통과 |
| PR-2 | `feat/engine-v2-gate` | `get-stage`·`submit-step`·`request-hint`·v2 보고·자물쇠·사초①, `commit_game_v2`, `game_events` | 정문 4역할 다단계 → 자물쇠 → 사초① 테스트, 정답·숫자가 다른 역할 응답에 섞이지 않음 |
| PR-3 | `feat/prologue-arrival-v2` | 30초 역할 교환, 역할별 출발 확인, 4명 도착·QR·수동 대체 | 교환 멱등·1회 제한, 재접속 때 역할 유지 |
| PR-4 | `feat/stage-yongbong` | 용봉관 콘텐츠 + 외부 대체 모드 | 대체 모드에서 "실내 관람 완료"로 표시하지 않음 |
| PR-5 | `feat/stage-wall-bongji` | 조용한 모드, 확인 버튼, 회고, 공동 문장 초안·동의, 결과 | 추모의 벽 점수·감점 0, 초안을 고치면 동의 초기화 |
| PR-6 | `feat/evidence-events` | 사진 업로드(D6 뒤), 결과 통계, 진행자 대행 입력(D3) | 보관 정책 반영 |

FE(이환희)와 맞출 계약: PR-1에서 `types.ts`의 v2 타입과 `docs/be/API_CONTRACT.md`(액션별 요청·응답 예시, 오류 코드)를 먼저 올린다.

## 10. 결정 필요 (기본값 제안 — 회의에서 확정)

| ID | 항목 | 기본값 제안 |
|---|---|---|
| D1 | 자유 서술 채점 | 서버는 정답 판정을 하지 않고 형식·필수 항목만 검사한다. 내용은 지휘관이 보고를 듣고 확인한다 |
| D2 | 도착 기준 | 시나리오대로 4명 전원(`require: all`), 반경 15m·안내 20m·체류 5초. GPS 실패 시 QR → 지휘관 수동(30초) |
| D3 | 진행자(운영자) 기능 | MVP에서는 제외한다. 진행자 도착 확인과 대행 입력은 PR-6 이후 별도 화면으로 만든다 |
| D4 | 자물쇠 3회·−10·60초 | 유지한다(논문 3.3절). 시나리오에 없는 규칙이므로 시나리오 쪽에 반영을 요청한다 |
| D5 | 힌트 감점·무힌트 보너스 수치 | 힌트 감점은 필수(상무대 요구). 수치는 미정이다. 설정값으로 두고 `confirmed: false` |
| D6 | 사진 업로드·보관 | 상무대 정책(G08)을 확인하기 전까지 관찰 메모만 받고, 업로드는 기능 플래그로 끈다 |
| D7 | 3·5인 팀 | v1.0 범위 밖이다. 4인 고정 |
| D8 | 시간 점수 계산식 | 필수(상무대 요구). 만점·제한 시간·조기 완주 가산 또는 초과 감점, 추모 거점 시간 정지 여부를 상무대 회신 후 확정 |
| D9 | 랭킹 범위·공개 시점 | 필수(상무대 요구). 같은 날/누적/부대 간 비교, 종료 직후 공개/전 팀 종료 후 일괄 공개를 상무대 회신 후 확정 |
