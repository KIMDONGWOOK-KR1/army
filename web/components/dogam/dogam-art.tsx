// 현장 도감 그림. 모두 손으로 그린 예시 그림이다(언론·기관 사진은 쓰지 않는다).
// 모양은 hh가 올린 사진·그림지도로 확인한 것만 따른다(jnu-landmarks): 정문 서쪽 채의 높은 화강암 탑, 갈색 평지붕,
// 동쪽 채의 베이지 경비실, 곧은 가로수 길, 길 한가운데 용봉탑, 그 너머 붉은 벽돌 용봉관.
import type { DogamArtId, DogamPicture } from "@/lib/dogam";
import s from "./dogam.module.css";

const ART_BOX: Record<DogamArtId, string> = {
  bloom: "0 0 100 120",
  stone: "0 0 100 80",
  miniGate: "0 0 100 80",
  roadFlag: "0 0 100 80",
};

function ArtShapes({ art }: { art: DogamArtId }) {
  switch (art) {
    case "bloom":
      return <>
        <rect x="28" y="104" width="44" height="10" rx="2" fill="#b3ad9f" />
        <path d="M50 104 C38 80 30 50 44 20 C54 46 56 76 50 104z" fill="#ebe6dc" stroke="#9c958a" strokeWidth="1.4" />
        <path d="M50 104 C34 92 14 76 10 46 C30 58 44 80 50 104z" fill="#e1dbcf" stroke="#9c958a" strokeWidth="1.4" />
        <path d="M50 104 C66 92 86 76 90 46 C70 58 56 80 50 104z" fill="#e1dbcf" stroke="#9c958a" strokeWidth="1.4" />
      </>;
    case "stone":
      return <>
        <path d="M10 76 L14 14 Q16 6 26 6 H74 Q84 6 86 14 L90 76z" fill="#55524c" />
        <g fill="#8e8a80"><rect x="28" y="20" width="44" height="4" rx="2" /><rect x="24" y="32" width="52" height="3" rx="1.5" />
          <rect x="24" y="41" width="52" height="3" rx="1.5" /><rect x="24" y="50" width="40" height="3" rx="1.5" /></g>
      </>;
    case "miniGate":
      return <>
        <rect x="10" y="20" width="16" height="56" fill="#a9a190" /><rect x="74" y="20" width="16" height="56" fill="#a9a190" />
        <g stroke="#4f483c" strokeWidth="2.4" fill="none"><path d="M26 30h48v44H26z" /><path d="M34 30v44M42 30v44M50 30v44M58 30v44M66 30v44" /></g>
      </>;
    case "roadFlag":
      return <>
        <path d="M30 80 L46 18 H54 L70 80z" fill="#c9c2b0" />
        <path d="M50 78 V22" stroke="#e7c64a" strokeWidth="1.6" strokeDasharray="4 4" />
        <g fill="#6f9a6a"><circle cx="26" cy="30" r="5" /><circle cx="74" cy="30" r="5" /><circle cx="20" cy="50" r="6" /><circle cx="80" cy="50" r="6" /></g>
        <rect x="38" y="6" width="24" height="12" fill="#9a4434" /><rect x="47" y="0" width="6" height="18" fill="#86352a" />
        <path d="M18 78 V46" stroke="#2b3a33" strokeWidth="3" strokeLinecap="round" />
        <path d="M19 47 h17 l-4 5 4 5 h-17z" fill="#2867b2" />
      </>;
  }
}

/** 도감 칸 그림. 빈 칸에서는 흐린 그림자만 보인다(꽃잎 수 같은 답이 그림자로 새지 않게). */
export function SlotArt({ art, className, label }: { art: DogamArtId; className?: string; label?: string }) {
  if (art === "bloom") return <img className={`${s.bloomArt} ${className ?? ""}`} src="/brand/bloom-metal-illustration.png" alt={label ?? "꽃잎 형태의 공공 조형물을 표현한 예시 그림"} width={1168} height={880} />;
  return <svg className={className} viewBox={ART_BOX[art]} role={label ? "img" : undefined}
    aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    <ArtShapes art={art} />
  </svg>;
}

/** 넷이 한 그림에 쓰는 거점 그림(280×200). 네 조각으로 세로로 자른다. */
export function PictureShapes({ picture }: { picture: DogamPicture }) {
  if (picture !== "gate") return null;
  return <>
    <rect width="280" height="200" fill="#d6e8f2" />
    <path d="M0 122 H280 V200 H0z" fill="#a9ba8c" />
    <g fill="#3f6b4a"><path d="M110 116 l6 -44 l6 44z" /><path d="M120 113 l4 -30 l4 30z" /><path d="M127 111 l3 -18 l3 18z" />
      <path d="M158 116 l6 -44 l6 44z" /><path d="M152 113 l4 -30 l4 30z" /><path d="M147 111 l3 -18 l3 18z" /></g>
    <g fill="#355e40"><path d="M80 124 l10 -70 l10 70z" /><path d="M180 124 l10 -70 l10 70z" /></g>
    <rect x="137.6" y="92" width="4.8" height="14" fill="#6f7f72" /><circle cx="140" cy="90" r="3.2" fill="#6f7f72" />
    <path d="M52 200 L134 112 H146 L228 200z" fill="#8d918b" />
    <path d="M138.6 112 L132 200 M141.4 112 L148 200" stroke="#e7c64a" strokeWidth="1.6" />
    <path d="M98 200 L136.5 112 M182 200 L143.5 112" stroke="#fff" strokeWidth="1.6" strokeDasharray="9 8" />
    <rect x="26" y="30" width="24" height="126" fill="#cdc6b6" /><rect x="34" y="42" width="6" height="66" fill="#6b6457" /><circle cx="44" cy="56" r="6.5" fill="#4b4339" />
    <rect x="18" y="92" width="92" height="7" fill="#5b4637" /><rect x="96" y="99" width="11" height="57" fill="#c4bdab" />
    <rect x="170" y="95" width="100" height="7" fill="#5b4637" /><rect x="173" y="102" width="11" height="54" fill="#c4bdab" />
    <rect x="204" y="102" width="60" height="52" fill="#dccfb3" />
    <g stroke="#b9a988" strokeWidth="2"><path d="M210 106v44M216 106v44M222 106v44" /></g>
    <rect x="232" y="114" width="28" height="8" fill="#efe6d1" />
  </>;
}

const TREES: [number, number][] = [[30, 96], [58, 74], [84, 110], [226, 88], [258, 70], [290, 104], [344, 80], [402, 96], [446, 72],
  [486, 90], [556, 84], [586, 100], [690, 92], [720, 74], [770, 104], [828, 86], [868, 96]];
function windows(x0: number, y0: number, cols: number, rows: number) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    out.push(<rect key={`${x0}-${r}-${c}`} x={x0 + c * 16} y={y0 + r * 16} width="8" height="8" />);
  return out;
}

/** 쌍안경으로 보는 길 건너편(900×420). 조형물은 x 606~654, y 196~254 자리에 있다. */
export const PANORAMA = { width: 900, height: 420, target: { x: 630, y: 228 } } as const;
export function Panorama() {
  return <>
    <defs><linearGradient id="dogam-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b8d4e5" /><stop offset="1" stopColor="#e4eef0" /></linearGradient></defs>
    <rect width="900" height="276" fill="url(#dogam-sky)" />
    <g fill="#d9d2c2"><rect x="196" y="166" width="132" height="76" /><rect x="372" y="184" width="98" height="58" /><rect x="742" y="174" width="142" height="68" /></g>
    <g fill="#c2baa6">{windows(206, 176, 8, 3)}{windows(382, 194, 6, 2)}{windows(752, 184, 9, 3)}</g>
    {TREES.map(([x, h], i) => <path key={x} d={`M${x} 242 l${9 + (i % 3)} -${h} l${9 + (i % 3)} ${h}z`} fill={i % 2 ? "#3f6b4a" : "#355e40"} />)}
    <rect y="236" width="900" height="24" fill="#a9ba8c" />
    <g fill="#8fae78"><ellipse cx="470" cy="246" rx="22" ry="9" /><ellipse cx="676" cy="248" rx="14" ry="7" /><ellipse cx="858" cy="246" rx="24" ry="9" /></g>
    <rect y="258" width="900" height="18" fill="#d8d0bd" />
    <rect x="118" y="64" width="42" height="196" fill="#cdc6b6" /><rect x="131" y="86" width="12" height="118" fill="#6b6457" /><circle cx="151" cy="100" r="11" fill="#4b4339" />
    <rect x="98" y="166" width="246" height="10" fill="#5b4637" /><rect x="322" y="176" width="16" height="84" fill="#c4bdab" />
    <rect x="520" y="148" width="4" height="112" fill="#5d6460" /><rect x="508" y="144" width="26" height="7" rx="3" fill="#5d6460" /><circle cx="521" cy="155" r="4" fill="#f2e2a2" />
    <rect x="696" y="242" width="42" height="6" rx="2" fill="#7a5b40" /><rect x="700" y="248" width="3" height="11" fill="#5b4637" /><rect x="731" y="248" width="3" height="11" fill="#5b4637" />
    <rect x="784" y="198" width="48" height="34" rx="3" fill="#f2ede0" stroke="#8b8576" strokeWidth="2" /><rect x="806" y="232" width="4" height="28" fill="#8b8576" />
    <rect x="610" y="248" width="40" height="10" fill="#b3ad9f" />
    <svg x="606" y="196" width="48" height="58" viewBox="0 0 100 120"><ArtShapes art="bloom" /></svg>
    <rect y="276" width="900" height="144" fill="#8d918b" /><rect y="276" width="900" height="5" fill="#c9c2b2" />
    <path d="M0 316 H900 M0 394 H900" stroke="#f4f4f0" strokeWidth="3" strokeDasharray="28 22" />
    <path d="M0 352 H900 M0 358 H900" stroke="#e7c64a" strokeWidth="3" />
    <g className={s.carB}><rect x="8" y="290" width="112" height="24" rx="8" fill="#e8e4da" /><path d="M28 290 l12 -14 h44 l14 14z" fill="#bcd2e0" />
      <circle cx="32" cy="316" r="8" fill="#222" /><circle cx="96" cy="316" r="8" fill="#222" /></g>
    <g className={s.car}><rect x="0" y="364" width="118" height="26" rx="8" fill="#4a74b5" /><path d="M22 364 l14 -16 h46 l14 16z" fill="#cfe0ee" />
      <circle cx="26" cy="392" r="9" fill="#222" /><circle cx="92" cy="392" r="9" fill="#222" /></g>
  </>;
}

/** 탁본 뒤 '표지석 직접 보기'(시연 그림). 현장에서는 눈앞의 표지석을 본다. */
export function StoneLook() {
  return <svg className={s.stoneLook} viewBox="0 0 320 200" role="img" aria-label="표지석 그림. 5·18 사적지 번호가 새겨져 있어요">
    <rect width="320" height="200" fill="#d4e6ee" /><rect y="148" width="320" height="52" fill="#a9ba8c" />
    <path d="M78 186 L82 44 Q84 28 102 28 H218 Q236 28 238 44 L242 186z" fill="#55524c" />
    <rect x="62" y="182" width="196" height="12" rx="2" fill="#8d877b" />
    <text x="160" y="90" textAnchor="middle" fontFamily="'Noto Serif KR', serif" fontWeight="700" fontSize="38" fill="#dcd6c8">5·18</text>
    <text x="160" y="132" textAnchor="middle" fontFamily="'Noto Serif KR', serif" fontWeight="700" fontSize="22" fill="#dcd6c8">사적지 제1호</text>
    <g fill="#8e8a80"><rect x="104" y="148" width="112" height="4" rx="2" /><rect x="104" y="158" width="112" height="4" rx="2" /><rect x="124" y="168" width="72" height="4" rx="2" /></g>
  </svg>;
}
