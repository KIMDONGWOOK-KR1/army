"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Footprints, LocateFixed, Navigation } from "lucide-react";
import {
  ROLE_NAMES,
  type Role,
  type SiteInfo,
} from "@/supabase/functions/_shared/types";
import type { FieldStatus } from "./field-3d";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";

// 포켓몬고처럼 지도를 가득 채운 이동 화면 위에 떠 있는 표시들.
// 지도를 가리는 큰 판 없이 위쪽 거점 이름·남은 거리, 아래쪽 내 초상·메뉴·다음 거점만 둔다.
const PORTRAIT = "/hud/c02.webp";
// 초상 그림이 없으면(404) 장면이 바뀔 때마다 다시 받지 않는다
let portraitMissing = false;

const meters = (d: number) =>
  d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;

const modeLine = (f: FieldStatus) =>
  f.mode === "gps"
    ? `내 위치 · 오차 ±${f.accuracy ?? 0}m`
    : f.mode === "outside"
      ? "캠퍼스 밖 · 시연 이동"
      : "시연 이동";

type Location = {
  status: string;
  distance: number | null;
  dwell: number;
  start: () => void;
};

export function TravelHud({
  site,
  sites,
  currentSeq,
  acquired,
  nickname,
  role,
  field,
  location,
  demo,
  v2Arrival,
  busy,
  remaining,
  onDemoArrival,
  onManualArrival,
  onMenu,
}: {
  site: SiteInfo;
  sites: SiteInfo[];
  currentSeq: number;
  acquired: number;
  nickname: string;
  role: Role | null;
  field: FieldStatus | null;
  location: Location;
  demo: boolean;
  v2Arrival?: { simulated: boolean; arrived: boolean; count: number };
  busy: boolean;
  remaining: number;
  onDemoArrival: () => void;
  onManualArrival: () => void;
  onMenu: () => void;
}) {
  const ready = !!field && !field.loading && !field.failed;
  const gpsRequired = !!v2Arrival && !v2Arrival.simulated;
  const inRange = gpsRequired
    ? location.distance !== null && location.distance <= site.radiusM
    : ready && field.inRange;
  const color = ROLE_COLORS[role ?? "commander"];
  const total = Math.max(1, sites.length);

  let main: string, sub: string;
  if (gpsRequired) {
    main = v2Arrival.arrived ? "내 GPS 도착 확인됨" : location.distance === null
      ? "GPS 위치 확인 필요"
      : inRange ? "도착 범위 안 · 5초 유지 중" : `${site.name}까지 ${meters(location.distance)}`;
    sub = `반경 ${site.radiusM}m · 전원 도착 ${v2Arrival.count}/4`;
  } else if (!field || field.loading) {
    main = "지도 불러오는 중";
    sub = "";
  } else if (field.failed) {
    main =
      location.distance !== null
        ? `${site.name}까지 ${meters(location.distance)}`
        : `${site.name}까지 이동하라`;
    sub = location.status;
  } else {
    main = field.inRange
      ? "도착 범위 안"
      : `${site.name}까지 ${meters(field.distance)}`;
    sub = modeLine(field);
  }
  const nextDistance = gpsRequired
    ? location.distance === null ? "—" : meters(location.distance)
    : ready
    ? field.inRange
      ? "범위 안"
      : meters(field.distance)
    : field?.failed && location.distance !== null
      ? meters(location.distance)
      : "—";
  const gpsLine = `${location.status}${
    location.distance !== null
      ? ` · 약 ${Math.round(location.distance)}m / ${location.dwell.toFixed(0)}초`
      : ""
  }`;

  return (
    <div
      className={`travel-hud ${site.reverent ? "calm" : ""}`}
      style={{ "--role": color } as CSSProperties}
    >
      <div className="hud-site">
        <span className="hud-site-seq">거점 0{site.seq}</span>
        <h1 data-scene-heading tabIndex={-1}>
          {site.name}
        </h1>
      </div>

      <div className="hud-distance" data-in-range={inRange}>
        <span className="hud-distance-icon" aria-hidden="true">
          <Navigation size={15} strokeWidth={2.6} />
        </span>
        <span className="hud-distance-text">
          <b>{main}</b>
          {sub && <small>{sub}</small>}
        </span>
      </div>
      {!demo && <p className="hud-gps">{gpsLine}</p>}
      <span className="hud-sr" role="status">
        {inRange ? "도착 범위에 들어섰다." : ""}
      </span>

      <SpeechCard
        key={site.id}
        text={
          site.seq === 1
            ? "첫 번째 기억의 흔적을 찾아 정문으로 이동하라."
            : "증언의 사초를 품고, 용봉관에 겹친 시간을 찾아라."
        }
      />

      <div className="hud-action-area">
        {v2Arrival?.arrived ? (
          <button className="hud-action waiting" disabled>
            내 도착 확인됨 · 팀원 대기 ({v2Arrival.count}/4)
          </button>
        ) : v2Arrival?.simulated ? (
          <button className="hud-action ready" disabled={busy} onClick={onDemoArrival}>
            본인 모의 도착 확인 <ArrowRight size={18} aria-hidden="true" />
          </button>
        ) : demo ? (
          <button
            className={`hud-action ${inRange ? "ready" : ""}`}
            // 보이는 말이 이름 앞에 오게 해 음성 조작으로도 누를 수 있게 한다
            aria-label={inRange ? "기억의 흔적 열기, 시연 거점에 도착" : undefined}
            disabled={busy}
            onClick={onDemoArrival}
          >
            {inRange ? (
              <>
                <Footprints size={19} aria-hidden="true" />
                기억의 흔적 열기
              </>
            ) : (
              <>
                시연 거점에 도착
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        ) : gpsRequired ? (
          <button type="button" className="hud-action" onClick={location.start}>
            GPS 위치 확인 · 반경 {site.radiusM}m <LocateFixed size={18} aria-hidden="true" />
          </button>
        ) : role === "commander" ? (
          <button
            className={`hud-action ${remaining > 0 ? "waiting" : ""}`}
            disabled={busy || remaining > 0}
            onClick={onManualArrival}
          >
            {remaining > 0 ? `수동 도착까지 ${remaining}초` : "수동 도착 확인"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <span className="hud-note">{v2Arrival ? "본인 GPS 도착 확인을 기다리라." : "도착 신호를 기다리라."}</span>
        )}
      </div>

      <button
        className="hud-round hud-locate"
        aria-label="위치 확인"
        onClick={location.start}
      >
        <LocateFixed size={22} aria-hidden="true" />
      </button>

      <div className="hud-player">
        <Portrait role={role} />
        <div className="hud-player-plate">
          <b>{nickname}</b>
          <span className="hud-player-role">
            <i aria-hidden="true" />
            {role ? ROLE_NAMES[role] : "보직 대기"}
          </span>
          <span
            className="hud-xp"
            role="progressbar"
            aria-label="모은 사초"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={acquired}
            aria-valuetext={`${total}장 중 ${acquired}장`}
          >
            <i style={{ width: `${(acquired / total) * 100}%` }} />
          </span>
        </div>
      </div>

      <button className="hud-main" aria-label="작전 메뉴" onClick={onMenu}>
        <span className="hud-main-seal" aria-hidden="true">
          記
        </span>
      </button>

      <div className="hud-next">
        <span className="hud-next-label">다음 거점</span>
        <b>{site.name}</b>
        <span className="hud-next-row">
          <span
            className="hud-dots"
            role="img"
            aria-label={`전체 ${sites.length}곳 중 ${currentSeq}번째`}
          >
            {sites.map((p) => (
              <i key={p.id} className={p.seq <= currentSeq ? "on" : ""} />
            ))}
          </span>
          <span className="hud-next-distance">{nextDistance}</span>
        </span>
      </div>
    </div>
  );
}

// 보직 색 고리를 두른 둥근 초상. 그림이 없으면 보직 아이콘을 보직 색 위에 둔다.
function Portrait({ role }: { role: Role | null }) {
  const [missing, setMissing] = useState(portraitMissing);
  const Icon = ROLE_ICONS[role ?? "commander"];
  return (
    <span className="hud-portrait">
      <Icon size={40} strokeWidth={2.2} aria-hidden="true" />
      {!missing && (
        <img
          src={PORTRAIT}
          alt=""
          draggable={false}
          onError={() => {
            portraitMissing = true;
            setMissing(true);
          }}
        />
      )}
    </span>
  );
}

// 예전 하단 대사 한 줄. 잠깐 떠 있다가 6초쯤 뒤 사라진다.
// 처음엔 비워 두었다가 채워야 화면 낭독기가 알림으로 읽는다.
function SpeechCard({ text }: { text: string }) {
  const [shown, setShown] = useState(false),
    [gone, setGone] = useState(false);
  useEffect(() => {
    const show = window.setTimeout(() => setShown(true), 250),
      hide = window.setTimeout(() => setGone(true), 6600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);
  return (
    <div className="hud-speech-live" aria-live="polite">
      {shown && !gone && (
        <p className="hud-speech">
          <span>이동 중</span>
          {text}
        </p>
      )}
    </div>
  );
}
