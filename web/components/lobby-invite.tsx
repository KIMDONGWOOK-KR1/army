"use client";
import { useEffect, useState } from "react";
import { Copy, Share2 } from "lucide-react";

// 로비 위쪽 초대 카드: 큰 입장 코드와 QR(합류 주소), 링크 복사·공유.
// 방장 화면에는 QR까지 크게 두어 옆 사람이 바로 찍게 하고, 합류한 사람은 코드만 작게 본다.
// .join-code에는 코드 글자만 둔다(시험이 글자를 그대로 읽는다).

function JoinQr({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((q) =>
        q.toDataURL(value, {
          width: size * 2,
          margin: 1,
          color: { dark: "#1f2a44", light: "#ffffff" },
        }),
      )
      .then((v) => {
        if (active) setSrc(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);
  return (
    <span className="invite-qr" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} width={size} height={size} alt="팀원 합류 QR 코드" />
      ) : (
        <span className="invite-qr-wait">QR 준비 중…</span>
      )}
    </span>
  );
}

export function LobbyInvite({
  code,
  url,
  host,
  copied,
  onCopy,
}: {
  code: string;
  url: string;
  host: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);
  const share = async () => {
    try {
      await navigator.share({
        title: "호국실록 작전 합류",
        text: `입장 코드 ${code} — 호출명을 정하고 합류하라.`,
        url,
      });
    } catch {}
  };
  const tiles = (
    <div className="join-code" role="group" aria-label={`입장 코드 ${code}`}>
      {code.split("").map((v, i) => (
        <span key={i}>{v}</span>
      ))}
    </div>
  );
  if (!host)
    return (
      <div className="invite-card compact">
        <span className="invite-label">입장 코드</span>
        {tiles}
      </div>
    );
  return (
    <div className="invite-card">
      {url ? <JoinQr value={url} size={132} /> : <span className="invite-qr" />}
      <div className="invite-side">
        <span className="invite-label">입장 코드</span>
        {tiles}
        <div className="invite-actions">
          <button className="button secondary invite-button" onClick={onCopy}>
            <Copy size={15} aria-hidden="true" />
            {copied ? "복사됨" : "링크 복사"}
          </button>
          {canShare && (
            <button
              className="button secondary invite-button"
              onClick={() => void share()}
            >
              <Share2 size={15} aria-hidden="true" />
              공유
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
