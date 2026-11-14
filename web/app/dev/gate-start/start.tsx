"use client";
// 개발용: 새 혼자 체험 방을 열고 정문에 도착한 뒤, ?role=scout|signal|cipher|commander 보직 화면으로 바로 간다.
// 보직 게임 화면만 빨리 보려는 미리보기다. 문항은 풀지 않는다.
import { useEffect, useRef, useState } from "react";
import { saveSoloSession } from "@/lib/client";
import { ROLES, type Role } from "@/supabase/functions/_shared/types";

const rid = () => crypto.randomUUID();

async function post(body: unknown) {
  const r = await fetch("/api/game/solo", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    credentials: "same-origin", cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message ?? `요청 실패(${r.status})`);
  return data;
}

export default function GateStart() {
  const [step, setStep] = useState("새 혼자 데모 방을 만드는 중…");
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const params = new URLSearchParams(location.search);
      const asked = params.get("role") as Role | null;
      const role: Role = asked && (ROLES as readonly string[]).includes(asked) ? asked : "scout";
      const created = await post({ setup: true, request_id: rid() });
      const game: string = created.game.id, seats: Record<Role, number> = created.solo.seats;
      saveSoloSession({ game, seats, role });
      try {
        sessionStorage.setItem("hoguk-game", game);
        localStorage.setItem("hoguk-game", game);
        sessionStorage.removeItem("hoguk-home");
      } catch {}
      setStep("정문에 도착하는 중…");
      await post({ seat: seats.commander, team: true, command: { action: "report-arrival", game_id: game, stage_id: "gate", request_id: rid(), method: "simulated" } });
      params.delete("role");
      const rest = params.toString();
      location.replace(`/${rest ? `?${rest}` : ""}`);
    })().catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 24, minHeight: "100dvh", display: "grid", alignContent: "center", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>정문 보직 화면 바로 보기</h1>
      {error ? <>
        <p role="alert">{error}</p>
        <button className="button primary" onClick={() => location.reload()}>다시 시도</button>
      </> : <p role="status">{step}</p>}
    </main>
  );
}
