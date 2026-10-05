"use client";
import { useEffect, useRef, useState } from "react";
import { judgeArrival, type Fix } from "@/lib/arrival";
import type { Snapshot, Command } from "@/supabase/functions/_shared/types";
export function useLocation(
  snapshot: Snapshot | null,
  send: (c: Command) => Promise<Snapshot | null>,
) {
  const [status, setStatus] = useState("위치 신호 대기"),
    [distance, setDistance] = useState<number | null>(null),
    [dwell, setDwell] = useState(0);
  const watch = useRef<number | null>(null),
    fixes = useRef<Fix[]>([]),
    sent = useRef(false),
    current = useRef(snapshot);
  current.current = snapshot;
  const stop = () => {
    if (watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
  };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    fixes.current = [];
    sent.current = false;
    setDistance(null);
    setDwell(0);
  }, [snapshot?.current_site.id]);
  useEffect(() => {
    if (snapshot?.game.status === "done") stop();
  }, [snapshot?.game.status]);
  const start = () => {
    if (!navigator.geolocation) {
      setStatus("위치를 지원하지 않는 기기다. 수동 도착을 사용하라.");
      return;
    }
    stop();
    setStatus("위치 신호를 찾는 중");
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const s = current.current;
        if (!s) return;
        const fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        };
        fixes.current.push(fix);
        fixes.current = fixes.current.slice(-60);
        if (s.current_site.lat === null || s.current_site.lng === null) {
          setStatus("시연 코스 · 실제 좌표 미확정");
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
        setDistance(verdict.distance);
        setDwell(Math.min(5, verdict.dwell / 1000));
        if (
          verdict.arrived &&
          s.game.status === "playing" &&
          s.game.site_phase === "travel" &&
          !sent.current
        ) {
          sent.current = true;
          void send({
            action: "report-arrival",
            site_id: s.current_site.id,
            manual: false,
          }).then((next) => {
            if (!next) sent.current = false;
          });
        }
      },
      (e) =>
        setStatus(
          e.code === 1
            ? "위치 권한이 꺼져 있다. 수동 도착으로 진행하라."
            : "위치 신호를 찾지 못했다. 다시 확인하라.",
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
  return { status, distance, dwell, start, stop };
}
