"use client";
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { ArrowRight, Footprints, LocateFixed } from "lucide-react";
import {
  ROLE_NAMES,
  type Role,
  type SiteInfo,
} from "@/supabase/functions/_shared/types";
import type { FieldStatus } from "./field-3d";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";

// 이동 화면: 지도가 주인공. 거점·거리 한 줄은 위에, 동그란 단추는 오른쪽 위에, 도착 단추 하나만 아래에 둔다.

// '정문으로', '용봉관으로', '봉지로': 받침(ㄹ 제외)이 있으면 '으로'
const towardJosa = (name: string) => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return "(으)로";
  const jong = c % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
};

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
  onRecenter,
  cooperation,
}: {
  site: SiteInfo;
  sites: SiteInfo[];
  currentSeq: number;
  role: Role | null;
  field: FieldStatus | null;
  location: Location;
  demo: boolean;
  // team: 혼자 데모 체험. 이 기기가 맡은 시연 동료도 함께 도착한다
  v2Arrival?: { simulated: boolean; arrived: boolean; count: number; team?: boolean };
  busy: boolean;
  remaining: number;
  onDemoArrival: () => void;
  onManualArrival: () => void;
  onMenu: () => void;
  // 지도를 끌어 옮긴 뒤 내 캐릭터 쪽으로 되돌린다
  onRecenter?: () => void;
  cooperation?: ReactNode;
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
      : inRange ? "도착 범위 안 · 5초" : meters(location.distance);
    sub = `반경 ${site.radiusM}m`;
  } else if (!field || field.loading) {
    main = "지도 불러오는 중";
    sub = "";
  } else if (field.failed) {
    main = location.distance !== null ? meters(location.distance) : "이동 중";
    sub = location.status;
  } else {
    main = field.inRange ? "도착 범위 안" : meters(field.distance);
    sub = modeLine(field);
  }
  // 위치 상태는 거리와 겹치지 않게 상태 말만 아주 작게(시연 이동이면 숨김)
  const gpsLine = location.status;
  // 좌측 상단 현재 목표: 행동을 먼저, 한 줄로(hh 2026-10-28)
  const arrived = !!v2Arrival?.arrived;
  const objective = arrived
    ? v2Arrival!.count < 4 ? "동료 도착 기다리는 중" : "모두 도착했어요"
    : inRange
      ? gpsRequired ? "도착 범위 · 그대로 5초" : "도착했어요 · 아래에서 확인"
      : `${site.name}${towardJosa(site.name)} 이동`;

  // 지도 중심(hh 2026-10-28): 위는 거점·거리 한 줄, 오른쪽 위에 동그란 단추(팀·기록첩·내 위치),
  // 아래는 도착 단추 하나. 캐릭터 카드와 記 단추는 빼고 메뉴는 머리줄 단추로 연다.
  return (
    <div
      className={`travel-hud map-first ${site.reverent ? "calm" : ""}`}
      style={{ "--role": color } as CSSProperties}
    >
      <div className="hud-top">
        <div className="hud-pill hud-distance" data-in-range={inRange}>
          <span className="hud-site-seq" aria-label={`거점 ${currentSeq}/${total}`}>{currentSeq}/{total}</span>
          <h1 data-scene-heading tabIndex={-1}>{objective}</h1>
          {!arrived && !inRange && <span className="hud-distance-text">
            <b>{main}</b>
            {gpsRequired && <small>{sub}</small>}
          </span>}
          {gpsRequired && (arrived || inRange) && <span className="hud-distance-text"><small>{arrived ? `${v2Arrival!.count}/4` : sub}</small></span>}
        </div>
        {gpsRequired && <p className="hud-gps">{gpsLine}</p>}
        {!cooperation && <SpeechCard
          key={site.id}
          text={
            site.seq === 1
              ? "첫 번째 기억의 흔적을 찾아 정문으로 이동하기"
              : site.reverent && site.seq > 2
                ? "걸음을 늦추고, 열사들을 기리는 벽으로 조용히 걸어가자."
                : site.seq > 3
                  ? "모은 기록을 품고 봉지로 가서 함께 돌아보자."
                  : "증언의 사초를 품고, 용봉관에 겹친 시간 찾기"
          }
        />}
      </div>
      {/* 우측 상단: 부가 기능(함께 모으기·기록첩) 원형 단추 묶음 */}
      <div className="hud-side">
        {cooperation}
        {!cooperation && <button className="hud-round" aria-label="작전 메뉴 열기" onClick={onMenu}>
          <span className="hud-main-seal" aria-hidden="true">記</span>
        </button>}
      </div>
      {/* 하단 오른쪽: 이동 조작(내 위치) */}
      {/* 지도를 손가락으로 옮겼으면(따라가기 멈춤) 단추가 강조되고, 누르면 내 캐릭터 쪽으로 돌아온다 */}
      <button className="hud-round hud-locate" aria-label={field?.free ? "내 위치로 돌아가기" : "위치 확인"} title="내 위치로"
        data-free={!!field?.free} onClick={() => { onRecenter?.(); location.start(); }}>
        <LocateFixed size={21} aria-hidden="true" />
      </button>
      <span className="hud-sr" role="status">
        {inRange ? "도착 범위에 들어왔어요." : ""}
      </span>

      <div className="hud-action-area">
        {v2Arrival?.arrived ? (
          <button className="hud-action waiting" disabled>
            내 도착 확인됨 · 팀원 대기 ({v2Arrival.count}/4)
          </button>
        ) : v2Arrival?.simulated ? (
          <button className="hud-action ready" disabled={busy} onClick={onDemoArrival}>
            {v2Arrival.team ? "시연 팀 함께 도착" : "본인 모의 도착 확인"} <ArrowRight size={18} aria-hidden="true" />
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
          <span className="hud-note">{v2Arrival ? "본인 GPS 도착 확인을 기다려요." : "도착 신호를 기다려요."}</span>
        )}
      </div>
    </div>
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
