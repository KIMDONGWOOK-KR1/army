"use client";

import { type FormEvent, useState } from "react";
import type { V2Response } from "@/lib/game-snapshot";
import {
  type Command,
  ROLE_NAMES,
  ROLES,
  type Step,
  type StepAnswer,
} from "@/supabase/functions/_shared/types";
import { emptyStepAnswer, VerifyInput } from "./verify-input";
import { useLockDraft } from "./use-lock-draft";

type Send = (command: Command) => Promise<V2Response | null>;
const statusLabels = {
  locked: "선행 문제 또는 보고 대기",
  open: "입력 가능",
  done: "완료",
  explained: "해설로 확인",
};

function StepCard({ step, snapshot, busy, send }: {
  step: Step;
  snapshot: V2Response;
  busy: boolean;
  send: Send;
}) {
  const [answer, setAnswer] = useState<StepAnswer>(() => emptyStepAnswer(step));
  const [method, setMethod] = useState<
    "" | "field" | "official_digital" | "simulated"
  >("");
  const [sourceText, setSourceText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [feedback, setFeedback] = useState("");
  const progress = snapshot.self.step_progress[step.id];
  const complete = progress?.status === "done" ||
    progress?.status === "explained";
  const sources = snapshot.stage.sources.filter((source) =>
    !step.sourceIds || step.sourceIds.includes(source.id)
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!method) return;
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
    if (!next) return;
    if (next.result?.accepted === false) {
      setFeedback(
        "답안을 다시 확인하세요. 문제 제출로 자물쇠 시도 횟수는 줄어들지 않습니다.",
      );
    } else {
      setAnswer(emptyStepAnswer(step));
      setSourceText("");
      setSourceId("");
      setFeedback("문제를 확인했습니다.");
    }
  };

  return (
    <form
      className="verify-card verify-stack"
      data-testid={`verify-step-${step.id}`}
      onSubmit={(event) => void submit(event)}
    >
      <h3>{step.prompt}</h3>
      <p className="verify-status">
        {progress ? statusLabels[progress.status] : "상태 확인 중"} · 제출{" "}
        {progress?.attempts ?? 0}회
      </p>
      {!!step.requiresReports?.length && (
        <p className="fine-print">
          선행 보고: {step.requiresReports.map((role) =>
            `${ROLE_NAMES[role]} ${
              snapshot.game.report_mask[ROLES.indexOf(role)] ? "완료" : "대기"
            }`
          ).join(" · ")}
        </p>
      )}
      {!complete && (
        <fieldset
          className="verify-stack"
          disabled={busy || progress?.status !== "open"}
        >
          <legend>문제 입력</legend>
          <VerifyInput step={step} value={answer} onChange={setAnswer} />
          <label className="verify-field">
            <span>확인 방식</span>
            <select
              aria-label="확인 방식"
              required
              value={method}
              onChange={(event) =>
                setMethod(event.target.value as typeof method)}
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
              onChange={(event) => setSourceText(event.target.value)}
            />
          </label>
          {!!sources.length && (
            <label className="verify-field">
              <span>연결할 자료 (선택)</span>
              <select
                aria-label="연결할 자료 (선택)"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">직접 확인한 출처</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="button dark full" type="submit">문제 제출</button>
        </fieldset>
      )}
      {progress?.record && (
        <div className="verify-stack">
          <h4>내 기록</h4>
          {Object.entries(progress.record).map(([key, value]) => (
            <p key={key}>
              {step.fields?.find((field) => field.id === key)?.label ?? "기록"}:
              {" "}
              {value}
            </p>
          ))}
        </div>
      )}
      {snapshot.self.explanations[step.id] && (
        <div className="verify-stack">
          <h4>문제 해설</h4>
          <p>{snapshot.self.explanations[step.id]}</p>
        </div>
      )}
      {snapshot.self.rewards[step.id] && (
        <div className="verify-stack">
          <h4>내게 공개된 보상</h4>
          <p>{snapshot.self.rewards[step.id]}</p>
        </div>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </form>
  );
}

function VerifyLock({ snapshot, busy, now, send }: {
  snapshot: V2Response;
  busy: boolean;
  now: number;
  send: Send;
}) {
  const { digits: values, setDigits } = useLockDraft(snapshot);
  const [feedback, setFeedback] = useState("");
  const lock = snapshot.self.lock;
  const completion = snapshot.stage.completion;
  if (!lock || completion.type !== "lock") return null;
  const remaining = Math.max(
    0,
    Math.ceil(((lock.nextAttemptAt ?? 0) - now) / 1000),
  );
  const reportsReady = snapshot.game.report_mask.every(Boolean);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = await send({
      action: "open-lock",
      stage_id: snapshot.stage.id,
      digits: values.map(Number),
    });
    if (!next) return;
    setFeedback(
      next.result?.opened === true
        ? "기록을 복원했습니다."
        : "맞은 칸은 잠겼습니다. 나머지 숫자를 다시 확인하세요.",
    );
  };
  return (
    <form
      className="verify-card verify-stack"
      onSubmit={(event) => void submit(event)}
    >
      <h3>기록의 자물쇠</h3>
      <p>
        남은 시도{" "}
        {snapshot.game.attempts_left}회 · 오답 −10점 · 3회 소진 후 60초마다 1회
        추가
      </p>
      <div className="verify-grid">
        {completion.order.map((role, index) => (
          <label className="verify-field" key={role}>
            <span>
              {ROLE_NAMES[role]} {lock.digits[index] !== null ? "잠김" : ""}
            </span>
            <input
              aria-label={`${ROLE_NAMES[role]} 잠금 숫자`}
              inputMode="numeric"
              pattern="[0-9]"
              maxLength={1}
              required
              disabled={busy || lock.digits[index] !== null}
              value={values[index]}
              onChange={(event) =>
                setDigits(values.map((value, i) =>
                  i === index
                    ? event.target.value.replace(/\D/g, "").slice(-1)
                    : value
                ))}
            />
          </label>
        ))}
      </div>
      {!reportsReady && <p>전원의 조사 결과 보고를 기다리고 있습니다.</p>}
      {remaining > 0 && <p role="timer">다음 시도까지 {remaining}초</p>}
      <button
        className="button dark full"
        type="submit"
        disabled={busy || !reportsReady || remaining > 0 ||
          values.some((value) => !/^\d$/.test(value))}
      >
        자물쇠 확인
      </button>
      {feedback && <p role="status">{feedback}</p>}
    </form>
  );
}

export function VerifyMission({ snapshot, busy, now, send }: {
  snapshot: V2Response;
  busy: boolean;
  now: number;
  send: Send;
}) {
  const [completionLabel, setCompletionLabel] = useState("");
  const { self, game, stage } = snapshot;
  const mission = self.mission;
  const role = self.role;
  if (!mission || !role) {
    return <p role="status">본인 역할의 문제를 확인하고 있습니다.</p>;
  }
  const cleared = game.site_phase === "cleared" || game.stage_phase === "done";
  const allDone = mission.steps.length > 0 &&
    mission.steps.every((step) =>
      ["done", "explained"].includes(self.step_progress[step.id]?.status)
    );
  const requiredReports = Array.from(
    new Set(mission.steps.flatMap((step) => step.requiresReports ?? [])),
  );
  const reportReady = allDone &&
    requiredReports.every((target) => game.report_mask[ROLES.indexOf(target)]);
  const allReports = game.report_mask.every(Boolean);
  const ownConfirmed = game.confirm_mask[ROLES.indexOf(role)];
  const allConfirmed = game.confirm_mask.every(Boolean);
  const act: Send = async (command) => {
    const next = await send(command);
    if (typeof next?.result?.label === "string") {
      setCompletionLabel(next.result.label);
    }
    return next;
  };
  const visibleScenes = mission.scenes.filter((scene) =>
    scene.trigger === "enter" ||
    (scene.trigger === "role-complete" && allDone) ||
    (scene.trigger === "reports-ready" && allReports) ||
    (scene.trigger === "stage-complete" && cleared) ||
    (scene.trigger === "scout-reported" &&
      game.report_mask[ROLES.indexOf("scout")])
  );

  return (
    <div className="verify-stack">
      <section className="verify-card verify-stack">
        <h2>{stage.name} · {ROLE_NAMES[role]}</h2>
        <p>정문 v2 동작 확인 화면</p>
        {mission.intro.trigger === "enter" && <p>{mission.intro.text}</p>}
        {visibleScenes.map((scene) => <p key={scene.id}>{scene.text}</p>)}
        <p>
          팀 점수 {game.score} · 내 문제 {mission.steps.filter((step) =>
            ["done", "explained"].includes(self.step_progress[step.id]?.status)
          ).length}/{mission.steps.length}
        </p>
        {cleared && (
          <div role="status">
            <h3>정문 확인 완료</h3>
            {completionLabel && <p>{completionLabel}</p>}
            <p>
              {stage.sacho?.name ?? "정문 기록"}을 복원했습니다. 이 확인 화면은
              정문 완료 상태를 유지합니다.
            </p>
          </div>
        )}
      </section>

      {role === "commander" && self.transfer_clue && (
        <section
          className="verify-card verify-stack"
          data-testid="verify-transfer-clue"
        >
          <h3>{self.transfer_clue.label}</h3>
          <p>{self.transfer_clue.value}</p>
          <p>
            지휘관에게만 표시되는 전달 단서입니다. 대상 역할에게 말로
            전달하세요.
          </p>
        </section>
      )}

      <section className="verify-card verify-stack">
        <h3>팀 진행 상태</h3>
        {ROLES.map((target, index) => (
          <p key={target}>
            {ROLE_NAMES[target]}: 문제 완료{" "}
            {game.step_done_count[target] ?? 0}개 · 보고{" "}
            {game.report_mask[index] ? "완료" : "대기"} · 해설 읽음{" "}
            {game.confirm_mask[index] ? "확인" : "대기"}
          </p>
        ))}
      </section>

      {!!self.hints.length && (
        <section className="verify-card verify-stack">
          <h3>내 역할 힌트</h3>
          {self.hints.map((hint, index) => (
            <p key={index}>{index + 1}단계: {hint}</p>
          ))}
        </section>
      )}

      {mission.steps.map((step) => (
        <StepCard
          key={`${game.id}:${stage.id}:${role}:${step.id}`}
          step={step}
          snapshot={snapshot}
          busy={busy || cleared}
          send={act}
        />
      ))}

      <section className="verify-card verify-stack">
        <h3>조사 결과 보고</h3>
        {self.reported
          ? (
            <>
              <p>보고 완료. 내 숫자를 지휘관에게 말로 전달하세요.</p>
              {self.digit !== null && (
                <p data-testid="verify-private-digit">
                  내 숫자: <strong>{self.digit}</strong>
                </p>
              )}
            </>
          )
          : (
            <>
              <p>
                본인 문제를 모두 확인하고 필요한 선행 보고가 완료되면 보고할 수
                있습니다.
              </p>
              {!!requiredReports.length && (
                <p>
                  먼저 보고할 역할:{" "}
                  {requiredReports.map((target) => ROLE_NAMES[target]).join(
                    ", ",
                  )}
                </p>
              )}
              <button
                type="button"
                className="button dark full"
                disabled={busy || cleared || !reportReady}
                onClick={() =>
                  void act({ action: "submit-report", stage_id: stage.id })}
              >
                조사 결과 보고
              </button>
            </>
          )}
      </section>

      {!cleared && role === "commander" && (
        <section className="verify-card verify-stack">
          <h3>역할별 힌트 요청</h3>
          <p>
            본문은 해당 역할 화면에만 표시됩니다. 3단계는 해당 역할의 미완료
            문제를 해설로 확인합니다.
          </p>
          {ROLES.map((target, index) => {
            const level = game.hint_level[target] ?? 0;
            const next = level + 1;
            const penalty = next <= 3
              ? stage.scoring.hintPenalty[next as 1 | 2 | 3]
              : null;
            return (
              <div className="verify-stack" key={target}>
                <p>
                  {ROLE_NAMES[target]}: {level}/3단계{next <= 3
                    ? ` · 다음 감점 ${
                      stage.scoring.enabled ? penalty ?? "미확정" : 0
                    }`
                    : ""}
                </p>
                <button
                  type="button"
                  className="button"
                  disabled={busy || level >= 3 || game.report_mask[index] ||
                    (target === role && allDone)}
                  onClick={() =>
                    void act({
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
        <section className="verify-card verify-stack">
          <h3>해설 읽음 확인</h3>
          <p>본인 문제의 해설을 모두 읽은 후 확인하세요.</p>
          <button
            type="button"
            className="button"
            disabled={busy || !allDone || ownConfirmed}
            onClick={() =>
              void act({ action: "confirm-explanation", stage_id: stage.id })}
          >
            {ownConfirmed ? "내 해설 읽음 확인 완료" : "내 해설 읽음 확인"}
          </button>
          {role === "commander" && (
            <>
              <p>
                전원의 조사 결과 보고와 해설 읽음 확인 후 별도로 복원할 수
                있습니다.
              </p>
              <button
                type="button"
                className="button dark full"
                disabled={busy || !allReports || !allConfirmed}
                onClick={() =>
                  void act({
                    action: "open-after-explanation",
                    stage_id: stage.id,
                  })}
              >
                해설 확인 후 복원
              </button>
            </>
          )}
        </section>
      )}

      {!cleared && role === "commander" && (
        <VerifyLock snapshot={snapshot} busy={busy} now={now} send={act} />
      )}
    </div>
  );
}
