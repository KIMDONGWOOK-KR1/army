"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Copy,
  Flag,
  HelpCircle,
  LocateFixed,
  LockKeyhole,
  Maximize,
  Menu,
  Radio,
  RotateCcw,
  ScrollText,
  Shield,
  Users,
  WifiOff,
} from "lucide-react";
import { useGame } from "./use-game";
import { useLocation } from "./use-location";
import { useLockDraft } from "./use-lock-draft";
import { Mission, LockPanel } from "./mission";
import { SceneArt } from "./scene-art";
import { GameDialog } from "./game-dialog";
import { DevControls } from "./dev-controls";
import { backend } from "@/lib/client";
import {
  ROLES,
  ROLE_NAMES,
  type Role,
  type Snapshot,
} from "@/supabase/functions/_shared/types";
const icons = {
  commander: Flag,
  scout: Compass,
  signal: Radio,
  cipher: ScrollText,
};
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
function Team({ snapshot: s }: { snapshot: Snapshot }) {
  return (
    <div className="team-list">
      {Array.from({ length: 4 }, (_, i) => {
        const member = s.game.members[i],
          index = member?.role
            ? s.current_site.lockOrder.indexOf(member.role)
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
export default function GameApp({ joinCode = "" }: { joinCode?: string }) {
  const {
      snapshot: s,
      busy,
      error,
      online,
      restoring,
      now,
      send,
      retry,
      reset,
    } = useGame(),
    location = useLocation(s, send),
    lockDraft = useLockDraft(s);
  const [entry, setEntry] = useState<"create" | "join" | null>(
      joinCode ? "join" : null,
    ),
    [nickname, setNickname] = useState(""),
    [code, setCode] = useState(joinCode),
    [pane, setPane] = useState<"report" | "lock" | "waiting">("report"),
    [modal, setModal] = useState<
      "menu" | "team" | "records" | "guide" | "invite" | null
    >(null),
    [origin, setOrigin] = useState(""),
    [copied, setCopied] = useState(false),
    [dev, setDev] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
    setDev(new URLSearchParams(window.location.search).get("dev") === "1");
  }, []);
  useEffect(() => {
    setPane("report");
  }, [s?.current_site.id, s?.self.role]);
  useEffect(() => {
    if (s && s.game.code === joinCode) setEntry(null);
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/j/${s!.game.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const scene = !s
    ? entry
      ? "enroll"
      : "title"
    : entry
      ? "enroll"
      : s.game.status === "lobby"
        ? "lobby"
        : s.game.status === "briefing"
          ? "briefing"
          : s.game.status === "equip"
            ? "equip"
            : s.game.status === "done"
              ? "done"
              : s.game.site_phase === "travel"
                ? "travel"
                : s.game.site_phase === "cleared"
                  ? "sacho"
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
      ? Math.floor(((s.game.ended_at ?? now) - s.game.started_at) / 60000)
      : 0;
  const sceneKey = `${scene}:${site?.id ?? ""}:${role ?? ""}`;
  useEffect(() => {
    canvas.current
      ?.querySelector<HTMLElement>("[data-scene-heading]")
      ?.focus({ preventScroll: true });
  }, [sceneKey]);
  const reports = (
    <div className="report-progress">
      <span>
        {s?.game.report_mask.filter(Boolean).length ?? 0} / 4 보직 보고 완료
      </span>
      <div>
        {(s?.current_site.lockOrder ?? ROLES).map((r, i) => {
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
            {s && (
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
            <button
              className="icon-button"
              aria-label="메뉴 열기"
              onClick={() => setModal("menu")}
            >
              <Menu size={21} />
            </button>
          </div>
        </header>
        <main
          className={`game-scene scene-${scene}`}
          data-scene={scene}
          key={sceneKey}
          id="main-content"
        >
          {scene === "title" ? (
            <>
              <div className="title-stage">
                <SceneArt party={false} />
                <div className="title-vignette" />
                <div className="title-copy">
                  <span className="title-kicker">
                    네 개의 시선, 하나의 기억
                  </span>
                  <h1 data-scene-heading tabIndex={-1}>
                    호국실록
                  </h1>
                  <div className="title-edition">
                    <span />
                    전남대편
                    <span />
                  </div>
                  <p>
                    흩어진 단서를 찾고,
                    <br />
                    우리의 기억을 함께 완성하라.
                  </p>
                </div>
                <div className="title-stamp" aria-hidden="true">
                  기억
                  <br />
                  수집
                </div>
              </div>
              <section className="game-console title-console">
                <p className="dialogue-line">당신의 첫 번째 기록을 시작하라.</p>
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
              <div className="lobby-stage">
                <SceneArt party={false} />
                <div className="lobby-content game-window">
                  <span className="eyebrow">
                    동료 합류 대기 · {s!.game.members.length}/4
                  </span>
                  <h1 data-scene-heading tabIndex={-1}>
                    네 사람의 기록이 필요하다.
                  </h1>
                  <div
                    className="join-code"
                    aria-label={`입장 코드 ${s!.game.code}`}
                  >
                    {s!.game.code.split("").map((v, i) => (
                      <span key={i}>{v}</span>
                    ))}
                  </div>
                  <Team snapshot={s!} />
                </div>
              </div>
              <section className="game-console">
                <div className="console-copy">
                  <span className="speaker">기록관</span>
                  <p>
                    동료에게 입장 코드를 전하라.
                    <br />네 사람이 모이면 보직을 공개한다.
                  </p>
                </div>
                <div className="console-actions">
                  <button
                    className="button secondary"
                    onClick={() => setModal("invite")}
                  >
                    QR로 초대
                    <Users size={18} />
                  </button>
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
                </div>
              </section>
            </>
          ) : scene === "briefing" ? (
            <>
              <div className="reveal-scene">
                <SceneArt party={false} night />
                <div className="reveal-copy">
                  <span className="eyebrow">보직 배정</span>
                  <h1 data-scene-heading tabIndex={-1}>
                    당신의 역할이 정해진다.
                  </h1>
                  <div className="countdown">
                    {Math.max(
                      1,
                      Math.ceil(((s!.game.reveal_at ?? now) - now) / 1000),
                    )}
                  </div>
                </div>
              </div>
              <section className="game-console">
                <p className="dialogue-line">각자의 시선으로, 함께 기억하라.</p>
              </section>
            </>
          ) : scene === "equip" ? (
            <>
              <div className="equipment-stage">
                <SceneArt party={false} />
                <div className="equipment-content">
                  <div className={`dog-tag ${role}`}>
                    <i className="tag-hole" />
                    {role && <RoleBadge role={role} />}
                    <b>{s!.self.nickname}</b>
                    <span>
                      FIELD JOURNAL · 0
                      {s!.game.members.findIndex((m) => m.id === s!.self.id) +
                        1}
                    </span>
                  </div>
                  <h1 data-scene-heading tabIndex={-1}>
                    {ROLE_NAMES[role!]}, 준비하라.
                  </h1>
                  <p>{descriptions[role!]}</p>
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
                </div>
              </div>
              <section className="game-console">
                <div className="console-copy">
                  <span className="speaker">장비 점검</span>
                  <p>
                    {s!.self.ready
                      ? "장비 수령을 마쳤다. 동료들의 준비를 기다리라."
                      : "현장에서 위치를 확인한다. 권한을 거부해도 참여할 수 있다."}
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
                        위치 없이 준비 완료
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
            <>
              <div className="travel-stage">
                <SceneArt site={site!.seq - 1} />
                <div className="location-label">
                  <span>거점 0{site!.seq}</span>
                  <h1 data-scene-heading tabIndex={-1}>
                    {site!.name}
                  </h1>
                </div>
                <div className="travel-marker">
                  <Compass size={15} /> 기억의 흔적이 있는 곳
                </div>
              </div>
              <section className="game-console">
                <div className="console-copy">
                  <span className="speaker">이동 중</span>
                  <p>
                    {site!.seq === 1
                      ? "첫 번째 기억의 흔적을 찾아 정문으로 이동하라."
                      : "증언의 사초를 품고, 용봉관에 겹친 시간을 찾아라."}
                  </p>
                  <span className="gps-status">
                    {location.status}
                    {location.distance !== null
                      ? ` · 약 ${Math.round(location.distance)}m / ${location.dwell.toFixed(0)}초`
                      : ""}
                  </span>
                </div>
                <div className="console-actions">
                  <button className="button secondary" onClick={location.start}>
                    위치 확인
                    <LocateFixed size={17} />
                  </button>
                  {s!.game.demo ? (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        void send({ action: "demo-arrival", site_id: site!.id })
                      }
                    >
                      시연 거점에 도착
                      <ArrowRight size={18} />
                    </button>
                  ) : role === "commander" ? (
                    <button
                      className="button primary"
                      disabled={busy || remaining > 0}
                      onClick={() =>
                        void send({
                          action: "report-arrival",
                          site_id: site!.id,
                          manual: true,
                        })
                      }
                    >
                      {remaining > 0
                        ? `수동 도착까지 ${remaining}초`
                        : "수동 도착 확인"}
                      <ArrowRight size={18} />
                    </button>
                  ) : (
                    <span className="waiting-note">도착 신호를 기다리라.</span>
                  )}
                </div>
              </section>
            </>
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
                <Mission snapshot={s!} busy={busy} send={send} />
              </div>
            </>
          ) : scene === "report" ? (
            <>
              <div className="reward-stage">
                <div className="reward-rays" />
                <span className="eyebrow">단서 획득</span>
                <h1 data-scene-heading tabIndex={-1}>
                  기억의 숫자를 찾았다.
                </h1>
                <div className="private-digit">{s!.self.digit}</div>
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
                <LockPanel
                  snapshot={s!}
                  busy={busy}
                  send={send}
                  now={now}
                  digits={lockDraft.digits}
                  setDigits={lockDraft.setDigits}
                />
                {reports}
              </div>
              <section className="game-console slim">
                <p className="dialogue-line">
                  말로 전해 들은 네 숫자로 기억을 열어라.
                </p>
                <button
                  className="button secondary"
                  onClick={() => setPane("report")}
                >
                  내 숫자 확인
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
              </section>
            </>
          ) : scene === "sacho" ? (
            <>
              <div className="sacho-scene">
                <span className="eyebrow">기억 복원 · {site!.name}</span>
                <div className="sacho-character">{site!.sacho.char}</div>
                <h1 data-scene-heading tabIndex={-1}>
                  {site!.sacho.name}
                </h1>
                <p>{site!.sacho.body}</p>
                <div className="sacho-reward">
                  <Check size={17} /> 사초를 기록첩에 보관했다.
                </div>
              </div>
              <section className="game-console">
                <p className="dialogue-line">
                  다음 거점에 또 하나의 기억이 기다린다.
                </p>
                {role === "commander" ? (
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
          ) : scene === "done" ? (
            <>
              <div className="completion">
                <span className="eyebrow">작전 완료</span>
                <h1 data-scene-heading tabIndex={-1}>
                  오늘의 기억을
                  <br />
                  함께 완성했다.
                </h1>
                <div className="collected-seals">
                  {s!.game.acquired_sites.map((p) => (
                    <span key={p.id}>
                      {p.sacho.char}
                      <small>{p.sacho.name}</small>
                    </span>
                  ))}
                </div>
                <p>
                  네 사람의 시선이 모여
                  <br />
                  잊히지 않을 기록이 되었다.
                </p>
                <div className="completion-score">
                  <span>
                    <b>{s!.game.score}</b> 기록 점수
                  </span>
                  <span>
                    <b>{acquired}</b> 수집한 사초
                  </span>
                  <span>
                    <b>{elapsed}</b> 활동 시간 · 분
                  </span>
                </div>
              </div>
              <section className="game-console">
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
        {s?.game.demo && s.game.status !== "done" && (
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
                  void canvas.current?.requestFullscreen?.().catch(() => {});
                  setModal(null);
                }}
              >
                전체 화면
                <Maximize size={18} />
              </button>
              {dev && s?.game.demo && (
                <DevControls snapshot={s} busy={busy} send={send} />
              )}
            </div>
          ) : modal === "team" && s ? (
            <>
              <Team snapshot={s} />
              <p>방장은 보직 공개를, 지휘관은 출발과 자물쇠를 담당한다.</p>
            </>
          ) : modal === "records" && s ? (
            <div className="record-grid">
              {s.course.sites.map((p) => {
                const got = s.game.acquired_sites.some((a) => a.id === p.id);
                return (
                  <article
                    className={`record-card ${got ? "acquired" : ""}`}
                    key={p.id}
                  >
                    <span className="eyebrow">{p.name}</span>
                    <span className="record-char">
                      {got ? p.sacho.char : "封"}
                    </span>
                    <h3>{p.sacho.name}</h3>
                    <p>
                      {got
                        ? p.sacho.body
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
                위치 확인이 어려우면 이동 시작 30초 후 지휘관이 수동 도착할 수
                있다. 좌표는 기기에서만 계산한다.
              </p>
              <p>
                <Shield size={16} /> 추모 공간을 존중하며 안전하게 이동하라.
                {(s?.course.demo ?? backend === "local")
                  ? "시연 코스의 실제 좌표와 문항은 미확정이다."
                  : "지정된 거점에서 동료와 단서를 모아라."}
              </p>
            </div>
          )}
        </GameDialog>
      )}
    </div>
  );
}
