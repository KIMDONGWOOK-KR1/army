"use client";
import { useEffect, useState } from "react";
import {
  Radio,
  Check,
  LockKeyhole,
  ArrowRight,
  CalendarDays,
} from "lucide-react";
import {
  ROLE_NAMES,
  type Snapshot,
  type Command,
} from "@/supabase/functions/_shared/types";
export function Mission({
  snapshot,
  busy,
  send,
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
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
  const submit = async () => {
    const next = await send({
      action: "submit-report",
      site_id: site.id,
      role: self.role!,
      answer: clue.type === "frequency" ? frequency : answer,
    });
    if (next) setWrong(next.result?.ok === false);
  };
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
        <div className="radio-panel">
          <Radio size={22} />
          <div className="frequency-display">
            {frequency}
            <small>MHz</small>
          </div>
          <div className="waveform" aria-hidden="true">
            {Array.from({ length: 31 }, (_, i) => (
              <i
                key={i}
                style={{ height: 8 + Math.abs(Math.sin(i * 0.7)) * 22 }}
              />
            ))}
          </div>
          <label htmlFor="frequency">주파수 조절</label>
          <input
            id="frequency"
            type="range"
            min={clue.min ?? 10}
            max={clue.max ?? 100}
            step="0.1"
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value).toFixed(1))}
          />
          <div className="frequency-controls">
            <button
              className="button secondary"
              aria-label="주파수 0.1 낮추기"
              onClick={() =>
                setFrequency(
                  Math.max(clue.min ?? 10, Number(frequency) - 0.1).toFixed(1),
                )
              }
            >
              −
            </button>
            <input
              aria-label="주파수 직접 입력"
              type="number"
              min={clue.min ?? 10}
              max={clue.max ?? 100}
              step="0.1"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            />
            <button
              className="button secondary"
              aria-label="주파수 0.1 높이기"
              onClick={() =>
                setFrequency(
                  Math.min(clue.max ?? 100, Number(frequency) + 0.1).toFixed(1),
                )
              }
            >
              +
            </button>
          </div>
        </div>
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
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
  now: number;
}) {
  const [digits, setDigits] = useState(["", "", "", ""]),
    [feedback, setFeedback] = useState("");
  const lock = snapshot.self.lock!;
  useEffect(() => {
    setDigits(lock.digits.map((d) => (d === null ? "" : String(d))));
  }, [JSON.stringify(lock.digits), snapshot.current_site.id]);
  const remaining = Math.max(
      0,
      Math.ceil(((lock.nextAttemptAt ?? 0) - now) / 1000),
    ),
    reports = snapshot.game.report_mask.every(Boolean);
  const submit = async () => {
    const next = await send({
      action: "open-lock",
      site_id: snapshot.current_site.id,
      digits: digits.map(Number),
    });
    if (next) {
      setDigits(
        next.self.lock!.digits.map((d) => (d === null ? "" : String(d))),
      );
      setFeedback(
        next.result?.ok
          ? "기록을 복원했다."
          : "맞은 칸은 잠겼다. 틀린 칸을 다시 확인하라. −10점",
      );
    }
  };
  return (
    <section className="lock-panel">
      <div className="section-label">
        <span>
          <LockKeyhole size={16} /> 기록의 자물쇠
        </span>
        <span>{snapshot.game.attempts_left}회 남음</span>
      </div>
      <h3>네 개의 보고를 모아라.</h3>
      <p className="subtle">숫자는 팀원에게 말로 전해 들어라.</p>
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
