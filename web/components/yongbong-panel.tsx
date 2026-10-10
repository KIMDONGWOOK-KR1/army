"use client";
import { plain } from "@/lib/practice-text";
import type { CSSProperties } from "react";
import { type Command, ROLE_NAMES, ROLES } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import { shortName, toward } from "./next-stop";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";

export function SharedRecords({ records }: { records: NonNullable<V2Response["self"]["shared_records"]> }) {
  return records.map((item) => <section className="verify-card verify-stack" key={item.step_id} data-testid="shared-material">
    <h3>통신원이 전달한 자료 기록</h3>
    {item.status === "explained_without_record"
      ? <p>해설로 완료했으며 제출한 자료 기록이 없다. 실제 자료를 추가로 확인해야 한다.</p>
      : <>
        {item.fields.map((field) => <p key={field.id}><strong>{plain(field.label)}:</strong> {item.record?.[field.id] ?? "확인 불가"}</p>)}
        {item.source && <p>확인 출처: {item.source.text}</p>}
      </>}
  </section>);
}

export function YongbongPanel({ snapshot, busy, send }: {
  snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null>;
}) {
  const outdoor = snapshot.game.visit?.mode === "outdoor";
  return <>
    {!!snapshot.stage.altModes?.length && <section className="verify-card verify-stack" data-testid="visit-mode">
      <h3>{snapshot.game.visit?.label ?? "현장 조사"}</h3>
      <p>실내 관람이 어렵다면 외부에서 건물과 제공된 공식 자료를 확인하라. 자료에서 찾지 못한 항목은 확인 불가로 기록하라.</p>
      {outdoor ? <p>외부 대체 조사로 기록한다. 이미 작성한 내용은 유지된다.</p>
        : snapshot.self.role === "commander" && snapshot.game.site_phase === "mission"
        ? <button type="button" className="button secondary" disabled={busy}
            onClick={() => void send({ action: "select-alt-mode", stage_id: snapshot.stage.id, mode_id: "outdoor" })}>
            외부 대체 모드 선택
          </button>
        : <p>필요하면 지휘관이 외부 대체 모드를 선택한다.</p>}
    </section>}
    {!!snapshot.self.shared_records?.length && <SharedRecords records={snapshot.self.shared_records} />}
  </>;
}

export function NextStageAction({ snapshot, busy, send }: {
  snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null>;
}) {
  const next = snapshot.course.sites.find((s) => s.seq > snapshot.current_site.seq);
  if (!next || snapshot.game.site_phase !== "cleared") return null;
  return snapshot.self.role === "commander"
    ? <button type="button" className="button primary depart-button" disabled={busy} data-testid="depart-next-stage"
        onClick={() => void send({ action: "depart-next-site", stage_id: snapshot.stage.id })}>
        {toward(shortName(next.name))} 출발
      </button>
    : <div className="depart-wait">
        <p>지휘관이 출발을 누르면 함께 이동해요.</p>
        <Crew snapshot={snapshot} />
      </div>;
}

/** 네 사람 표시: 보직 그림과 호출명 */
export function Crew({ snapshot }: { snapshot: V2Response }) {
  return <ul className="crew-row" aria-label="함께 이동할 네 사람">
    {ROLES.map((role) => {
      const m = snapshot.game.members.find((x) => x.role === role);
      const Icon = ROLE_ICONS[role];
      return <li key={role} style={{ "--crew": ROLE_COLORS[role] } as CSSProperties}>
        <Icon size={18} aria-hidden="true" />
        <span>{m?.nickname ?? ROLE_NAMES[role]}</span>
        <small>{ROLE_NAMES[role]}</small>
      </li>;
    })}
  </ul>;
}
