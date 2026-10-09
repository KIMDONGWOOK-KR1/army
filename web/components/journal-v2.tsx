"use client";
import type { V2Response } from "@/lib/game-snapshot";
import styles from "./mission-v2.module.css";

const methods: Record<string, string> = {
  field: "현장 확인",
  official_digital: "공식 디지털 자료 확인",
  simulated: "모의 확인",
  explained: "해설 확인",
};

export function JournalV2({ snapshot }: { snapshot: V2Response }) {
  return (
    <div className={`record-grid ${styles.journal}`} data-testid="journal-v2">
      {snapshot.course.sites.map((site) => {
        const acquired = snapshot.game.acquired_sites.find((s) =>
          s.id === site.id
        );
        const journal = snapshot.self.journal?.find((s) =>
          s.stage_id === site.id
        );
        return (
          <article
            className={`record-card ${acquired ? "acquired" : ""}`}
            key={site.id}
          >
            <span className="eyebrow">{site.name}</span>
            <span className="record-char">
              {acquired ? acquired.sacho.char || "記" : "封"}
            </span>
            <h3>{site.sacho.name}</h3>
            <p>
              {acquired
                ? acquired.sacho.body || "함께 복원한 기록이다."
                : "동료들과 단서를 모아 이 기록을 복원하라."}
            </p>
            {journal && (
              <>
                <p>
                  {journal.method === "explained"
                    ? "해설 확인 후 복원"
                    : "조사 후 복원"}
                </p>
                <h4>내 조사 기록</h4>
                {journal.entries.map((entry) => (
                  <section className={styles.note} key={entry.step_id}>
                    <h5>{entry.prompt}</h5>
                    <p>
                      {entry.verified ? "조사 검증 완료" : "해설로 확인"} ·{" "}
                      {methods[entry.method] ?? "확인 완료"}
                    </p>
                    {Object.values(entry.record ?? {}).map((text, i) => (
                      <p key={i}>{text}</p>
                    ))}
                    {entry.source && <p>사용한 출처: {entry.source.text}</p>}
                    {entry.explanation && <p>{entry.explanation}</p>}
                    {entry.reward && <p>{entry.reward}</p>}
                  </section>
                ))}
              </>
            )}
            {acquired && !journal && site.id === snapshot.stage.id && (
              <>
                <h4>내 조사 해설</h4>
                {Object.entries(snapshot.self.explanations).map((
                  [id, text],
                ) => <p key={id}>{text}</p>)}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
