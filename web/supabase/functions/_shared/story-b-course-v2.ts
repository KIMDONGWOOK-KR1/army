// MINO 정문·용봉관의 다단계 미션. 추모의 벽은 1차 구현 그대로 재사용한다.
// 실제 정답·표기 변형·완료 숫자는 커밋하지 않는 서버 privateInput에서 주입한다.
import { fullDemoV2Input } from "./wall-bongji-course-v2.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { STORY_B, STORY_B_ROLES, STORY_B_STEP } from "../../../lib/narration.ts";
import { ROLES, type Role, type SceneText, type Step, type StepAnswer, type Stage, type CourseV2PrivateInput } from "./types.ts";

export type StoryBAnswerInput = {
  stages: Record<"gate" | "yongbong", {
    digits: Record<Role, number>;
    steps: Record<string, { answer: StepAnswer; acceptedAnswers?: StepAnswer[] }>;
  }>;
};
const scene = (id: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
  ({ id, text, trigger, channel: "screen" });
const fields = (labels: Record<string, string>) => Object.entries(labels).map(([id, label]) => ({ id, label, required: true, maxLen: 300 }));
const ref = (role: Role, stepId: string) => ({ role, stepId });
const step = (id: string, type: Step["type"], grading: Step["grading"], prompt: string, extra: Partial<Step> = {}): Step =>
  ({ id, type, grading, prompt, confirmed: false, maxLen: 300, sourceRequired: false, ...extra });
const textStep = (id: string, prompt: string, extra: Partial<Step> = {}) =>
  step(id, "text", "hash", prompt, { normalize: { ignoreSpaces: true }, ...extra });

type Hints = [string, string, string];
// 정답을 말하는 원문의 3단계는 사용자 규칙에 따라 조사 방법으로 바꾼다.
const HINTS: Record<string, Hints> = {
  "G-01.verdict": ["시간·모인 이유·이동 방향을 따로 물어보세요.", "사건의 세 항목은 암호해독관에게, 조형물 설명은 정찰원과 통신원에게 확인하세요.", "공식 정문 설명의 해당 문장을 보고서와 한 줄씩 대조해 판정하세요."],
  "G-01.order": ["어떤 일이 먼저 있었는지 생각하세요.", "각 카드가 가리키는 행동을 공식 설명에서 찾아 시간 표현을 표시해보세요.", "공식 설명의 시간 표현과 '이후'라는 연결어를 확인해 카드의 앞뒤를 정하세요."],
  "G-01.evidence": ["어떤 보고가 어떤 항목을 뒷받침하는지 살펴보세요.", "시각·약속·이동·조형물의 의미를 확인한 출처를 각각 물어보세요.", "동료의 보고 중 사건 순서를 뒷받침한 내용과 그 근거를 자신의 말로 적으세요."],
  "G-02.name": ["통신원이 전해줄 형태 단서를 기다리세요.", "공식 정문 안내의 주변 장소와 상징조형물 소개를 살펴보세요.", "작품 소개의 이름 부분을 찾아 입력하세요. 사진이 없어도 공식 설명으로 확인할 수 있습니다."],
  "G-02.shape": ["색보다 반복되는 형태를 살펴보세요.", "공식 설명에서 꽃잎의 형태를 소개한 부분을 찾으세요.", "조형물의 형태 설명에 적힌 꽃잎 수를 확인해 숫자만 입력하세요."],
  "G-02.record": ["직접 본 것과 자료에서 읽은 것을 나누세요.", "형태의 특징과 이름을 확인한 안내 위치를 기록하세요.", "촬영 없이도 관찰 메모로 진행할 수 있습니다. 보지 못한 부분은 확인 불가로 남기세요."],
  "G-03.freq": ["지휘관에게 도착한 수신 정보를 물어보세요.", "전달받은 숫자의 소수점 위치를 확인하세요.", "지휘관과 숫자를 다시 대조하고, 다이얼 또는 입력 칸에 소수점 한 자리까지 맞추세요."],
  "G-03.words": ["형태의 이름이 아니라 작품이 표현하는 가치를 찾으세요.", "정찰원이 찾은 작품의 공식 설명에서 상징과 가치를 설명하는 부분을 읽으세요.", "서로 다른 가치 낱말을 한 칸에 하나씩 입력하세요. 순서는 달라도 됩니다."],
  "G-04.spots": ["언제, 왜, 어디로 이동했는지를 확인하세요.", "강조된 표현을 포함해 각 구절을 공식 정문 기록과 대조하세요.", "각 선택 구절을 공식 설명의 해당 부분과 짝지어 대조하세요. 같은 뜻인지 확인한 뒤 다른 구절만 고르세요."],
  "G-04.time": ["시각을 설명하는 부분을 찾으세요.", "정문에 학생들이 모인 시각을 공식 자료와 대조하세요.", "오전·오후 구분과 시간을 함께 입력하세요. 띄어쓰기는 달라도 됩니다."],
  "G-04.reason": ["왜 사람들이 모였는지 확인하세요.", "공식 설명에서 집결 전에 나눈 약속이 있는지 살펴보세요.", "집결 이유를 핵심말로 적으세요. 행사라고 단정한 표현을 공식 설명과 다시 대조하세요."],
  "G-04.destination": ["충돌 이후를 설명하는 문장을 찾아보세요.", "학교 안 장소인지 시내 방향인지 공식 자료를 확인하세요.", "이동한 곳의 이름을 입력하세요. 자료가 뒷받침하는 범위까지만 고치세요."],
  "G-04.corrections": ["고친 표현 옆에 이유도 남기세요.", "세 항목을 어떤 설명과 대조했는지 적으세요.", "수정한 문장과 근거를 따로 기록하고, 근거를 확인한 자료도 함께 적으세요."],
  "Y-01.features": ["건물 가운데와 양쪽의 관계를 살펴보세요.", "중앙부의 높이와 좌우 배치를 비교하세요.", "전체 모양과 정면 재료를 설명한 선택지도 실제 모습 또는 공식 설명과 대조해 두 항목을 고르세요."],
  "Y-01.use": ["모습만으로 과거 쓰임을 단정하지 마세요.", "공식 용봉관 안내의 건물 소개 첫 부분을 읽으세요.", "과거 용도를 나타내는 이름을 입력하세요. 다음 관찰 메모에 확인한 설명을 남길 수 있습니다."],
  "Y-01.record": ["관찰한 사실과 설명으로 확인한 사실을 나누세요.", "외형의 특징과 과거 용도를 각각 어디에서 확인했는지 적으세요.", "옛 사진이 없거나 실내에 들어가지 못했다면 그 한계를 기록하고 공식 설명으로 이어가세요."],
  "Y-02.functions": ["누가 누구에게 무엇을 전달하려고 만든 자료인지 생각하세요.", "입장과 요구, 정보 전달, 논의와 결정, 현장 모습으로 나누어 보세요.", "자료 이름과 설명에 쓰인 동사를 대조해 주된 기능을 연결하세요."],
  "Y-02.choice": ["자료 하나가 알려주는 범위를 생각하세요.", "출처가 필요한지, 한 자료가 모든 것을 보여주는지 비교하세요.", "각 선택지의 '모두', '언제나', '확인하지 않아도' 같은 단정이 타당한지 살펴보세요."],
  "Y-02.record": ["자료 하나를 골라 제목과 출처를 확인하세요.", "자료 유형·작성 시기·제공기관과 본문을 구분하세요.", "자료에 없는 정보는 확인 불가로 적으세요. 실내 관람이 어렵다면 공식 웹 설명 자체를 자료로 삼을 수 있습니다."],
  "Y-03.sources": ["누가, 언제, 어디에서, 어떤 목적으로 만들었는지 보세요.", "사진의 촬영 정보, 증언 시기, 게시글 원출처를 확인하세요.", "각 카드에 이미 있는 정보와 빠진 정보를 나누고, 그 차이를 살피는 판단을 연결하세요."],
  "Y-03.verdict": ["자료가 만들어진 시점과 내용의 진실성을 구분하세요.", "작성자의 입장이나 관점이 내용에 담길 수 있는지 생각하세요.", "문장의 '모든', '무조건'을 다른 자료와 비교해 판단하세요."],
  "Y-03.limits": ["통신원이 고른 자료 정보를 기다리세요.", "전달된 기록에서 확인된 항목과 빠진 항목을 나누세요.", "단정할 수 없는 내용 하나와 추가로 확인할 질문을 각각 남기세요."],
  "Y-04.classify": ["주장마다 뒷받침할 자료가 있는지 확인하세요.", "건물 용도는 공식 안내로, 사진 시점은 촬영 정보로 판단하세요.", "맞다는 근거, 반대 근거, 판단할 정보의 부족을 구분해 분류하세요."],
  "Y-04.evidence": ["각 판정에 사용한 근거를 떠올리세요.", "주장과 자료가 같은 대상·시기를 다루는지 비교하세요.", "공식 설명과의 일치·충돌, 촬영 정보의 유무를 각 문장에 연결하세요."],
  "Y-04.revision": ["초안의 주장이 자료가 말하는 범위보다 넓은지 보세요.", "자료로 확인한 내용과 추가 비교할 내용을 구분하세요.", "두 칸을 모두 작성하세요. 한 자료가 사건 전체를 증명한다고 단정하지 않도록 고쳐보세요."],
};

export function storyBDemoV2Input(id: string, answers?: StoryBAnswerInput) {
  const { content, privateInput } = fullDemoV2Input(id);
  content.name = "민주기록 작전 · 전남대편 (시연용)";
  content.note = "MINO 대본 적용. 역사 자료는 공식 출처 기반이며 현장 문구·사진 사용 권한은 별도 확인이 필요하다.";
  content.settings.note = "4인 고정 보직. 관찰 메모와 공식 디지털 자료 경로를 제공한다.";
  content.sources = [
    { id: "S1", title: "전남대학교 민주길 · 정문", url: "https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K20200" },
    { id: "S2", title: "전남대학교 민주길 · 용봉관", url: "https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K21000" },
    { id: "S3", title: "전남대학교 민주길 · 추모의 벽", url: "https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K40600" },
  ];
  const [gate, yongbong, , bongji] = content.stages;
  const reports: Role[] = ["scout", "signal", "cipher"];
  const G = { sourceRequired: false, sourceIds: ["S1"] }, Y = { sourceRequired: false, sourceIds: ["S2"] };
  const steps: Record<"gate" | "yongbong", Record<Role, Step[]>> = {
    gate: {
      commander: [
        step("G-01.verdict", "truefalse", "hash", "교육용 미확인 보고서입니다. 동료의 보고를 듣고 네 문장을 판정하십시오.", {
          statements: ["학생들은 5월 18일 오후에 정문에 모였다.", "학생들은 사전에 나눈 약속에 따라 모였다.", "정문 충돌 이후 학생들은 중앙도서관으로 이동했다.", "조형물은 꽃잎을 통해 여러 가치를 표현한다."], requiresReports: reports,
        }),
        step("G-01.order", "order", "order-hash", "사건 카드를 먼저 일어난 일부터 배열하십시오.", {
          choices: ["금남로 방향 이동", "약속에 따른 정문 집결", "계엄 확대와 대학 통제", "출입을 막는 계엄군과 대치·충돌"], requires: [ref("commander", "G-01.verdict")],
        }),
        step("G-01.evidence", "record-form", "record", "동료의 보고를 바탕으로 사건 순서를 판단한 근거를 직접 남기십시오.", {
          fields: fields({ reason: "사건 순서를 판단한 근거" }),
          requires: [ref("commander", "G-01.order")], ...G,
        }),
      ],
      scout: [
        textStep("G-02.name", "통신원의 형태 단서와 공식 설명을 이용해 작품 이름을 확인하십시오.", { requires: [ref("signal", "G-03.freq")], ...G }),
        textStep("G-02.shape", "작품의 꽃잎 수를 확인해 숫자만 입력하십시오.", { requires: [ref("scout", "G-02.name")] }),
        step("G-02.record", "record-form", "record", "사진 대신 관찰 메모를 남기십시오. 직접 보지 못한 내용은 구분해 적습니다.", {
          fields: fields({ shape: "관찰한 형태", location: "이름과 설명을 확인한 위치·자료", limits: "직접 보지 못한 부분 또는 남은 질문" }), requires: [ref("scout", "G-02.shape")], ...G,
        }),
      ],
      signal: [
        step("G-03.freq", "frequency", "hash", "지휘관에게 가상 주파수를 말로 전달받아 다이얼을 맞추십시오."),
        step("G-03.words", "words", "set-hash", "정찰원이 찾은 작품이 표현하는 세 가지 가치를 입력하십시오. 순서는 달라도 됩니다.", {
          answerCount: 3, normalize: { ignoreSpaces: true }, requires: [ref("signal", "G-03.freq")], requiresReports: ["scout"], ...G,
        }),
      ],
      cipher: [
        step("G-04.spots", "spot-correct", "set-hash", "교육용 오류 문장입니다. 실제 역사 기록이 아닙니다. “1980년 5월 18일 오후 2시, 학생들은 예정된 교내 행사에 참여하려고 정문에 모였다. 충돌 이후에는 중앙도서관으로 이동했다.” 바뀐 표현 세 곳을 고르십시오.", {
          choices: ["1980년 5월 18일", "오후 2시", "예정된 교내 행사", "정문", "중앙도서관"], answerCount: 3,
        }),
        textStep("G-04.time", "공식 설명으로 집결 시각을 바로잡으십시오. 오전·오후와 시간을 적습니다.", { requires: [ref("cipher", "G-04.spots")], ...G }),
        textStep("G-04.reason", "공식 설명으로 집결 이유를 바로잡으십시오. 핵심말 또는 짧은 문장으로 적습니다.", { requires: [ref("cipher", "G-04.time")], ...G }),
        textStep("G-04.destination", "충돌 이후 이동한 곳을 공식 설명에서 확인해 적으십시오.", { requires: [ref("cipher", "G-04.reason")], ...G }),
        step("G-04.corrections", "record-form", "record", "수정한 문장과 고친 근거를 남겨 지휘관에게 보고하십시오.", {
          fields: fields({ revision: "고쳐 쓴 문장", evidence: "고친 이유와 근거" }), requires: [ref("cipher", "G-04.destination")], ...G,
        }),
      ],
    },
    yongbong: {
      scout: [
        step("Y-01.features", "multi-choice", "set-hash", "공식 설명 또는 현재 건물에서 확인되는 외형 특징 두 가지를 고르십시오.", {
          choices: ["중앙의 높은 탑상형 구조", "좌우 대칭", "전체가 원형인 건물", "정면 전체가 유리로 된 외벽"], answerCount: 2, ...Y,
        }),
        textStep("Y-01.use", "이 건물의 과거 용도를 확인하십시오.", { requires: [ref("scout", "Y-01.features")], ...Y }),
        step("Y-01.record", "record-form", "record", "외형과 과거 용도를 어떤 방법으로 확인했는지 나누어 기록하십시오.", {
          fields: fields({ observed: "관찰하거나 공식 설명으로 확인한 외형", read: "과거 용도를 확인한 설명·자료", limits: "확인하지 못한 부분" }), requires: [ref("scout", "Y-01.use")], ...Y,
        }),
      ],
      signal: [
        step("Y-02.functions", "match", "map-hash", "유형 학습 카드입니다. 실제 전시 문서가 아닙니다. 자료와 주된 기능을 연결하십시오.", {
          fields: fields({ statement: "성명서", leaflet: "전단지", minutes: "회의록", image: "사진·영상" }),
          choices: ["논의 내용과 결정 과정을 남긴다.", "촬영된 현장의 모습을 남긴다.", "작성 주체의 공식 입장과 요구를 밝힌다.", "여러 사람에게 정보와 주장을 전달한다."],
        }),
        step("Y-02.choice", "choice", "hash", "같은 사건을 여러 종류의 자료로 확인해야 하는 이유는 무엇입니까?", {
          choices: ["오래된 자료는 모두 틀리기 때문이다.", "자료가 많으면 출처를 확인하지 않아도 되기 때문이다.", "하나의 자료만으로 모든 사실을 확인하기 어렵기 때문이다.", "사진은 언제나 모든 사실을 보여주기 때문이다."], requires: [ref("signal", "Y-02.functions")],
        }),
        step("Y-02.record", "record-form", "record", "전시 또는 공식 디지털 자료 한 점을 골라 기록하십시오. 없는 정보는 '확인 불가'로 남깁니다. 이 기록은 암호해독관에게 전달됩니다.", {
          fields: fields({ title: "자료 제목", type: "자료 유형", created_at: "표시된 작성 시기", provider: "소장처 또는 제공기관", known: "자료에서 알 수 있는 내용" }), requires: [ref("signal", "Y-02.choice")], ...Y,
        }),
      ],
      cipher: [
        step("Y-03.sources", "match", "map-hash", "실제 사료가 아닌 교육용 상황 카드입니다. 각 자료에 필요한 판단을 연결하십시오.", {
          fields: fields({ a: "A · 사건 당시 작성되었고 작성 주체와 날짜가 확인되는 성명서", b: "B · 촬영 장소와 날짜가 표시되지 않은 사진", c: "C · 사건 이후 당사자가 자신의 경험을 회고한 증언", d: "D · 작성자와 근거를 알 수 없는 인터넷 게시글" }),
          choices: ["원출처를 추적하기 전에는 사실의 근거로 확정하지 않는다.", "당사자의 경험을 살피되 회고 시점과 다른 기록을 함께 확인한다.", "작성 주체의 입장과 요구를 살피고 내용의 사실 여부는 다른 근거와 비교한다.", "촬영 시점과 장소를 추가 확인한다."],
        }),
        step("Y-03.verdict", "truefalse", "hash", "자료에 관한 다음 문장을 OX로 판단하십시오.", { statements: ["당시에 만들어진 자료라면 그 안의 모든 내용이 무조건 사실이다."], requires: [ref("cipher", "Y-03.sources")] }),
        step("Y-03.limits", "record-form", "record", "통신원이 고른 자료에서 확인된 항목과 빠진 항목을 구분하고, 그 자료만으로 단정할 수 없는 내용을 보고하십시오.", {
          fields: fields({ checked: "확인된 항목", missing: "빠진 항목", limit: "단정할 수 없는 내용", question: "추가로 확인할 질문" }),
          requires: [ref("cipher", "Y-03.verdict"), ref("signal", "Y-02.record")], recordFrom: ref("signal", "Y-02.record"), ...Y,
        }),
      ],
      commander: [
        step("Y-04.classify", "classification", "map-hash", "동료의 보고를 듣고 세 문장을 사실·거짓·근거 부족으로 분류하십시오. 마지막 문장은 가상의 사진 자료 상황입니다.", {
          fields: fields({ a: "용봉관은 과거 대학 본부로 사용되었다.", b: "용봉관은 대학 본부로 사용된 적이 없다.", c: "날짜·장소 정보가 없는 이 사진은 1980년 5월 18일 전남대에서 촬영되었다." }), choices: ["사실", "거짓", "근거 부족"], requiresReports: reports,
        }),
        step("Y-04.evidence", "match", "map-hash", "각 판정에 사용한 근거를 연결하십시오.", {
          fields: fields({ a: "과거 용도에 대한 첫 번째 문장", b: "과거 용도를 부정한 두 번째 문장", c: "촬영 시점과 장소를 단정한 세 번째 문장" }),
          choices: ["촬영 정보가 확인되지 않은 교육용 상황", "정찰원이 확인한 공식 안내", "공식 안내와 충돌하는 주장"], requires: [ref("commander", "Y-04.classify")], ...Y,
        }),
        step("Y-04.revision", "record-form", "record", "수정할 초안: “성명서 한 장을 읽었으므로 사건의 모든 사실을 확인했다.” 확인한 범위와 추가 확인할 내용을 나누어 고쳐 쓰십시오.", {
          fields: fields({ verified: "자료로 확인한 내용", follow_up: "추가 확인할 내용" }), requires: [ref("commander", "Y-04.evidence")], ...Y,
        }),
      ],
    },
  };
  for (const stage of [gate, yongbong]) {
    const key = stage.id as "gate" | "yongbong";
    const priv: CourseV2PrivateInput["stages"][string] = { roles: {} as CourseV2PrivateInput["stages"][string]["roles"], steps: {} };
    for (const role of ROLES) {
      const story = STORY_B_ROLES[key][role];
      stage.roles[role] = { intro: scene(`${key}-${role}-enter`, story.intro), digit: true,
        scenes: [scene(`${key}-${role}-done`, story.complete, "role-complete"),
          ...("retry" in story ? [scene(`${key}-${role}-retry`, story.retry, "retry")] : []),
          ...(key === "gate" && role === "signal" ? [scene("G-scout-reported", "정찰원이 조형물을 찾았다. 이제 들린 단서를 작품의 설명과 연결할 차례다. 꽃잎이 무엇을 표현하는지 확인하자.", "scout-reported")] : [])],
        steps: steps[key][role],
        ...(role === "scout" ? { asset: { url: null, confirmed: false, alt: key === "gate" ? "사용 허가가 확인된 부분 사진이 없어 공식 안내와 관찰 메모로 진행합니다." : "사용 허가와 촬영 시점이 확인된 과거 사진이 없어 공식 설명과 현재 건물을 관찰합니다." } } : {}),
      };
      priv.roles[role] = { digit: answers?.stages[key].digits[role], hints: ["문항별 첫 안내를 확인하세요.", "문항별로 확인할 자료와 항목을 좁혀보세요.", "정답 대신 자료를 읽는 방법과 해설을 확인한 뒤 보고하세요."] };
      for (const s of steps[key][role]) {
        const value = answers?.stages[key].steps[s.id];
        priv.steps[s.id] = {
          ...(value && s.grading.includes("hash") ? { answer: value.answer, ...(value.acceptedAnswers ? { acceptedAnswers: value.acceptedAnswers } : {}) } : {}),
          hints: HINTS[s.id], explanation: s.grading === "record"
            ? "확인한 내용과 근거, 남은 질문을 구분하는 기록입니다. 자유 서술 내용의 역사적 진위를 자동 판정하지 않습니다."
            : "공식 설명과 동료의 보고를 다시 대조하세요. 확인한 근거와 판단이 달라진 이유를 자신의 말로 설명해보세요.",
          ...(s.id in STORY_B_STEP ? { reward: STORY_B_STEP[s.id as keyof typeof STORY_B_STEP] } : {}),
        };
      }
    }
    stage.scoring = { enabled: true, confirmed: true, hintPenalty: { 1: 0, 2: 10, 3: 10 }, noHintBonus: 0 };
    stage.completion = { type: "lock", order: [...ROLES] };
    privateInput.stages[key] = priv;
  }
  // 가상 주파수는 서버의 검증 입력에서만 정의하고 기존 계약대로 지휘관 개인 단서로 투영한다.
  if (answers) privateInput.stages.gate.roles.commander!.transferClue = {
    kind: "relay-frequency", label: "통신원에게 말로 전달할 가상 주파수",
    value: String(answers.stages.gate.steps["G-03.freq"].answer), targetStepId: "G-03.freq",
  };
  gate.narration = [scene("G-00.enter", STORY_B.gateEnter), scene("G-00.guide", STORY_B.gateGuide), scene("G-05.reports", STORY_B.gateReports, "reports-ready"), scene("G-06.done", STORY_B.gateSacho, "stage-complete")];
  gate.sacho = { id: "story-b-gate", char: "始", name: "사초① · 시작의 기록", body: "우리는 정문에서 사건의 시간과 집결 이유, 이후 이동 방향을 확인했다. 잘못된 표현을 고칠 때에는 현장의 설명과 공식 기록을 근거로 삼았다.", sections: ["사건의 흐름과 근거", "현재 조형물의 관찰", "직접 남긴 근거와 출처"] };
  yongbong.narration = [scene("Y-00.enter", STORY_B.yongbongEnter), scene("Y-00.guide", STORY_B.yongbongGuide), scene("Y-05.reports", STORY_B.yongbongReports, "reports-ready"), scene("Y-05.done", STORY_B.yongbongSacho, "stage-complete")];
  yongbong.sacho = { id: "story-b-yongbong", char: "證", name: "사초② · 검증의 기록", body: "우리는 자료의 작성 주체와 시점, 맥락을 살폈다. 한 자료가 보여주는 범위를 확인하고, 다른 자료와 비교했다. 확인되지 않은 내용은 확인되지 않았다고 남겼다.", sections: ["자료 제목·출처", "확인 범위", "추가 질문"] };
  yongbong.altModes = [{ id: "outdoor", label: "외부 대체 조사" }];
  // wall의 데이터·힌트·묵념·헌화·사초는 그대로 둔다.
  const retros: Record<Role, string> = { scout: "직접 관찰해서 확인한 것은 무엇입니까?", signal: "동료에게 정보를 전달할 때 무엇이 중요했습니까?", cipher: "처음의 판단을 바꾸게 한 근거는 무엇입니까?", commander: "서로 다른 보고를 어떤 기준으로 종합했습니까?" };
  for (const role of ROLES) {
    bongji.roles[role]!.intro = scene(`B-${role}`, STORY_B.retroGuide);
    bongji.roles[role]!.steps[0].prompt = retros[role];
    privateInput.stages.bongji.steps[bongji.roles[role]!.steps[0].id].explanation = "정해진 답이나 감정은 없습니다. 오늘의 경험을 자신의 말로 남겨주세요.";
  }
  bongji.narration = [scene("B-00.enter", STORY_B.bongjiEnter)];
  bongji.recordTemplate = { prompt: "민주주의는 개인의 ______에서 시작해 사람들의 ______로 확산되며, 역사를 정확히 기억하기 위해서는 기록에 대한 ______이 필요하다. 낱말 세 개를 고르고 팀의 문장과 선택 이유를 남기십시오. 정해진 조합은 없습니다.", wordChoices: ["용기", "연대", "책임", "검증", "존중", "참여"], wordCount: 3, sentenceParts: ["민주주의는 개인의 ", "에서 시작해 사람들의 ", "로 확산되며, 역사를 정확히 기억하기 위해서는 기록에 대한 ", "이 필요하다."] };
  return { content, privateInput };
}
export function storyBDemoCourseV2(id: string, salt: string, answers: StoryBAnswerInput) {
  const { content, privateInput } = storyBDemoV2Input(id, answers);
  return prepareCourseV2(content, privateInput, salt);
}
