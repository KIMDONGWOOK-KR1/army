"use client";
// 정문 보직 게임(hh 2026-11-08 두 번째: 네 칸 도감 틀을 버리고, 보직마다 자기 게임 화면에서 세 판을 차례로 깬다).
// 다음 판은 잠겨 있다가 앞 판을 깨면 열리고, 갈수록 어려워지거나 새 장치가 붙는다. 판 사이에는 기록실 무전이 한 줄씩 온다.
// 위에는 동료 넷이 몇 판째인지 작게 보인다(공개 값만: 서버가 센 푼 문항 수와 보고 여부, 혼자 데모면 이 폰의 진행).
// 서버 문항(.dogam…)은 그대로라 엔진 명령도 같다: submit-step · request-hint · confirm-explanation · submit-report.
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Binoculars, Brush, Camera, Sparkles, Check, Flag, Flame, Lightbulb, LockKeyhole, Map as MapIcon, Radio, Send, X } from "lucide-react";
import { isV2Response, type GameResponse, type V2Response } from "@/lib/game-snapshot";
import { plain } from "@/lib/practice-text";
import { play } from "@/lib/sound";
import { soloFor } from "@/lib/client";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { dogamSlotDone, dogamSlotFor, type DogamArtId, type DogamPage, type DogamSlot, type DogamTool } from "@/lib/dogam";
import { clearedRounds, peerRounds, ROLE_GAMES, roundSteps, type RoundDef } from "@/lib/field-rounds";
import { distanceM, FIELD, FIELD_BEARING } from "@/lib/field-sense";
import { type Command, ROLE_NAMES, ROLES, type Role, type Step } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS } from "../role-style";
import { PictureShapes, SlotArt, StoneLook } from "./dogam-art";
import { Binoculars as BinocularsTool } from "./binoculars";
import { RadioSet } from "./radio-set";
import { Rubbing } from "./rubbing";
import { LiveBinoculars, type ScopeText } from "./live-binoculars";
import { LiveRubbing } from "./live-rubbing";
import { SignalHunt } from "./signal-hunt";
import { FlagRun, type FlagTarget } from "./flag-run";
import { PetalCount, RecordTiles } from "./round-bits";
import { QuizRun } from "./quiz-run";
import { VoiceRadio } from "./voice-radio";
import { DustSweep } from "./dust-sweep";
import { CipherWheel } from "./cipher-wheel";
import { RedFilm } from "./red-film";
import { MissionDialog } from "./mission-dialog";
import { missionText } from "./display-text";
import { ScanResult, ScoutScan } from "../scout-scan";
import type { ScoutScanSite } from "@/lib/scout-photo/sites";
import type { PhotoGateState } from "@/lib/scout-photo/contract";
import { saveRounds, type SenseMode, useDogamPhoto, useRounds, useSenseMode } from "./use-field-sense";
import s from "./dogam.module.css";

type Send = (command: Command) => Promise<GameResponse | null>;
type Props = { snapshot: V2Response; page: DogamPage; busy: boolean; send: Send; onShowDigit?: () => void; onMap?: () => void };
type Choose = (mode: SenseMode) => void;

const TOOL_NEEDS: Record<DogamTool, ("camera" | "compass")[]> = {
  binoculars: ["camera"], rubbing: ["camera"], radio: [], compass: [],
};
/** 이 판들은 그림·진짜 기능을 고르지 않는다(퀴즈·목소리·불꽃 찾기는 스스로 처리한다) */
const NO_SENSE = new Set(["quiz", "voice", "flame", "pick", "dust", "wheel", "film", "read"]);
// 정찰원 불꽃 찾기(hh 2026-11-09): scout-scan 화면에 넣는 정문 글. 판정은 개발 서버의 모의 판정이다.
const GATE_FLAME: ScoutScanSite = {
  stageId: "gate",
  target: "정문 곁 표지석의 불꽃",
  riddle: "바람에도 꺼지지 않는 불꽃이 정문 곁 둥근 돌 위에 있어요. 찾아서 동그라미에 맞춰 비춰요.",
  shape: "flame",
  hints: [
    "실루엣이 조금 더 또렷해졌어요. 불꽃 끝이 위로 솟은 모양이에요.",
    "정문 곁 잔디밭의 둥근 표지석을 찾아요. 가까이 가서 불꽃이 화면을 채우게 비춰요.",
  ],
  found: "불꽃을 찾았어요.",
  next: "암호해독관에게 표지석 자리를 알려 줘요.",
  locked: "",
  confirmed: false,
};
/** 내 폰에만 두는 사진·판 진행의 이름표 */
const keyFor = (gameId: string, stageId: string, role: Role) => `${gameId}:${stageId}:${role}`;

const ROLE_ICONS: Record<Role, typeof Flag> = { scout: Flame, cipher: Sparkles, signal: Radio, commander: Flag };
const NUMS = ["①", "②", "③", "④", "⑤"];
const solvedStatus = (status?: string) => status === "done" || status === "explained";
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동이 없는 기기 */ } };
const roleStyle = (role: Role) => ({ "--rc": ROLE_COLORS[role] }) as CSSProperties;
const meters = (to: keyof typeof FIELD) => Math.round(distanceM(FIELD.gate, FIELD[to]));

// 지휘관 깃발: 첫 판은 넉넉하게 하나, 둘째 판은 동료가 볼 곳 둘과 다음 길을 차례로(갈수록 좁고 오래)
const FIRST_FLAG: FlagTarget[] = [{ label: "용봉관", bearing: FIELD_BEARING.hall, meters: 338, tol: 14, hold: 1000 }];
const FLAG_RUN: FlagTarget[] = [
  { label: "길 건너 조형물", bearing: FIELD_BEARING.bloom, meters: meters("bloom"), tol: 12, hold: 1100 },
  { label: "5·18 소공원", bearing: FIELD_BEARING.park, meters: meters("park"), tol: 9, hold: 1300 },
  // 마지막은 다시 용봉관 쪽(더 좁고 오래). 길 끝에 무엇이 있는지는 셋째 판에서 눈으로 본다.
  { label: "용봉관", bearing: FIELD_BEARING.hall, meters: 338, tol: 7, hold: 1500 },
];
const SCOPE_NEAR: ScopeText = {
  title: "쌍안경을 진짜 카메라로 켜요",
  body: "정문 서쪽 화강암 탑 꼭대기를 카메라로 당겨 봐요. 찍은 사진은 이 폰에만 남아요.",
  find: "정문 탑 꼭대기를 찾아 2배 넘게 당겨요",
  aim: "탑 꼭대기를 가운데 두고 멈추면 찍어요",
  alt: "쌍안경으로 찍은 정문 탑 꼭대기 사진",
};
const SCOPE_FAR: ScopeText = {
  title: "이번엔 길 건너편이에요",
  body: "꽃 모양 조형물 '피어나다'를 4배로 당겨요. 당길수록 손이 떨려 보여요. 숨을 고르고 버텨요.",
  find: "길 건너편 조형물을 찾아 4배 가까이 당겨요",
  aim: "흔들림 없이 1.5초 버텨요",
  alt: "쌍안경으로 찍은 길 건너편 조형물 사진",
};

export function DogamMission(props: Props) {
  // 혼자 데모에서 보직을 바꾸면 그 보직의 게임을 처음부터 다시 그린다
  return <RoleRounds key={props.snapshot.self.role ?? "none"} {...props} />;
}

function readFlag(key: string) { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } }
function writeFlag(key: string) { try { sessionStorage.setItem(key, "1"); } catch { /* 이 화면에서만 */ } }

function RoleRounds({ snapshot, page, busy, send, onShowDigit, onMap }: Props) {
  const reduce = useMotionPreference();
  const { self, game, stage } = snapshot;
  const role = self.role!, mission = self.mission!;
  const slot = dogamSlotFor(page, role);
  const def = ROLE_GAMES[role];
  const sense = useSenseMode(slot.tool, TOOL_NEEDS[slot.tool]);
  const steps = mission.steps;
  const solvedId = (id: string) => solvedStatus(self.step_progress[id]?.status);
  const base = keyFor(game.id, stage.id, role);
  const local = useRounds(base);
  const n = clearedRounds(def, solvedId, local);
  const total = def.rounds.length;
  const finished = n >= total;
  const cleared = game.stage_phase === "done" || game.site_phase === "cleared";
  const solo = !!soloFor(game.id);
  const drawn = sense.mode === "drawn";

  // hh 2026-11-09: 정문에 도착하면 바로 첫 판(소개 카드 없이). 첫 무전은 판 위에 한 줄로 둔다.
  const [started, setStarted] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [card, setCard] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ review: boolean } | null>(null);
  const lastN = useRef(n);
  const area = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // 판을 깨면: 다음 판 무전 카드, 세 판을 다 깨면 그 자리 이야기에 도장
  useEffect(() => {
    let timer: number | undefined;
    if (n > lastN.current) {
      if (n < total) { setCard(n); play("typewriter"); lastN.current = n; }
      else lastN.current = n;
    }
    return () => window.clearTimeout(timer);
  }, [n, total, reduce]);
  const toArea = () => requestAnimationFrame(() => area.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }));
  const start = () => { writeFlag(`hoguk:rounds-start:${base}`); setStarted(true); toArea(); };
  const openRound = () => { setCard(null); toArea(); };
  // 현장 동작 판을 깼다(이 폰에 남긴다). 찍은 장면을 잠깐 보여 준 뒤 넘어간다.
  const clearLocal = (i: number, wait = 800) => window.setTimeout(() => saveRounds(base, i + 1), reduce ? 100 : wait);
  const solvedNow = (step: Step) => {
    window.dispatchEvent(new CustomEvent("hoguk:step-solved", { detail: { stageId: stage.id, stepId: step.id, role } }));
  };
  const reportAttempted = useRef(false);
  const [reportFailed, setReportFailed] = useState(false);
  const report = async () => {
    if (busy || !finished || self.reported) return;
    const result = await send({ action: "submit-report", stage_id: stage.id });
    if (!result || !isV2Response(result) || !result.self.reported) setReportFailed(true);
  };

  useEffect(() => {
    if (!finished || cleared || self.reported || busy || reportAttempted.current) return;
    reportAttempted.current = true;
    void report();
  }, [finished, cleared, self.reported, busy]);

  const Icon = ROLE_ICONS[role];
  const round = def.rounds[Math.min(n, total - 1)];
  const titleOf = (r: RoundDef) => drawn && r.drawnTitle ? r.drawnTitle : r.title;
  const showClue = role === "commander" && !!self.transfer_clue && !cleared && (game.step_done_count.signal ?? 0) < 1;
  const hintCount = self.hints.length;
  const canHint = !cleared;

  return <div className={s.root} style={roleStyle(role)} data-testid="field-game" data-role={role} data-round={finished ? "done" : n + 1}>
    <header className={s.gameHead}>
      <span className={s.badge} aria-hidden><Icon size={18} /></span>
      <h1 ref={heading} data-scene-heading tabIndex={-1} className={s.focusTitle}>{def.name}<small>{ROLE_NAMES[role]} · {page.place}</small></h1>
      {/* 힌트는 아래로 길게 두지 않고 위쪽 단추로 연다(hh 2026-11-09: 스크롤이 길면 지루하다) */}
      {canHint && <button type="button" className={s.hintPill} aria-expanded={hintOpen} onClick={() => setHintOpen(true)} data-testid="hint-toggle"
        data-new={hintCount > 0 || undefined}>
        <Lightbulb size={16} aria-hidden /> 힌트{hintCount > 0 && <b>{hintCount}</b>}
      </button>}
      {onMap && <button type="button" className={s.mapButton} onClick={onMap} aria-label="지도 보기: 내 위치와 거점"><MapIcon size={20} aria-hidden /></button>}
    </header>
    {showClue && <details className={s.clueFold}>
      <summary><Radio size={16} aria-hidden /> 통신원에게 채널 알려주기</summary>
      <section className={s.clue} data-testid="mission-v2-transfer-clue">
        <span>{plain(self.transfer_clue!.label)}</span><strong>{plain(self.transfer_clue!.value)}</strong>
        <p>통신원에게 말로 불러 줘요.</p>
      </section>
    </details>}
    {total > 1 && !finished && <p className={s.roundProgress}>{n + 1} / {total} · {titleOf(round)}</p>}

    <div ref={area} className={s.area}>
      {finished && !cleared && !self.reported ? <section className={s.finish} data-testid="digit-preparing"><p className={s.say} role="status">{reportFailed ? "숫자를 불러오지 못했어요. 다시 시도해 주세요." : "내 자물쇠 숫자를 준비하고 있어요…"}</p>{reportFailed && <button className={`${s.btn} ${s.roleBtn}`} disabled={busy} onClick={() => { setReportFailed(false); void report(); }}>다시 시도</button>}</section> : cleared || finished ? <FinishPanel def={def} slot={slot} cleared={cleared} reported={self.reported} busy={busy}
        photoKey={base} onReport={() => void report()} onReview={() => setSheet({ review: true })} onShowDigit={onShowDigit} />
        : !started ? <IntroCard name={def.name} role={role} intro={def.intro} radio={def.rounds[0].radio}
          rounds={def.rounds.map(titleOf)} onStart={start} />
        : card != null ? <RadioCard num={NUMS[card]} title={titleOf(def.rounds[card])} radio={def.rounds[card].radio} onOpen={openRound} />
        : sense.mode && <section className={s.roundBox} data-testid={`field-round-${n + 1}`} data-kind={round.kind}>
          <RoundBody round={round} index={n} slot={slot} snapshot={snapshot} steps={steps} busy={busy} send={send} reduce={reduce}
            mode={sense.mode} choose={sense.choose} base={base} onSolved={solvedNow} clearLocal={clearLocal} />
          {drawn && sense.why !== "desk" && !NO_SENSE.has(round.kind) && <SenseNote why={sense.why} choose={sense.choose} />}
        </section>}
    </div>

    {hintOpen && <HintSheet onClose={() => setHintOpen(false)}>
      <p className={s.say}>{drawn ? round.goal : round.liveGoal}</p>
      {hintCount > 0 ? <ol className={s.hintList}>{self.hints.map((hint, i) => <li key={i}>{plain(hint)}</li>)}</ol>
        : role !== "commander" && <p className={s.note}>아직 받은 힌트가 없어요.</p>}
      {role === "commander" && <HintDesk snapshot={snapshot} busy={busy} send={send} page={page} />}
      <details className={s.teamDetails}><summary>동료 진행 보기</summary><TeamStrip snapshot={snapshot} me={role} solo={solo} /></details>
    </HintSheet>}
    {sheet && <StampSheet slot={slot} snapshot={snapshot} review={sheet.review} photoKey={base}
      onClose={() => setSheet(null)} />}
  </div>;
}

/** 동료 넷이 몇 판째인지(작게). 남의 문항 내용은 보지 않는다. */
function TeamStrip({ snapshot, me, solo }: { snapshot: V2Response; me: Role; solo: boolean }) {
  return <ul className={s.team} aria-label="동료 진행">
    {ROLES.map((r) => <TeamChip key={r} role={r} me={r === me} snapshot={snapshot} solo={solo} />)}
  </ul>;
}
function TeamChip({ role, me, snapshot, solo }: { role: Role; me: boolean; snapshot: V2Response; solo: boolean }) {
  const { game, stage, self } = snapshot;
  const def = ROLE_GAMES[role];
  const local = useRounds(keyFor(game.id, stage.id, role));
  const reported = game.report_mask[ROLES.indexOf(role)];
  const k = me
    ? clearedRounds(def, (id) => solvedStatus(self.step_progress[id]?.status), local)
    : peerRounds(def, game.step_done_count[role] ?? 0, reported, solo ? local : 0);
  return <li className={s.mate} data-me={me || undefined} style={roleStyle(role)}
    aria-label={`${ROLE_NAMES[role]}${me ? "(나)" : ""} ${def.rounds.length}판 가운데 ${k}판${reported ? ", 기록에 올림" : ""}`}>
    <b>{me ? "나" : ROLE_NAMES[role]}</b>
    <span className={s.pips} aria-hidden>{def.rounds.map((_, i) => <i key={i} data-on={i < k || undefined} />)}</span>
  </li>;
}

/** 처음 여는 화면: 이 보직의 게임 이야기와 세 판, 첫 무전. */
function IntroCard({ name, role, intro, radio, rounds, onStart }: {
  name: string; role: Role; intro: string; radio: string; rounds: string[]; onStart: () => void;
}) {
  const Icon = ROLE_ICONS[role];
  return <section className={s.intro} data-testid="field-intro">
    <span className={s.introIcon} aria-hidden><Icon size={34} /></span>
    <p className={s.roundKicker}>{ROLE_NAMES[role]}의 게임</p>
    <h3>{name}</h3>
    <p className={s.say}>{intro}</p>
    <ol className={s.introList}>{rounds.map((title, i) => <li key={i}><span>{NUMS[i]}</span> {title}{i > 0 && <LockKeyhole size={14} aria-label="잠김" />}</li>)}</ol>
    <RadioLine text={radio} />
    <button type="button" className={`${s.btn} ${s.roleBtn}`} data-sound="confirm" onClick={onStart} data-testid="field-start">
      {rounds[0]} 시작하기
    </button>
  </section>;
}

/** 판 사이: 기록실 무전 한 줄과 새로 열린 판. */
function RadioCard({ num, title, radio, onOpen }: { num: string; title: string; radio: string; onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); buzz(20); }, []);
  return <section className={s.radioCard} data-testid="field-radio-card">
    <p className={s.unlock}><LockKeyhole size={16} aria-hidden /> {num} {title} 열렸어요</p>
    <RadioLine text={radio} />
    <button ref={button} type="button" className={`${s.btn} ${s.roleBtn}`} data-sound="confirm" onClick={onOpen} data-testid="field-next">
      {title} 시작하기
    </button>
  </section>;
}
function RadioLine({ text }: { text: string }) {
  return <p className={s.radioLine}><span><Radio size={15} aria-hidden /> 기록실 무전</span>{text}</p>;
}

/** 판을 다 깼을 때: 내 기록 사진과 이야기, 기록에 올리고 숫자 받기. */
function FinishPanel({ def, slot, cleared, reported, busy, photoKey, onReport, onReview, onShowDigit }: {
  def: (typeof ROLE_GAMES)[Role]; slot: DogamSlot; cleared: boolean; reported: boolean; busy: boolean; photoKey: string;
  onReport: () => void; onReview: () => void; onShowDigit?: () => void;
}) {
  const photo = useDogamPhoto(photoKey);
  return <section className={s.finish} data-testid="field-finish">
    <div className={s.finishArt}>
      {photo ? <img src={photo} alt={`내가 현장에서 남긴 ${slot.name} 사진`} /> : <SlotArt art={slot.art} />}
      <span className={s.stamp} aria-hidden>證</span>
    </div>
    <p className={s.say}><b>{def.name} {def.rounds.length}판을 다 마쳤어요.</b> {cleared ? "정문 기록이 열렸어요."
      : reported ? "기록에 올렸어요. 내 숫자를 다시 볼 수 있어요." : "찾은 이야기를 기록에 올리고 자물쇠 숫자를 받아요."}</p>
    {!cleared && (reported
      ? onShowDigit && <button type="button" className={`${s.btn} ${s.roleBtn}`} onClick={onShowDigit}>내 숫자 보기</button>
      : <button type="button" className={`${s.btn} ${s.roleBtn}`} data-sound="confirm" disabled={busy} onClick={onReport} data-testid="dogam-report">
        기록에 올리고 숫자 받기 <Send size={18} aria-hidden />
      </button>)}
    <button type="button" className={`${s.btn} ${s.ghost} ${s.small}`} onClick={onReview}>찾은 이야기 다시 보기</button>
  </section>;
}

/** 지금 판 하나. 현장 동작 판은 이 폰에서 깨고(clearLocal), 문항 판은 서버가 확인한다. */
function RoundBody({ round, index, slot, snapshot, steps, busy, send, reduce, mode, choose, base, onSolved, clearLocal }: {
  round: RoundDef; index: number; slot: DogamSlot; snapshot: V2Response; steps: Step[]; busy: boolean; send: Send; reduce: boolean;
  mode: SenseMode; choose: Choose; base: string; onSolved: (step: Step) => void; clearLocal: (i: number, wait?: number) => void;
}) {
  const live = mode === "live", drawn = () => choose("drawn");
  const photo = useDogamPhoto(base);
  const step = round.step ? steps.find((st) => st.id === round.step) ?? null : null;
  const ask = (target: Step | null, extra?: ReactNode) => target
    ? <Ask step={target} snapshot={snapshot} busy={busy} send={send} onSolved={onSolved} pictures={slot.pictures?.[target.id]} extra={extra} />
    : <p className={s.note}>문항을 불러오는 중이에요.</p>;
  const radioStep = steps.find((st) => st.id === "G-03.dogam-radio");
  const done = () => clearLocal(index);
  switch (round.kind) {
    case "flag":
      return <FlagRun targets={FIRST_FLAG} mode={mode} onDone={done} onDrawn={drawn} photoKey={base} reduce={reduce}
        gate={{ title: "진짜 길 위에 깃발을 꽂아요", body: "카메라 화면에 용봉관 쪽 깃발이 떠요. 폰을 돌려 깃발을 가운데 맞추면 길 위에 꽂혀요. 누르면 폰이 카메라와 방향 권한을 물어요." }} />;
    case "flags":
      return <FlagRun targets={FLAG_RUN} limitMs={12000} mode={mode} onDone={done} onDrawn={drawn} reduce={reduce}
        gate={{ title: "깃발 세 개를 꽂아요", body: "길 건너 조형물, 5·18 소공원, 다시 용봉관 차례예요. 한 곳에 12초, 갈수록 가운데 줄이 좁아져요." }} />;
    case "roadEnd":
      return <>
        {live && photo ? <figure className={s.roadEnd}><img src={photo} alt="첫 판에 꽂은 깃발 사진" />
          <figcaption>첫 판에 꽂은 깃발 · 깃발 끝 길을 눈으로 따라가요</figcaption></figure>
          : <figure className={s.roadEnd}>
            <svg viewBox="80 60 120 80" role="img" aria-label="깃발 끝을 따라 본 길 그림. 길 끝 한가운데에 무언가 서 있어요"><PictureShapes picture="gate" /></svg>
            <figcaption>깃발 끝을 따라 본 길 · 그림은 예시예요</figcaption></figure>}
        {ask(step)}
      </>;
    case "scopeNear":
      return live ? <LiveBinoculars found={false} onFound={done} onDrawn={drawn} photoKey={`${base}:r1`} minZoom={2} steadyMs={1000} text={SCOPE_NEAR} />
        : <BinocularsTool found={false} onFound={done} reduce={reduce} />;
    case "scopeFar":
      return live ? <LiveBinoculars found={false} onFound={() => clearLocal(index, 1000)} onDrawn={drawn} photoKey={base}
        minZoom={3.5} steadyMs={1500} limit={4.2} text={SCOPE_FAR} />
        : <BinocularsTool found={false} onFound={done} reduce={reduce} need={3.6} holdMs={1200} />;
    case "petals":
      return <>
        <PetalCount photo={live ? photo : null} alt={live ? "내가 찍은 길 건너편 조형물 사진. 눌러서 꽃잎을 짚어요" : "당겨 본 조형물 그림. 눌러서 꽃잎을 짚어요"} />
        {ask(step)}
      </>;
    case "rub":
      return live ? <LiveRubbing done={false} onDone={done} onDrawn={drawn} photoKey={base} reduce={reduce} />
        : <Rubbing done={false} onDone={done} reduce={reduce} />;
    case "read":
      return <>
        {snapshot.self.role === "cipher" && <p className={s.vaultLine}><LockKeyhole size={16} aria-hidden /> 기록실 금고 · 표지석에 새긴 번호를 맞추면 열려요</p>}
        {/* 그림에는 번호를 두지 않는다(번호는 진짜 표지석에서 읽는다) */}
        <figure className={s.roadEnd}><svg viewBox="40 60 280 210" role="img" aria-label="쪽지가 가리킨 둥근 표지석 그림. 가운데 구멍 위에 청동 불꽃이 있어요">
          <rect x="40" y="60" width="280" height="210" fill="#e7f1e6" /><rect x="40" y="226" width="280" height="44" fill="#9ccb8e" />
          <ellipse cx="180" cy="252" rx="112" ry="16" fill="#8c8576" /><circle cx="180" cy="160" r="92" fill="#6f6a60" />
          <circle cx="176" cy="154" r="86" fill="#7d776b" /><circle cx="180" cy="160" r="26" fill="#9cc4d6" stroke="#5c574e" strokeWidth="4" />
          <path d="M180 96C206 128 204 150 192 166C198 150 188 140 182 134C184 152 170 158 170 172C156 150 162 122 180 96Z" fill="#b8803a" />
          <rect x="132" y="222" width="96" height="26" fill="#3d3a34" /><rect x="142" y="230" width="50" height="3" fill="#a59e8c" /><rect x="142" y="238" width="70" height="3" fill="#a59e8c" />
        </svg><figcaption>정문 곁 둥근 돌, 불꽃 아래 · 번호는 현장에서 직접 읽어요</figcaption></figure>
        {ask(step)}
      </>;
    case "tiles":
      return <RecordTiles text={plain(snapshot.self.explanations["G-04.dogam"] ?? "")} onDone={() => clearLocal(index, 200)} reduce={reduce}
        seed={snapshot.game.id.length + 11} />;
    case "tune":
      return radioStep ? <RadioSet step={radioStep} snapshot={snapshot} busy={busy} send={send} reduce={reduce} /> : null;
    case "hunt":
      return <>
        {radioStep && <RadioSet step={radioStep} snapshot={snapshot} busy={busy} send={send} reduce={reduce} />}
        <SignalHunt found={false} onFound={() => clearLocal(index, 0)} onDrawn={drawn} mode={mode} />
      </>;
    case "flame":
      return <FlameRound step={step} snapshot={snapshot} busy={busy} send={send} onSolved={onSolved} scope={base} />;
    case "dust":
      return <DustSweep onDone={() => clearLocal(index, 0)} reduce={reduce} />;
    case "wheel":
      return <CipherWheel onDone={() => clearLocal(index, 0)} reduce={reduce} />;
    case "film":
      return <RedFilm onDone={() => clearLocal(index, 0)} reduce={reduce} />;
    case "voice":
      return <VoiceRadio seed={snapshot.game.id} done={false} onDone={() => clearLocal(index, 0)} reduce={reduce} />;
    case "quiz": {
      const ids = roundSteps(round);
      const quiz = ids.map((id) => steps.find((st) => st.id === id)).filter(Boolean) as Step[];
      return quiz.length === ids.length
        ? <QuizRun steps={quiz} snapshot={snapshot} busy={busy} send={send} reduce={reduce} onSolved={onSolved} onDone={() => clearLocal(index, 0)} />
        : <p className={s.note}>문항을 불러오는 중이에요.</p>;
    }
    case "pick":
      return <>
        {snapshot.self.role === "signal" ? <VoiceRadio seed={snapshot.game.id} done onDone={() => undefined} reduce={reduce} />
          : radioStep && <RadioSet step={radioStep} snapshot={snapshot} busy={busy} send={send} reduce={reduce} />}
        {ask(step, <p className={s.note}>{live ? "신호가 오던 곳에서 본 것을 골라요." : "현장에서는 다 같이 둘러보고 찾아가 손으로 가리켜요."}</p>)}
      </>;
  }
}

/** 그림 도구로 하는 까닭과, 진짜 기능으로 돌아가는 단추. */
function SenseNote({ why, choose }: { why: "insecure" | "desk" | "picked" | null; choose: Choose }) {
  if (why === "insecure") return <p className={s.note}>카메라와 나침반은 https 주소에서만 열려서, 지금은 그림으로 해요.</p>;
  return <button type="button" className={s.linkBtn} onClick={() => choose("live")}>
    <Camera size={16} aria-hidden /> 진짜 카메라·나침반으로 하기
  </button>;
}

/** 눈으로 본 것을 고르는 문항. 누르면 바로 서버에 낸다(오답은 자물쇠 시도를 줄이지 않는다). */
function Ask({ step, snapshot, busy, send, onSolved, pictures, extra }: {
  step: Step; snapshot: V2Response; busy: boolean; send: Send; onSolved: (step: Step) => void;
  pictures?: { art: DogamArtId; alt: string }[];
  extra?: ReactNode;
}) {
  const progress = snapshot.self.step_progress[step.id];
  const done = solvedStatus(progress?.status);
  const [wrong, setWrong] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    // 아래쪽 떠 있는 지도 단추·보직 줄에 가리지 않게 가운데로 올린다
    if (!done) box.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [done]);
  const choices = step.choices ?? [];
  const submit = async (id: string) => {
    if (busy || done || picked) return;
    setPicked(id);
    const next = await send({ action: "submit-step", stage_id: snapshot.stage.id, step_id: step.id, answer: id });
    setPicked(null);
    if (!next || !isV2Response(next)) return;
    if (next.result?.accepted === false) {
      setWrong(id); setShake((n) => n + 1); buzz(60);
      setNote("한 번 더 봐요. 틀려도 자물쇠 기회는 줄지 않아요.");
    } else {
      buzz([20, 40, 20]); setNote(""); onSolved(step);
    }
  };
  return <section ref={box} className={s.ask} data-testid={`dogam-step-${step.id}`} data-done={done || undefined}>
    <h3>{plain(step.prompt)}</h3>
    {extra}
    {done ? <p className={s.solvedLine}><Check size={16} aria-hidden /> {progress?.status === "explained" ? "해설로 확인했어요" : "맞혔어요"}</p>
      : pictures ? <div className={s.pick} role="group" aria-label="고르기">
        {choices.map((label, i) => {
          const id = String(i + 1), pic = pictures[i];
          return <button key={id} type="button" disabled={busy || !!picked} aria-label={pic?.alt ?? label}
            data-wrong={wrong === id || undefined} data-shake={wrong === id ? shake % 2 : undefined}
            onClick={() => void submit(id)}>
            {pic && <SlotArt art={pic.art} />}<b>{plain(label)}</b>
          </button>;
        })}
      </div>
      : <div className={s.opts} data-long={choices.some((c) => [...c].length > 4) || undefined} role="group" aria-label="고르기">
        {choices.map((label, i) => {
          const id = String(i + 1);
          return <button key={id} type="button" className={s.opt} disabled={busy || !!picked}
            data-wrong={wrong === id || undefined} data-shake={wrong === id ? shake % 2 : undefined}
            onClick={() => void submit(id)}>{plain(label)}</button>;
        })}
      </div>}
    {!done && note && <p className={s.wrongNote} role="status">{note}</p>}
  </section>;
}

/** 찾은 순간: 그 자리 이야기(서버 해설)에 도장을 찍는다. */
function StampSheet({ slot, snapshot, review, onClose, photoKey }: {
  slot: DogamSlot; snapshot: V2Response; review: boolean; onClose: () => void; photoKey: string;
}) {
  const photo = useDogamPhoto(photoKey);
  const steps = snapshot.self.mission?.steps ?? [];
  // 퀴즈 해설은 퀴즈 화면에서 이미 읽었다. 도장 장면에는 현장에서 찾은 이야기만 둔다.
  const story = (list: Step[]) => list.map((step) => snapshot.self.explanations[step.id]).filter(Boolean) as string[];
  const field = story(steps.filter((step) => !/-q\d+$/.test(step.id)));
  // 지휘관은 퀴즈만 풀어서, 그때는 퀴즈 해설을 도장 장면에 둔다
  const stories = field.length ? field : story(steps);
  const [main, ...more] = [...new Set(stories.map(missionText).filter(Boolean))].reverse();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus({ preventScroll: true });
    if (!review) { const t = window.setTimeout(() => play("digit-reveal"), 280); buzz(30); return () => window.clearTimeout(t); }
  }, [review]);
  return <MissionDialog label={slot.name} onClose={review ? onClose : undefined} style={roleStyle(slot.role)} testId="dogam-sheet">
    <div className={s.sheetCard}>
      <div className={s.sheetArt} data-photo={photo ? true : undefined}>
        {photo ? <img src={photo} alt={`내가 현장에서 남긴 ${slot.name} 사진`} /> : <SlotArt art={slot.art} />}
        <span className={s.stamp} aria-hidden>證</span>
      </div>
      <p className={s.kicker}>{slot.num} {ROLE_NAMES[slot.role]}{review ? ` · ${slot.toolName}` : "이 찾았어요"}</p>
      <h3 id="dogam-sheet-title">{slot.name}</h3>
      {main && <p className={s.record}>{main}</p>}
      {review && more.map((text, i) => <p key={i} className={s.note}>{text}</p>)}
      <button ref={button} type="button" className={`${s.btn} ${s.roleBtn}`} data-sound="confirm" onClick={onClose}>
        닫기
      </button>
    </div>
  </MissionDialog>;
}

/** 지휘관: 동료가 막히면 그 보직에만 힌트를 보낸다(3단계는 해설로 확인). 점수는 화면에 보이지 않는다. */
function HintDesk({ snapshot, busy, send, page }: { snapshot: V2Response; busy: boolean; send: Send; page: DogamPage }) {
  const { game, stage } = snapshot;
  return <details className={s.hintDesk} open>
    <summary><Lightbulb size={16} aria-hidden /> 동료가 막히면 힌트 보내기</summary>
    <p className={s.note}>힌트는 그 보직 폰에만 가요. 3단계 힌트는 그 칸을 해설로 채워요.</p>
    <div className={s.hintRows}>
      {page.slots.map((sl) => {
        const i = ROLES.indexOf(sl.role), level = game.hint_level[sl.role] ?? 0, next = level + 1;
        return <button key={sl.role} type="button" className={s.hintBtn} style={roleStyle(sl.role)}
          disabled={busy || level >= 3 || game.report_mask[i] || dogamSlotDone(game, sl)}
          onClick={() => void send({ action: "request-hint", stage_id: stage.id, target_role: sl.role, level: next })}>
          <b>{ROLE_NAMES[sl.role]}</b><span>{level >= 3 ? "힌트 다 보냄" : `${next}단계 보내기 · ${level}/3`}</span>
        </button>;
      })}
    </div>
  </details>;
}

/** 정찰원 불꽃 찾기: 카메라로 비춰 찾으면(설정된 사진 판정기) 서버에 '찾았어요' 확인을 낸다. */
function FlameRound({ step, snapshot, busy, send, onSolved, scope }: {
  step: Step | null; snapshot: V2Response; busy: boolean; send: Send; onSolved: (step: Step) => void; scope: string;
}) {
  const [result, setResult] = useState<PhotoGateState | null>(null);
  const sent = useRef(false);
  const settle = async (state: PhotoGateState) => {
    setResult(state);
    if (!step || state.photo.status === "pending" || sent.current || busy) return;
    sent.current = true;
    const next = await send({ action: "submit-step", stage_id: snapshot.stage.id, step_id: step.id, answer: "confirmed" });
    if (next && isV2Response(next) && next.result?.accepted !== false) { buzz([20, 40, 20]); onSolved(step); }
    else sent.current = false;
  };
  if (!step) return <p className={s.note}>문항을 불러오는 중이에요.</p>;
  return result && result.photo.status !== "pending"
    ? <ScanResult site={GATE_FLAME} state={result} />
    : <ScoutScan site={GATE_FLAME} scope={`${scope}:flame`} onSettled={(st) => void settle(st)} />;
}

/** 위쪽 '힌트' 단추로 여는 가운데 창. 받은 힌트와 동료에게 힌트 보내기. */
function HintSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return <MissionDialog label="힌트" onClose={onClose} testId="hint-sheet">
    <div className={`${s.sheetCard} ${s.hintSheet}`}>
      <div className={s.hintSheetHead}>
        <h3><Lightbulb size={18} aria-hidden /> 힌트</h3>
        <button type="button" className={s.hintClose} onClick={onClose} aria-label="닫기" autoFocus><X size={20} aria-hidden /></button>
      </div>
      {children}
    </div>
  </MissionDialog>;
}
