"use client";
// 개발용: 추모의 벽 누르기 단추와 헌화 장면을 서버 없이 상태별로 본다(?state=idle|two|open|done).
import { useEffect, useState } from "react";
import type { V2Response } from "@/lib/game-snapshot";
import { TributePanel } from "@/components/tribute-v2";
import { ROLES } from "@/supabase/functions/_shared/types";

export default function TributePreview() {
  const [state, setState] = useState("idle");
  const [now, setNow] = useState(() => Date.now());
  const [base] = useState(() => Date.now());
  useEffect(() => { setState(new URLSearchParams(location.search).get("state") ?? "idle"); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const done = state === "done", open = state === "open";
  const snapshot = {
    self: { role: "commander", mission: { steps: [{ id: "W-04.tribute" }] } },
    game: {
      id: `preview-${base}`, status: done ? "done" : "playing", site_phase: done ? "cleared" : "mission", completion: done ? {} : null,
      members: ROLES.map((role, i) => ({ role, nickname: ["너울", "가람", "솔빛", "기록자"][i] })),
      tribute: { pressed: open ? [true, true, true, true] : state === "two" ? [true, false, true, false] : [false, false, false, false],
        started_at: open ? base : null, ends_at: open ? base + 15000 : null, missed: false, round: 1, window_ms: 15000 },
    },
    stage: { id: "wall", name: "용봉열사 추모의 벽", completion: { type: "tribute" } },
  } as unknown as V2Response;
  return <main style={{ maxWidth: 430, margin: "0 auto", padding: 16, display: "grid", gap: 16 }}>
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {["idle", "two", "open", "done"].map((k) => <button key={k} className="button secondary" onClick={() => { history.replaceState(null, "", `?state=${k}`); setState(k); }}>{k}</button>)}
    </nav>
    <TributePanel key={state} snapshot={snapshot} busy={false} now={now} send={async () => null} />
    <div style={{ background: "#2c4841", borderRadius: 16, padding: 12 }}>
      <TributePanel key={`c-${state}`} compact snapshot={snapshot} busy={false} now={now} send={async () => null} />
    </div>
  </main>;
}
