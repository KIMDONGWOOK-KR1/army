"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Fingerprint } from "lucide-react";
import type { Role } from "@/supabase/functions/_shared/types";
import { PAPER_DURATION, PAPER_MOVE, PAPER_OUT, paperDestination, type PaperMotion } from "@/lib/paper-motion";
import { ROLE_ICONS } from "./role-style";
import s from "./story-discovery.module.css";

/** Contains only invented paper shapes and a public role emblem. */
export function PaperProp({ role, reward }: { role: Role; reward: boolean }) {
  const Icon = ROLE_ICONS[role];
  return <span className={s.paperProp}>
    <span className={s.envelopeBack} />
    <span className={s.insert} data-paper-part="insert"><Icon size={42} strokeWidth={1.5} /><span /><span /></span>
    <span className={s.flap} />
    <span className={s.envelopeLid} data-paper-part="lid" />
    <span className={s.seal} data-paper-part="seal">{reward ? <Check size={30} strokeWidth={3} /> : <Fingerprint size={32} />}</span>
  </span>;
}

/** A disposable, non-interactive drawing; the real tool is usable immediately. */
export function PaperFlight({ motion, role, onFinish }: { motion: PaperMotion; role: Role; onFinish: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current, preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (!node || preference.matches || typeof node.animate !== "function") { onFinish(); return; }
    let stopped = false;
    const animations: Animation[] = [];
    const finish = () => { if (!stopped) { stopped = true; animations.forEach((a) => a.cancel()); onFinish(); } };
    const animate = (element: Element | null, frames: Keyframe[], duration: number, easing = PAPER_OUT) => {
      if (element) {
        const animation = element.animate(frames, { duration, easing, fill: "both" });
        void animation.finished.catch(() => {});
        animations.push(animation);
      }
    };
    try {
      animate(node.querySelector('[data-paper-part="seal"]'), [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: "translateY(-12px) scale(.96)", opacity: 0 },
      ], 140);
      animate(node.querySelector('[data-paper-part="lid"]'), [
        { transform: "rotateX(0deg)" }, { transform: "rotateX(-165deg)" },
      ], 220);
      animate(node.querySelector('[data-paper-part="insert"]'), [
        { transform: "translateY(0) rotate(5deg)" },
        { transform: "translateY(-45%) rotate(0deg)" },
      ], 240);
      // Keep the paper legible while it unfolds; opacity must not inherit the fast movement curve.
      animate(node, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: .65 }, { opacity: 0, offset: 1 }], PAPER_DURATION, "linear");
      animate(node, [
        { transform: "translate(0, 0) scale(1)" },
        { transform: paperDestination(motion) },
      ], PAPER_DURATION, motion.kind === "collect" ? PAPER_MOVE : PAPER_OUT);
      void animations.at(-1)!.finished.then(finish, finish);
    } catch { finish(); }
    // Abandon the decoration on new input, view changes, backgrounding or preference changes.
    const events = ["scroll", "resize", "pointerdown", "keydown", "pagehide"] as const;
    events.forEach((event) => window.addEventListener(event, finish, { capture: true, passive: true }));
    const visibility = () => { if (document.hidden) finish(); };
    document.addEventListener("visibilitychange", visibility);
    preference.addEventListener("change", finish);
    return () => {
      stopped = true; animations.forEach((a) => a.cancel());
      events.forEach((event) => window.removeEventListener(event, finish, true));
      document.removeEventListener("visibilitychange", visibility);
      preference.removeEventListener("change", finish);
    };
  }, [motion, onFinish]);
  return createPortal(<div ref={root} className={s.paperFlight} data-testid="story-paper-flight" data-kind={motion.kind}
    aria-hidden="true" style={{ left: motion.from.left, top: motion.from.top, width: motion.from.width, height: motion.from.height }}>
    <PaperProp role={role} reward={motion.kind === "collect"} />
  </div>, document.body);
}
