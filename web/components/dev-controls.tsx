"use client";
import { useState } from "react";
import { judgeArrival } from "@/lib/arrival";
import type { Command, Snapshot } from "@/supabase/functions/_shared/types";
export function DevControls({
  snapshot,
  busy,
  send,
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
}) {
  const [distance, setDistance] = useState(20),
    [result, setResult] = useState("");
  const simulate = async () => {
    const now = Date.now(),
      lat = 35 + distance / 111195;
    const verdict = judgeArrival(
      Array.from({ length: 8 }, (_, i) => ({
        lat,
        lng: 126,
        accuracy: 10,
        timestamp: now + i * 1000,
      })),
      { lat: 35, lng: 126, radiusM: snapshot.current_site.radiusM },
    );
    setResult(
      verdict.arrived
        ? "합성 표본의 5초 체류 판정 통과"
        : "반경 밖이다. 모의 거리를 줄이라.",
    );
    if (verdict.arrived)
      await send({ action: "demo-arrival", site_id: snapshot.current_site.id });
  };
  return (
    <section className="dev-panel">
      <span>격리된 시연 보조 도구</span>
      {snapshot.game.site_phase === "travel" && (
        <>
          <label className="field-label">
            모의 거리 {distance}m
            <input
              type="range"
              min="0"
              max="80"
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value))}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void simulate()}
          >
            합성 GPS 표본으로 도착 판정
          </button>
        </>
      )}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void send({ action: "demo-time" })}
      >
        시연 대기시간 건너뛰기
      </button>
      <p>{result || "이 도구는 혼자 체험하는 합성 코스에서만 작동한다."}</p>
    </section>
  );
}
