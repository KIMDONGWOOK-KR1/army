"use client";
import { ResultV2 } from "./closing-v2";

import { useState } from "react";
import { useGameV2 } from "./use-game";
import { VerifyMission } from "./verify-mission";
import { useLocation } from "./use-location";
import { allowsSimulatedArrival } from "@/supabase/functions/_shared/arrival-policy";
import { ROLE_NAMES, ROLES } from "@/supabase/functions/_shared/types";

export default function VerifyApp() {
  const {
    snapshot: s,
    busy,
    error,
    online,
    restoring,
    now,
    send,
    retry,
    reset,
  } = useGameV2();
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const isSynthetic = s?.course.demo === true &&
    s.course.id.startsWith("jnu-demo-dev-");
  const myIndex = s?.self.role ? ROLES.indexOf(s.self.role) : -1;
  const location = useLocation(s, send);
  const canSimulate = !!s && allowsSimulatedArrival(s.course, s.stage.arrival);

  return (
    <div className="verify-page">
      <main id="main-content" className="verify-stack verify-container">
        <header className="verify-card verify-stack">
          <h1>전체 코스 v2 확인용 화면</h1>
          <p>
            합성 코스로 4인 흐름을 확인하는 임시 화면이다. 모의 도착은 실제 현장
            GPS 검증에 해당하지 않는다.
          </p>
          <a href="/">기존 게임 화면</a>
        </header>

        {error && (
          <section
            className="verify-card verify-stack"
            role="alert"
            data-testid="verify-error"
          >
            <p>{error}</p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void retry()}
            >
              다시 연결
            </button>
          </section>
        )}
        {!online && (
          <p role="status">
            서버 연결을 확인하라. 복구하면 현재 상태를 다시 불러온다.
          </p>
        )}

        {restoring
          ? <p role="status">이전 상태를 확인하는 중…</p>
          : !s
          ? (
            <section className="verify-card verify-stack">
              <h2>새 방 또는 코드 합류</h2>
              <p>
                기기 4대나 서로 다른 브라우저 프로필을 사용하라. 같은 프로필의
                탭은 같은 참가자다.
              </p>
              <label className="verify-field">
                호출명
                <input
                  value={nickname}
                  maxLength={6}
                  autoComplete="off"
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="button primary"
                disabled={busy || !nickname.trim()}
                onClick={() => void send({ action: "create-game", nickname })}
              >
                새 v2 방 만들기
              </button>
              <label className="verify-field">
                입장 코드
                <input
                  value={code}
                  maxLength={12}
                  autoComplete="off"
                  onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={busy || !nickname.trim() || !code}
                onClick={() =>
                  void send({ action: "join-game", nickname, code })}
              >
                코드로 합류
              </button>
            </section>
          )
          : !isSynthetic
          ? (
            <section className="verify-card verify-stack">
              <h2>합성 코스가 필요하다</h2>
              <p>
                이 화면은 dev 합성 v2 코스의 흐름 확인용이다. 연결된 코스 설정을
                확인하라.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={reset}
              >
                연결 화면으로
              </button>
            </section>
          )
          : (
            <>
              <section className="verify-card verify-stack">
                <h2>{s.stage.name}</h2>
                <p>
                  입장 코드{" "}
                  <strong data-testid="verify-code">{s.game.code}</strong>
                </p>
                <p>
                  {s.self.nickname} ·{" "}
                  <strong data-testid="verify-role">
                    {s.self.role ? ROLE_NAMES[s.self.role] : "보직 배정 대기"}
                  </strong>
                </p>
                <p>
                  {s.stage.kind !== "memorial" && <>점수 {s.game.score} · </>}{s.game.members.length}/4명 ·{" "}
                  {s.game.status === "lobby"
                    ? "합류 대기"
                    : s.game.status === "briefing"
                    ? "보직 공개 중"
                    : s.game.status === "equip"
                    ? "준비 중"
                    : s.game.site_phase === "travel"
                    ? "이동 중"
                    : s.game.site_phase === "cleared"
                    ? `${s.stage.name} 완료`
                    : "조사 중"}
                </p>
                <ul className="verify-team" data-testid="verify-team">
                  {s.game.members.map((m) => {
                    const i = m.role ? ROLES.indexOf(m.role) : -1;
                    return (
                      <li key={m.id}>
                        {m.nickname} ·{" "}
                        {m.role ? ROLE_NAMES[m.role] : "배정 대기"}
                        {m.id === s.self.id ? " (나)" : ""}
                        {m.ready ? " · 준비 ✓" : ""}
                        {i >= 0 && s.game.arrival_mask[i] ? " · 도착 ✓" : ""}
                        {i >= 0 && s.game.report_mask[i] ? " · 보고 ✓" : ""}
                        {i >= 0 && s.game.confirm_mask[i]
                          ? " · 해설 읽음 ✓"
                          : ""}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void retry()}
                >
                  상태 새로고침
                </button>
              </section>

              {s.game.status === "lobby" && (
                <section className="verify-card verify-stack">
                  <h2>4인 합류 확인</h2>
                  {s.self.is_host
                    ? (
                      <button
                        type="button"
                        className="button primary"
                        disabled={busy || s.game.members.length !== 4}
                        onClick={() => void send({ action: "start-game" })}
                      >
                        보직 공개 시작
                      </button>
                    )
                    : <p>방장이 보직을 공개할 때까지 기다리라.</p>}
                </section>
              )}
              {s.game.status === "briefing" && (
                <p role="status">잠시 후 준비 화면으로 이동한다.</p>
              )}
              {s.game.status === "equip" && (
                <section className="verify-card verify-stack">
                  <h2>개인 준비</h2>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || s.self.ready}
                    onClick={() => void send({ action: "set-ready" })}
                  >
                    {s.self.ready ? "준비 확인됨" : "준비 완료"}
                  </button>
                  {s.self.role === "commander" && (
                    <button
                      type="button"
                      className="button dark"
                      disabled={busy || !s.game.members.every((m) => m.ready)}
                      onClick={() =>
                        void send({ action: "begin-operation" })}
                    >
                      작전 출발
                    </button>
                  )}
                </section>
              )}
              {s.game.status === "playing" && s.game.site_phase === "travel" &&
                (
                  <section className="verify-card verify-stack">
                    <h2>{s.stage.name} 도착 확인 · {s.current_site.radiusM}m</h2>
                    <p>
                      {canSimulate ? "각자 본인의 모의 도착 버튼을 누른다."
                        : "GPS를 켜고 반경 안에서 5초간 기다리라. 네 명 모두 도착해야 미션이 열린다."}
                    </p>
                    {!canSimulate && <p role="status">{location.status} · 전원 도착 {s.game.arrival_mask.filter(Boolean).length}/4</p>}
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy || myIndex < 0 ||
                        s.game.arrival_mask[myIndex]}
                      onClick={() => canSimulate
                        ? void send({
                          action: "report-arrival",
                          stage_id: s.game.stage_id,
                          method: "simulated",
                        }) : location.start()}
                    >
                      {canSimulate ? "본인 모의 도착 확인" : "GPS 위치 확인"}
                    </button>
                  </section>
                )}
              {s.game.status === "playing" && s.game.site_phase !== "travel" &&
                (
                  <VerifyMission
                    key={`${s.game.id}:${s.game.stage_id}:${s.self.role}`}
                    snapshot={s}
                    busy={busy}
                    now={now}
                    send={send}
                  />
                )}
              {s.game.status === "done" && <ResultV2 snapshot={s} />}
              <footer className="verify-card verify-stack">
                <p>
                  화면을 새로고침하면 서버 진행 상태를 복구한다. 제출 전
                  입력값은 보관하지 않는다.
                </p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={reset}
                >
                  새 방 또는 코드 입력으로
                </button>
              </footer>
            </>
          )}
      </main>
    </div>
  );
}
