"use client";

import { plain } from "@/lib/practice-text";
import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { BookOpen, Check, LockKeyhole, Radio } from "lucide-react";
import { personalMissionBody } from "@/lib/gate-narration";
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
import { SharedDraftPanel } from "./closing-v2";
import { BongjiStop } from "./bongji-stop";
import { TributePanel } from "./tribute-v2";
import { YongbongPanel } from "./yongbong-panel";
import { MissionAsset } from "./mission-asset";
import { roleStepsComplete } from "@/lib/hint-availability";
import { usesGateStory } from "@/lib/story-play";
import { StoryMission } from "./story-mission";
import { ScanResult, ScoutScan } from "./scout-scan";
import { scanEnabled, scanState } from "@/lib/scout-photo/session";
import type { ScoutScanSite } from "@/lib/scout-photo/sites";
import type { PhotoGateState } from "@/lib/scout-photo/contract";
import { dogamPageFor } from "@/lib/dogam";
import { DogamMission } from "./dogam/dogam-mission";

type Props = {
  snapshot: V2Response;
  busy: boolean;
  now: number;
  send: (command: Command) => Promise<GameResponse | null>;
};
// 다시 해 볼 때의 말: 고르는 문제는 골라 보고, 맞추는 문제는 맞춰 보고, 찾아 적는 문제는 찾아 본다
const retryVerb = (step: Step) =>
  step.type === "choice" || step.type === "truefalse" ? "골라 봐요"
    : step.type === "frequency" || step.type === "order" || step.type === "match" ? "맞춰 봐요" : "찾아 봐요";

function StepCard(
  { step, snapshot, busy, send }: Omit<Props, "now"> & { step: Step },
) {
  const legacyInput = snapshot.course.demo &&
    isLegacyMissionStep(snapshot.stage.id, snapshot.self.role, step);
  const [answer, setAnswer] = useState<StepAnswer>(() =>
    legacyInput && step.type === "frequency" ? "50.0" : emptyStepAnswer(step));
  const [feedback, setFeedback] = useState("");
  // 방금 맞힌 문제만 도장처럼 찍어 보인다(새로고침해서 다시 열면 그냥 결과 줄)
  const [fresh, setFresh] = useState(false);
  const progress = snapshot.self.step_progress[step.id];
  const done = progress?.status === "done" || progress?.status === "explained";
  // 낸 뒤에는 결과 줄(맞음·다시 해 보기)이 화면 밖에 있으면 보이게 당겨 온다
  const statusLine = useRef<HTMLParagraphElement>(null), reveal = useRef(false);
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    statusLine.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [feedback, done]);
  const disabled = busy || progress?.status !== "open";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (legacyInput && step.type === "choice" &&
      (typeof answer !== "string" || !/^[1-9]\d*$/.test(answer))) {
      setFeedback("답을 하나 골라 주세요.");
      return;
    }
    setFeedback("");
    const next = await send({
      action: "submit-step",
      stage_id: snapshot.stage.id,
      step_id: step.id,
      answer,
    });
    if (!next || !isV2Response(next)) return;
    reveal.current = true;
    if (next.result?.accepted === false) {
      setFeedback(
        snapshot.stage.kind === "memorial" ? "자료를 다시 확인해 봐요." : `아직 아니에요. 단서를 다시 보고 ${retryVerb(step)}. (자물쇠 기회는 그대로예요)`,
      );
    } else {
      setAnswer(emptyStepAnswer(step));
      setFeedback("");
      // 추모 거점에서는 도장·한마디 없이 조용히 결과 줄만
      if (snapshot.stage.kind !== "memorial") {
        setFresh(true);
        window.dispatchEvent(new Event("hoguk:step-solved"));
      }
    }
  };
  return (
    <form
      className={styles.card}
      data-testid={`mission-v2-step-${step.id}`}
      onSubmit={(e) => void submit(e)}
      autoComplete="off"
    >
      {/* 상태 줄은 아직 안 열린 문제에만, 왜 못 푸는지 한 줄. 낸 횟수(제출 N회)는 시험지처럼 읽혀 빼고,
          틀린 뒤에는 아래 안내 한 줄이 그 몫을 한다(처음엔 질문부터, 푼 뒤엔 결과 한 줄로) */}
      {!done && (progress?.status ?? "locked") === "locked" && <div className="section-label">
        <span>선행 조사 대기</span>
      </div>}
      <h3>{plain(step.prompt)}</h3>
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
          {/* 틀렸을 때는 고개를 젓듯 살짝 흔든다(낼 때마다 다시) */}
          {feedback && <p ref={statusLine} key={progress?.attempts ?? 0} role="status" className={`${styles.feedback} ${styles.nudge}`}>{feedback}</p>}
          <button className="button primary full" type="submit"
            disabled={legacyInput && step.type === "choice" && !answer}>
            맞춰 보기 <Check size={17} />
          </button>
        </fieldset>
      )}
      {/* 답한 뒤: 결과 한 줄이 먼저, 해설·내 기록·복원한 기록은 펼쳐 볼 때만(hh 2026-10-28) */}
      {done && <p ref={statusLine} className={`${styles.result} ${fresh ? styles.stamped : ""}`} data-explained={progress?.status === "explained"} role="status">
        <Check size={17} aria-hidden="true" />
        {progress?.status === "explained" ? "해설로 확인 · 조사 완료"
          : snapshot.stage.kind === "memorial" ? "기록했어요 · 조사 완료" : "맞았어요 · 조사 완료"}
      </p>}
      {(progress?.record || snapshot.self.explanations[step.id] || snapshot.self.rewards[step.id]) && (
        <details className={styles.more}>
          <summary>해설 보기</summary>
          {progress?.record && Object.entries(progress.record).map(([key, value]) => (
            <p key={key}>
              {step.fields?.find((f) => f.id === key)?.label ?? "내 기록"}: {plain(value)}
            </p>
          ))}
          {snapshot.self.explanations[step.id] && <p>{plain(snapshot.self.explanations[step.id])}</p>}
          {snapshot.self.rewards[step.id] && <p className={styles.reward}>{plain(snapshot.self.rewards[step.id])}</p>}
        </details>
      )}
    </form>
  );
}

type MissionProps = Props & {
  onShowDigit?: () => void;
  onMap?: () => void;
  /** 정찰원 '사진으로 찾기'(개발 서버의 모의 판정). 찾은 뒤에야 서버 문제가 열린다 */
  scan?: ScoutScanSite;
};

/** Keep local photo state scoped to the current room, stage and role. */
export function MissionV2(props: MissionProps) {
  const { game, stage, self } = props.snapshot;
  return <MissionContent key={`${game.id}:${stage.id}:${self.role ?? "pending"}`} {...props} />;
}

/** The real mission always comes from the caller's server-projected response. */
function MissionContent({ snapshot, busy, now, send, onShowDigit, onMap, scan: requestedScan }: MissionProps) {
  const { self, game, stage } = snapshot;
  const { mission, role } = self;
  const scan = scanEnabled() && snapshot.course.demo && role === "scout" &&
    requestedScan?.stageId === stage.id ? requestedScan : undefined;
  const scanKey = `${game.id}:${stage.id}`;
  const [scanResult, setScanResult] = useState<PhotoGateState | null>(() => scan ? scanState(scanKey) : null);
  if (!mission || !role) return <p role="status">본인 조사를 불러오는 중…</p>;
  // 봉지(hh 2026-11-09): 온라인 산사처럼 다른 팀과 머무는 마당을 먼저, 회고·공동 기록은 그다음
  if (stage.completion.type === "joint-record") return <BongjiStop snapshot={snapshot} busy={busy} send={send} />;
  if (stage.completion.type === "tribute") return <TributePanel snapshot={snapshot} busy={busy} now={now} send={send} />;
  // 안 2 '현장 도감'(hh 2026-11-08): 도감 문항(.dogam)으로 된 거점은 도감 화면으로 푼다. 사진으로 찾기 시연은 쓰지 않는다.
  const dogam = dogamPageFor(stage.id, mission.steps);
  if (dogam) return <DogamMission snapshot={snapshot} page={dogam} busy={busy} send={send} onShowDigit={onShowDigit} onMap={onMap} />;
  const cleared = game.stage_phase === "done" || game.site_phase === "cleared";
  const complete = (step: Step) =>
    ["done", "explained"].includes(self.step_progress[step.id]?.status);
  const allDone = mission.steps.length > 0 && mission.steps.every(complete);
  // 사진으로 찾기: 문제를 이미 풀었거나(새로고침·해설) 보고했으면 다시 막지 않는다
  const scanOpen = !!scan && !cleared && !self.reported && !mission.steps.some(complete) &&
    (!scanResult || scanResult.photo.status === "pending");
  const scanPanel = scan && !cleared && (scanOpen
    ? <ScoutScan site={scan} scope={scanKey} onSettled={setScanResult} />
    : scanResult && scanResult.photo.status !== "pending" && <ScanResult site={scan} state={scanResult} />);
  const scanLocked = scanOpen && <section className={styles.card} data-testid="scout-scan-locked">
    <h3><LockKeyhole size={18} /> 사진으로 찾으면 열리는 문제</h3>
    <p className="fine-print">{scan!.locked}</p>
  </section>;
  // Preserve the existing gate interaction, but do not skip the optional local photo rehearsal.
  if (usesGateStory(stage.id, mission.steps)) return <div className={styles.root}>
    {scanPanel}
    {scanOpen ? scanLocked : <StoryMission
      key={mission.steps.map((step) => step.id).join("|")}
      snapshot={snapshot} busy={busy} send={send} onShowDigit={onShowDigit} />}
  </div>;
  const doneCount = mission.steps.filter(complete).length + (scan && !scanOpen ? 1 : 0);
  const solving = !allDone && !self.reported && !cleared;
  const totalCount = mission.steps.length + (scan ? 1 : 0);
  // 짧은 안내(조사 이름)는 카드 머리에, 긴 안내는 본문 문단으로 둔다
  const introText = mission.intro.trigger === "enter"
    ? plain(stage.id === "gate" ? personalMissionBody(mission.intro.text) : mission.intro.text).trim()
    : "";
  const shortIntro = introText && introText.length <= 16 ? introText : "";
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
  // 처음부터 보이는 글(긴 소개·시작 장면)은 문제를 푸는 단서라 푸는 동안 문제 곁에 두고, 다 푼 뒤에는 접는다.
  // 그 뒤에 열리는 장면(다 풂·보고·완료)은 짧은 결과 문장이라 그대로 보인다
  const clues = [
    ...(mission.intro.trigger === "enter" && !shortIntro && introText ? [introText] : []),
    ...scenes.filter((scene) => scene.trigger === "enter").map((scene) => plain(scene.text)),
  ];
  return (
    <div className={styles.root}>
      <YongbongPanel snapshot={snapshot} busy={busy} send={send} />
      {stage.completion.type === "confirm" && <SharedDraftPanel snapshot={snapshot} busy={busy} send={send} />}
      {/* 내 조사 퀘스트 카드(포켓몬 GO 리서치·브롤스타즈 퀘스트처럼): 이름 · 진행 · 얻는 것을 한 카드에.
          얻는 것은 종류만 적는다(숫자·정답은 보고 전에 보이지 않는다). */}
      <div className={`${styles.card} ${styles.quest}`} data-testid="mission-v2-quest">
        <div className={styles.questTop}>
          <span className={styles.questKind}>
            {ROLE_NAMES[role]}의 조사{shortIntro && <b>{shortIntro}</b>}
          </span>
          <span className={styles.questCount} aria-label={`조사 ${totalCount}개 중 ${doneCount}개 완료`}>
            {doneCount} / {totalCount}
          </span>
        </div>
        <span className={styles.questBar} aria-hidden="true"><i style={{ "--done": totalCount ? doneCount / totalCount : 0 } as CSSProperties} /></span>
        {/* 얻는 것은 종류만 한 줄로(숫자·정답은 보고 전에 보이지 않는다). 팀 목표 설명은 오른쪽 위 '함께'에서 */}
        {!self.reported && <ul className={styles.questRewards} aria-label="이 조사로 얻는 것">
          <li><b>얻는 것</b>{mission.digit ? "기억의 숫자 1개" : "팀에 전할 조사 결과"}</li>
        </ul>}
        {/* 단서는 푸는 동안 문제 위에 그대로, 다 푼 뒤에는 '단서 다시 보기'로 접는다(hh 2026-10-28) */}
        {clues.length > 0 && (solving
          ? <div className={styles.clueBox} data-testid="mission-v2-clue"><b>단서</b>{clues.map((text, i) => <p key={i}>{text}</p>)}</div>
          : <details className={styles.more}><summary>단서 다시 보기</summary>{clues.map((text, i) => <p key={i}>{text}</p>)}</details>)}
        {scenes.filter((scene) => scene.trigger !== "enter").map((scene) => <p key={scene.id} className={styles.sceneLine}>{plain(scene.text)}</p>)}
      </div>
      {!scanOpen && <MissionAsset asset={mission.asset} stageId={stage.id} role={role} />}
      {role === "commander" && self.transfer_clue && (
        <section className={styles.clue} data-testid="mission-v2-transfer-clue">
          <h3>
            <Radio size={18} /> {plain(self.transfer_clue.label)}
          </h3>
          <p>{plain(self.transfer_clue.value)}</p>
        </section>
      )}
      {!!self.hints.length && (
        <section className={styles.note}>
          <h3>내 역할 힌트</h3>
          {self.hints.map((hint, i) => <p key={i}>{i + 1}단계: {plain(hint)}</p>)}
        </section>
      )}
      {scanPanel}
      {scanOpen ? scanLocked : mission.steps.map((step) => (
        <StepCard
          key={`${game.id}:${stage.id}:${role}:${step.id}`}
          step={step}
          snapshot={snapshot}
          busy={busy || cleared}
          send={send}
        />
      ))}
      {(allDone || self.reported) && <section className={styles.card}>
        {self.reported
          ? (
            <div className="digit-result">
              <p className={styles.result}><Check size={17} aria-hidden="true" />보고했어요 · {mission.digit ? "내 숫자를 지휘관에게 말로 전해요" : "찾은 내용을 팀에 말로 나눠요"}</p>
              {mission.digit && onShowDigit ? <button type="button" className="button primary full" onClick={onShowDigit}>
                내 숫자 확인 <Check size={17} />
              </button> : self.digit !== null && (
                <div
                  className="private-digit"
                  data-testid="mission-v2-private-digit"
                >
                  {self.digit}
                </div>
              )}
            </div>
          )
          : (
            <>
              {!!requiredReports.length && (
                <p className="fine-print">
                  먼저 보고할 역할:{" "}
                  {requiredReports.map((r) => ROLE_NAMES[r]).join(", ")}
                </p>
              )}
              <button
                type="button"
                className={`button primary full ${reportReady && !busy && !cleared ? styles.callout : ""}`}
                disabled={busy || cleared || !reportReady}
                onClick={() =>
                  void send({ action: "submit-report", stage_id: stage.id })}
              >
                조사 결과 보고 <Check size={17} />
              </button>
            </>
          )}
      </section>}
      {!cleared && role === "commander" && (
        <details className={`${styles.card} ${styles.more}`}>
          <summary>동료에게 힌트 주기</summary>
          <p className="fine-print">대상 보직에만 전달돼요. 3단계는 그 문제를 해설로 넘겨요.</p>
          {ROLES.map((target, i) => {
            const level = game.hint_level[target] ?? 0, next = level + 1;
            const penalty = next <= 3
              ? stage.scoring.hintPenalty[next as 1 | 2 | 3]
              : null;
            return (
              <div className={styles.hint} key={target}>
                <p>
                  {ROLE_NAMES[target]} · {level}/3{stage.kind !== "memorial" && next <= 3
                    ? ` · 다음 감점 ${
                      stage.scoring.enabled ? penalty ?? "미확정" : 0
                    }`
                    : ""}
                </p>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy || level >= 3 || game.report_mask[i] || roleStepsComplete(snapshot, target)}
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
        </details>
      )}
      {/* 해설 읽음 확인은 내 문제를 다 푼 뒤에만(해설로 복원하는 길) */}
      {!cleared && stage.completion.type === "lock" && allDone && (
        <section className={styles.card}>
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

export function LockPanelV2({ snapshot, busy, now, send, draft }: Props & {
  draft?: Pick<ReturnType<typeof useLockDraft>, "digits" | "setDigits">;
}) {
  const localDraft = useLockDraft(snapshot);
  const { digits, setDigits } = draft ?? localDraft;
  const [feedback, setFeedback] = useState("");
  // 숫자 칸: 한 자리를 넣으면 다음 빈 칸으로, 빈 칸에서 지우면 앞 칸으로(인증번호 칸처럼)
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const { game, stage, self } = snapshot;
  const lock = self.lock;
  if (self.role !== "commander" || !lock || stage.completion.type !== "lock") {
    return null;
  }
  const open = (i: number) => lock.digits[i] === null;
  const focusBox = (i: number) => {
    const box = boxes.current[i];
    if (!box || box.disabled) return;
    box.focus();
    box.setSelectionRange(0, box.value.length);
  };
  const put = (i: number, raw: string) => {
    // 칸에 있던 숫자 앞이나 뒤에 새로 친 숫자가 붙어 들어와도(아이폰은 칸을 눌러도 다 고르지 않는다) 새 숫자만 남긴다
    const typed = raw.replace(/\D/g, ""), before = digits[i] ?? "";
    const added = typed.length > 1 && before && typed.startsWith(before) ? typed.slice(before.length)
      : typed.length > 1 && before && typed.endsWith(before) ? typed.slice(0, -before.length)
      : typed;
    const value = added.slice(-1);
    const next = digits.map((d, index) => index === i ? value : d);
    setDigits(next);
    if (!value) return;
    // 뒤쪽 빈 칸부터, 없으면 앞쪽 빈 칸으로. 다 찼으면 자판을 내려 '자물쇠 확인'이 보이게
    const empty = (index: number) => open(index) && !/^\d$/.test(next[index] ?? "");
    const order = next.map((_, index) => index);
    const target = order.slice(i + 1).find(empty) ?? order.slice(0, i).find(empty);
    if (target !== undefined) focusBox(target);
    else boxes.current[i]?.blur();
  };
  const back = (i: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace" || digits[i]) return;
    const prev = digits.map((_, index) => index).slice(0, i).reverse().find(open);
    if (prev === undefined) return;
    event.preventDefault();
    setDigits(digits.map((d, index) => index === prev ? "" : d));
    focusBox(prev);
  };
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
          ? "열렸어요 · 기록을 복원했어요"
          : "맞은 칸은 고정됐어요. 나머지 숫자를 다시 확인해요 (−10점)",
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
        {/* 위 장면 제목(기억의 자물쇠)과 겹치는 이름 대신, 남은 횟수와 규칙을 한 줄에 */}
        <div className="section-label">
          <span>
            <LockKeyhole size={16} /> {game.attempts_left}회 남음
          </span>
          <span>틀리면 −10점</span>
        </div>
        <div className="lock-digits">
          {stage.completion.order.map((role, i) => (
            <label key={role}>
              <span>{ROLE_NAMES[role]}</span>
              <input
                ref={(box) => { boxes.current[i] = box; }}
                aria-label={`${ROLE_NAMES[role]} 잠금 숫자`}
                inputMode="numeric"
                pattern="[0-9]"
                required
                value={digits[i] ?? ""}
                disabled={busy || cleared || lock.digits[i] !== null}
                className={lock.digits[i] !== null ? "locked" : ""}
                onFocus={(e) => e.target.select()}
                onChange={(e) => put(i, e.target.value)}
                onKeyDown={(e) => back(i, e)}
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
        {/* 횟수 규칙은 거의 다 썼을 때만 */}
        {game.attempts_left <= 1 && <p className="fine-print">3회를 다 쓰면 60초마다 1회씩 다시 시도할 수 있어요</p>}
      </form>
      {/* 자물쇠 대신 해설로 복원하는 길: 단추는 늘 보이고, 조건과 네 사람 상태는 펼쳐 본다 */}
      <section className={styles.card}>
        <details className={styles.more}>
          <summary>해설로 복원 · 해설 읽음 {game.confirm_mask.filter(Boolean).length}/4</summary>
          <p className="fine-print">모두 보고하고 각자 해설 읽음을 확인하면, 지휘관이 자물쇠 대신 복원할 수 있어요.</p>
        <ul className={styles.confirmations}>
          {ROLES.map((role, i) => (
            <li key={role}>
              {ROLE_NAMES[role]} · 보고 {game.report_mask[i] ? "완료" : "대기"}
              {" "}
              · 해설 읽음 {game.confirm_mask[i] ? "확인" : "대기"}
            </li>
          ))}
        </ul>
        </details>
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
