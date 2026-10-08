// 폰 목업 보기(발표·녹화용): 실제 앱을 같은 출처 iframe(폰 화면 390×844)에 담아 폰 모양 틀 안에 보여 준다.
// 이 파일은 DOM 없이 시험할 수 있는 결정만 둔다(app-shell.tsx·phone-mockup.tsx가 쓴다).

// 작전 메뉴에서 고른 보기(켜면 "on", 끄면 지운다)
export const MOCKUP_KEY = "hoguk:mockup";
// ?mockup=1은 목업을 강제로 켜고, ?mockup=0은 강제로 끈다(링크·녹화·발표용)
export const MOCKUP_PARAM = "mockup";
// 틀 안 앱 → 바깥 문서 메시지 종류
export const MOCKUP_MESSAGE = "hoguk:mockup";

// 틀 치수(CSS px). 앱이 보는 화면은 아이폰 14·15와 같은 390×844로 고정하고,
// 상태 표시줄은 그 위에, 홈 표시줄은 그 아래에 틀이 따로 그린다(앱 상단 바·단추를 가리지 않게).
export const PHONE = {
  screenW: 390,
  screenH: 844,
  status: 44,
  home: 26,
  bezel: 13,
} as const;
export const PHONE_W = PHONE.screenW + PHONE.bezel * 2;
export const PHONE_H =
  PHONE.screenH + PHONE.status + PHONE.home + PHONE.bezel * 2;

// 목업을 고를 수 있는 가장 작은 창. 폰은 세로·가로 어느 쪽으로 들어도 걸리지 않고
// (세로 폭 ≤ 430, 가로 높이 ≤ 430), 태블릿과 브라우저 창 테두리를 뺀 1280×720 발표 화면·
// 150% 배율 14인치 노트북(CSS 1280×720)은 들어온다. 다만 창 높이 700 아래에서는 폰이 0.65배보다
// 작아져 본문 글자가 8px 안팎으로 작다(560에서 약 0.52배, 7px). 녹화·발표는 전체 화면을 권한다.
export const MIN_W = 700;
export const MIN_H = 560;
export const fitsMockup = (w: number, h: number) => w >= MIN_W && h >= MIN_H;

// 폰은 창 높이의 이만큼을 채운다
export const PHONE_FILL = 0.88;
// 창 위 모서리의 제호·끄기 단추가 차지하는 자리(바깥 여백 포함)
export const CORNER = { w: 176, h: 84 } as const;

export type ShellMode = "app" | "mockup" | "frame";

// 처음 열 때 한 번 정한다.
// - 목업 틀 안의 앱은 언제나 그냥 앱이다(저장값이 같은 출처라 틀 안에서 또 틀을 열지 않게).
// - 주소의 mockup=1/0이 저장값보다 앞선다. mockup=1은 창 크기와 상관없이 켠다(녹화·발표하는 사람이 고른 것).
// - 저장된 선택은 창이 충분히 클 때만 켠다. 작은 창이면 그냥 앱을 보여 주되 저장값은 지우지 않아,
//   다음에 큰 창에서 열면 다시 목업으로 연다. 목업을 보는 중에 창이 작아지면 앱을 다시 올리지 않고
//   폰만 줄인다(게임·자동 시연이 처음부터 다시 시작되지 않게). 바깥의 끄기 단추는 늘 보인다.
export function shellMode({
  inFrame,
  param,
  stored,
  fits,
}: {
  inFrame: boolean;
  param: string | null;
  stored: string | null;
  fits: boolean;
}): ShellMode {
  if (inFrame) return "frame";
  if (param === "1") return "mockup";
  if (param === "0") return "app";
  return stored === "on" && fits ? "mockup" : "app";
}

// 지금 주소에서 mockup 값만 뺀 같은 출처 경로(틀 안 iframe 주소, 보기를 바꾼 뒤의 주소).
// /j/ABCD 같은 경로와 auto=1·3d=1 같은 다른 값은 그대로 둔다.
// 경로 앞 빗금은 하나로 줄인다("//다른곳"이 다른 출처 주소로 읽히지 않게).
export function withoutMockup(pathname: string, search: string, hash = "") {
  const query = new URLSearchParams(search);
  query.delete(MOCKUP_PARAM);
  const rest = query.toString();
  return `/${pathname.replace(/^\/+/, "")}${rest ? `?${rest}` : ""}${hash}`;
}

// 창에 맞춘 폰 배율: 창 높이의 88%에 맞추되 창 폭을 넘지 않는다. 폰 옆에 위 모서리 표식이 들어갈
// 자리가 없으면(세로로 긴 좁은 창) 위아래에 표식 띠를 비운다.
// 1배보다 키우지 않는다: 틀 안 입체 장면(WebGL)은 바깥 창의 픽셀 비율로 그려 키우면 글자 옆에서 흐려진다.
export function phoneScale(w: number, h: number) {
  let scale = Math.min((h * PHONE_FILL) / PHONE_H, (w - 32) / PHONE_W, 1);
  if ((w - PHONE_W * scale) / 2 < CORNER.w)
    scale = Math.min(scale, (h - CORNER.h * 2) / PHONE_H);
  return Math.max(0.25, scale);
}

// 첫 그림 전에 보기를 정하는 인라인 스크립트(app/layout.tsx가 <body> 맨 앞에 넣는다).
// 서버는 언제나 그냥 앱을 그려 보내고, 목업으로 열 때만 이 스크립트가 <html data-mockup>을 달아
// 그 앱을 감추고(globals.css) window.__hogukMockup을 남긴다. app-shell.tsx는 이 값을 보고 서버가 그린 앱을
// 수화(hydrate)하지 않고 둔 채 폰 틀만 올린다. 규칙은 shellMode와 같다(tests/mockup-view.test.ts가 맞춰 본다).
export const MOCKUP_GLOBAL = "__hogukMockup";
export const MOCKUP_ATTR = "data-mockup";
export const mockupBootScript = () =>
  `(function(){try{var w=window,f=w.frameElement;` +
  `if(f&&f.hasAttribute("data-phone-screen"))return;` +
  `var p=new URLSearchParams(w.location.search).get(${JSON.stringify(MOCKUP_PARAM)}),s=null;` +
  `try{s=w.localStorage.getItem(${JSON.stringify(MOCKUP_KEY)})}catch(e){}` +
  `if(p==="1"||(p!=="0"&&s==="on"&&w.innerWidth>=${MIN_W}&&w.innerHeight>=${MIN_H})){` +
  `w.${MOCKUP_GLOBAL}=1;w.document.documentElement.setAttribute(${JSON.stringify(MOCKUP_ATTR)},"")}` +
  `}catch(e){}})()`;

// 틀 안 앱 → 바깥 문서: 목업 끄기, 전체 화면, 대화 상자가 열려 화면이 어두워졌는지(dim/undim)
export type MockupAction = "exit" | "fullscreen" | "dim" | "undim";
const ACTIONS: readonly string[] = ["exit", "fullscreen", "dim", "undim"];
// 틀 안 앱이 보낸 메시지에서 할 일을 읽는다(모르는 모양이면 null)
export function readMockupMessage(data: unknown): MockupAction | null {
  if (!data || typeof data !== "object") return null;
  const { type, action } = data as { type?: unknown; action?: unknown };
  return type === MOCKUP_MESSAGE &&
    typeof action === "string" &&
    ACTIONS.includes(action)
    ? (action as MockupAction)
    : null;
}
