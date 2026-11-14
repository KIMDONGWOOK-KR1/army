"use client";
// 새 혼자 체험을 추모의 벽 도착까지 진행한다. 추모 자체는 사용자가 직접 시작한다.
import { useEffect, useRef, useState } from "react";
import { saveSoloSession } from "@/lib/client";
import type { Role } from "@/supabase/functions/_shared/types";

type Seats = Record<Role, number>;
const ORDER: Role[] = ["scout", "signal", "cipher", "commander"];
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
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function WallStart() {
  const [step, setStep] = useState("새 혼자 데모 방을 만드는 중…");
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const created = await post({ setup: true, request_id: rid() });
      const game: string = created.game.id, seats: Seats = created.solo.seats;
      saveSoloSession({ game, seats, role: "commander" });
      try {
        sessionStorage.setItem("hoguk-game", game);
        localStorage.setItem("hoguk-game", game);
      } catch {}
      let stage = "gate";
      const call = (role: Role, action: string, extra: Record<string, unknown> = {}, team = false) =>
        post({ seat: seats[role], team, command: { action, game_id: game, stage_id: stage, request_id: rid(), ...extra } });
      const arrive = () => call("commander", "report-arrival", { method: "simulated" }, true);
      const waitCleared = async () => {
        for (let i = 0; i < 40; i++) {
          const s = await call("commander", "get-game");
          if (s.game.site_phase === "cleared") return;
          await sleep(500);
        }
        throw new Error("거점 완료를 기다리다 멈췄어요.");
      };
      for (const [id, name] of [["gate", "정문"], ["yongbong", "용봉관"]] as const) {
        stage = id;
        setStep(`${name} 넘기는 중…`);
        await arrive();
        for (const role of ORDER) {
          for (const level of [1, 2, 3]) await call("commander", "request-hint", { target_role: role, level });
          await call(role, "submit-report");
          await call(role, "confirm-explanation");
        }
        await call("commander", "open-after-explanation");
        await waitCleared();
        await call("commander", "depart-next-site");
      }
      stage = "wall";
      setStep("추모의 벽에 도착하는 중…");
      await arrive();
      try {
        // 예전에 '처음으로'를 눌러 둔 표시가 있으면 방을 되살리지 않으므로 지운다
        sessionStorage.removeItem("hoguk-home");
      } catch {}
      location.replace(`/${location.search}`);
    })().catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 24, minHeight: "100dvh", display: "grid", alignContent: "center", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>추모의 벽부터 보기</h1>
      {error ? <>
        <p role="alert">{error}</p>
        <button className="button primary" onClick={() => location.reload()}>다시 시도</button>
      </> : <p role="status">{step}</p>}
      <p style={{ fontSize: 13, color: "#5b6678" }}>새 혼자 체험 방을 열어요. 앞 거점은 해설 경로로 넘기며, 추모의 벽에서는 버튼을 15초 동안 누르고 있어야 해요.</p>
    </main>
  );
}
