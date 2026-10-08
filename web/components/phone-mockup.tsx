"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import styles from "./phone-mockup.module.css";
import {
  PHONE,
  PHONE_H,
  PHONE_W,
  phoneScale,
  readMockupMessage,
} from "./mockup-view";

// 폰 목업 보기의 바깥 문서: 실제 앱은 같은 출처 iframe(390×844) 안에서 돌고, 여기서는 틀만 그린다.
// 미디어 쿼리·고정 위치·입체 장면이 폰에서와 똑같이 동작하고, 폰 전체를 CSS 배율로 창에 맞춘다.
// iframe 표시(data-phone-screen)는 틀 안 앱이 자신이 목업 안에 있음을 알아보는 표지다(app-shell.tsx).
export function PhoneMockup({
  src,
  onExit,
}: {
  src: string;
  onExit: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(() =>
      phoneScale(window.innerWidth, window.innerHeight),
    ),
    // 틀 안 앱의 대화 상자가 열려 화면이 어두운가(상태·홈 표시줄도 같은 막으로 덮는다)
    [dim, setDim] = useState(false);
  // 메시지 듣기는 한 번만 단다(부모가 다시 그려도 새로 달지 않게 끄기 함수는 ref로 본다)
  const exit = useRef(onExit);
  useEffect(() => {
    exit.current = onExit;
  }, [onExit]);
  useEffect(() => {
    const fit = () =>
      setScale(phoneScale(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // 틀 안 앱의 작전 메뉴가 보내는 요청: 같은 출처, 이 iframe에서 온 것만 듣는다
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        e.origin !== window.location.origin ||
        !frame.current ||
        e.source !== frame.current.contentWindow
      )
        return;
      const action = readMockupMessage(e.data);
      if (action === "exit") exit.current();
      else if (action === "dim" || action === "undim") setDim(action === "dim");
      // 틀 안에서 누른 '전체 화면'은 폰 틀째로 띄운다(앱만 띄우면 폰 화면이 아니라 넓은 화면 배치가 된다)
      else if (action === "fullscreen" && !document.fullscreenElement)
        void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <div className={styles.stage} data-phone-mockup>
      <div className={styles.sun} aria-hidden="true" />
      <div className={styles.brand}>
        <span className="tiny-seal" aria-hidden="true">
          記
        </span>
        <b>호국실록</b>
      </div>
      <button className={`button secondary ${styles.exit}`} onClick={onExit}>
        목업 끄기
        <X size={18} />
      </button>
      <div
        className={styles.phone}
        style={
          {
            "--phone-w": `${PHONE_W}px`,
            "--phone-h": `${PHONE_H}px`,
            "--bezel": `${PHONE.bezel}px`,
            "--status": `${PHONE.status}px`,
            "--home": `${PHONE.home}px`,
            transform: `scale(${scale})`,
          } as CSSProperties
        }
      >
        <i className={`${styles.key} ${styles.action}`} aria-hidden="true" />
        <i className={`${styles.key} ${styles.volUp}`} aria-hidden="true" />
        <i className={`${styles.key} ${styles.volDown}`} aria-hidden="true" />
        <i className={`${styles.key} ${styles.power}`} aria-hidden="true" />
        <div className={styles.screen} data-dim={dim || undefined}>
          <div className={styles.status} aria-hidden="true">
            <span className={styles.clock}>9:41</span>
            <span className={styles.island} />
            <span className={styles.icons}>
              <svg
                width="18"
                height="12"
                viewBox="0 0 18 12"
                fill="currentColor"
              >
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                <rect x="10" y="3" width="3" height="9" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" />
              </svg>
              <svg
                width="16"
                height="12"
                viewBox="0 0 16 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              >
                <path d="M1.6 4.6a9.2 9.2 0 0 1 12.8 0" />
                <path d="M4.3 7.5a5.3 5.3 0 0 1 7.4 0" />
                <circle
                  cx="8"
                  cy="10.3"
                  r="1.4"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              <svg
                width="27"
                height="13"
                viewBox="0 0 27 13"
                fill="currentColor"
              >
                <rect
                  x="0.75"
                  y="0.75"
                  width="22.5"
                  height="11.5"
                  rx="3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.5"
                  strokeWidth="1.5"
                />
                <rect x="2.5" y="2.5" width="19" height="8" rx="2" />
                <path
                  d="M24.8 4.4v4.2c.8-.3 1.4-1.2 1.4-2.1s-.6-1.8-1.4-2.1Z"
                  opacity="0.5"
                />
              </svg>
            </span>
          </div>
          <iframe
            ref={frame}
            className={styles.frame}
            id="main-content"
            data-phone-screen
            src={src}
            title="호국실록 폰 화면"
            allow="geolocation; fullscreen; autoplay"
            width={PHONE.screenW}
            height={PHONE.screenH}
            // 키보드 초점을 바로 폰 화면 안으로 옮긴다(틀 안 앱이 장면 제목에 초점을 둔다)
            onLoad={() => {
              setDim(false);
              frame.current?.focus();
            }}
          />
          <div className={styles.home} aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
