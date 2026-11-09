"use client";
// 진짜 카메라·나침반을 켜기 전 안내(권한을 묻는 이유를 먼저 말한다). 안 되면 그림 도구로 바로 넘어갈 수 있다.
import type { ReactNode } from "react";
import { Camera, Compass, Image as ImageIcon, RotateCcw } from "lucide-react";
import s from "./dogam.module.css";

export type GateProblem = "denied" | "none" | "insecure" | "paused" | null;

const inKakao = () => typeof navigator !== "undefined" && /KAKAOTALK/i.test(navigator.userAgent);

export function SenseGate({ kind, title, body, action, onAction, onDrawn, problem, busy, dark }: {
  kind: "camera" | "compass" | "both";
  title: string;
  body: ReactNode;
  action: string;
  onAction: () => void;
  onDrawn: () => void;
  problem: GateProblem;
  busy?: boolean;
  dark?: boolean;
}) {
  const what = kind === "compass" ? "나침반(방향)" : kind === "camera" ? "카메라" : "카메라와 나침반";
  const trouble = problem === "denied"
    ? `${what} 권한이 꺼져 있어요. 사파리는 주소창 왼쪽 '가가', 크롬은 주소창 자물쇠에서 허용하고 다시 눌러요.`
    : problem === "none" ? `이 폰에서는 ${what}을 열지 못했어요. 그림으로 해도 돼요.`
    : problem === "insecure" ? `${what}은 https 주소에서만 열려요. 지금은 그림으로 해요.`
    : problem === "paused" ? "화면을 떠나서 카메라를 잠시 껐어요." : "";
  const Icon = kind === "compass" ? Compass : Camera;
  const retry = problem === "paused" || problem === "denied";
  return <div className={s.gate} data-dark={dark || undefined} data-testid="dogam-sense-gate">
    <span className={s.gateIcon} aria-hidden><Icon size={26} /></span>
    <b className={s.gateTitle}>{title}</b>
    <p className={s.gateBody}>{trouble || body}</p>
    {!trouble && inKakao() && <p className={s.gateBody}>카톡 안에서는 카메라가 막힐 수 있어요. 오른쪽 위 메뉴에서 &apos;다른 브라우저로 열기&apos;를 눌러요.</p>}
    {(!problem || retry) && <button type="button" className={`${s.btn} ${s.roleBtn}`} disabled={busy} onClick={onAction} data-sound="confirm">
      {problem ? <RotateCcw size={18} aria-hidden /> : <Icon size={18} aria-hidden />} {problem ? "다시 켜기" : action}
    </button>}
    <button type="button" className={s.linkBtn} onClick={onDrawn}><ImageIcon size={16} aria-hidden /> 그림으로 하기</button>
  </div>;
}
