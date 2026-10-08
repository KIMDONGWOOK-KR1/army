"use client";
import { useEffect, useState } from "react";
import {
  ROLE_NAMES,
  type Command,
  type Role,
  type Snapshot,
} from "@/supabase/functions/_shared/types";

// 발표용 자동 시연. 합성 데모 코스(jnu-demo)의 답만 담는다. 실제 코스 정답이 아니다.
// 데모 화면의 힌트에 이미 드러난 값이다.
const DEMO_ANSWERS: Record<string, Record<Role, string>> = {
  gate: { commander: "2", scout: "1", signal: "51.8", cipher: "일요일" },
  yongbong: { commander: "3", scout: "용봉관", signal: "19.9", cipher: "8" },
};
const DEMO_DIGITS: Record<string, Record<Role, number>> = {
  gate: { commander: 2, scout: 1, signal: 3, cipher: 7 },
  yongbong: { commander: 3, scout: 4, signal: 6, cipher: 8 },
};

export function autoAnswer(s: Snapshot | null): string | undefined {
  const role = s?.self.role;
  return role ? DEMO_ANSWERS[s.current_site.id]?.[role] : undefined;
}

export function autoDigits(s: Snapshot | null): string[] | undefined {
  const digits = s && DEMO_DIGITS[s.current_site.id];
  return digits
    ? s.current_site.lockOrder.map((r) => String(digits[r]))
    : undefined;
}

export function autoCaption(scene: string, s: Snapshot | null): string {
  const role = s?.self.role ? ROLE_NAMES[s.self.role] : "";
  switch (scene) {
    case "title":
    case "enroll":
      return "혼자 체험하는 시연 작전을 연다.";
    case "lobby":
      return "네 사람이 정문 앞에 모인다. 각자 폰으로 입장 코드나 QR을 찍고 합류한다.";
    case "briefing":
      return "방장이 보직을 공개하면 각자 폰에서 자기 보직 카드가 뒤집힌다.";
    case "travel":
      return "실제 길을 따라 거점까지 걸어간다. 현장에서는 GPS로 도착을 판정한다.";
    case "mission":
      return `${role} 시점이다. 자기 기기에만 보이는 단서를 푼다.`;
    case "report":
      return "정답을 맞히면 자기 기기에만 숫자가 보인다. 이 숫자를 말로 지휘관에게 전한다.";
    case "waiting":
      return "보고를 마치고 동료를 기다린다.";
    case "lock":
      return "지휘관이 네 사람의 숫자를 모아 기억의 자물쇠를 연다.";
    case "sacho":
      return "자물쇠가 열리면 그 장소의 사초 한 장을 되찾는다.";
    case "done":
      return "작전 완료. 두 거점의 사초를 모두 모았다.";
    default:
      return "자동 시연 중이다.";
  }
}

// 장면이 바뀔 때마다 다음 한 걸음을 정한다. 단서 풀이와 자물쇠 입력은
// Mission·LockPanel이 auto 값을 받아 화면에서 직접 보여 준다.
export function useAutoplay({
  active,
  paused,
  s,
  scene,
  busy,
  arrived,
  send,
  setPane,
  stop,
}: {
  active: boolean;
  paused: boolean;
  s: Snapshot | null;
  scene: string;
  busy: boolean;
  // 이동 장면에서 캐릭터가 거점 도착 범위에 들어섰는지(입체 필드가 알려 준다)
  arrived: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
  setPane: (p: "report" | "lock" | "waiting") => void;
  stop: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const step = `${scene}:${s?.current_site.id}:${s?.self.role}:${s?.game.report_mask.join()}`;
  useEffect(() => {
    if (!active || paused || busy) return;
    const later = (ms: number, act: () => Promise<unknown> | void) => {
      const t = window.setTimeout(async () => {
        const out = await act();
        if (out === null) window.setTimeout(() => setRetry((n) => n + 1), 1500);
      }, ms);
      return () => window.clearTimeout(t);
    };
    if (scene === "title" || scene === "enroll")
      return later(800, () =>
        send({ action: "create-demo", nickname: "기록자" }),
      );
    if (!s?.game.demo) return;
    const site = s.current_site;
    // 캐릭터가 실제 길을 따라 거점까지 걸어가 도착 범위에 들어서면 도착을 알린다.
    // 지도를 그리지 못하는 기기에서도 멈추지 않게 오래 기다리면 그냥 넘어간다.
    if (scene === "travel")
      return later(arrived ? 1600 : 90000, () =>
        send({ action: "demo-arrival", site_id: site.id }),
      );
    if (scene === "report" || scene === "waiting") {
      const next = site.lockOrder.find((_, i) => !s.game.report_mask[i]);
      if (next)
        return later(3000, () =>
          send({ action: "demo-role", demo_role: next }),
        );
      if (s.self.role !== "commander")
        return later(2500, () =>
          send({ action: "demo-role", demo_role: "commander" }),
        );
      return later(2500, () => setPane("lock"));
    }
    if (scene === "sacho")
      return later(4000, () =>
        send({ action: "depart-next-site", site_id: site.id }),
      );
    if (scene === "done") return later(6000, stop);
  }, [active, paused, busy, step, retry, arrived]);
}
