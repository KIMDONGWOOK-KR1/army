"use client";
import {
  AlertTriangle,
  BookOpen,
  Footprints,
  KeyRound,
  LocateOff,
  MapPin,
  Play,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Command, Snapshot } from "@/supabase/functions/_shared/types";
import styles from "./demo-scenes.module.css";

// 발표 때 원하는 장면으로 바로 넘어가는 시연 장면 목록(혼자 체험하는 시연 작전 전용).
// 장면을 고르면 서버가 앞 거점의 보고·자물쇠를 채워 그 단계로 옮긴다. 정답은 서버에만 있다.
type Scene = {
  title: string;
  note: string;
  icon: LucideIcon;
  stage: NonNullable<Command["stage"]>;
  site?: number; // 코스 거점 차례(0부터)
};
const FLOW: Scene[] = [
  {
    title: "정문까지 걸어가기",
    note: "캐릭터가 실제 길을 따라 정문 표석까지 걷는다. 도착하면 표석이 기록 액자로 펼쳐진다.",
    icon: Footprints,
    stage: "travel",
    site: 0,
  },
  {
    title: "정문 도착, 보직별 단서",
    note: "네 보직이 각자 다른 단서를 받는다. 아래 보직 탭으로 화면을 바꿔 보여 준다.",
    icon: MapPin,
    stage: "mission",
    site: 0,
  },
  {
    title: "정문 기억의 자물쇠",
    note: "네 보고가 모였다. 지휘관이 들은 숫자로 자물쇠를 연다.",
    icon: KeyRound,
    stage: "lock",
    site: 0,
  },
  {
    title: "용봉관으로 이동",
    note: "정문을 지나 민주대로를 따라 용봉관까지 걷는다.",
    icon: Footprints,
    stage: "travel",
    site: 1,
  },
  {
    title: "용봉관 마지막 자물쇠",
    note: "마지막 자물쇠를 열면 작전이 끝난다.",
    icon: KeyRound,
    stage: "lock",
    site: 1,
  },
  {
    title: "작전 완료와 사초",
    note: "두 거점에서 모은 사초 기록을 확인한다.",
    icon: BookOpen,
    stage: "done",
  },
];
const CASES: Scene[] = [
  {
    title: "오답을 냈을 때",
    note: "단서 화면에서 아무 답이나 내면 다시 살펴보라는 안내가 나온다.",
    icon: AlertTriangle,
    stage: "mission",
    site: 0,
  },
  {
    title: "자물쇠를 틀렸을 때",
    note: "맞은 칸만 잠기고 틀릴 때마다 10점이 깎인다. 세 번 틀리면 60초를 기다린다.",
    icon: KeyRound,
    stage: "lock",
    site: 0,
  },
  {
    title: "위치를 받지 못할 때",
    note: "위치 권한이 없거나 캠퍼스 밖이면 길을 따라 걷는 시연 이동으로 바뀐다. 현장에서는 30초 뒤 지휘관이 수동 도착한다.",
    icon: LocateOff,
    stage: "travel",
    site: 0,
  },
];

export function DemoScenes({
  snapshot,
  busy,
  send,
  onAuto,
  onRehearse,
  onJump,
  onPicked,
}: {
  snapshot: Snapshot;
  busy: boolean;
  send: (c: Command) => Promise<Snapshot | null>;
  onAuto: () => void; // 새 시연 작전을 만들어 처음부터 자동으로 돌린다(창도 닫는다)
  // 정문에 모이고 보직 카드가 뒤집히는 장면만 미리 보여 준다(서버 진행은 그대로, 창도 닫는다)
  onRehearse?: () => void;
  onJump: (stage: Scene["stage"], siteId?: string) => void; // 서버에 보내기 직전
  onPicked: (stage: Scene["stage"]) => void;
}) {
  const pick = async (scene: Scene) => {
    const site =
      scene.site === undefined ? undefined : snapshot.course.sites[scene.site];
    onJump(scene.stage, site?.id);
    const next = await send({
      action: "demo-jump",
      stage: scene.stage,
      site_id: site?.id,
    });
    // 자물쇠는 지휘관만 열 수 있으니 지휘관 화면으로 바꾼다
    if (next && scene.stage === "lock" && next.self.role !== "commander")
      await send({ action: "demo-role", demo_role: "commander" });
    if (next) onPicked(scene.stage);
  };
  const row = (scene: Scene) => {
    const Icon = scene.icon;
    return (
      <li key={scene.title}>
        <button
          className={styles.pick}
          disabled={busy}
          onClick={() => void pick(scene)}
        >
          <Icon size={20} aria-hidden />
          <span>
            <strong>{scene.title}</strong>
            <small>{scene.note}</small>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className={styles.scenes}>
      <button
        className="button primary full"
        disabled={busy}
        onClick={onAuto}
      >
        처음부터 자동 시연
        <Play size={17} />
      </button>
      <h3>흐름대로 보기</h3>
      <ol>
        {onRehearse && (
          <li>
            <button
              className={styles.pick}
              disabled={busy}
              onClick={onRehearse}
            >
              <Users size={20} aria-hidden />
              <span>
                <strong>정문에 모여 보직 공개</strong>
                <small>
                  동료가 하나씩 정문 앞에 걸어 들어오고, 보직 카드가 뒤집힌다.
                  미리 보기라 진행 단계는 그대로다.
                </small>
              </span>
            </button>
          </li>
        )}
        {FLOW.map(row)}
      </ol>
      <h3>이럴 때는</h3>
      <ul>{CASES.map(row)}</ul>
    </div>
  );
}
