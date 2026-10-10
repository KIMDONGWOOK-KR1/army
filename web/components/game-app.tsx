"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clapperboard,
  Compass,
  Copy,
  HelpCircle,
  LocateFixed,
  LockKeyhole,
  Maximize,
  Menu,
  Play,
  RotateCcw,
  ScrollText,
  Shield,
  Smartphone,
  Square,
  Users,
  WifiOff,
} from "lucide-react";
import { useGameAny } from "./use-game";
import { useLocation } from "./use-location";
import { allowsSimulatedArrival } from "@/supabase/functions/_shared/arrival-policy";
import { useLockDraft } from "./use-lock-draft";
import {
  handoffPane,
  saveHandoff,
  takeHandoff,
  type Handoff,
  type Pane,
} from "./view-handoff";
import { Mission, LockPanel } from "./mission";
import { MissionV2, LockPanelV2 } from "./mission-v2";
import { JournalV2 } from "./journal-v2";
import { NextStageAction } from "./yongbong-panel";
import { isV2Response, type GameResponse } from "@/lib/game-snapshot";
import { SceneArt } from "./scene-art";
import { GameDialog } from "./game-dialog";
import { DevControls } from "./dev-controls";
import { DemoScenes } from "./demo-scenes";
import { SoundToggle } from "./sound-toggle";
import { play } from "@/lib/sound";
import { MemorialDeparture, ResultV2 } from "./closing-v2";
import { useCueSend, useSoundCues } from "./use-sound-cues";
import { Narration } from "./narration";
import { TravelHud } from "./travel-hud";
import { StopScreen, markStopSeen, stopEnabled, stopSeen } from "./stop-screen";
import { ROLE_COLORS, ROLE_ICONS as icons } from "./role-style";
import {
  autoAnswer,
  autoCaption,
  autoDigits,
  useAutoplay,
} from "./use-autoplay";
import dynamic from "next/dynamic";
import { backend } from "@/lib/client";
import {
  markNarrationSeen,
  narrationEnabled,
  narrationLines,
  narrationSeen,
} from "@/lib/narration";
import {
  ROLES,
  ROLE_NAMES,
  type Command,
  type Role,
} from "@/supabase/functions/_shared/types";
import type { FieldStatus } from "./field-3d";
import type { GatherMember, RevealStep } from "./gather-stage";
import { RoleReveal, type RevealCue } from "./role-reveal";
import { LobbyInvite } from "./lobby-invite";
const Field3D = dynamic(() => import("./field-3d").then((m) => m.Field3D), {
  ssr: false,
  loading: () => <SceneArt site={0} party={false} />,
});
// 모이기·보직 공개·장비 장면 뒤의 입체 정문(첫 화면과 같은 점토 캠퍼스)
const GatherStage = dynamic(
  () => import("./gather-stage").then((m) => m.GatherStage),
  { ssr: false, loading: () => <SceneArt party={false} /> },
);
// 보직 공개 애니메이션을 이 기기에서 이미 봤는지(같은 게임에서 새로고침해도 다시 띄우지 않는다)
const revealSeenKey = (gameId: string) => `hoguk:reveal-seen:${gameId}`;
const revealSeen = (gameId: string) => {
  try {
    return sessionStorage.getItem(revealSeenKey(gameId)) === "1";
  } catch {
    return false;
  }
};
// 보직 공개 소리: 카드를 섞을 때 가볍게, 내 카드가 뒤집힐 때 거문고 한 소절, 팀이 모두 드러날 때 한 음
const revealCue = (cue: RevealCue) => {
  play(cue === "flip" ? "role-reveal" : cue === "team" ? "join" : "tap");
};
// 첫 화면 입체 배경: three는 이 화면에서만 따로 받는다(첫 그림을 늦추지 않게)
const HomeHero = dynamic(() => import("./home-hero").then((m) => m.HomeHero), {
  ssr: false,
  loading: () => <SceneArt party={false} />,
});
// 이동 장면에서 이 장면들로 넘어가는 순간이 거점 도착이다
const ARRIVAL_SCENES = ["mission", "report", "lock", "waiting"];
const descriptions: Record<Role, string> = {
  commander:
    "자신의 단서를 풀고, 네 사람의 보고를 모아 기억의 자물쇠를 열어라.",
  scout: "표지석과 안내판의 흔적을 찾아 현장에 남은 기록을 읽어라.",
  signal: "현장의 힌트를 따라 주파수를 조절하고, 흩어진 신호를 모아라.",
  cipher: "달력과 현판에 담긴 의미를 읽고 숨은 단서를 해독하라.",
};
function RoleBadge({ role }: { role: Role }) {
  const Icon = icons[role];
  return (
    <span className={`role-badge ${role}`}>
      <Icon size={17} />
      {ROLE_NAMES[role]}
    </span>
  );
}
function Team({ snapshot: s }: { snapshot: GameResponse }) {
  return (
    <div className="team-list">
      {Array.from({ length: 4 }, (_, i) => {
        const member = s.game.members[i],
          index = member?.role
            ? (isV2Response(s) ? ROLES : s.current_site.lockOrder).indexOf(member.role)
            : -1;
        return (
          <div
            className={`team-member ${member?.id === s.self.id ? "self" : ""}`}
            key={i}
          >
            <span className="member-number">0{i + 1}</span>
            <div>
              <b>
                {member?.nickname ?? "합류 대기"}
                {member?.id === s.self.id && <small>나</small>}
              </b>
              <span>
                {member?.role ? ROLE_NAMES[member.role] : "보직 배정 대기"}
              </span>
            </div>
            <span className="member-state">
              {index >= 0 && s.game.report_mask[index] ? (
                <>
                  <Check size={14} />
                  보고 완료
                </>
              ) : member?.ready ? (
                "준비 완료"
              ) : member ? (
                "접속 중"
              ) : (
                "빈 자리"
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((q) => q.toDataURL(value, { width: 180, margin: 2 }))
      .then((v) => {
        if (active) setSrc(v);
      });
    return () => {
      active = false;
    };
  }, [value]);
  return src ? (
    <img src={src} width={180} height={180} alt="팀원 합류 QR 코드" />
  ) : (
    <p>QR 준비 중…</p>
  );
}
// 폰 목업 보기 단추(app-shell.tsx가 넘긴다). on은 지금 목업 틀 안이라는 뜻이고,
// fullscreen이 있으면 '전체 화면'도 바깥 틀에 맡긴다.
export type MockupControl = {
  on: boolean;
  toggle: () => void;
  fullscreen?: () => void;
};
export default function GameApp({
  joinCode = "",
  mockup,
}: {
  joinCode?: string;
  mockup?: MockupControl;
}) {
  const {
      snapshot: s,
      busy,
      error,
      online,
      restoring,
      now,
      send: rawSend,
      retry: rawRetry,
      reset,
    } = useGameAny(),
    // 단서 보고·자물쇠 판정이 돌아오면 소리를 낸다
    cueSend = useCueSend(rawSend);
  const v2 = s && isV2Response(s) ? s : null;
  const soloDemo = !!s?.game.demo && !v2;
  const simulatedArrival = !!v2 && allowsSimulatedArrival(v2.course, v2.stage.arrival);
  const ownArrival = !!v2?.self.role &&
    v2.game.arrival_mask[ROLES.indexOf(v2.self.role)];
  // Keep the completion receipt visible across polling while this view is mounted.
  // Older Edge responses lack game.completion; never infer it from read flags.
  const [completionNotice, setCompletionNotice] = useState<{
    gameId: string; stageId: string; label: string;
  } | null>(null);
  const activeScope = useRef({ gameId: s?.game.id, stageId: v2?.stage.id });
  activeScope.current = { gameId: s?.game.id, stageId: v2?.stage.id };
  const rememberCompletion = useCallback((next: GameResponse | null) => {
    // A newer poll may win snapshot reconciliation before this receipt arrives.
    // Read the receipt itself, but never display a late result from another room/stage.
    if (next && isV2Response(next) && next.game.site_phase === "cleared" &&
      typeof next.result?.label === "string" &&
      activeScope.current.gameId === next.game.id && activeScope.current.stageId === next.stage.id) {
      setCompletionNotice({ gameId: next.game.id, stageId: next.stage.id, label: next.result.label });
    }
  }, []);
  const send = useCallback(async (command: Command) => {
    const next = await cueSend(command);
    rememberCompletion(next);
    if (command.action === "submit-report" && next && isV2Response(next) && next.self.reported && next.stage.completion.type === "lock")
      setPane("report");
    return next;
  }, [cueSend, rememberCompletion]);
  const retry = useCallback(async () => {
    const next = await rawRetry();
    rememberCompletion(next);
    return next;
  }, [rawRetry, rememberCompletion]);
  const location = useLocation(s, send), lockDraft = useLockDraft(s);
  useEffect(() => {
    if (!v2 || v2.game.site_phase !== "cleared") {
      setCompletionNotice(null);
      return;
    }
    if (typeof v2.result?.label === "string") {
      setCompletionNotice({ gameId: v2.game.id, stageId: v2.stage.id, label: v2.result.label });
    }
  }, [v2?.game.id, v2?.stage.id, v2?.game.site_phase, v2?.result?.label]);
  const completionLabel = v2 && completionNotice?.gameId === v2.game.id &&
    completionNotice.stageId === v2.stage.id ? completionNotice.label : v2?.game.completion?.label ?? null;
  const [entry, setEntry] = useState<"create" | "join" | null>(
      joinCode ? "join" : null,
    ),
    [nickname, setNickname] = useState(""),
    [code, setCode] = useState(joinCode),
    [pane, setPane] = useState<Pane>("report"),
    [modal, setModal] = useState<
      "menu" | "team" | "records" | "guide" | "invite" | "scenes" | null
    >(null),
    [origin, setOrigin] = useState(""),
    [copied, setCopied] = useState(false),
    [dev, setDev] = useState(false),
    [auto, setAuto] = useState(false),
    [field, setField] = useState<FieldStatus | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // 폰 목업 보기를 막 켜거나 끈 뒤라면 앞 문서의 화면 상태를 넘겨받는다(view-handoff.ts).
  // undefined는 아직 읽지 않음, null은 넘겨받을 것이 없음(개발 모드 Strict Mode가 효과를 두 번 돌려도 한 번만 읽는다)
  const handoff = useRef<Handoff | null | undefined>(undefined);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrigin(window.location.origin);
    setDev(params.get("dev") === "1");
    if (handoff.current === undefined) handoff.current = takeHandoff();
    const h = handoff.current;
    if (h) {
      // 자동 시연은 새로 시작하지 않고 지금 작전에서 이어 간다(주소의 auto=1도 다시 시작하지 않는다)
      setRehearsedFor(h.rehearsed);
      setRehearsal(h.rehearsal);
      setAuto(h.auto);
    } else if (backend === "local" && params.get("auto") === "1") startAuto();
  }, []);
  // 시연 장면 고르기로 자물쇠 장면에 오면 보고 화면을 건너뛰고 지휘관의 자물쇠를 바로 연다
  const jumpLock = useRef<string | null>(null);
  useEffect(() => {
    const site = s?.current_site.id ?? null;
    if (jumpLock.current !== site) jumpLock.current = null;
    const back = s
      ? handoffPane(handoff.current ?? null, {
          game: s.game.id,
          site: s.current_site.id,
          role: s.self.role ?? null,
        })
      : null;
    if (s && handoff.current) {
      // A v2 room recovers only the server verdict, never a saved private input.
      if (!isV2Response(s) && handoff.current.lock)
        lockDraft.restore(handoff.current.lock);
      handoff.current = null;
    }
    setPane(
      jumpLock.current && s?.self.role === "commander"
        ? "lock"
        : (back ?? "report"),
    );
  }, [s?.game.id, s?.current_site.id, s?.self.role]);
  // 다른 장면이나 다음 거점으로 넘어가면 지난 이동 화면의 지도 상태를 버린다
  useEffect(() => {
    setField(null);
  }, [s?.current_site.id, s?.game.site_phase]);
  useEffect(() => {
    // Retry may finish a create/join request after its original handler returned.
    if (s && (!joinCode || s.game.code === joinCode)) setEntry(null);
  }, [s?.game.id, joinCode]);
  const create = async (demo = false) => {
    const next = await send({
      action: demo
        ? "create-demo"
        : entry === "join"
          ? "join-game"
          : "create-game",
      nickname: demo ? "기록자" : nickname,
      ...(!demo && entry === "join" ? { code } : {}),
    });
    if (next) setEntry(null);
  };
  const home = () => {
    location.stop();
    reset();
    setEntry(null);
    setModal(null);
    setPane("report");
  };
  // 발표용 자동 시연: 항상 새 시연 작전으로 처음부터 진행한다.
  const startAuto = () => {
    home();
    setAuto(true);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/j/${s!.game.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  // 보직 공개: 서버가 장비 단계로 넘어가도 이 기기에서 카드 공개가 끝날 때까지 공개 장면을 둔다
  const [revealFor, setRevealFor] = useState<string | null>(null),
    [revealDone, setRevealDone] = useState(false),
    [revealStep, setRevealStep] = useState<RevealStep>("none"),
    [revealSkip, setRevealSkip] = useState(false);
  if ((s?.game.id ?? null) !== revealFor) {
    setRevealFor(s?.game.id ?? null);
    setRevealDone(!!s && revealSeen(s.game.id));
    setRevealStep("none");
    setRevealSkip(false);
  }
  // 시연 작전의 모이기·보직 공개 미리 보기(자동 시연 처음, 또는 시연 장면 고르기).
  // 서버 진행은 그대로 두고 화면만 보여 준다: 시연 동료가 하나씩 걸어 들어오고, 지금 보직 카드가 뒤집힌다.
  const [rehearsal, setRehearsal] = useState<{
      game: string;
      step: "lobby" | "briefing";
      count: number;
      shown?: boolean; // 카드 공개가 끝났다: 결과를 잠시 보여 주고 닫는다
    } | null>(null),
    [rehearsedFor, setRehearsedFor] = useState<string | null>(null);
  if (
    auto &&
    soloDemo &&
    s &&
    s.game.status === "playing" &&
    s.game.id !== rehearsedFor
  ) {
    setRehearsedFor(s.game.id);
    setRehearsal({ game: s.game.id, step: "lobby", count: 0 });
    setRevealSkip(false);
  }
  const rehearsing =
    !v2 && rehearsal && s && rehearsal.game === s.game.id ? rehearsal : null;
  // 목업을 켜고 끌 수 있을 때만 지금 화면 상태를 적어 둔다(보기를 바꾸면 새 문서의 GameApp이 이어 간다)
  const lockKey = s && !v2
    ? lockDraft.draft.scope + lockDraft.draft.digits.join()
    : "";
  useEffect(() => {
    if (!mockup) return;
    saveHandoff({
      game: s?.game.id ?? null,
      site: s?.current_site.id ?? null,
      role: s?.self.role ?? null,
      auto: !v2 && auto,
      rehearsed: rehearsedFor,
      rehearsal: rehearsal && {
        game: rehearsal.game,
        step: rehearsal.step,
        count: rehearsal.count,
      },
      pane,
      lock: s && !v2 ? lockDraft.draft : null,
    });
  }, [
    !!mockup,
    s?.game.id,
    s?.current_site.id,
    s?.self.role,
    auto,
    rehearsedFor,
    rehearsal?.game,
    rehearsal?.step,
    rehearsal?.count,
    pane,
    lockKey,
    !!v2,
  ]);
  const scene = !s
    ? entry
      ? "enroll"
      : "title"
    : entry
      ? "enroll"
      : rehearsing
        ? rehearsing.step
        : s.game.status === "lobby"
          ? "lobby"
          : s.game.status === "briefing" ||
              (s.game.status === "equip" && !revealDone)
            ? "briefing"
            : s.game.status === "equip"
              ? "equip"
              : s.game.status === "done"
                ? "done"
                : s.game.site_phase === "travel"
                  ? "travel"
                  : s.game.site_phase === "cleared"
                    ? v2 && pane === "summary" ? "done" : "sacho"
                    : v2
                      ? v2.stage.completion.type !== "lock" ? "mission" : pane === "lock" && s.self.role === "commander"
                        ? "lock"
                        : !s.self.reported || pane === "mission"
                          ? "mission"
                          : pane === "waiting" ? "waiting" : "report"
                    : s.self.reported
                      ? pane === "lock" && s.self.role !== "commander"
                        ? "report"
                        : pane
                      : "mission";
  const role = s?.self.role,
    site = s?.current_site,
    remaining = s
      ? Math.max(
          0,
          Math.ceil(((s.game.site_started_at ?? now) + 30000 - now) / 1000),
        )
      : 0;
  const acquired = s?.game.acquired_sites.length ?? 0,
    elapsed = s?.game.started_at
      ? Math.floor(((s.game.ended_at ?? v2?.game.completion?.at ?? now) - s.game.started_at) / 60000)
      : 0;
  const sceneKey = `${scene}:${site?.id ?? ""}:${role ?? ""}`;
  const gameId = s?.game.id;
  // 거점 도착 화면: 이동 장면에서 도착 장면으로 넘어가는 순간 게임·거점마다 한 번 띄운다.
  // 나레이션보다 먼저 나오고, 떠 있는 동안 나레이션과 자동 시연은 기다린다.
  // 같은 렌더에서 정해야 미션 화면이나 나레이션이 한 번 비쳤다 사라지지 않는다.
  const [lastScene, setLastScene] = useState(scene),
    [stop, setStop] = useState<string | null>(null);
  if (lastScene !== scene) {
    setLastScene(scene);
    if (
      lastScene === "travel" &&
      ARRIVAL_SCENES.includes(scene) &&
      gameId &&
      site &&
      stopEnabled() &&
      !stopSeen(gameId, site.id)
    )
      setStop(site.id);
  }
  if (stop && (!gameId || site?.id !== stop)) setStop(null);
  useEffect(() => {
    if (gameId && stop) markStopSeen(gameId, stop);
  }, [gameId, stop]);
  const focusHeading = () => {
    const root = canvas.current;
    // 거점 도착 화면이나 나레이션이 떠 있으면 초점은 그쪽에 둔다
    if (!root || root.querySelector(".stop-screen, .narration")) return;
    root
      .querySelector<HTMLElement>("[data-scene-heading]")
      ?.focus({ preventScroll: true });
  };
  useEffect(() => {
    focusHeading();
  }, [sceneKey]);
  const legacyGate = !!v2?.course.demo && v2.stage.id === "gate" &&
    v2.stage.sacho?.id === "legacy-sacho-gate";
  const narrationKey = !s
    ? null
    : scene === "sacho"
      ? `sacho:${site!.id}`
      : ["mission", "report", "lock", "waiting"].includes(scene)
        ? `arrive:${site!.id}`
        : ["briefing", "equip", "travel"].includes(scene)
          ? v2 && !legacyGate ? `intro:${scene}` : "intro"
          : null;
  const narrationTrigger = scene === "sacho" ? "stage-complete" :
    scene === "briefing" ? "role-reveal" : scene === "equip" ? "ready" :
    ARRIVAL_SCENES.includes(scene) ? "enter" : null;
  const stageNarration = legacyGate ? narrationLines(
    scene === "sacho" ? "sacho" : ARRIVAL_SCENES.includes(scene) ? "arrive" : "intro", site,
  ) : v2?.stage.narration.filter((line) =>
    line.trigger === narrationTrigger
  ).map((line) => line.text) ?? [];
  const [narration, setNarration] = useState<string | null>(null);
  useEffect(() => {
    if (!gameId) return setNarration(null);
    setNarration((open) => {
      if (open && open !== narrationKey) markNarrationSeen(gameId, open);
      if (v2 && stageNarration.length === 0) return null;
      if (open === narrationKey) return open;
      return narrationKey &&
        !stop &&
        narrationEnabled() && (!v2 || stageNarration.length > 0) &&
        !narrationSeen(gameId, narrationKey)
        ? narrationKey
        : null;
    });
  }, [gameId, narrationKey, stop, !!v2, stageNarration.join("\n")]);
  // 이동 중 5·18 조용한 구역 안인가(배경음을 추모 숨결로). 지도가 아직 위치를 알리기 전에는
  // 이 다리가 시작하는 자리(앞 거점)가 추모 거점이었는지로 어림한다(정문을 막 떠나는 길).
  const leavingReverent = !!s?.course.sites.find(
      (p) => p.seq === (site?.seq ?? 0) - 1,
    )?.reverent,
    hushed =
      scene === "travel" &&
      (field && !field.loading ? field.quiet : leavingReverent);
  useSoundCues({
    scene,
    reverent: !!site?.reverent,
    hushed,
    silent: !!v2 && (v2.stage.kind === "memorial" || v2.self.journal.some((j) => j.memorial_record)),
    narration: !!narration,
    reportKey: `${gameId}:${site?.id}:${role}`,
    reported: !!s?.self.reported,
    digits: lockDraft.digits,
  });
  useAutoplay({
    active: auto && !v2,
    paused: !!narration || restoring || !!stop,
    s,
    scene,
    busy,
    arrived: scene === "travel" && !!(field?.inRange || field?.failed),
    send,
    setPane,
    stop: () => setAuto(false),
  });
  // 미리 보기 모이기: 시연 동료가 하나씩 걸어 들어오고, 다 모이면 보직 공개로 넘어간다
  useEffect(() => {
    if (!rehearsing || rehearsing.step !== "lobby") return;
    const t = window.setTimeout(
      () => {
        if (rehearsing.count >= 4) setRevealStep("none");
        setRehearsal((r) =>
          !r
            ? r
            : r.count < 4
              ? { ...r, count: r.count + 1 }
              : { ...r, step: "briefing" },
        );
      },
      rehearsing.count === 0 ? 700 : rehearsing.count < 4 ? 1300 : 4400,
    );
    return () => window.clearTimeout(t);
  }, [rehearsing?.step, rehearsing?.count]);
  useEffect(() => {
    if (!rehearsing?.shown) return;
    const t = window.setTimeout(() => setRehearsal(null), 1600);
    return () => window.clearTimeout(t);
  }, [rehearsing?.shown]);
  const rehearse = () => {
    if (!s) return;
    setAuto(false);
    setModal(null);
    setRevealStep("none");
    setRevealSkip(false);
    setRehearsal({ game: s.game.id, step: "lobby", count: 0 });
  };
  const finishReveal = () => {
    if (rehearsing) {
      setRehearsal((r) => r && { ...r, shown: true });
      return;
    }
    if (gameId)
      try {
        sessionStorage.setItem(revealSeenKey(gameId), "1");
      } catch {}
    setRevealDone(true);
  };
  const gathering =
    scene === "lobby" || scene === "briefing" || scene === "equip";
  const gatherMembers: GatherMember[] = gathering
    ? s!.game.members
        .slice(0, rehearsing?.step === "lobby" ? rehearsing.count : 4)
        .map((m) => ({
          id: m.id,
          nickname: m.nickname,
          role: m.role,
          ready: m.ready,
          self: m.id === s!.self.id,
        }))
    : [];
  // 로비에 장병이 새로 걸어 들어올 때마다 한 음(처음 들어온 화면에서는 울리지 않는다)
  const crew = scene === "lobby" ? gatherMembers.length : 0;
  const lastCrew = useRef(crew);
  useEffect(() => {
    const was = lastCrew.current;
    lastCrew.current = crew;
    if (was > 0 && crew > was) play("join");
  }, [crew]);
  const closeNarration = () => {
    if (gameId && narration) markNarrationSeen(gameId, narration);
    setNarration(null);
    requestAnimationFrame(focusHeading);
  };
  const closeStop = () => {
    if (gameId && stop) markStopSeen(gameId, stop);
    setStop(null);
    requestAnimationFrame(focusHeading);
  };
  const reports = (
    <div className="report-progress">
      <span>
        {s?.game.report_mask.filter(Boolean).length ?? 0} / 4 보직 보고 완료
      </span>
      <div>
        {(v2 ? ROLES : s?.current_site.lockOrder ?? ROLES).map((r, i) => {
          const Icon = icons[r];
          return (
            <span
              role="img"
              key={r}
              className={s?.game.report_mask[i] ? "complete" : ""}
              aria-label={`${ROLE_NAMES[r]} ${s?.game.report_mask[i] ? "보고 완료" : "대기"}`}
            >
              <Icon size={16} />
              {s?.game.report_mask[i] && <Check size={11} />}
            </span>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="game-viewport">
      <div className="game-canvas" ref={canvas}>
        <header className="game-hud">
          <div className="game-brand">
            <span className="tiny-seal" aria-hidden="true">
              記
            </span>
            <b>호국실록</b>
          </div>
          <div className="hud-stage">
            {s ? (
              <>
                <span className="hud-route">
                  {site?.name}
                  {s.course.demo && (
                    <small className="simulation-badge"> · 시연</small>
                  )}
                </span>
                <span className="stage-dots">
                  {s.course.sites.map((p) => (
                    <i
                      key={p.id}
                      className={p.seq <= s.game.current_site_seq ? "on" : ""}
                    />
                  ))}
                </span>
              </>
            ) : (
              <span>전남대편</span>
            )}
          </div>
          <div className="hud-right">
            {backend === "local" && !v2 && (
              <button
                className={`hud-auto ${auto ? "on" : ""}`}
                aria-label={auto ? "시연 정지" : "자동 시연"}
                aria-pressed={auto}
                onClick={() => (auto ? setAuto(false) : startAuto())}
              >
                {auto ? <Square size={14} /> : <Play size={14} />}
                <span className="hud-auto-long">
                  {auto ? "시연 정지" : "자동 시연"}
                </span>
                <span className="hud-auto-short">{auto ? "정지" : "시연"}</span>
              </button>
            )}
            {s && v2?.stage.kind !== "memorial" && (
              <span className="hud-score">
                {s.game.score}
                <small>점</small>
              </span>
            )}
            <span
              role="img"
              className={`connection-dot ${online ? "" : "offline"}`}
              aria-label={online ? "연결됨" : "연결 끊김"}
            />
            <SoundToggle />
            <button
              className="icon-button"
              aria-label="메뉴 열기"
              onClick={() => setModal("menu")}
            >
              <Menu size={21} />
            </button>
          </div>
        </header>
        {auto && !v2 && (
          <div className="autoplay-caption" role="status">
            <span>자동 시연</span>
            <p>{autoCaption(scene, s)}</p>
          </div>
        )}
        {gathering && (
          <div className="gather-layer">
            <GatherStage
              members={gatherMembers}
              shot={scene === "equip" ? "self" : "line"}
              reveal={
                scene === "equip"
                  ? "all"
                  : scene === "briefing"
                    ? revealStep
                    : "none"
              }
              walkIn={scene === "lobby"}
              hidden={!!narration || !!stop}
              fallback={<SceneArt party={false} />}
            />
          </div>
        )}
        <main
          className={`game-scene scene-${scene}`}
          data-scene={scene}
          key={sceneKey}
          id="main-content"
        >
          {scene === "title" ? (
            <>
              <div className="title-backdrop">
                <HomeHero fallback={<SceneArt party={false} />} />
              </div>
              <div className="title-stage">
                <div className="title-scrim" />
                <div className="title-copy" data-hero-top>
                  <span className="title-kicker">
                    네 개의 시선, 하나의 기억
                  </span>
                  <div className="title-lockup">
                    <h1 data-scene-heading tabIndex={-1}>
                      호국실록
                    </h1>
                    <span className="title-seal" aria-hidden="true">
                      記
                    </span>
                  </div>
                  <div className="title-edition">
                    <span />
                    전남대편
                    <span />
                  </div>
                </div>
              </div>
              <section className="game-console title-console" data-hero-bottom>
                <p className="dialogue-line">
                  흩어진 단서를 찾아, 우리의 기억을 함께 완성하라.
                </p>
                <div className="title-actions">
                  <button
                    className="button primary"
                    disabled={restoring || busy}
                    onClick={() => setEntry("create")}
                  >
                    작전 시작
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="button secondary"
                    disabled={restoring || busy}
                    onClick={() => setEntry("join")}
                  >
                    코드로 합류
                    <Users size={18} />
                  </button>
                  {backend === "local" && (
                    <button
                      className="button secondary demo-button"
                      disabled={restoring || busy}
                      onClick={() => void create(true)}
                    >
                      혼자 데모 체험
                      <Compass size={18} />
                    </button>
                  )}
                </div>
                <span className="console-footnote">
                  {backend === "local"
                    ? "시연 코스 · 실제 좌표와 문항은 미확정"
                    : "설치 없는 4인 현장 협동 미션"}
                </span>
              </section>
            </>
          ) : scene === "enroll" ? (
            <>
              <div className="scene-heading">
                <button
                  className="icon-button"
                  aria-label="타이틀로 돌아가기"
                  onClick={() => setEntry(null)}
                >
                  <ArrowLeft />
                </button>
                <span>작전 참가</span>
              </div>
              <div className="enroll-stage">
                <SceneArt party={false} />
                <form
                  className="enroll-form game-window"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <span className="eyebrow">
                    {entry === "join" ? "JOIN OPERATION" : "NEW OPERATION"}
                  </span>
                  <h1 data-scene-heading tabIndex={-1}>
                    {entry === "join"
                      ? "동료들의 기록에 합류하라."
                      : "당신의 호출명을 남겨라."}
                  </h1>
                  <label className="field-label">
                    호출명
                    <input
                      required
                      maxLength={6}
                      pattern="[가-힣a-zA-Z0-9]{1,6}"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="한글·영문·숫자 1~6자"
                      autoComplete="off"
                    />
                  </label>
                  {entry === "join" && (
                    <label className="field-label">
                      입장 코드
                      <input
                        required
                        minLength={4}
                        maxLength={4}
                        value={code}
                        onChange={(e) =>
                          setCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z2-9]/g, ""),
                          )
                        }
                        className="code-input"
                        placeholder="ABCD"
                      />
                    </label>
                  )}
                  <button
                    className="button primary full"
                    disabled={
                      busy ||
                      restoring ||
                      !nickname ||
                      (entry === "join" && code.length !== 4)
                    }
                  >
                    {entry === "join" ? "작전에 합류하기" : "새 작전 만들기"}
                    <ArrowRight size={18} />
                  </button>
                  <p className="console-footnote">실명·연락처 없이 참여한다.</p>
                </form>
              </div>
            </>
          ) : scene === "lobby" ? (
            <>
              <div className="gather-top" data-gather-top>
                <div className="gather-heading">
                  <span className="eyebrow">
                    동료 합류 대기 ·{" "}
                    {rehearsing ? rehearsing.count : s!.game.members.length}
                    /4
                  </span>
                  <h1 data-scene-heading tabIndex={-1}>
                    네 사람의 기록이 필요하다.
                  </h1>
                </div>
                <LobbyInvite
                  code={s!.game.code}
                  url={origin ? `${origin}/j/${s!.game.code}` : ""}
                  host={s!.self.is_host}
                  copied={copied}
                  onCopy={() => void copy()}
                />
              </div>
              <div className="gather-gap" />
              <section
                className="game-console gather-console"
                data-gather-bottom
              >
                <div className="console-copy">
                  <span className="speaker">기록관</span>
                  <p>
                    {rehearsing
                      ? "시연 미리 보기: 실제 작전에서는 네 사람이 각자 폰으로 합류한다."
                      : s!.self.is_host
                        ? "옆 사람에게 QR을 보여 주거나 코드를 전하라. 네 사람이 모이면 보직을 공개한다."
                        : "정문 앞에 동료가 모인다. 네 사람이 모이면 방장이 보직을 공개한다."}
                  </p>
                </div>
                <div className="console-actions">
                  {rehearsing ? (
                    <button
                      className="button secondary"
                      onClick={() => setRehearsal(null)}
                    >
                      미리 보기 닫기
                    </button>
                  ) : (
                    <>
                      {!s!.self.is_host && (
                        <button
                          className="button secondary"
                          onClick={() => setModal("invite")}
                        >
                          QR로 초대
                          <Users size={18} />
                        </button>
                      )}
                      {s!.self.is_host ? (
                        <button
                          className="button primary"
                          disabled={busy || s!.game.members.length !== 4}
                          onClick={() => void send({ action: "start-game" })}
                        >
                          {s!.game.members.length === 4
                            ? "보직 공개 시작"
                            : "동료를 기다리는 중"}
                          <ArrowRight size={18} />
                        </button>
                      ) : (
                        <span className="waiting-note">
                          방장의 신호를 기다리라.
                        </span>
                      )}
                    </>
                  )}
                </div>
              </section>
            </>
          ) : scene === "briefing" ? (
            <>
              <div className="gather-top reveal-top" data-gather-top>
                <div className="gather-heading">
                  <span className="eyebrow">보직 배정</span>
                  <h1 data-scene-heading tabIndex={-1}>
                    당신의 역할이 정해진다.
                  </h1>
                </div>
                {role && (
                  <RoleReveal
                    key={`${gameId}:${rehearsing ? "preview" : "game"}`}
                    role={role}
                    nickname={s!.self.nickname}
                    paused={!!narration || !!stop}
                    skip={revealSkip || (!rehearsing && revealDone)}
                    onStep={setRevealStep}
                    onDone={finishReveal}
                    onCue={revealCue}
                  />
                )}
              </div>
              <div className="gather-gap" />
              <section className="game-console" data-gather-bottom>
                <p className="dialogue-line">
                  {revealStep !== "all"
                    ? "각자의 시선으로, 함께 기억하라."
                    : rehearsing
                      ? "네 보직이 모두 정해졌다. 미리 보기를 마치고 작전으로 돌아간다."
                      : "네 보직이 모두 정해졌다. 장비를 받으러 간다."}
                </p>
                {revealStep !== "all" && (
                  <button
                    className="button secondary"
                    onClick={() => setRevealSkip(true)}
                  >
                    바로 보기
                  </button>
                )}
              </section>
            </>
          ) : scene === "equip" ? (
            <>
              <div className="gather-top equip-top" data-gather-top>
                <div
                  className={`dog-tag ${role}`}
                  style={
                    role
                      ? ({ "--role": ROLE_COLORS[role] } as CSSProperties)
                      : undefined
                  }
                >
                  <span className="dog-tag-icon" aria-hidden="true">
                    {role &&
                      (() => {
                        const Icon = icons[role];
                        return <Icon size={26} />;
                      })()}
                  </span>
                  <span className="dog-tag-text">
                    {role && <RoleBadge role={role} />}
                    <b>{s!.self.nickname}</b>
                    <small>
                      FIELD JOURNAL · 0
                      {s!.game.members.findIndex((m) => m.id === s!.self.id) +
                        1}
                    </small>
                  </span>
                </div>
                <h1 data-scene-heading tabIndex={-1}>
                  {ROLE_NAMES[role!]}, 준비하라.
                </h1>
                <p className="equip-desc">{descriptions[role!]}</p>
              </div>
              <div className="gather-gap" />
              <section
                className="game-console equip-console"
                data-gather-bottom
              >
                <div className="console-copy">
                  <div className="ready-progress">
                    {s!.game.members.map((m) => (
                      <span key={m.id} className={m.ready ? "on" : ""}>
                        {m.ready ? <Check size={16} /> : <Users size={16} />}
                      </span>
                    ))}
                    <b>
                      {s!.game.members.filter((m) => m.ready).length}/4 준비
                    </b>
                  </div>
                  <p>
                    {s!.self.ready
                      ? "장비 수령을 마쳤다. 동료들의 준비를 기다리라."
                      : "장비 수령 후 GPS를 켜라. 네 명 모두 거점 반경 안에 도착해야 미션이 열린다."}
                  </p>
                </div>
                <div className="console-actions">
                  {!s!.self.ready ? (
                    <>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void send({ action: "set-ready" })}
                      >
                        {v2 && !simulatedArrival ? "준비만 완료 · GPS는 이동 시 설정" : "위치 없이 준비 완료"}
                      </button>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => {
                          location.start();
                          void send({ action: "set-ready" });
                        }}
                      >
                        위치 켜고 장비 수령
                        <LocateFixed size={18} />
                      </button>
                    </>
                  ) : role === "commander" ? (
                    <button
                      className="button primary"
                      disabled={busy || !s!.game.members.every((m) => m.ready)}
                      onClick={() => void send({ action: "begin-operation" })}
                    >
                      작전 출발
                      <ArrowRight size={18} />
                    </button>
                  ) : (
                    <span className="waiting-note">
                      지휘관의 출발 신호를 기다리라.
                    </span>
                  )}
                </div>
              </section>
            </>
          ) : scene === "travel" ? (
            <div className="travel-stage">
              <Field3D
                siteSeq={site!.seq}
                siteName={site!.name}
                fix={location.fix}
                target={site!}
                distance={location.distance}
                roleColor={ROLE_COLORS[role ?? "commander"]}
                role={role ?? null}
                look={s!.self.id}
                fallback={<SceneArt site={site!.seq - 1} />}
                fast={auto && !v2}
                simulateMovement={soloDemo || simulatedArrival}
                onStatus={setField}
                onMarkerTap={() => {
                  if (simulatedArrival && !ownArrival && !busy)
                    void send({ action: "report-arrival", stage_id: v2!.stage.id, method: "simulated" });
                  else if (soloDemo && !busy)
                    void send({ action: "demo-arrival", site_id: site!.id });
                }}
              />
              <TravelHud
                site={site!}
                sites={s!.course.sites}
                currentSeq={s!.game.current_site_seq}
                acquired={acquired}
                nickname={s!.self.nickname}
                role={role ?? null}
                field={field}
                location={location}
                demo={soloDemo}
                v2Arrival={v2 ? { simulated: simulatedArrival, arrived: ownArrival,
                  count: v2.game.arrival_mask.filter(Boolean).length } : undefined}
                busy={busy}
                remaining={remaining}
                onDemoArrival={() => void send(simulatedArrival
                  ? { action: "report-arrival", stage_id: v2!.stage.id, method: "simulated" }
                  : { action: "demo-arrival", site_id: site!.id })}
                onManualArrival={() =>
                  void send({
                    action: "report-arrival",
                    ...(v2
                      ? { stage_id: v2.stage.id, method: "manual" as const }
                      : { site_id: site!.id, manual: true }),
                  })
                }
                onMenu={() => setModal("menu")}
              />
            </div>
          ) : scene === "mission" ? (
            <>
              <div className="mission-header">
                <div>
                  <span className="eyebrow">거점 0{site!.seq} · 개인 단서</span>
                  <h1 data-scene-heading tabIndex={-1}>
                    {role && <RoleBadge role={role} />}
                  </h1>
                </div>
                <span className="mission-emblem">
                  {role &&
                    (() => {
                      const Icon = icons[role];
                      return <Icon size={38} />;
                    })()}
                </span>
              </div>
              <div className="mission-stage game-window">
                {v2 ? <MissionV2 snapshot={v2} busy={busy} now={now} send={send} onShowDigit={() => setPane("report")} /> : <Mission
                  snapshot={s!}
                  busy={busy}
                  send={send}
                  auto={auto && !narration && !stop ? autoAnswer(s) : undefined}
                />}
              </div>
              {v2 && v2.stage.completion.type === "lock" && role === "commander" && (
                <section className="game-console slim">
                  {reports}
                  <button className="button primary" disabled={busy} onClick={() => setPane("lock")}>
                    팀 자물쇠로 <ArrowRight size={18} />
                  </button>
                </section>
              )}
            </>
          ) : scene === "report" ? (
            <>
              <div className="reward-stage">
                <div className="reward-rays" />
                <span className="eyebrow">단서 획득</span>
                <h1 data-scene-heading tabIndex={-1}>
                  기억의 숫자를 찾았다.
                </h1>
                <div className="private-digit" data-testid={v2 ? "mission-v2-private-digit" : undefined}>{s!.self.digit}</div>
                {role && <RoleBadge role={role} />}
                <p>이 숫자는 당신의 기기에만 보인다.</p>
              </div>
              <section className="game-console">
                <div className="console-copy">
                  <span className="speaker">보고 완료</span>
                  <p>
                    {role === "commander"
                      ? "동료에게 말로 전해 들은 숫자와 함께 자물쇠에 입력하라."
                      : "지휘관에게 이 숫자를 말로 전하라. 함께 찾아야 기록이 열린다."}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    setPane(role === "commander" ? "lock" : "waiting")
                  }
                >
                  {role === "commander" ? "팀 자물쇠로" : "팀원 기다리기"}
                  <ArrowRight size={18} />
                </button>
                {v2 && <button className="button secondary" onClick={() => setPane("mission")}>
                  내 조사와 해설 확인 <BookOpen size={17} />
                </button>}
              </section>
            </>
          ) : scene === "lock" ? (
            <>
              <div className="lock-heading">
                <span className="eyebrow">거점 0{site!.seq} · 팀 미션</span>
                <h1 data-scene-heading tabIndex={-1}>
                  기억의 자물쇠
                </h1>
                <span className="lock-ornament">
                  <LockKeyhole size={44} />
                </span>
              </div>
              <div className="lock-stage game-window">
                {v2 ? <LockPanelV2 snapshot={v2} busy={busy} now={now} send={send} draft={lockDraft} /> : <LockPanel
                  snapshot={s!}
                  busy={busy}
                  send={send}
                  now={now}
                  digits={lockDraft.digits}
                  setDigits={lockDraft.setDigits}
                  auto={auto && !narration && !stop ? autoDigits(s) : undefined}
                />}
                {reports}
              </div>
              <section className="game-console slim">
                <p className="dialogue-line">
                  말로 전해 들은 네 숫자로 기억을 열어라.
                </p>
                <button
                  className="button secondary"
                  disabled={!!v2 && busy}
                  onClick={() => setPane(v2 ? "mission" : "report")}
                >
                  {v2 ? "내 조사와 해설 확인" : "내 숫자 확인"}
                  <ScrollText size={17} />
                </button>
              </section>
            </>
          ) : scene === "waiting" ? (
            <>
              <div className="waiting-stage">
                <SceneArt site={site!.seq - 1} />
                <div className="waiting-content game-window">
                  <Users size={38} />
                  <h1 data-scene-heading tabIndex={-1}>
                    동료들의 기록을 기다린다.
                  </h1>
                  {reports}
                  <p>
                    각자의 숫자를 말로 나누어라.
                    <br />
                    지휘관이 기록의 자물쇠를 연다.
                  </p>
                </div>
              </div>
              <section className="game-console">
                <span className="dialogue-line">당신의 보고는 전달되었다.</span>
                <button
                  className="button secondary"
                  onClick={() => setPane("report")}
                >
                  내 숫자 다시 보기
                </button>
                {v2 && <button className="button secondary" onClick={() => setPane("mission")}>
                  내 조사와 해설 확인 <BookOpen size={17} />
                </button>}
              </section>
            </>
          ) : scene === "sacho" ? (
            <>
              <div className="sacho-scene" data-testid={v2 ? "stage-v2-completed" : undefined}>
                <span className="eyebrow">기억 복원 · {site!.name}</span>
                <div className="sacho-character">{site!.sacho.char || (v2 ? "記" : "")}</div>
                <h1 data-scene-heading tabIndex={-1}>
                  {site!.sacho.name}
                </h1>
                <p>{site!.sacho.body || (v2 ? `${site!.name} 단계 확인 완료` : "")}</p>
                {v2 && completionLabel && <p>{completionLabel}</p>}
                {v2?.game.completion?.visit && <p>{v2.game.completion.visit.label}</p>}
                <div className="sacho-reward">
                  <Check size={17} /> 사초를 기록첩에 보관했다.
                </div>
              </div>
              <section className="game-console">
                <p className="dialogue-line">
                  {v2 ? `함께 복원한 ${site!.name} 기록을 보관했다.` : "다음 거점에 또 하나의 기억이 기다린다."}
                </p>
                {v2 ? (
                  <><MemorialDeparture key={`${v2.game.id}:${v2.stage.id}`} snapshot={v2} busy={busy} send={send} />
                  <button className="button primary" onClick={() => setPane("summary")}>
                    {site!.name} 결과 보기 <ArrowRight size={18} />
                  </button><button className="button secondary" onClick={() => setModal("records")}>
                    수집한 기록 읽기 <BookOpen size={18} />
                  </button></>
                ) : role === "commander" ? (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void send({
                        action: "depart-next-site",
                        site_id: site!.id,
                      })
                    }
                  >
                    다음 거점으로 출발
                    <ArrowRight size={18} />
                  </button>
                ) : (
                  <span className="waiting-note">
                    지휘관의 출발 신호를 기다리라.
                  </span>
                )}
              </section>
            </>
          ) : scene === "done" && v2?.game.status === "done" ? (
            <><ResultV2 snapshot={v2} /><button className="button secondary" onClick={home}>새 작전 준비하기</button></>
          ) : scene === "done" ? (
            <>
              <div className="completion">
                <span className="eyebrow">{v2 ? `${site!.name} 확인 완료 · 전남대편` : "작전 완료 · 전남대편"}</span>
                <h1 data-scene-heading tabIndex={-1}>
                  오늘의 실록 한 장을
                  <br />
                  함께 엮었다.
                </h1>
                <div className="collected-seals">
                  {s!.game.acquired_sites.map((p) => (
                    <span key={p.id}>
                      {p.sacho.char || (v2 ? "記" : "")}
                      <small>{p.sacho.name}</small>
                    </span>
                  ))}
                </div>
                <p>
                  정문에서 시작된 그해 오월을
                  <br />네 사람의 자리에서 다시 이었다.
                </p>
                <p className="completion-next">
                  {v2 ? `${site!.name}의 사초를 복원했다. ${v2.course.sites.some((s) => s.seq > site!.seq) ? "지휘관의 출발 신호에 맞춰 다음 거점으로 이동하라." : "후속 거점은 준비 중이며, 이번 확인은 여기까지다."}`
                    : "민주길의 기록은 여기서 끝나지 않는다. 박관현의 언덕, 윤상원의 숲, 김남주의 뜰이 다음 사초를 기다린다."}
                </p>
                {v2 && completionLabel && <p>{completionLabel}</p>}
                {v2?.game.completion?.visit && <p>{v2.game.completion.visit.label}</p>}
                {v2?.stage.kind !== "memorial" && <div className="completion-score">
                  <span>
                    <b>{s!.game.score}</b> 기록 점수
                  </span>
                  <span>
                    <b>{acquired}</b> 수집한 사초
                  </span>
                  <span>
                    <b>{elapsed}</b> 활동 시간 · 분
                  </span>
                </div>}
              </div>
              <section className="game-console">
                {v2 && <button className="button secondary" onClick={() => setPane("report")}>
                  사초로 돌아가기
                </button>}
                {v2 && <NextStageAction snapshot={v2} busy={busy} send={send} />}
                <button className="button secondary" onClick={home}>
                  새 작전 준비하기
                </button>
                <button
                  className="button primary"
                  onClick={() => setModal("records")}
                >
                  수집한 기록 읽기
                  <BookOpen size={18} />
                </button>
              </section>
            </>
          ) : null}
        </main>
        {stop && site && (
          <StopScreen
            key={`${gameId}:${stop}`}
            site={site}
            total={s!.course.sites.length}
            auto={auto && !v2}
            description={v2 && !legacyGate ? "주변을 안전하게 살피고, 각자의 기록을 확인하라." : undefined}
            onClose={closeStop}
          />
        )}
        {narration && !stop && (
          <Narration
            key={narration}
            lines={v2 ? stageNarration : narrationLines(
              narration.split(":")[0] as "intro" | "arrive" | "sacho",
              site,
            )}
            onClose={closeNarration}
            auto={auto && !v2}
          />
        )}
        {soloDemo && s!.game.status !== "done" && (
          <div className="demo-role-bar" aria-label="시연 보직 전환">
            <span>체험 보직</span>
            {ROLES.map((r) => (
              <button
                key={r}
                aria-pressed={role === r}
                disabled={busy}
                onClick={() => void send({ action: "demo-role", demo_role: r })}
              >
                {ROLE_NAMES[r]}
              </button>
            ))}
          </div>
        )}
        {(error || !online) && (
          <div className="error-banner" role="alert">
            <WifiOff size={18} />
            <p>{error || "연결이 끊겼다. 현재 장면과 진행은 유지된다."}</p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void retry()}
            >
              <RotateCcw size={15} />
              다시 연결
            </button>
          </div>
        )}
        {busy && (
          <span className="saving-indicator" role="status">
            기록 중…
          </span>
        )}
      </div>
      {modal && (
        <GameDialog
          title={
            modal === "menu"
              ? "작전 메뉴"
              : modal === "team"
                ? "우리 팀"
                : modal === "records"
                  ? "기록첩"
                  : modal === "invite"
                    ? "동료 초대"
                    : modal === "scenes"
                      ? "시연 장면 고르기"
                      : "진행 안내"
          }
          onClose={() => setModal(null)}
        >
          {modal === "menu" ? (
            <div className="pause-menu">
              <button
                className="button primary full"
                onClick={() => setModal(null)}
              >
                게임으로 돌아가기
                <ArrowRight size={18} />
              </button>
              {soloDemo && (
                <button
                  className="button secondary full"
                  onClick={() => setModal("scenes")}
                >
                  시연 장면 고르기
                  <Clapperboard size={18} />
                </button>
              )}
              {s && (
                <>
                  <button
                    className="button secondary full"
                    onClick={() => setModal("team")}
                  >
                    우리 팀<Users size={18} />
                  </button>
                  <button
                    className="button secondary full"
                    onClick={() => setModal("records")}
                  >
                    기록첩
                    <BookOpen size={18} />
                  </button>
                </>
              )}
              <button
                className="button secondary full"
                onClick={() => setModal("guide")}
              >
                진행 안내
                <HelpCircle size={18} />
              </button>
              <button
                className="button secondary full"
                onClick={() => {
                  // 목업 틀 안에서는 폰 틀째로 띄운다(앱만 띄우면 넓은 화면 배치가 된다)
                  if (mockup?.fullscreen) mockup.fullscreen();
                  else
                    void canvas.current?.requestFullscreen?.().catch(() => {});
                  setModal(null);
                }}
              >
                전체 화면
                <Maximize size={18} />
              </button>
              {/* 노트북·발표 화면에서 폰 모양 틀에 담아 본다(폰에서는 단추가 없다) */}
              {mockup && (
                <button
                  className="button secondary full"
                  onClick={() => {
                    setModal(null);
                    mockup.toggle();
                  }}
                >
                  {mockup.on ? "폰 목업 끄기" : "폰 목업으로 보기"}
                  <Smartphone size={18} />
                </button>
              )}
              <SoundToggle variant="menu" />
              {dev && soloDemo && s && (
                <DevControls snapshot={s} busy={busy} send={send} />
              )}
            </div>
          ) : modal === "scenes" && s && !v2 ? (
            <DemoScenes
              snapshot={s}
              busy={busy}
              send={send}
              onAuto={startAuto}
              onRehearse={rehearse}
              onJump={(stage, siteId) => {
                jumpLock.current = stage === "lock" ? (siteId ?? null) : null;
                // 자물쇠 장면으로 건너뛸 때는 도착 나레이션을 이미 본 것으로 둔다
                if (stage === "lock" && siteId && gameId)
                  markNarrationSeen(gameId, `arrive:${siteId}`);
              }}
              onPicked={(stage) => {
                // 고른 장면부터는 발표자가 직접 진행한다. 모이기·보직 공개 미리 보기가
                // 돌던 중이면 접어야 고른 장면이 바로 보인다.
                setAuto(false);
                setModal(null);
                setRehearsal(null);
                setRevealStep("none");
                setRevealSkip(false);
                if (stage === "lock") setPane("lock");
              }}
            />
          ) : modal === "team" && s ? (
            <>
              <Team snapshot={s} />
              <p>방장은 보직 공개를, 지휘관은 출발과 자물쇠를 담당한다.</p>
            </>
          ) : modal === "records" && s ? (
            v2 ? <JournalV2 snapshot={v2} /> : <div className="record-grid">
              {s.course.sites.map((p) => {
                const got = s.game.acquired_sites.some((a) => a.id === p.id);
                return (
                  <article
                    className={`record-card ${got ? "acquired" : ""}`}
                    key={p.id}
                  >
                    <span className="eyebrow">{p.name}</span>
                    <span className="record-char">
                      {got ? p.sacho.char || (v2 ? "記" : "") : "封"}
                    </span>
                    <h3>{p.sacho.name}</h3>
                    <p>
                      {got
                        ? p.sacho.body || (v2 ? "이 단계의 기록을 복원했다." : "")
                        : "동료들과 단서를 모아 이 기록을 복원하라."}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : modal === "invite" && s ? (
            <div className="invite-dialog">
              <div className="join-code">
                {s.game.code.split("").map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </div>
              <Qr value={`${origin}/j/${s.game.code}`} />
              <button
                className="button primary full"
                onClick={() => void copy()}
              >
                <Copy size={17} />
                {copied ? "링크 복사됨" : "초대 링크 복사"}
              </button>
              <p>각자의 폰에서 QR을 열어 호출명을 입력하라.</p>
            </div>
          ) : (
            <div className="guide-copy">
              <h3>관찰하고, 말로 나누고, 함께 기록하라.</h3>
              <p>
                네 명이 각자의 기기로 같은 방에 합류한다. 자신의 단서만 풀고,
                얻은 숫자를 말로 지휘관에게 전달한다.
              </p>
              <p>
                네 보직의 보고가 모이면 지휘관이 자물쇠를 연다. 맞은 칸은
                잠기고, 오답마다 10점을 차감한다. 세 번 소진하면 60초 후 한 번
                더 시도할 수 있다.
              </p>
              <p>
                {v2
                  ? simulatedArrival
                    ? "각자가 본인 모의 도착 버튼으로 개발 시연을 진행한다."
                    : `GPS를 켜고 반경 ${site?.radiusM ?? 10}m 안에서 5초간 기다리라. 네 명 모두 도착해야 미션이 열린다.`
                  : "위치 확인이 어려우면 이동 시작 30초 후 지휘관이 수동 도착할 수 있다."}
                {" "}좌표는 기기에서만 계산한다.
              </p>
              <p>
                <Shield size={16} /> 추모 공간을 존중하며 안전하게 이동하라.
                {(s?.course.demo ?? backend === "local")
                  ? v2?.stage.arrival.confirmed ? "GPS 좌표는 지정됐으며 문항은 시연용이다." : "시연 코스의 실제 좌표와 문항은 미확정이다."
                  : "지정된 거점에서 동료와 단서를 모아라."}
              </p>
            </div>
          )}
        </GameDialog>
      )}
    </div>
  );
}
