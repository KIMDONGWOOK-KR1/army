"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Link2, Stamp } from "lucide-react";
import type { Step, StepAnswer } from "@/supabase/functions/_shared/types";
import { connectChoice } from "@/lib/story-play";
import s from "./story-mission.module.css";

type Props = { step: Step; value: StepAnswer; onChange: (value: StepAnswer) => void };
function CardTabs({ count, current, filled, choose }: { count: number; current: number; filled: (i: number) => boolean; choose: (i: number) => void }) {
  return <nav className={s.cardTabs} aria-label="묶음 안 카드 선택">{Array.from({ length: count }, (_, i) => <button type="button" key={i}
    aria-label={`${i + 1}번째 카드${filled(i) ? " · 선택 있음" : ""}`} aria-current={current === i ? "step" : undefined}
    onClick={() => choose(i)}>{filled(i) ? <Check size={16} aria-hidden /> : i + 1}</button>)}</nav>;
}
function NextCard({ index, count, onChange, ready }: { index: number; count: number; onChange: (n: number) => void; ready: boolean }) {
  return <div className={s.cardPaging}>
    <button type="button" aria-label="앞 카드" disabled={index === 0} onClick={() => onChange(index - 1)}><ArrowLeft size={18} /></button>
    <span>{index + 1} / {count}</span>
    <button type="button" aria-label="다음 카드" disabled={index === count - 1 || !ready} onClick={() => onChange(index + 1)}><ArrowRight size={18} /></button>
  </div>;
}

export function StoryJudge({ step, value, onChange }: Props) {
  const [index, setIndex] = useState(0), values = Array.isArray(value) ? value : [], statements = step.statements ?? [];
  return <div className={s.judge}>
    <CardTabs count={statements.length} current={index} filled={(i) => !!values[i]} choose={setIndex} />
    <div className={s.document} key={index}>
      <span className={s.paperLabel}>교육용 미확인 보고 · {index + 1}</span>
      <p>{statements[index]}</p>
      <div className={s.stamps} role="radiogroup" aria-label={`보고 ${index + 1} 판정`}>
        {[["true", "참"], ["false", "거짓"]].map(([v, label]) => <label key={v} data-selected={values[index] === v}>
          <input type="radio" name={`${step.id}-${index}`} value={v} checked={values[index] === v}
            onChange={() => onChange(statements.map((_, n) => n === index ? v : values[n] ?? ""))} />
          <Stamp size={24} aria-hidden /><span>{label}</span>
        </label>)}
      </div>
      <span className={s.pencilNote}>도장은 나의 판단 · 최종 확인 전 수정 가능</span>
    </div>
    <NextCard index={index} count={statements.length} onChange={setIndex} ready={!!values[index]} />
  </div>;
}

export function StoryConnections({ step, value, onChange }: Props) {
  const [index, setIndex] = useState(0), fields = step.fields ?? [], field = fields[index];
  const record = typeof value === "object" && !Array.isArray(value) ? value : {};
  if (!field) return null;
  return <div className={s.connections}>
    <CardTabs count={fields.length} current={index} filled={(i) => !!record[fields[i].id]} choose={setIndex} />
    <div className={s.connectionSource}><span className={s.paperLabel}>{step.type === "classification" ? "판단할 보고" : "연결할 자료"} · {index + 1}</span><p>{field.label}</p>
      <Link2 size={24} aria-hidden /></div>
    <div className={s.connectionsOptions} role="group" aria-label={field.label}>{step.choices?.map((choice, i) => {
      const id = String(i + 1), selected = record[field.id] === id;
      const used = step.type === "match" && Object.entries(record).some(([k, v]) => k !== field.id && v === id);
      return <button key={id} type="button" aria-pressed={selected} data-testid={`connect-${step.id}-${id}`}
        onClick={() => onChange(connectChoice(step, record, field.id, id))}><span className={s.port}>{selected ? <Check size={16} /> : i + 1}</span><span>{choice}</span>{used && <small>연결 바꾸기</small>}</button>;
    })}</div>
    <p className={s.pencilNote}>선택한 항목을 다시 누르면 연결이 풀립니다.{step.type === "match" && " 다른 카드의 항목을 누르면 서로 바꿉니다."}</p>
    <NextCard index={index} count={fields.length} onChange={setIndex} ready={!!record[field.id]} />
  </div>;
}

export function StoryNotebook({ step, value, onChange }: Props) {
  const [index, setIndex] = useState(0), fields = step.fields ?? [];
  const record = typeof value === "object" && !Array.isArray(value) ? value : {};
  return <div className={s.notebook}>
    <nav className={s.cardTabs} aria-label="메모 항목">{fields.map((field, i) => <button key={field.id} type="button"
      data-testid={`record-tab-${field.id}`} aria-label={`메모 ${i + 1} · ${field.label}`} aria-current={index === i ? "step" : undefined}
      onClick={() => setIndex(i)}>{record[field.id]?.trim() ? <Check size={16} /> : i + 1}</button>)}</nav>
    {fields.map((field, i) => <label key={field.id} hidden={i !== index} className={s.notebookField}>
      <span>{field.label}</span><textarea aria-label={`${field.label}${field.required ? " (필수)" : ""}`} maxLength={field.maxLen ?? 300}
        value={record[field.id] ?? ""} placeholder="짧게, 내 말로 남기기" onChange={(e) => {
          const next = { ...record };
          if (e.target.value) next[field.id] = e.target.value;
          else delete next[field.id];
          onChange(next);
        }} />
      <small>{[...(record[field.id] ?? "")].length} / {field.maxLen ?? 300}</small>
    </label>)}
    <NextCard index={index} count={fields.length} onChange={setIndex} ready={!fields[index]?.required || !!record[fields[index]?.id]?.trim()} />
  </div>;
}
