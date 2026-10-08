"use client";
import { useEffect, useState } from "react";
import { Check, LockKeyhole, ArrowRight, CalendarDays } from "lucide-react";
import {
  ROLE_NAMES,
  type Snapshot,
  type Command,
} from "@/supabase/functions/_shared/types";
import { FrequencyTuner } from "./frequency-tuner";
import { formatTenths, glide, toTenths } from "./dial-math";
export function Mission({
  snapshot,
  busy,
  send,
  auto,
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
  auto?: string;
}) {
  const { self, current_site: site } = snapshot,
    clue = self.clue!;
  const [answer, setAnswer] = useState(""),
    [frequency, setFrequency] = useState("50.0"),
    [wrong, setWrong] = useState(false);
  useEffect(() => {
    setAnswer("");
    setFrequency("50.0");
    setWrong(false);
  }, [site.id, self.role]);
  const submit = async (value?: string) => {
    const next = await send({
      action: "submit-report",
      site_id: site.id,
      role: self.role!,
      answer: value ?? (clue.type === "frequency" ? frequency : answer),
    });
    if (next) setWrong(next.result?.ok === false);
  };
  // 자동 시연: 답을 고르는(주파수는 돌리는) 모습을 보여 준 뒤 보고한다.
  useEffect(() => {
    if (!auto || self.reported) return;
    const timers: number[] = [];
    const at = (ms: number, f: () => void) =>
      timers.push(window.setTimeout(f, ms));
    let t = 2200;
    if (clue.type === "frequency")
      // 다이얼을 50.0에서 목표까지 천천히 출발해 감속하며 돌린다.
      for (const v of glide(toTenths(50), toTenths(Number(auto))))
        at((t += 70), () => setFrequency(formatTenths(v)));
    else if (clue.choices) at(t, () => setAnswer(auto));
    else
      for (let i = 1; i <= auto.length; i++)
        at((t += 180), () => setAnswer(auto.slice(0, i)));
    at(t + 1400, () => void submit(auto));
    return () => timers.forEach(window.clearTimeout);
  }, [auto, self.reported, site.id, self.role]);
  if (self.reported)
    return (
      <div className="digit-result">
        <div className="round-icon success">
          <Check />
        </div>
        <span className="eyebrow">REPORT COMPLETE</span>
        <h3>단서를 기록했다.</h3>
        <p>이 숫자를 지휘관에게 말로 전하라.</p>
        <div className="private-digit">{self.digit}</div>
        <p className="subtle">
          자신의 기기에만 보이는 숫자다.
          <br />
          다른 기기에는 보고 완료 표시만 전달된다.
        </p>
      </div>
    );
  return (
    <div className="mission-form">
      <div className="section-label">
        <span>{ROLE_NAMES[self.role!]}의 단서</span>
        <span>개인 미션</span>
      </div>
      <h3>{clue.title}</h3>
      <p className="question">{clue.question}</p>
      <div className="clue-hint">{clue.hint}</div>
      {clue.type === "calendar" && (
        <div className="calendar">
          <div>
            <CalendarDays size={17} /> 1980년 5월
          </div>
          <div className="calendar-grid">
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
              <b key={d}>{d}</b>
            ))}
            {Array.from({ length: 4 }, (_, i) => (
              <span key={`blank${i}`} />
            ))}
            {Array.from({ length: 31 }, (_, i) => (
              <span key={i} className={i === 17 ? "marked" : ""}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      )}
      {clue.type === "frequency" ? (
        <FrequencyTuner
          value={frequency}
          onChange={(v) => {
            setFrequency(v);
            setWrong(false);
          }}
          min={clue.min ?? 10}
          max={clue.max ?? 100}
        />
      ) : clue.choices ? (
        <div className={`choices ${clue.type === "hanja" ? "hanja" : ""}`}>
          {clue.choices.map((choice, i) => (
            <button
              key={i}
              aria-pressed={
                answer === (clue.type === "calendar" ? choice : String(i + 1))
              }
              className={
                answer === (clue.type === "calendar" ? choice : String(i + 1))
                  ? "selected"
                  : ""
              }
              onClick={() => {
                setAnswer(clue.type === "calendar" ? choice : String(i + 1));
                setWrong(false);
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <label className="field-label">
          찾은 단서의 답
          <input
            maxLength={200}
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              setWrong(false);
            }}
            placeholder="현장에서 찾은 답을 입력하라"
            autoComplete="off"
          />
        </label>
      )}
      {wrong && (
        <p role="status" className="inline-error">
          단서를 다시 살펴라. 보고 오답에는 감점이 없다.
        </p>
      )}
      <button
        className="button primary full"
        disabled={
          busy ||
          (!answer && clue.type !== "frequency") ||
          (!frequency && clue.type === "frequency")
        }
        onClick={() => void submit()}
      >
        {busy ? "보고 중…" : "단서 확인하고 보고"}
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
export function LockPanel({
  snapshot,
  busy,
  send,
  now,
  digits,
  setDigits,
  auto,
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
  now: number;
  digits: string[];
  setDigits: (digits: string[]) => void;
  auto?: string[];
}) {
  const [feedback, setFeedback] = useState("");
  const lock = snapshot.self.lock!;
  const remaining = Math.max(
      0,
      Math.ceil(((lock.nextAttemptAt ?? 0) - now) / 1000),
    ),
    reports = snapshot.game.report_mask.every(Boolean);
  const submit = async (value = digits) => {
    const next = await send({
      action: "open-lock",
      site_id: snapshot.current_site.id,
      digits: value.map(Number),
    });
    if (next) {
      setFeedback(
        next.result?.ok
          ? "기록을 복원했다."
          : "맞은 칸은 잠겼다. 틀린 칸을 다시 확인하라. −10점",
      );
    }
  };
  // 자동 시연: 전해 들은 숫자를 한 칸씩 넣고 자물쇠를 연다.
  useEffect(() => {
    if (!auto || !reports || lock.openedAt) return;
    const timers = auto.map((_, i) =>
      window.setTimeout(
        () => setDigits(auto.map((d, j) => (j <= i ? d : ""))),
        1500 + i * 700,
      ),
    );
    timers.push(
      window.setTimeout(
        () => void submit(auto),
        1500 + auto.length * 700 + 900,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [auto?.join(), reports, snapshot.current_site.id]);
  return (
    <section className="lock-panel">
      <div className="section-label">
        <span>
          <LockKeyhole size={16} /> 기록의 자물쇠
        </span>
        <span>{snapshot.game.attempts_left}회 남음</span>
      </div>

      <div className="lock-digits">
        {snapshot.current_site.lockOrder.map((role, i) => (
          <label key={role}>
            <span>{ROLE_NAMES[role]}</span>
            <input
              aria-label={`${ROLE_NAMES[role]} 잠금 숫자`}
              inputMode="numeric"
              pattern="[0-9]"
              maxLength={1}
              value={digits[i]}
              disabled={lock.digits[i] !== null || busy}
              onChange={(e) => {
                const next = [...digits];
                next[i] = e.target.value.replace(/\D/g, "").slice(-1);
                setDigits(next);
              }}
              className={lock.digits[i] !== null ? "locked" : ""}
            />
            <small>
              {lock.digits[i] !== null ? (
                <LockKeyhole size={13} />
              ) : snapshot.game.report_mask[i] ? (
                <Check size={14} />
              ) : (
                <span>대기</span>
              )}
            </small>
          </label>
        ))}
      </div>
      {feedback && (
        <p className="inline-error" role="status">
          {feedback}
        </p>
      )}
      {remaining > 0 && (
        <div className="cooldown" role="timer">
          다음 시도까지 <b>{remaining}초</b>
        </div>
      )}
      <button
        className="button dark full"
        disabled={
          busy || !reports || remaining > 0 || digits.some((x) => x === "")
        }
        onClick={() => void submit()}
      >
        {!reports
          ? "네 보직의 보고를 기다리는 중"
          : remaining > 0
            ? "다음 시도 대기 중"
            : "자물쇠 확인"}
        <LockKeyhole size={17} />
      </button>
      <p className="fine-print">오답 −10점 · 3회 소진 후 60초마다 1회 추가</p>
    </section>
  );
}
