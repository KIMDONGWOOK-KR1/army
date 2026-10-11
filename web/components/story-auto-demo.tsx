"use client";
import { useEffect, useRef, useState } from "react";
import { ROLE_NAMES, ROLES, type Role } from "@/supabase/functions/_shared/types";
import styles from "./story-auto-demo.module.css";

type Step = { caption: string; selector?: string; text?: string; value?: string; optional?: boolean; settledSelector?: string; delay?: number };
const button = (text: string, caption: string): Step => ({ text, caption });
const target = (id: string, caption: string): Step => ({ selector: `[data-testid="${id}"]`, caption });
const role = (r: Role): Step => ({ selector: '[aria-label="시연 보직 전환"] button', text: ROLE_NAMES[r], caption: `${ROLE_NAMES[r]}의 화면으로 바꿔봅니다.` });
const help = (): Step => ({ selector: '[data-testid="story-help"] summary', caption: "도움 무전을 열어 단계별 힌트를 확인합니다." });

/** A presentation of the public UI, using the normal assisted-completion path.
 * No answers, private input, server shortcuts, or multiplayer actions live here. */
export const STORY_DEMO_STEPS: Step[] = (() => {
  const steps: Step[] = [];
  for (const place of ["정문", "용봉관"]) {
    steps.push({ ...button("시연 거점에 도착", `${place}까지 지도를 따라 이동합니다.`), delay: 6000 },
      { ...target("story-open-clue", "봉투를 열어 단서를 살펴봅니다."), optional: true }, help());
    for (const r of ROLES) for (const level of [1, 2, 3])
      steps.push(button(`${ROLE_NAMES[r]} ${level}단계 힌트`, `${ROLE_NAMES[r]}에게 도움을 보냅니다. 시연은 해설로 진행합니다.`));
    for (const r of ["scout", "signal", "cipher", "commander"] as const) {
      steps.push(role(r), { ...target("story-claim", "조사 기록을 펼쳐 수첩에 모읍니다."), optional: true }, help(),
        button("내 해설 읽음 확인", "해설을 확인한 뒤 동료에게 기록을 전합니다."), button("조사 결과 보고", "네 보직의 보고가 모이면 팀 자물쇠로 이어집니다."));
    }
    steps.push(button("팀 자물쇠로", "팀의 보고가 모두 모였습니다."), button("해설 확인 후 복원", "해설로 기록을 복원하고 사초를 받습니다."),
      { ...target("depart-next-stage", "사초를 간직하고 다음 장소로 이동합니다."), delay: 4500 });
  }
  steps.push({ ...button("시연 거점에 도착", "용봉열사 추모의 벽으로 이동합니다."), delay: 6000 },
    { ...button("묵념 마치기", "잠시 멈춰 추모의 마음을 나눕니다."), delay: 12000, settledSelector: '[data-testid="tribute"]' });
  for (const r of ["scout", "signal", "cipher", "commander"] as const)
    steps.push(role(r), button("국화 올리기", "각자의 마음을 담아 국화를 올립니다."));
  steps.push({ ...target("depart-next-stage", "추모의 마음을 간직하고 봉지로 이동합니다."), delay: 4500 },
    { ...button("시연 거점에 도착", "봉지에서 오늘의 기록을 돌아봅니다."), delay: 6000 });
  for (const r of ["scout", "signal", "cipher", "commander"] as const)
    steps.push(role(r), { selector: 'textarea[aria-label="개인 회고 본문"]', value: `[자동 시연 예시 · ${ROLE_NAMES[r]}] 동료의 기록을 듣고 함께 기억하는 경험을 돌아봅니다.`, caption: "시연용 회고 예시를 남깁니다. 직접 체험할 때는 나의 생각을 적어보세요." }, button("회고 저장", "네 사람의 회고가 모입니다."));
  steps.push(button("공동 기록 작성", "낱말을 골라 우리 팀의 문장을 만듭니다."));
  for (let i = 1; i <= 3; i++) steps.push(button(`낱말 자리 ${i}`, "문장의 빈자리를 고릅니다."), target(`joint-word-${i}`, "공개된 낱말로 시연용 문장을 만듭니다. 정해진 정답은 없습니다."));
  steps.push({ selector: 'textarea[aria-label="공동 근거"]', value: "자동 시연 예시: 함께 모은 기록과 헌화, 네 보직의 회고를 바탕으로 작성했습니다.", caption: "함께 고른 문장의 근거를 남깁니다." }, button("공동 기록 저장", "팀의 공동 기록을 저장합니다."));
  for (const r of ROLES) steps.push(role(r), button("공동 기록에 동의", "시연 보직들이 공동 문장을 확인합니다."));
  return steps;
})();

export function StoryAutoDemo({ paused, blocked, failed, finished, onPause, onResume, onStop }: {
  paused: boolean; blocked: boolean; failed: boolean; finished: boolean; onPause: () => void; onResume: () => void; onStop: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const attempts = useRef(0);
  const current = STORY_DEMO_STEPS[index];
  const complete = finished;
  // Manual input takes over immediately. Programmatic demo clicks are untrusted.
  useEffect(() => {
    const takeOver = (event: Event) => {
      if (event.isTrusted && !(event.target as Element)?.closest?.('[data-testid="auto-demo-controls"]')) onPause();
    };
    const hide = () => { if (document.hidden) onPause(); };
    document.addEventListener("pointerdown", takeOver, true);
    document.addEventListener("keydown", takeOver, true);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("pointerdown", takeOver, true);
      document.removeEventListener("keydown", takeOver, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [onPause]);
  useEffect(() => {
    if (failed) { setNotice("요청을 완료하지 못해 멈췄습니다. 화면의 안내를 확인해주세요."); onPause(); }
  }, [failed, onPause]);
  useEffect(() => {
    if (paused || blocked || failed || finished || !current || document.hidden) return;
    const timer = window.setInterval(() => {
      const scope = document.querySelector('[data-auto-demo-surface]');
      // The existing memorial animation can finish the bow itself. Wait for its
      // flower panel instead of requiring a button that has already disappeared.
      const settled = current.settledSelector && scope?.querySelector<HTMLElement>(current.settledSelector);
      if (settled && settled.getClientRects().length > 0) {
        attempts.current = 0; setIndex((i) => i + 1); return;
      }
      const candidates = Array.from(scope?.querySelectorAll<HTMLElement>(current.selector ?? "button") ?? []);
      const element = candidates.find((el) => el.getClientRects().length > 0 && !el.closest("[hidden]") &&
        (!current.text || (el.getAttribute("aria-label") ?? el.textContent?.trim()) === current.text));
      if (!element || element.matches(":disabled")) {
        if (current.optional) { attempts.current = 0; setIndex((i) => i + 1); return; }
        if (++attempts.current >= 15) {
          setNotice("진행 화면이 달라 잠시 멈췄습니다. 직접 이어서 체험할 수 있어요."); onPause();
        }
        return;
      }
      attempts.current = 0;
      element.scrollIntoView({ block: "center", behavior: "instant" });
      if (current.value !== undefined && element instanceof HTMLTextAreaElement) {
        // Use the native setter so React's onChange observes this ordinary input event.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, current.value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (!(element.tagName === "SUMMARY" && (element.parentElement as HTMLDetailsElement).open)) element.click();
      setIndex((i) => i + 1);
    }, current.delay ?? 1800);
    return () => window.clearInterval(timer);
  }, [index, current, paused, blocked, failed, finished, onPause]);
  return <aside className={styles.panel} data-testid="auto-demo-controls" data-demo-step={index} aria-label="자동 시연 제어">
    <div><strong>{complete ? "시연을 모두 마쳤어요" : paused ? "시연 일시정지" : "자동 시연 · 해설로 체험"}</strong>
      <p role="status">{(complete ? "정문부터 공동 기록까지 함께 걸었습니다." : current?.caption ?? "마지막 동의를 저장하고 결과를 기다립니다.")}</p>{notice && <p role="alert">{notice}</p>}</div>
    <div className={styles.actions}>
      {!complete && <button type="button" onClick={() => { setNotice(""); attempts.current = 0; if (paused) onResume(); else onPause(); }}>{paused ? "시연 계속" : "일시정지"}</button>}
      <button type="button" onClick={onStop}>{complete ? "시연 닫기" : "직접 체험하기"}</button>
    </div>
  </aside>;
}
