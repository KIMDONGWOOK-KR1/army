"use client";
import { useEffect, useRef, useState } from "react";
import { judgeArrival, type Fix } from "@/lib/arrival";
import type { Snapshot, Command } from "@/supabase/functions/_shared/types";
import { ROLES } from "@/supabase/functions/_shared/types";
import { isV2Response, type GameResponse } from "@/lib/game-snapshot";
import { hasGpsArrival } from "@/supabase/functions/_shared/arrival-policy";
export function useLocation(
  snapshot: GameResponse | null,
  send: (c: Command) => Promise<Snapshot | null>,
) {
  const [status, setStatus] = useState("위치 신호 대기"),
    [distance, setDistance] = useState<number | null>(null),
    [dwell, setDwell] = useState(0),
    // 지도에 내 자리를 그리는 데 쓰는 마지막 위치(시연 코스에서도 받는다)
    [fix, setFix] = useState<Pick<Fix, "lat" | "lng" | "accuracy"> | null>(
      null,
    );
  const watch = useRef<number | null>(null),
    fixes = useRef<Fix[]>([]),
    sent = useRef(false),
    generation = useRef(0),
    lastFixAt = useRef(0),
    current = useRef(snapshot);
  current.current = snapshot;
  const stop = () => {
    generation.current++;
    if (watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
  };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (lastFixAt.current && Date.now() - lastFixAt.current > 5000) {
        fixes.current = [];
        lastFixAt.current = 0;
        setFix(null);
        setDistance(null);
        setDwell(0);
        setStatus("위치 신호가 끊겼다. 위치 확인을 다시 눌러라.");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    fixes.current = [];
    sent.current = false;
    setDistance(null);
    setDwell(0);
    setFix(null);
    lastFixAt.current = 0;
  }, [snapshot?.game.id, snapshot?.current_site.id, snapshot?.self.id]);
  useEffect(() => {
    if (snapshot?.game.status === "done") stop();
  }, [snapshot?.game.status]);
  const start = () => {
    if (!navigator.geolocation) {
      setStatus("위치를 지원하지 않는 기기다. GPS를 지원하는 브라우저에서 접속하라.");
      return;
    }
    stop();
    const attempt = generation.current;
    fixes.current = [];
    lastFixAt.current = 0;
    setFix(null);
    setDistance(null);
    setDwell(0);
    setStatus("위치 신호를 찾는 중");
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (generation.current !== attempt) return;
        const s = current.current;
        if (!s) return;
        const fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        };
        if (!Object.values(fix).every(Number.isFinite) ||
          Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 || fix.accuracy < 0 ||
          Date.now() - fix.timestamp > 5000 || fix.timestamp - Date.now() > 1000) {
          fixes.current = [];
          lastFixAt.current = 0;
          setFix(null);
          setDistance(null);
          setDwell(0);
          setStatus("최신 위치를 확인하지 못했다. 다시 측정하라.");
          return;
        }
        lastFixAt.current = fix.timestamp;
        fixes.current.push(fix);
        fixes.current = fixes.current.slice(-60);
        setFix(fix.accuracy <= 40 ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null);
        if (s.current_site.lat === null || s.current_site.lng === null ||
          (isV2Response(s) && !hasGpsArrival(s.stage.arrival))) {
          setDistance(null);
          setDwell(0);
          setStatus("GPS 도착 좌표·설정 미확정");
          return;
        }
        setStatus(
          p.coords.accuracy > 40
            ? "오차가 크다. 열린 곳에서 기다리라."
            : `위치 수신 · 오차 약 ${Math.round(p.coords.accuracy)}m`,
        );
        const verdict = judgeArrival(fixes.current, {
          lat: s.current_site.lat,
          lng: s.current_site.lng,
          radiusM: s.current_site.radiusM,
        });
        setDistance(fix.accuracy <= 40 ? verdict.distance : null);
        setDwell(Math.min(5, verdict.dwell / 1000));
        if (
          verdict.arrived &&
          s.game.status === "playing" &&
          s.game.site_phase === "travel" &&
          (!isV2Response(s) || !s.self.role ||
            !s.game.arrival_mask[ROLES.indexOf(s.self.role)]) &&
          !sent.current
        ) {
          sent.current = true;
          void send({
            action: "report-arrival",
            ...(isV2Response(s)
              ? { stage_id: s.stage.id, method: "gps" as const }
              : { site_id: s.current_site.id, manual: false }),
          }).then((next) => {
            if (!next) sent.current = false;
          });
        }
      },
      (e) => {
        if (generation.current !== attempt) return;
        fixes.current = [];
        lastFixAt.current = 0;
        setFix(null);
        setDistance(null);
        setDwell(0);
        setStatus(
          e.code === 1
            ? "위치 권한이 꺼져 있다. 브라우저에서 정확한 위치를 허용한 뒤 위치 확인을 눌러라."
            : "위치 신호를 찾지 못했다. 열린 곳에서 위치 확인을 다시 눌러라.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
  return { status, distance, dwell, fix, start, stop };
}
