"use client";
import {
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import GameApp, { type MockupControl } from "./game-app";
import { PhoneMockup } from "./phone-mockup";
import {
  MOCKUP_ATTR,
  MOCKUP_GLOBAL,
  MOCKUP_KEY,
  MOCKUP_MESSAGE,
  fitsMockup,
  withoutMockup,
  type MockupAction,
} from "./mockup-view";
import { markViewSwitch } from "./view-handoff";

// 그냥 앱(지금 화면)과 폰 목업 보기를 오간다.
// - 서버는 언제나 그냥 앱(GameApp)을 그려 보낸다. 폰에서도 JS가 오기 전에 첫 화면이 보인다.
// - 목업으로 열 문서는 layout의 인라인 스크립트(mockup-view.ts의 mockupBootScript)가 첫 그림 전에
//   <html data-mockup>으로 그 앱을 감추고 window.__hogukMockup을 남긴다. 그러면 여기서는 서버가 그린 앱을
//   수화(hydrate)하지 않고 둔 채 폰 틀만 올린다. 바깥 문서에서 GameApp이 한 번도 돌지 않아
//   게임·소리·자동 시연이 둘이 되지 않는다. 목업을 끄면 그때 그 앱을 수화한다.
// - 지금 화면에서 메뉴로 켜면 GameApp을 내리고 폰 틀을 올린다(주소는 그대로, 고른 보기는 저장).

type View = { hosting: boolean; src: string };
const APP_VIEW: View = { hosting: false, src: "" };
const here = () => {
  const { pathname, search, hash } = window.location;
  return withoutMockup(pathname, search, hash);
};
const booted =
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>)[MOCKUP_GLOBAL];
let view: View = booted ? { hosting: true, src: here() } : APP_VIEW;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const setView = (next: View) => {
  view = next;
  listeners.forEach((listener) => listener());
};
const useView = () =>
  useSyncExternalStore(
    subscribe,
    () => view,
    () => APP_VIEW,
  );

// 서버가 그린 앱의 수화를 미루는 문(목업으로 연 문서에서만 닫혀 있다)
let gateShut = booted;
let openGate = () => {};
const gate = new Promise<void>((resolve) => {
  openGate = () => {
    gateShut = false;
    resolve();
  };
});
// 감춰 둔 서버 앱의 본문 id를 잠시 비켜 '본문으로 건너뛰기'가 폰 화면(iframe#main-content)으로 가게 한다
function parkServerMain(park: boolean) {
  const main = document.querySelector<HTMLElement>(
    `.game-viewport [id="${park ? "main-content" : "main-content-parked"}"]`,
  );
  if (main) main.id = park ? "main-content-parked" : "main-content";
}

function writeStored(on: boolean) {
  try {
    if (on) localStorage.setItem(MOCKUP_KEY, "on");
    else localStorage.removeItem(MOCKUP_KEY);
  } catch {}
}
// 메뉴나 끄기 단추로 보기를 바꾼다. 주소의 mockup 값은 지워 새로 고쳐도 고른 보기(저장값)가 이어진다.
function enterMockup() {
  const src = here();
  writeStored(true);
  window.history.replaceState(null, "", src);
  markViewSwitch();
  document.documentElement.setAttribute(MOCKUP_ATTR, "");
  setView({ hosting: true, src });
}
function exitMockup() {
  writeStored(false);
  window.history.replaceState(null, "", here());
  markViewSwitch();
  const dehydrated = gateShut;
  if (dehydrated) parkServerMain(false);
  (window as unknown as Record<string, unknown>)[MOCKUP_GLOBAL] = 0;
  document.documentElement.removeAttribute(MOCKUP_ATTR);
  setView(APP_VIEW);
  if (dehydrated) openGate();
}

// 이 문서가 같은 출처 폰 목업 틀(data-phone-screen iframe) 안에서 열렸는가.
// 다른 출처의 틀 안이면 frameElement가 null이라 그냥 앱으로 연다.
function inPhoneFrame() {
  try {
    return !!window.frameElement?.hasAttribute("data-phone-screen");
  } catch {
    return false;
  }
}
// 틀 안 앱 → 바깥 문서(같은 출처로만 보낸다)
function tellHost(action: MockupAction) {
  window.parent.postMessage(
    { type: MOCKUP_MESSAGE, action },
    window.location.origin,
  );
}
// 틀 안 앱의 대화 상자(작전 메뉴·안내 등)가 열려 화면이 어두워지면 바깥 틀의 상태·홈 표시줄도 같이 어둡게 한다
function watchDim() {
  let dim = false;
  const open = () => {
    try {
      return !!document.querySelector("dialog:modal");
    } catch {
      return !!document.querySelector("dialog[open]");
    }
  };
  const check = () => {
    const next = open();
    if (next === dim) return;
    dim = next;
    tellHost(next ? "dim" : "undim");
  };
  const watch = new MutationObserver(check);
  watch.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  return () => watch.disconnect();
}
const FRAME_CONTROL: MockupControl = {
  on: true,
  toggle: () => tellHost("exit"),
  fullscreen: () => tellHost("fullscreen"),
};
const HOST_CONTROL: MockupControl = { on: false, toggle: enterMockup };
// 작전 메뉴의 목업 단추: 틀 안이면 '폰 목업 끄기', 창이 충분히 크면 '폰 목업으로 보기'(창 크기를 바꿀 때마다 다시 따진다)
function useMockupControl() {
  const [control, setControl] = useState<MockupControl>();
  useEffect(() => {
    if (inPhoneFrame()) {
      setControl(FRAME_CONTROL);
      return watchDim();
    }
    const measure = () =>
      setControl(
        fitsMockup(window.innerWidth, window.innerHeight)
          ? HOST_CONTROL
          : undefined,
      );
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return control;
}

function AppView({ joinCode }: { joinCode: string }) {
  // 목업으로 연 문서: 문이 열릴 때까지(목업을 끌 때까지) 서버가 그린 앱을 수화하지 않는다
  if (gateShut) use(gate);
  const { hosting } = useView(),
    control = useMockupControl();
  if (hosting) return null;
  return <GameApp joinCode={joinCode} mockup={control} />;
}

function MockupHost() {
  const { hosting, src } = useView();
  useLayoutEffect(() => {
    if (!hosting) return;
    // 개발 모드(Strict Mode)는 수화 뒤 <html> 속성을 지우기도 해서 다시 단다
    document.documentElement.setAttribute(MOCKUP_ATTR, "");
    if (gateShut) parkServerMain(true);
  }, [hosting]);
  return hosting ? <PhoneMockup src={src} onExit={exitMockup} /> : null;
}

export default function AppShell({ joinCode = "" }: { joinCode?: string }) {
  return (
    <>
      <Suspense fallback={null}>
        <AppView joinCode={joinCode} />
      </Suspense>
      <MockupHost />
    </>
  );
}
