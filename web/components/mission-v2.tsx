"use client";

import { type FormEvent, useState } from "react";
import { BookOpen, Check, LockKeyhole, Radio } from "lucide-react";
import {
  type GameResponse,
  isV2Response,
  type V2Response,
} from "@/lib/game-snapshot";
import {
  type Command,
  ROLE_NAMES,
  ROLES,
  type Step,
  type StepAnswer,
} from "@/supabase/functions/_shared/types";
import { emptyStepAnswer, VerifyInput } from "./verify-input";
import { isLegacyMissionStep, LegacyMissionInput } from "./legacy-mission-input";
import { useLockDraft } from "./use-lock-draft";
import styles from "./mission-v2.module.css";

type Props = {
  snapshot: V2Response;
  busy: boolean;
  now: number;
  send: (command: Command) => Promise<GameResponse | null>;
};
const labels = {
  locked: "선행 조사 대기",
  open: "조사 중",
  done: "조사 완료",
  explained: "해설로 확인",
};

function StepCard(
  { step, snapshot, busy, send }: Omit<Props, "now"> & { step: Step },
) {
  const legacyInput = snapshot.course.demo &&
    isLegacyMissionStep(snapshot.stage.id, snapshot.self.role, step);
  const [answer, setAnswer] = useState<StepAnswer>(() =>
    legacyInput && step.type === "frequency" ? "50.0" : emptyStepAnswer(step));
  const [method, setMethod] = useState<
    "" | "field" | "official_digital" | "simulated"
  >("");
  const [sourceText, setSourceText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [feedback, setFeedback] = useState("");
  const progress = snapshot.self.step_progress[step.id];
  const done = progress?.status === "done" || progress?.status === "explained";
  const disabled = busy || progress?.status !== "open";
  const sources = snapshot.stage.sources.filter((source) =>
    !step.sourceIds || step.sourceIds.includes(source.id)
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!method || disabled) return;
    if (legacyInput && step.type === "choice" &&
      (typeof answer !== "string" || !/^[1-9]\d*$/.test(answer))) {
      setFeedback("답안을 하나 선택하라.");
      return;
    }
    setFeedback("");
    const next = await send({
      action: "submit-step",
      stage_id: snapshot.stage.id,
      step_id: step.id,
      answer,
      method,
      ...(sourceText.trim()
        ? {
          source: {
            text: sourceText,
            ...(sourceId ? { source_id: sourceId } : {}),
          },
        }
        : {}),
    });
    if (!next || !isV2Response(next)) return;
    if (next.result?.accepted === false) {
      setFeedback(
        "단서를 다시 살펴라. 문제 오답은 자물쇠 시도 횟수를 줄이지 않는다.",
      );
    } else {
      setAnswer(emptyStepAnswer(step));
      setSourceText("");
      setSourceId("");
      setFeedback("조사를 기록했다.");
    }
  };
  return (
    <form
      className={styles.card}
      data-testid={`mission-v2-step-${step.id}`}
      onSubmit={(e) => void submit(e)}
      autoComplete="off"
    >
      <div className="section-label">
        <span>{labels[progress?.status ?? "locked"]}</span>
        <span>제출 {progress?.attempts ?? 0}회</span>
      </div>
      <h3>{step.prompt}</h3>
      {!!step.requiresReports?.length && (
        <p className="fine-print">
          선행 보고: {step.requiresReports.map((role) =>
            `${ROLE_NAMES[role]} ${
              snapshot.game.report_mask[ROLES.indexOf(role)] ? "완료" : "대기"
            }`
          ).join(" · ")}
        </p>
      )}
      {!done && (
        <fieldset
          className={styles.fields}
          disabled={disabled}
        >
          <legend className={styles.legend}>문제 입력</legend>
          {legacyInput && snapshot.self.role
            ? <LegacyMissionInput step={step} role={snapshot.self.role}
                value={typeof answer === "string" ? answer : ""}
                onChange={setAnswer} disabled={disabled} />
            : <VerifyInput step={step} value={answer} onChange={setAnswer} />}
          <label className="verify-field">
            <span>확인 방식</span>
            <select
              aria-label="확인 방식"
              required
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              <option value="">선택</option>
              <option value="field">현장 확인</option>
              <option value="official_digital">공식 디지털 자료 확인</option>
              {snapshot.course.demo && (
                <option value="simulated">합성 자료로 모의 확인</option>
              )}
            </select>
          </label>
          <label className="verify-field">
            <span>
              확인한 출처{step.sourceRequired ? " (필수)" : " (선택)"}
            </span>
            <input
              required={step.sourceRequired || !!sourceId}
              maxLength={300}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </label>
          {!!sources.length && (
            <label className="verify-field">
              <span>연결할 자료 (선택)</span>
              <select
                aria-label="연결할 자료 (선택)"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">직접 확인한 출처</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </label>
          )}
          <button className="button primary full" type="submit"
            disabled={legacyInput && step.type === "choice" && !answer}>
            문제 제출 <Check size={17} />
          </button>
        </fieldset>
      )}
      {progress?.record && (
        <div className={styles.note}>
          <h4>내 기록</h4>
          {Object.entries(progress.record).map(([key, value]) => (
            <p key={key}>
              {step.fields?.find((f) => f.id === key)?.label ?? "기록"}: {value}
            </p>
          ))}
        </div>
      )}
      {snapshot.self.explanations[step.id] && (
        <div className={styles.note}>
          <h4>문제 해설</h4>
          <p>{snapshot.self.explanations[step.id]}</p>
        </div>
      )}
      {snapshot.self.rewards[step.id] && (
        <div className={styles.note}>
          <h4>복원한 기록</h4>
          <p>{snapshot.self.rewards[step.id]}</p>
        </div>
      )}
      {feedback && <p role="status" className="fine-print">{feedback}</p>}
    </form>
  );
}

/** Only the caller's server-projected mission is rendered; no course/answer data is imported. */
export function MissionV2({ snapshot, busy, send }: Props) {
  const { self, game, stage } = snapshot;
  const { mission, role } = self;
  if (!mission || !role) return <p role="status">본인 조사를 불러오는 중…</p>;
  const cleared = game.stage_phase === "done" || game.site_phase === "cleared";
  const complete = (step: Step) =>
    ["done", "explained"].includes(self.step_progress[step.id]?.status);
  const allDone = mission.steps.length > 0 && mission.steps.every(complete);
  const requiredReports = [
    ...new Set(mission.steps.flatMap((step) => step.requiresReports ?? [])),
  ];
  const reportReady = allDone &&
    requiredReports.every((target) => game.report_mask[ROLES.indexOf(target)]);
  const scenes = mission.scenes.filter((scene) =>
    scene.trigger === "enter" ||
    (scene.trigger === "role-complete" && allDone) ||
    (scene.trigger === "reports-ready" && game.report_mask.every(Boolean)) ||
    (scene.trigger === "stage-complete" && cleared) ||
    (scene.trigger === "scout-reported" &&
      game.report_mask[ROLES.indexOf("scout")])
  );
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className="section-label">
          <span>{ROLE_NAMES[role]}의 조사</span>
          <span>
            {mission.steps.filter(complete).length} / {mission.steps.length}
          </span>
        </div>
        {mission.intro.trigger === "enter" && <p>{mission.intro.text}</p>}
        {scenes.map((scene) => <p key={scene.id}>{scene.text}</p>)}
      </div>
      {role === "commander" && self.transfer_clue && (
        <section className={styles.clue} data-testid="mission-v2-transfer-clue">
          <h3>
            <Radio size={18} /> {self.transfer_clue.label}
          </h3>
          <p>{self.transfer_clue.value}</p>
          <p className="fine-print">
            대상 보직에게 말로 전달하라. 지휘관의 화면에만 보이는 단서다.
          </p>
        </section>
      )}
      {!!self.hints.length && (
        <section className={styles.note}>
          <h3>내 역할 힌트</h3>
          {self.hints.map((hint, i) => <p key={i}>{i + 1}단계: {hint}</p>)}
        </section>
      )}
      {mission.steps.map((step) => (
        <StepCard
          key={`${game.id}:${stage.id}:${role}:${step.id}`}
          step={step}
          snapshot={snapshot}
          busy={busy || cleared}
          send={send}
        />
      ))}
      <section className={styles.card}>
        <h3>조사 결과 보고</h3>
        {self.reported
          ? (
            <div className="digit-result">
              <span className="eyebrow">REPORT COMPLETE</span>
              <p>내 숫자를 지휘관에게 말로 전하라.</p>
              {self.digit !== null && (
                <div
                  className="private-digit"
                  data-testid="mission-v2-private-digit"
                >
                  {self.digit}
                </div>
              )}
              <p className="fine-print">
                다른 기기에는 보고 완료 표시만 전달된다.
              </p>
            </div>
          )
          : (
            <>
              <p>본인 조사를 마치고 결과를 보고하라.</p>
              {!!requiredReports.length && (
                <p className="fine-print">
                  먼저 보고할 역할:{" "}
                  {requiredReports.map((r) => ROLE_NAMES[r]).join(", ")}
                </p>
              )}
              <button
                type="button"
                className="button primary full"
                disabled={busy || cleared || !reportReady}
                onClick={() =>
                  void send({ action: "submit-report", stage_id: stage.id })}
              >
                조사 결과 보고 <Check size={17} />
              </button>
            </>
          )}
      </section>
      {!cleared && role === "commander" && (
        <section className={styles.card}>
          <h3>역할별 힌트 요청</h3>
          <p className="fine-print">
            힌트는 대상 보직에만 전달된다. 3단계는 그 역할의 미완료 조사를
            해설로 확인한다.
          </p>
          {ROLES.map((target, i) => {
            const level = game.hint_level[target] ?? 0, next = level + 1;
            const penalty = next <= 3
              ? stage.scoring.hintPenalty[next as 1 | 2 | 3]
              : null;
            return (
              <div className={styles.hint} key={target}>
                <p>
                  {ROLE_NAMES[target]} · {level}/3{next <= 3
                    ? ` · 다음 감점 ${
                      stage.scoring.enabled ? penalty ?? "미확정" : 0
                    }`
                    : ""}
                </p>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy || level >= 3 || game.report_mask[i] ||
                    (target === role && allDone)}
                  onClick={() =>
                    void send({
                      action: "request-hint",
                      stage_id: stage.id,
                      target_role: target,
                      level: next,
                    })}
                >
                  {level >= 3
                    ? `${ROLE_NAMES[target]} 힌트 완료`
                    : `${ROLE_NAMES[target]} ${next}단계 힌트`}
                </button>
              </div>
            );
          })}
        </section>
      )}
      {!cleared && (
        <section className={styles.card}>
          <h3>
            <BookOpen size={18} /> 해설 읽음 확인
          </h3>
          <p>공개된 본인 문제의 해설을 모두 읽고 확인하라.</p>
          <button
            type="button"
            className="button secondary full"
            disabled={busy || !allDone ||
              game.confirm_mask[ROLES.indexOf(role)]}
            onClick={() =>
              void send({ action: "confirm-explanation", stage_id: stage.id })}
          >
            {game.confirm_mask[ROLES.indexOf(role)]
              ? "내 해설 읽음 확인 완료"
              : "내 해설 읽음 확인"}
          </button>
        </section>
      )}
    </div>
  );
}

export function LockPanelV2({ snapshot, busy, now, send }: Props) {
  const { digits, setDigits } = useLockDraft(snapshot);
  const [feedback, setFeedback] = useState("");
  const { game, stage, self } = snapshot;
  const lock = self.lock;
  if (self.role !== "commander" || !lock || stage.completion.type !== "lock") {
    return null;
  }
  const remaining = Math.max(
    0,
    Math.ceil(((lock.nextAttemptAt ?? 0) - now) / 1000),
  );
  const reports = game.report_mask.every(Boolean);
  const cleared = game.stage_phase === "done" || game.site_phase === "cleared";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = await send({
      action: "open-lock",
      stage_id: stage.id,
      digits: digits.map(Number),
    });
    if (next && isV2Response(next)) {
      setFeedback(
        next.result?.ok
          ? "기록을 복원했다."
          : "맞은 칸은 잠겼다. 나머지 숫자를 다시 확인하라. −10점",
      );
    }
  };
  return (
    <div className={styles.root}>
      <form
        className="lock-panel"
        autoComplete="off"
        onSubmit={(e) => void submit(e)}
      >
        <div className="section-label">
          <span>
            <LockKeyhole size={16} /> 기록의 자물쇠
          </span>
          <span>{game.attempts_left}회 남음</span>
        </div>
        <div className="lock-digits">
          {stage.completion.order.map((role, i) => (
            <label key={role}>
              <span>{ROLE_NAMES[role]}</span>
              <input
                aria-label={`${ROLE_NAMES[role]} 잠금 숫자`}
                inputMode="numeric"
                pattern="[0-9]"
                maxLength={1}
                required
                value={digits[i] ?? ""}
                disabled={busy || cleared || lock.digits[i] !== null}
                className={lock.digits[i] !== null ? "locked" : ""}
                onChange={(e) =>
                  setDigits(digits.map((value, index) =>
                    index === i
                      ? e.target.value.replace(/\D/g, "").slice(-1)
                      : value
                  ))}
              />
              <small>
                {lock.digits[i] !== null
                  ? "잠김"
                  : game.report_mask[ROLES.indexOf(role)]
                  ? "보고 완료"
                  : "대기"}
              </small>
            </label>
          ))}
        </div>
        {feedback && <p role="status" className="inline-error">{feedback}</p>}
        {remaining > 0 && (
          <p role="timer" className="cooldown">
            다음 시도까지 <b>{remaining}초</b>
          </p>
        )}
        <button
          type="submit"
          className="button dark full"
          disabled={busy || cleared || !reports || remaining > 0 ||
            digits.some((d) => !/^\d$/.test(d))}
        >
          자물쇠 확인 <LockKeyhole size={17} />
        </button>
        {!reports && <p className="fine-print">네 보직의 보고를 기다리는 중</p>}
        <p className="fine-print">오답 −10점 · 3회 소진 후 60초마다 1회 추가</p>
      </form>
      <section className={styles.card}>
        <h3>해설 확인 후 복원</h3>
        <p>
          전원이 조사 결과를 보고하고 본인 해설을 읽었다고 확인한 뒤, 지휘관이
          별도로 복원한다.
        </p>
        <ul className={styles.confirmations}>
          {ROLES.map((role, i) => (
            <li key={role}>
              {ROLE_NAMES[role]} · 보고 {game.report_mask[i] ? "완료" : "대기"}
              {" "}
              · 해설 읽음 {game.confirm_mask[i] ? "확인" : "대기"}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button secondary full"
          disabled={busy || cleared || !reports ||
            !game.confirm_mask.every(Boolean)}
          onClick={() =>
            void send({ action: "open-after-explanation", stage_id: stage.id })}
        >
          해설 확인 후 복원
        </button>
      </section>
    </div>
  );
}
