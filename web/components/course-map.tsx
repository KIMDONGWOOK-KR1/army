import { MapPin } from "lucide-react";
export function CourseMap({
  site = 0,
  cleared = 0,
  compact = false,
}: {
  site?: number;
  cleared?: number;
  compact?: boolean;
}) {
  return (
    <div className={`course-map ${compact ? "compact" : ""}`}>
      <div className="map-caption">
        <span>CHONNAM · MEMORY ROUTE</span>
        <span>도식 지도</span>
      </div>
      <svg
        viewBox="0 0 700 420"
        role="img"
        aria-label="전남대 정문에서 용봉관으로 이어지는 도식 코스 지도. 실제 길 안내 지도가 아닙니다."
      >
        <defs>
          <pattern
            id="grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 30 0 L 0 0 0 30"
              fill="none"
              stroke="#cfcbbb"
              strokeWidth=".5"
            />
          </pattern>
          <pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r=".65" fill="#a5ad9e" />
          </pattern>
        </defs>
        <rect width="700" height="420" fill="url(#grid)" />
        <path
          d="M0 305Q170 240 305 280T700 210"
          fill="none"
          stroke="#e1ded2"
          strokeWidth="50"
        />
        <path
          d="M0 305Q170 240 305 280T700 210"
          fill="none"
          stroke="#f8f6ef"
          strokeWidth="36"
        />
        <path
          d="M190 -20Q255 130 210 220T230 440"
          fill="none"
          stroke="#e1ded2"
          strokeWidth="28"
        />
        <path
          d="M190 -20Q255 130 210 220T230 440"
          fill="none"
          stroke="#f8f6ef"
          strokeWidth="20"
        />
        <path
          d="M540 0Q470 80 500 145T555 420"
          fill="none"
          stroke="#e1ded2"
          strokeWidth="24"
        />
        <path
          d="M540 0Q470 80 500 145T555 420"
          fill="none"
          stroke="#f8f6ef"
          strokeWidth="17"
        />
        <g fill="#dfe4d8" stroke="#c4ceba" strokeWidth="1">
          <path d="M35 45h118l18 105-90 48-46-60z" />
          <path d="M300 27h139v140H300z" />
          <path d="M583 64h97v92h-97z" />
          <path d="M319 325h116v80H319z" />
          <path d="M38 350h90v55H38z" />
        </g>
        <g fill="url(#dots)">
          <rect x="312" y="37" width="115" height="115" />
          <path d="M47 56h93l18 87-70 36-41-50z" />
          <rect x="590" y="72" width="81" height="76" />
        </g>
        <g fill="#e5dfd0" stroke="#bcb5a3">
          <path d="M272 185h74v34h-74z" />
          <path d="M386 190h58v31h-58z" />
          <path d="M597 291h56v33h-56z" />
          <path d="M39 236h95v27H39z" />
          <path d="M471 351h25v47h-25z" />
        </g>
        <path
          d="M212 320C277 320 260 246 353 249S467 251 495 199"
          fill="none"
          stroke="#9f3434"
          strokeWidth="3"
          strokeDasharray="6 7"
        />
        <g
          transform="translate(159 300)"
          fill="#f6f1e7"
          stroke="#3b5141"
          strokeWidth="2"
        >
          <path d="M0 3h100v9H0zM7 12h12v51H7zM81 12h12v51H81zM17 18h67v6H17zM39 24h22v39H39z" />
          <path d="M-6 3L50-10l56 13" fill="#3b5141" />
          <path d="M0 63h100" />
        </g>
        <g
          transform="translate(437 134)"
          fill="#f6f1e7"
          stroke="#3b5141"
          strokeWidth="1.7"
        >
          <path d="M0 20h111v64H0zM-7 20L55-1l62 21z" />
          <path d="M12 31h10v16H12zM34 31h10v16H34zM67 31h10v16H67zM89 31h10v16H89zM12 57h10v16H12zM89 57h10v16H89zM44 57h22v27H44z" />
          <path d="M-6 84h123M-2 89h115" />
          <rect x="41" y="14" width="29" height="13" fill="#3b5141" />
          <text
            x="55"
            y="23"
            textAnchor="middle"
            fill="#fff"
            stroke="none"
            fontSize="8"
          >
            龍鳳
          </text>
        </g>
        <g fill="#76856a" opacity=".9">
          {[
            [60, 205],
            [98, 200],
            [134, 180],
            [157, 218],
            [284, 350],
            [292, 376],
            [617, 191],
            [649, 208],
            [390, 169],
            [420, 158],
            [562, 355],
            [580, 377],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="9" />
              <circle cx={x + 6} cy={y + 4} r="6" />
              <path d={`M${x} ${y + 8}v7`} stroke="#55634b" strokeWidth="2" />
            </g>
          ))}
        </g>
        <g fontFamily="system-ui,sans-serif" fill="#566050" fontSize="11">
          <text x="333" y="103">
            기억의 숲
          </text>
          <text x="58" y="102">
            캠퍼스
          </text>
          <text x="322" y="361">
            함께 걷는 길
          </text>
        </g>
        <g transform="translate(204 267)">
          <circle r="19" fill={site === 0 ? "#9f3434" : "#344e40"} />
          <text
            y="5"
            textAnchor="middle"
            fill="white"
            fontFamily="monospace"
            fontSize="15"
          >
            {cleared >= 1 ? "✓" : "01"}
          </text>
        </g>
        <g transform="translate(493 107)">
          <circle r="19" fill={site === 1 ? "#9f3434" : "#344e40"} />
          <text
            y="5"
            textAnchor="middle"
            fill="white"
            fontFamily="monospace"
            fontSize="15"
          >
            {cleared >= 2 ? "✓" : "02"}
          </text>
        </g>
        <g fontFamily="serif" fontSize="17" fill="#23392d">
          <text x="160" y="392">
            전남대 정문
          </text>
          <text x="451" y="251">
            용봉관
          </text>
        </g>
        <g transform="translate(653 340)" fill="#344e40">
          <path d="M0 0l-6 20 6-4 6 4z" />
          <text y="-8" textAnchor="middle" fontSize="10" fontFamily="monospace">
            N
          </text>
        </g>
      </svg>
      <div className="map-legend">
        <span>
          <MapPin size={14} /> 두 거점 · 네 개의 시선
        </span>
        <span>정문 → 용봉관</span>
      </div>
    </div>
  );
}
