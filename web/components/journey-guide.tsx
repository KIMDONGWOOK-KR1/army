import { Footprints, Flower2, LockKeyhole, MessageCircle, NotebookPen } from "lucide-react";
import type { CSSProperties } from "react";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import { ROLES, ROLE_NAMES } from "@/supabase/functions/_shared/types";
import styles from "./final-polish.module.css";
const JOBS = { commander: '이야기를 읽고, 네 숫자로 자물쇠를 열어요.', scout: '주변을 살피고, 현장의 흔적을 찾아요.', signal: '흩어진 신호를 듣고, 주파수를 맞춰요.', cipher: '문자와 날짜에 숨은 뜻을 풀어요.' };
const ROUTE = [
  { name: '전남대 정문', act: '첫 단서 발견', Icon: Footprints },
  { name: '용봉관', act: '함께 기억 복원', Icon: LockKeyhole },
  { name: '용봉열사 추모의 벽', act: '묵념과 국화 한 송이', Icon: Flower2 },
  { name: '봉지', act: '오늘의 기록 남기기', Icon: NotebookPen },
];
export function RoleLegend() {
  return <div className={styles.legend} aria-label="함께하는 네 보직">{ROLES.map(role => {
    const Icon = ROLE_ICONS[role];
    return <span key={role} style={{ '--role-color': ROLE_COLORS[role] } as CSSProperties}><Icon size={14} aria-hidden="true" />{ROLE_NAMES[role]}</span>;
  })}</div>;
}
export function JourneyGuide() {
  return <div className={styles.guide}>
    <p className={styles.intro}>한 사람의 정답보다,<br /><strong>네 사람이 나누는 이야기.</strong></p>
    <p>각자 다른 단서를 찾고, 얻은 숫자를 말로 전해요. 네 개의 시선이 모이면 하나의 기록이 완성돼요.</p>
    <ol className={styles.route} aria-label="전남대 탐방 순서">{ROUTE.map(({name, act, Icon}, i) => <li key={name}>
      <span className={styles.routeNumber}>{String(i + 1).padStart(2, '0')}</span>
      <div><b>{name}</b><span>{act}</span></div><Icon size={20} aria-hidden="true" />
    </li>)}</ol>
    <div className={styles.sectionHeading}><h3>각자 하나씩, 함께 네 역할</h3></div>
    <div className={styles.roles}>{ROLES.map(role => { const Icon = ROLE_ICONS[role]; return <article key={role} style={{ '--role-color': ROLE_COLORS[role] } as CSSProperties}>
      <span className={styles.badge}><Icon size={22} aria-hidden="true" /></span><div><h4>{ROLE_NAMES[role]}</h4><p>{JOBS[role]}</p></div>
    </article>; })}</div>
    <div className={styles.reminder}><MessageCircle size={20} aria-hidden="true" /><p><b>내 숫자는 동료에게 말로 전해요.</b><br />다른 사람의 숫자는 내 화면에 보이지 않아요.</p></div>
  </div>;
}
