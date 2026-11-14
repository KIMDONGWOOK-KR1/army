"use client";
// 통신원 무전기: 지휘관이 말로 불러 준 채널로 다이얼(FrequencyTuner)을 맞춘다. 채널 값은 지휘관 폰에만 있고 서버가 확인한다.
// 다이얼 잡음은 돌리는 중인지에만 반응한다(정답 거리를 알려 주지 않는다). 맞으면 기록실 무전(서버 보상 글)이 또렷해진다.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { isV2Response, type GameResponse, type V2Response } from "@/lib/game-snapshot";
import { plain } from "@/lib/practice-text";
import { play } from "@/lib/sound";
import type { Command, Step } from "@/supabase/functions/_shared/types";
import { FrequencyTuner } from "../frequency-tuner";
import s from "./dogam.module.css";

const NOISE = "░▒▓";
const isSolved = (status?: string) => status === "done" || status === "explained";

/** 서버가 준 무전 글을 잡음 글자에서 또렷한 글자로 바꿔 보여 준다. */
function useDecode(text: string, run: boolean, reduce: boolean) {
  const [out, setOut] = useState(run && !reduce ? "" : text);
  useEffect(() => {
    if (!text) return;
    if (!run || reduce) { setOut(text); return; }
    const chars = [...text], order = chars.map((_, i) => i).sort(() => Math.random() - 0.5);
    const shown = new Set<number>();
    let i = 0;
    play("typewriter");
    const timer = window.setInterval(() => {
      for (let n = 0; n < Math.ceil(chars.length / 18) && i < order.length; n++) shown.add(order[i++]);
      setOut(chars.map((c, j) => shown.has(j) || " .,…".includes(c) ? c : NOISE[(j + i) % 3]).join(""));
      if (i >= order.length) window.clearInterval(timer);
    }, 70);
    return () => window.clearInterval(timer);
  }, [text, run, reduce]);
  return out;
}

export function RadioSet({ step, snapshot, busy, send, reduce }: {
  step: Step; snapshot: V2Response; busy: boolean; reduce: boolean;
  send: (command: Command) => Promise<GameResponse | null>;
}) {
  const progress = snapshot.self.step_progress[step.id];
  const solved = isSolved(progress?.status);
  const reward = snapshot.self.rewards[step.id] ?? "";
  // 이 화면에서 방금 맞춘 경우에만 잡음 → 또렷 효과를 낸다(다시 열면 바로 보인다)
  const fresh = useRef(!solved);
  const message = useDecode(plain(reward), fresh.current, reduce);
  const [value, setValue] = useState("50.0");
  const [note, setNote] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || solved) return;
    setNote("");
    const next = await send({ action: "submit-step", stage_id: snapshot.stage.id, step_id: step.id, answer: value });
    if (!next || !isV2Response(next)) return;
    if (next.result?.accepted === false)
      setNote("잡음뿐이에요. 지휘관에게 채널을 다시 물어보고 소수점 자리까지 맞춰요.");
  };
  return <section className={s.radio} data-testid={`dogam-step-${step.id}`} data-solved={solved || undefined}>
    {!solved ? <form onSubmit={(e) => void submit(e)} autoComplete="off" className={s.radioForm}>
      <FrequencyTuner value={value} onChange={setValue} min={10} max={100} strictInput disabled={busy} />
      <button type="submit" className={`${s.btn} ${s.roleBtn}`} disabled={busy}>
        이 채널로 듣기 <Radio size={18} aria-hidden />
      </button>
      {note && <p className={s.wrongNote} role="status">{note}</p>}
    </form> : <div className={s.radioMsg} aria-live="polite" data-testid="dogam-radio-message">
      <span className={s.radioLabel}><Radio size={16} aria-hidden /> 기록실 무전 · 내 폰에만 들려요</span>
      <p>{message || "채널을 해설로 확인했어요. 무전은 다음 문항 안내를 따라가요."}</p>
    </div>}
  </section>;
}
