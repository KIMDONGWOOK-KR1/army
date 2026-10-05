"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Copy,
  Flag,
  HelpCircle,
  Landmark,
  MapPin,
  Radio,
  ScrollText,
  Shield,
  Signal,
  Users,
  X,
  LocateFixed,
  RotateCcw,
  Clock3,
  WifiOff,
} from "lucide-react";
import { useGame } from "./use-game";
import { CourseMap } from "./course-map";
import { Mission, LockPanel } from "./mission";
import { DevControls } from "./dev-controls";
import { backend } from "@/lib/client";
import { judgeArrival, type Fix } from "@/lib/arrival";
import {
  ROLES,
  ROLE_NAMES,
  type Role,
  type Snapshot,
} from "@/supabase/functions/_shared/types";
const roleIcon = {
  commander: Flag,
  scout: Compass,
  signal: Radio,
  cipher: ScrollText,
};
const roleIntro: Record<Role, string> = {
  commander:
    "자신의 단서를 풀고, 네 사람의 보고를 모아 기록의 자물쇠를 열어라.",
  scout: "표지석과 안내판의 흔적을 관찰하고, 현장의 단서를 읽어라.",
  signal: "현장에 남은 힌트를 따라 흩어진 신호의 주파수를 맞추어라.",
  cipher: "달력과 현판에 담긴 시간을 읽고 숨은 단서를 해독하라.",
};
const stageLabel = (s: Snapshot) =>
  s.game.status === "lobby"
    ? "대기실"
    : s.game.status === "briefing"
      ? "보직 공개"
      : s.game.status === "equip"
        ? "장비 수령"
        : s.game.status === "done"
          ? "작전 완료"
          : s.game.site_phase === "travel"
            ? "거점으로 이동"
            : s.game.site_phase === "cleared"
              ? "사초 획득"
              : "협동 미션";
function Seal({ small = false }: { small?: boolean }) {
  return (
    <span className={`seal ${small ? "small" : ""}`} aria-hidden="true">
      호국
      <br />
      실록
    </span>
  );
}
function RoleBadge({ role }: { role: Role }) {
  const Icon = roleIcon[role];
  return (
    <span className={`role-badge ${role}`}>
      <Icon size={16} />
      {ROLE_NAMES[role]}
    </span>
  );
}
function Qr({ value }: { value: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((q) =>
        q.toDataURL(value, {
          width: 160,
          margin: 2,
          color: { dark: "#213c2c", light: "#ffffff" },
        }),
      )
      .then((result) => {
        if (active) setUrl(result);
      });
    return () => {
      active = false;
    };
  }, [value]);
  return url ? (
    <img
      className="qr-image"
      src={url}
      width="116"
      height="116"
      alt="같은 작전에 합류하는 QR 코드"
    />
  ) : (
    <div className="qr-placeholder">QR 준비 중</div>
  );
}
export default function AppShell({ joinCode = "" }: { joinCode?: string }) {
  const game = useGame(),
    {
      snapshot: s,
      busy,
      error,
      online,
      restoring,
      now,
      send,
      retry,
      reset,
    } = game;
  const [tab, setTab] = useState<"mission" | "team" | "records">("mission"),
    [mode, setMode] = useState<"create" | "join">(joinCode ? "join" : "create"),
    [nickname, setNickname] = useState(""),
    [code, setCode] = useState(joinCode),
    [copied, setCopied] = useState(false),
    [geo, setGeo] = useState("위치 확인 대기"),
    [geoProgress, setGeoProgress] = useState(0),
    [distance, setDistance] = useState<number | null>(null),
    [origin, setOrigin] = useState(""),
    [dev, setDev] = useState(false);
  const guide = useRef<HTMLDialogElement>(null),
    watch = useRef<number | null>(null),
    fixes = useRef<Fix[]>([]),
    arrivalSent = useRef(false),
    current = useRef(s);
  current.current = s;
  useEffect(() => {
    setOrigin(window.location.origin);
    setDev(new URLSearchParams(window.location.search).get("dev") === "1");
    return () => {
      if (watch.current !== null)
        navigator.geolocation?.clearWatch(watch.current);
    };
  }, []);
  useEffect(() => {
    fixes.current = [];
    arrivalSent.current = false;
    setDistance(null);
    setGeoProgress(0);
  }, [s?.current_site.id]);
  useEffect(() => {
    if (s?.game.status === "done" && watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
  }, [s?.game.status]);
  const startLocation = () => {
    if (!navigator.geolocation) {
      setGeo("이 기기는 위치 확인을 지원하지 않는다.");
      return;
    }
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    setGeo("위치 신호를 확인하는 중");
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const latest = current.current;
        if (!latest) return;
        if (position.coords.accuracy > 40) {
          setGeo("위치 오차가 크다. 열린 곳에서 잠시 기다리라.");
        } else
          setGeo(
            `위치 수신 중 · 오차 약 ${Math.round(position.coords.accuracy)}m`,
          );
        const fix: Fix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        fixes.current.push(fix);
        fixes.current = fixes.current.slice(-60);
        const target = latest.current_site;
        if (target.lat === null || target.lng === null) {
          setGeo("시연 코스의 실제 좌표는 미확정이다.");
          return;
        }
        const verdict = judgeArrival(fixes.current, {
          lat: target.lat,
          lng: target.lng,
          radiusM: target.radiusM,
        });
        setDistance(verdict.distance);
        setGeoProgress(Math.min(100, verdict.dwell / 50));
        if (
          verdict.arrived &&
          latest.game.status === "playing" &&
          latest.game.site_phase === "travel" &&
          !arrivalSent.current
        ) {
          arrivalSent.current = true;
          void send({
            action: "report-arrival",
            site_id: target.id,
            manual: false,
          }).then((next) => {
            if (!next) arrivalSent.current = false;
          });
        }
      },
      (e) =>
        setGeo(
          e.code === 1
            ? "위치 권한이 꺼져 있다. 수동 도착으로 진행할 수 있다."
            : "위치 신호를 찾지 못했다. 다시 확인하거나 수동 도착하라.",
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
  const create = (demo = false) =>
    void send({
      action: demo
        ? "create-demo"
        : mode === "create"
          ? "create-game"
          : "join-game",
      nickname: demo ? nickname || "기록자" : nickname,
      ...(!demo && mode === "join" ? { code: code.toUpperCase() } : {}),
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/j/${s!.game.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
      window.prompt(
        "이 링크를 복사하여 팀원에게 전달하라.",
        `${origin}/j/${s!.game.code}`,
      );
    }
  };
  const panelName =
    tab === "team"
      ? "함께하는 사람들"
      : tab === "records"
        ? "수집한 기록"
        : s
          ? stageLabel(s)
          : "작전 준비";
  const role = s?.self.role,
    site = s?.current_site,
    acquired = s?.game.acquired_sites.length ?? 0;
  const elapsed = s?.game.started_at
    ? Math.max(
        0,
        Math.floor(((s.game.ended_at ?? now) - s.game.started_at) / 1000),
      )
    : 0;
  const goHome = () => {
    if (watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
    reset();
    setTab("mission");
  };
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <a className="brand" href="/">
          <Seal small />
          <div>
            <strong>호국실록</strong>
            <span>기억을 잇는 현장 기록</span>
          </div>
        </a>
        <div className="sidebar-course">
          <span className="eyebrow">첫 번째 기록</span>
          <h2>전남대편</h2>
          <p>정문에서 용봉관까지</p>
        </div>
        <nav aria-label="주요 메뉴">
          {(
            [
              ["mission", Compass, "작전 진행"],
              ["team", Users, "우리 팀"],
              ["records", BookOpen, "수집한 사초"],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              <Icon size={19} />
              {label}
              {key === "records" && (
                <span className="nav-count">{acquired}/2</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-quote">
          <span>記</span>
          <p>
            함께 바라보고,
            <br />
            말로 나누고,
            <br />
            기록으로 남기다.
          </p>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => guide.current?.showModal()}>
            <HelpCircle size={17} /> 진행 안내
            <ArrowUpRight size={15} />
          </button>
          <span className="connection">
            <i className={online ? "" : "offline"} />
            {backend === "local" ? "로컬 시연 서버" : "현장 코스 서버"}
          </span>
          <small>HOGUK SILLOK · FIELD JOURNAL</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Seal small />
            <strong>호국실록</strong>
          </div>
          <div className="breadcrumb">
            전남대편
            <ChevronRight size={14} />
            <strong>{panelName}</strong>
          </div>
          <div className="top-status">
            <span className={`status-dot ${online ? "" : "offline"}`} />
            {online ? "연결됨" : "재연결 필요"}
            <button
              className="icon-button"
              aria-label="진행 안내 열기"
              onClick={() => guide.current?.showModal()}
            >
              <HelpCircle size={19} />
            </button>
          </div>
        </header>
        <main id="main-content">
          {!s ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">FIELD JOURNAL / CHONNAM 01</span>
                  <h1>
                    잊히지 않도록,
                    <br />
                    <em>함께 기록하라.</em>
                  </h1>
                  <p>
                    네 사람이 서로 다른 단서를 찾고, 하나의 기억을 완성한다.
                    <br className="desktop-break" /> 전남대의 현장에서 시작하는
                    우리의 첫 번째 기록.
                  </p>
                </div>
                <div className="edition-mark">
                  <span>全南大</span>
                  <small>
                    CHONNAM
                    <br />
                    UNIVERSITY
                  </small>
                </div>
              </div>
              <div className="home-grid">
                <section className="course-overview">
                  <CourseMap />
                  <div className="course-info">
                    <div>
                      <span className="eyebrow">기억을 잇는 길</span>
                      <h2>두 거점, 하나의 기록</h2>
                    </div>
                    <span className="outline-pill">
                      <Users size={15} /> 4인 협동
                    </span>
                  </div>
                  <div className="route-line">
                    <div>
                      <b>01</b>
                      <span>
                        전남대 정문<small>증언의 사초</small>
                      </span>
                    </div>
                    <span className="route-dashes" />
                    <div>
                      <b>02</b>
                      <span>
                        용봉관<small>겹친 시간의 사초</small>
                      </span>
                    </div>
                  </div>
                  <div className="role-strip">
                    {ROLES.map((r) => (
                      <RoleBadge key={r} role={r} />
                    ))}
                  </div>
                  <p className="fine-print">
                    도식 지도 · 도보 시간과 현장 좌표는 답사 후 확정
                  </p>
                </section>
                <section className="entry-card">
                  <div className="section-label">
                    <span>작전 참가 신청</span>
                    <span>01 — 04</span>
                  </div>
                  <h2>당신의 자리를 기록하라.</h2>
                  <p className="subtle">설치 없이, 호출명 하나로 시작한다.</p>
                  <div className="segmented">
                    <button
                      onClick={() => setMode("create")}
                      aria-pressed={mode === "create"}
                      className={mode === "create" ? "active" : ""}
                    >
                      방 만들기
                    </button>
                    <button
                      onClick={() => setMode("join")}
                      aria-pressed={mode === "join"}
                      className={mode === "join" ? "active" : ""}
                    >
                      코드로 합류
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      create();
                    }}
                  >
                    <label className="field-label" htmlFor="nickname">
                      호출명
                      <input
                        id="nickname"
                        required
                        maxLength={6}
                        pattern="[가-힣a-zA-Z0-9]{1,6}"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="한글·영문·숫자 1~6자"
                        autoComplete="off"
                      />
                    </label>
                    {mode === "join" && (
                      <label className="field-label" htmlFor="code">
                        입장 코드
                        <input
                          id="code"
                          className="code-input"
                          required
                          maxLength={4}
                          minLength={4}
                          value={code}
                          onChange={(e) =>
                            setCode(
                              e.target.value
                                .toUpperCase()
                                .replace(/[^A-Z2-9]/g, ""),
                            )
                          }
                          placeholder="ABCD"
                          autoComplete="off"
                        />
                      </label>
                    )}
                    <button
                      className="button primary full"
                      disabled={
                        busy ||
                        restoring ||
                        !nickname ||
                        (mode === "join" && code.length !== 4)
                      }
                    >
                      {busy
                        ? "연결 중…"
                        : mode === "create"
                          ? "새 작전 만들기"
                          : "작전에 합류하기"}
                      <ArrowRight size={18} />
                    </button>
                  </form>
                  <div className="entry-divider">
                    <span>먼저 살펴보고 싶다면</span>
                  </div>
                  {backend === "local" ? (
                    <button
                      className="button secondary full"
                      disabled={busy || restoring}
                      onClick={() => create(true)}
                    >
                      혼자 데모 체험
                      <ArrowUpRight size={17} />
                    </button>
                  ) : (
                    <p className="fine-print">
                      현장 모드에서는 네 명이 각자의 기기로 합류한다.
                    </p>
                  )}
                  <p className="fine-print">
                    {backend === "local"
                      ? "시연용 문항으로 모든 보직을 차례로 체험한다."
                      : "정답은 서버에서 검증하고 본인에게만 반환한다."}
                  </p>
                  <div className="privacy-note">
                    <Shield size={16} />
                    <span>
                      실명·연락처를 받지 않는다.
                      <br />
                      기기의 위치 좌표를 서버에 저장하지 않는다.
                    </span>
                  </div>
                </section>
              </div>
              <div className="principles">
                {[
                  ["01", "관찰하라", "각자의 시선으로 현장의 단서를 찾는다."],
                  ["02", "나누어라", "찾은 숫자는 말로 지휘관에게 전한다."],
                  ["03", "기록하라", "네 개의 단서로 기억의 자물쇠를 연다."],
                ].map(([n, title, body]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="operation-heading">
                <div>
                  <span className="eyebrow">
                    OPERATION {s.game.code} / FIELD JOURNAL
                  </span>
                  <h1>
                    {tab === "team"
                      ? "함께 기억하는 사람들."
                      : tab === "records"
                        ? "우리가 모은 기억."
                        : s.game.status === "done"
                          ? "기억을 함께 완성했다."
                          : site!.name}
                  </h1>
                  <p>
                    {tab === "mission"
                      ? `${stageLabel(s)} · ${s.game.current_site_seq} / ${s.course.sites.length} 거점`
                      : s.course.name}
                  </p>
                </div>
                <div className="operation-meta">
                  <span>
                    기록 점수
                    <b>
                      {s.game.score}
                      <small>점</small>
                    </b>
                  </span>
                  <span>
                    수집한 사초
                    <b>
                      {acquired}
                      <small>/{s.course.sites.length}</small>
                    </b>
                  </span>
                </div>
              </div>
              {s.course.demo && (
                <div className="demo-banner">
                  <span>
                    <Signal size={16} /> 시연 코스 · 실제 좌표와 문항은 미확정
                  </span>
                  {s.game.demo && s.game.status !== "done" && (
                    <div aria-label="시연 보직 전환">
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          className={role === r ? "active" : ""}
                          disabled={busy}
                          onClick={() =>
                            void send({ action: "demo-role", demo_role: r })
                          }
                        >
                          {ROLE_NAMES[r]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tab === "team" ? (
                <section className="wide-card">
                  <div className="section-label">
                    <span>TEAM ROSTER</span>
                    <span>{s.game.members.length} / 4</span>
                  </div>
                  <h2>네 개의 시선이 모인다.</h2>
                  <Team snapshot={s} />
                  <p className="subtle">
                    방장은 보직 공개를, 지휘관은 출발과 자물쇠를 담당한다.
                    보직은 계급과 관계없이 서버가 무작위로 배정한다.
                  </p>
                </section>
              ) : tab === "records" ? (
                <section className="record-grid">
                  {s.course.sites.map((place) => {
                    const got = s.game.acquired_sites.some(
                      (x) => x.id === place.id,
                    );
                    return (
                      <article
                        className={`record-card ${got ? "acquired" : ""}`}
                        key={place.id}
                      >
                        <span className="eyebrow">
                          기록 {String(place.seq).padStart(2, "0")} ·{" "}
                          {place.name}
                        </span>
                        <div className="sacho-character">
                          {got ? place.sacho.char : "封"}
                        </div>
                        <h2>{place.sacho.name}</h2>
                        <p>
                          {got
                            ? place.sacho.body
                            : "네 역할의 단서를 모아 자물쇠를 열면 이 기록을 읽을 수 있다."}
                        </p>
                        <span className="record-status">
                          {got ? (
                            <>
                              <Check size={16} /> 기록 복원 완료
                            </>
                          ) : (
                            <>
                              <ScrollText size={16} /> 아직 봉인된 기록
                            </>
                          )}
                        </span>
                      </article>
                    );
                  })}
                </section>
              ) : (
                <div className="operation-grid">
                  <div className="operation-context">
                    <CourseMap
                      site={s.game.current_site_seq - 1}
                      cleared={acquired}
                    />
                    <div className="context-card">
                      <div className="section-label">
                        <span>작전 현황</span>
                        <span>{stageLabel(s)}</span>
                      </div>
                      <Team snapshot={s} compact />
                      <div className="context-footer">
                        <span>
                          <Clock3 size={15} />
                          {Math.floor(elapsed / 60)}분 {elapsed % 60}초
                        </span>
                        <span>
                          <BookOpen size={15} />
                          {acquired}개 기록
                        </span>
                      </div>
                    </div>
                  </div>
                  <section className="action-card" aria-label="현재 작전 단계">
                    {s.game.status === "lobby" ? (
                      <>
                        <div className="section-label">
                          <span>LOBBY / 대기실</span>
                          <span>{s.game.members.length}/4</span>
                        </div>
                        <h2>네 사람을 모아라.</h2>
                        <p className="subtle">
                          팀원에게 코드를 전하거나 QR을 보여라.
                        </p>
                        <div
                          className="join-code"
                          aria-label={`입장 코드 ${s.game.code}`}
                        >
                          {s.game.code.split("").map((x, i) => (
                            <span key={i}>{x}</span>
                          ))}
                        </div>
                        <div className="qr-row">
                          <Qr value={`${origin}/j/${s.game.code}`} />
                          <div>
                            <b>각자의 폰으로 합류</b>
                            <p>
                              동일한 링크를 열어
                              <br />
                              호출명을 입력하라.
                            </p>
                            <button
                              className="button secondary"
                              onClick={() => void copy()}
                            >
                              <Copy size={15} />
                              {copied ? "링크 복사됨" : "초대 링크 복사"}
                            </button>
                          </div>
                        </div>
                        <Team snapshot={s} compact />
                        {s.self.is_host ? (
                          <button
                            className="button primary full"
                            disabled={busy || s.game.members.length !== 4}
                            onClick={() => void send({ action: "start-game" })}
                          >
                            {s.game.members.length === 4
                              ? "보직 공개 시작"
                              : "네 명의 합류를 기다리는 중"}
                            <ArrowRight size={18} />
                          </button>
                        ) : (
                          <div className="waiting-note">
                            방장의 보직 공개 신호를 기다리라.
                          </div>
                        )}
                        <p className="fine-print">
                          휴대폰 4대가 필요하다. 같은 브라우저의 탭은 같은
                          자리로 복귀한다.
                        </p>
                      </>
                    ) : s.game.status === "briefing" ? (
                      <div className="reveal-scene">
                        <span className="eyebrow">ROLE ASSIGNMENT</span>
                        <div className="countdown">
                          {Math.max(
                            1,
                            Math.ceil(((s.game.reveal_at ?? now) - now) / 1000),
                          )}
                        </div>
                        <h2>당신의 보직을 확인하라.</h2>
                        <p className="subtle">
                          네 기기가 같은 서버 시각에 보직을 공개한다.
                        </p>
                      </div>
                    ) : s.game.status === "equip" ? (
                      <>
                        <span className="eyebrow">EQUIPMENT / 장비 수령</span>
                        <div className={`dog-tag ${role}`}>
                          <span className="tag-hole" />
                          {role && <RoleBadge role={role} />}
                          <b>{s.self.nickname}</b>
                          <small>
                            HOGUK SILLOK / 0
                            {s.game.members.findIndex(
                              (m) => m.id === s.self.id,
                            ) + 1}
                          </small>
                        </div>
                        <h2>{role && ROLE_NAMES[role]}, 준비하라.</h2>
                        <p className="subtle">{role && roleIntro[role]}</p>
                        <div className="location-note">
                          <LocateFixed size={20} />
                          <div>
                            <b>현장에서 위치를 확인한다.</b>
                            <p>
                              오차 40m 이내의 신호를 모아, 거점 안에서 5초
                              머물면 도착으로 인정한다.
                            </p>
                          </div>
                        </div>
                        {!s.self.ready ? (
                          <>
                            <button
                              className="button primary full"
                              disabled={busy}
                              onClick={() => {
                                startLocation();
                                void send({ action: "set-ready" });
                              }}
                            >
                              위치 켜고 장비 수령
                              <LocateFixed size={18} />
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setGeo(
                                  "위치 없이 진행한다. 지휘관의 수동 도착을 사용하라.",
                                );
                                void send({ action: "set-ready" });
                              }}
                            >
                              위치 없이 준비 완료
                            </button>
                          </>
                        ) : (
                          <div className="ready-note">
                            <Check size={19} />
                            장비 점검 완료 ·{" "}
                            {s.game.members.filter((m) => m.ready).length}/4명
                            준비
                          </div>
                        )}
                        {s.self.ready && role === "commander" && (
                          <button
                            className="button primary full"
                            disabled={
                              busy || !s.game.members.every((m) => m.ready)
                            }
                            onClick={() =>
                              void send({ action: "begin-operation" })
                            }
                          >
                            작전 출발
                            <ArrowRight size={18} />
                          </button>
                        )}
                        <p className="fine-print">
                          위치 권한을 거부해도 참여할 수 있다.
                        </p>
                      </>
                    ) : s.game.status === "done" ? (
                      <div className="completion">
                        <Seal />
                        <span className="eyebrow">MISSION ACCOMPLISHED</span>
                        <h2>
                          오늘의 기억을
                          <br />
                          함께 남겼다.
                        </h2>
                        <p>
                          각자의 단서를 나누어
                          <br />두 개의 사초를 복원했다.
                        </p>
                        <div className="collected-seals">
                          {s.game.acquired_sites.map((x) => (
                            <span key={x.id}>
                              {x.sacho.char}
                              <small>{x.sacho.name}</small>
                            </span>
                          ))}
                        </div>
                        <div className="completion-score">
                          <b>
                            {s.game.score}
                            <small>점</small>
                          </b>
                          <span>
                            활동 시간 {Math.floor(elapsed / 60)}분{" "}
                            {elapsed % 60}초
                          </span>
                        </div>
                        <button
                          className="button primary full"
                          onClick={() => setTab("records")}
                        >
                          수집한 기록 읽기
                          <BookOpen size={18} />
                        </button>
                        <button className="text-button" onClick={goHome}>
                          새 작전 준비하기
                        </button>
                      </div>
                    ) : s.game.site_phase === "travel" ? (
                      <>
                        <div className="section-label">
                          <span>
                            MOVE / {String(site!.seq).padStart(2, "0")}
                          </span>
                          <span>{role && ROLE_NAMES[role]}</span>
                        </div>
                        <div className="round-icon">
                          <MapPin />
                        </div>
                        <h2>
                          {site!.name}으로
                          <br />
                          함께 이동하라.
                        </h2>
                        <p className="subtle">
                          {site!.seq === 1
                            ? "정문에서 첫 번째 기억의 흔적을 찾는다."
                            : "앞서 복원한 기록을 품고, 다음 시간의 층으로 걸어간다."}
                        </p>
                        <div className="arrival-card">
                          <div>
                            <LocateFixed size={18} />
                            <b>{geo}</b>
                          </div>
                          {distance !== null && (
                            <p>
                              거점까지 약 {Math.round(distance)}m · 반경{" "}
                              {site!.radiusM}m
                            </p>
                          )}
                          <div className="progress-track">
                            <span style={{ width: `${geoProgress}%` }} />
                          </div>
                          <small>
                            {site!.lat === null
                              ? "좌표 미확정 · GPS 도착 판정 사용 불가"
                              : `거점 안에서 머무르기 ${Math.round(geoProgress / 20)} / 5초`}
                          </small>
                        </div>
                        <button
                          className="button secondary full"
                          onClick={startLocation}
                        >
                          위치 신호 다시 확인
                          <LocateFixed size={17} />
                        </button>
                        {s.game.demo ? (
                          <button
                            className="button primary full"
                            disabled={busy}
                            onClick={() =>
                              void send({
                                action: "demo-arrival",
                                site_id: site!.id,
                              })
                            }
                          >
                            시연 거점에 도착
                            <ArrowRight size={18} />
                          </button>
                        ) : role === "commander" ? (
                          <button
                            className="button primary full"
                            disabled={
                              busy ||
                              now < (s.game.site_started_at ?? now) + 30000
                            }
                            onClick={() =>
                              void send({
                                action: "report-arrival",
                                site_id: site!.id,
                                manual: true,
                              })
                            }
                          >
                            {now < (s.game.site_started_at ?? now) + 30000
                              ? `수동 도착까지 ${Math.max(0, Math.ceil(((s.game.site_started_at ?? now) + 30000 - now) / 1000))}초`
                              : "수동 도착 확인"}
                            <MapPin size={17} />
                          </button>
                        ) : (
                          <div className="waiting-note">
                            GPS 도착 또는 지휘관의 수동 도착을 기다리라.
                          </div>
                        )}
                        <p className="fine-print">
                          도식 지도는 실제 길 안내가 아니다. 주변을 살피며
                          안전하게 이동하라.
                        </p>
                      </>
                    ) : s.game.site_phase === "cleared" ? (
                      <div className="sacho-scene">
                        <span className="eyebrow">
                          RECORD RESTORED / {site!.name}
                        </span>
                        <div className="sacho-character">
                          {site!.sacho.char}
                        </div>
                        <h2>{site!.sacho.name}</h2>
                        <p>{site!.sacho.body}</p>
                        {role === "commander" ? (
                          <button
                            className="button primary full"
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
                          <div className="waiting-note">
                            지휘관의 다음 출발 신호를 기다리라.
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {role && <RoleBadge role={role} />}
                        <Mission snapshot={s} busy={busy} send={send} />
                        {role === "commander" && (
                          <LockPanel
                            snapshot={s}
                            busy={busy}
                            send={send}
                            now={now}
                          />
                        )}
                        <div className="report-progress">
                          {s.game.report_mask.filter(Boolean).length} / 4 보직
                          보고 완료<span>숫자는 말로 전하라.</span>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
          {dev && s?.game.demo && s.game.status !== "done" && (
            <DevControls snapshot={s} busy={busy} send={send} />
          )}
          {(error || !online) && (
            <div className="error-banner" role="alert">
              <WifiOff size={19} />
              <p>
                {error || "연결이 끊겼다. 현재 화면과 진행 기록은 유지된다."}
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void retry()}
              >
                <RotateCcw size={15} /> 다시 연결
              </button>
            </div>
          )}
          {restoring && (
            <p className="restore-note" role="status">
              기존 작전 기록을 확인하는 중…
            </p>
          )}
          <footer className="page-footer">
            <span>호국실록 · 전남대편</span>
            <span>과거의 기록을, 오늘의 우리에게.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {(
          [
            ["mission", Compass, "작전"],
            ["team", Users, "팀"],
            ["records", BookOpen, "기록"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <dialog className="guide-dialog" ref={guide}>
        <button
          className="icon-button close-dialog"
          aria-label="안내 닫기"
          onClick={() => guide.current?.close()}
        >
          <X />
        </button>
        <span className="eyebrow">FIELD GUIDE</span>
        <h2>함께 기억하는 방법</h2>
        <ol>
          <li>
            <b>네 명이 같은 방에 합류한다.</b>
            <p>
              방장과 지휘관은 다를 수 있다. 보직은 서버가 무작위로 배정한다.
            </p>
          </li>
          <li>
            <b>각자 자신의 단서를 해결한다.</b>
            <p>
              보고 후 나오는 숫자는 자기 폰에만 보인다. 말로 지휘관에게
              전달하라.
            </p>
          </li>
          <li>
            <b>지휘관이 네 숫자를 입력한다.</b>
            <p>
              맞은 칸은 잠긴다. 오답마다 −10점, 세 번 소진하면 60초 후 한 번 더
              시도할 수 있다.
            </p>
          </li>
          <li>
            <b>기억의 사초를 모아 다음 거점으로 간다.</b>
            <p>추모 공간을 존중한다. 속도나 도착 순서로 점수를 주지 않는다.</p>
          </li>
        </ol>
        <div className="clue-hint">
          {backend === "local"
            ? "현재는 시연 코스다. 혼자 체험에서는 보직을 전환해 각 미션을 풀 수 있다. 실제 장소의 좌표·문항은 답사 후 등록한다."
            : "위치는 기기에서만 계산한다. 위치 실패 시 지휘관은 이동 시작 30초 뒤 수동 도착을 사용할 수 있다."}
        </div>
      </dialog>
    </div>
  );
}
function Team({
  snapshot: s,
  compact = false,
}: {
  snapshot: Snapshot;
  compact?: boolean;
}) {
  return (
    <div className={`team-list ${compact ? "compact" : ""}`}>
      {Array.from({ length: 4 }, (_, i) => {
        const m = s.game.members[i],
          index = m?.role ? s.current_site.lockOrder.indexOf(m.role) : -1,
          reported = index >= 0 && s.game.report_mask[index];
        return (
          <div
            className={`team-member ${m?.id === s.self.id ? "self" : ""} ${!m ? "empty" : ""}`}
            key={i}
          >
            <span className="member-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <b>
                {m ? m.nickname : "합류 대기"}
                {m?.id === s.self.id && <small>나</small>}
                {m?.id === s.game.host_member_id && <small>방장</small>}
              </b>
              <span>{m?.role ? ROLE_NAMES[m.role] : "보직 배정 대기"}</span>
            </div>
            <span
              className={`member-state ${reported || m?.ready ? "ready" : ""}`}
            >
              {reported ? (
                <>
                  <Check size={14} />
                  보고
                </>
              ) : m?.ready ? (
                <>
                  <Check size={14} />
                  준비
                </>
              ) : m ? (
                m.online ? (
                  "접속 중"
                ) : (
                  "연결 대기"
                )
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
