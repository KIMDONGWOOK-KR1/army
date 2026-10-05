export function SceneArt({
  site = 0,
  night = false,
  party = true,
}: {
  site?: number;
  night?: boolean;
  party?: boolean;
}) {
  return (
    <svg
      className="scene-art"
      viewBox="0 0 960 430"
      role="img"
      aria-label={
        site === 0
          ? "전남대 정문을 표현한 게임 장면"
          : "용봉관을 표현한 게임 장면"
      }
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor={night ? "#273e38" : "#dce1c4"} />
          <stop offset="1" stopColor={night ? "#63795e" : "#f1e8ca"} />
        </linearGradient>
        <pattern
          id="grass"
          width="35"
          height="30"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M8 20l2-3 2 3M26 9l1-3 2 3"
            fill="none"
            stroke="#667852"
            strokeWidth="1"
            opacity=".3"
          />
        </pattern>
      </defs>
      <rect width="960" height="430" fill="url(#sky)" />
      <circle cx="744" cy="78" r="35" fill="#e8d99d" opacity=".8" />
      <path
        d="M0 218Q140 112 271 204Q460 84 629 195Q820 136 960 194V430H0"
        fill="#b1bf92"
      />
      <path
        d="M0 256Q181 171 316 242Q566 158 733 227Q881 208 960 253V430H0"
        fill="#8fa17b"
      />
      <rect y="287" width="960" height="143" fill="#b7bb8a" />
      <rect y="287" width="960" height="143" fill="url(#grass)" />
      <path d="M437 275h89l260 155H141z" fill="#d1c9a8" />
      <path d="M468 276h30l115 154H315z" fill="#e8dcc0" />
      {[
        [52, 220, 1.5],
        [155, 245, 1.15],
        [843, 245, 1.25],
        [933, 212, 1.6],
        [238, 280, 0.72],
        [700, 272, 0.8],
      ].map(([x, y, scale], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${scale})`}>
          <path d="M-6 9h12v67H-6" fill="#666b46" />
          <path
            d="M0-94c-24 2-38 20-32 37-26 16-21 42-8 53-15 14-5 36 15 38 16 10 42 5 48-7 28-1 32-32 15-47 13-21-1-40-18-43 7-18-2-32-20-31"
            fill="#526c47"
          />
          <path
            d="M0-72c-15 5-21 13-17 30-18 5-22 28-10 34 0 18 23 22 33 9 19 1 27-20 15-30 9-18-1-30-12-33z"
            fill="#758455"
          />
        </g>
      ))}
      {site === 0 ? (
        <g transform="translate(319 178)">
          <path
            d="M0 45h319v25H0z"
            fill="#647054"
            stroke="#344c37"
            strokeWidth="3"
          />
          <path
            d="M-12 44L159 10l172 34z"
            fill="#40583f"
            stroke="#344c37"
            strokeWidth="3"
          />
          <path
            d="M34 70h29v145H34zM256 70h29v145h-29z"
            fill="#e0d6b8"
            stroke="#5b614b"
            strokeWidth="3"
          />
          <path
            d="M54 93h213v13H54z"
            fill="#b7b79b"
            stroke="#5b614b"
            strokeWidth="3"
          />
          <path
            d="M132 106h53v109h-53z"
            fill="#c3c6a2"
            stroke="#5b614b"
            strokeWidth="3"
          />
          <path d="M20 215h280v9H20z" fill="#889074" />
          <rect x="120" y="45" width="79" height="25" fill="#344c37" />
          <text
            x="159"
            y="63"
            textAnchor="middle"
            fill="#efdfba"
            fontSize="15"
            fontFamily="serif"
          >
            全南大學
          </text>
        </g>
      ) : (
        <g transform="translate(303 128)">
          <path
            d="M0 79h351v173H0z"
            fill="#d8c9a6"
            stroke="#556044"
            strokeWidth="3"
          />
          <path
            d="M-22 80L177 0l198 80z"
            fill="#53684b"
            stroke="#344c37"
            strokeWidth="3"
          />
          <path d="M9 252h333v10H9zM-5 262h361v9H-5z" fill="#849273" />
          <path
            d="M154 181h49v72h-49z"
            fill="#4d6046"
            stroke="#3c4c35"
            strokeWidth="3"
          />
          {[27, 86, 218, 277].map((x) => (
            <g key={x}>
              <path
                d={`M${x} 107h33v48h-33zM${x} 181h33v47h-33z`}
                fill="#748371"
                stroke="#52634b"
                strokeWidth="3"
              />
              <path
                d={`M${x + 16} 107v48M${x} 131h33M${x + 16} 181v47M${x} 205h33`}
                stroke="#d7c8a5"
                strokeWidth="2"
              />
            </g>
          ))}
          <rect
            x="129"
            y="58"
            width="96"
            height="32"
            fill="#344c37"
            stroke="#d7bd88"
            strokeWidth="2"
          />
          <text
            x="177"
            y="81"
            textAnchor="middle"
            fill="#efdfba"
            fontSize="21"
            fontFamily="serif"
          >
            龍鳳館
          </text>
        </g>
      )}
      <path
        d="M0 398Q77 362 164 390L159 430H0M797 417q80-63 163-22v35H797"
        fill="#526c47"
      />
      {party &&
        [
          [447, 349, "#994c40"],
          [505, 360, "#556b68"],
          [543, 334, "#ae8c49"],
          [401, 374, "#74627c"],
        ].map(([x, y, c], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <ellipse cy="27" rx="10" ry="4" fill="#58684b" opacity=".3" />
            <path d="M-4 14v13M5 14v13" stroke="#334c38" strokeWidth="4" />
            <rect
              x="-8"
              y="0"
              width="16"
              height="18"
              rx="4"
              fill={c as string}
            />
            <circle cy="-8" r="7" fill="#dec3a0" />
            <path d="M-7-10q1-12 13-3v4" fill="#40533d" />
            <path
              d="M-10 3l-5 10M10 3l4 7"
              stroke={c as string}
              strokeWidth="4"
            />
          </g>
        ))}
      <g fill="#dace9f">
        <path d="M99 364l3-7 3 7-3 3zM782 313l3-7 3 7-3 3zM726 387l3-7 3 7-3 3z" />
      </g>
      <g fill="none" stroke="#657554" strokeWidth="2">
        <path d="M338 89q7-8 14 0 7-8 14 0M599 119q6-7 12 0 6-7 12 0" />
      </g>
    </svg>
  );
}
