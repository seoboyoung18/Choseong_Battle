/**
 * 캐릭터 렌더러 — 파츠 id 조합을 SVG로 그린다.
 *
 * 그림 파일을 쓰지 않는 이유: 아직 일러스트가 없고, 조합이 8×8×6×5×6 = 11,520가지라
 * 미리 그려둘 수도 없다. 색은 카탈로그(shared/avatar.js)가 들고 있고 여기는 형태만
 * 안다. 나중에 진짜 일러스트가 나오면 이 파일만 갈아끼우면 되고, 저장된 조합은
 * 그대로 산다.
 *
 * 좌표계는 100×100. 얼굴 중심 (50, 46), 어깨 위쪽 y=68.
 *
 * 동그란 액자는 얼굴만 잘라 확대한다. 22~32px짜리 자리에서 전신을 다 넣으면
 * 얼굴이 몇 픽셀밖에 안 남아 누가 누군지 구분되지 않는다.
 */

import { useId } from 'react';

import { findPart, normalizeAppearance } from '../../../shared/avatar.js';
import './Avatar.css';

const INK = '#3b2f27';
const WHITE = '#fffcf7';

/** 배경이 어두우면 눈을 흰색으로 뒤집는다 — 너구리 눈가·까치처럼 */
function isDark(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/* ── 귀 ──────────────────────────────────────────────────────────────────── */

function Ears({ ear, fur, inner }) {
  if (ear === 'LONG') {
    return (
      <g>
        <ellipse cx="38" cy="16" rx="7" ry="18" fill={fur} transform="rotate(-8 38 16)" />
        <ellipse cx="62" cy="16" rx="7" ry="18" fill={fur} transform="rotate(8 62 16)" />
        <ellipse cx="38" cy="17" rx="3.4" ry="12" fill={inner} transform="rotate(-8 38 17)" />
        <ellipse cx="62" cy="17" rx="3.4" ry="12" fill={inner} transform="rotate(8 62 17)" />
      </g>
    );
  }
  if (ear === 'POINT') {
    return (
      <g>
        <path d="M24 44 L30 15 L48 32 Z" fill={fur} />
        <path d="M76 44 L70 15 L52 32 Z" fill={fur} />
        <path d="M29.5 39 L32.5 24 L42 33 Z" fill={inner} />
        <path d="M70.5 39 L67.5 24 L58 33 Z" fill={inner} />
      </g>
    );
  }
  if (ear === 'TUFT') {
    return (
      <g>
        <ellipse cx="30" cy="24" rx="8" ry="12.5" fill={fur} transform="rotate(-25 30 24)" />
        <ellipse cx="70" cy="24" rx="8" ry="12.5" fill={fur} transform="rotate(25 70 24)" />
        <ellipse cx="30" cy="26" rx="4" ry="7" fill={inner} transform="rotate(-25 30 26)" />
        <ellipse cx="70" cy="26" rx="4" ry="7" fill={inner} transform="rotate(25 70 26)" />
      </g>
    );
  }
  if (ear === 'BIRD') {
    // 귀 대신 볏 — 부리는 얼굴 위에 따로 그린다
    return (
      <g fill={fur}>
        <path d="M50 9 L44 27 L56 27 Z" />
        <path d="M37 16 L36 28 L48 26 Z" />
        <path d="M63 16 L64 28 L52 26 Z" />
      </g>
    );
  }
  return (
    <g>
      <circle cx="27" cy="27" r="11" fill={fur} />
      <circle cx="73" cy="27" r="11" fill={fur} />
      <circle cx="27" cy="27" r="5.5" fill={inner} />
      <circle cx="73" cy="27" r="5.5" fill={inner} />
    </g>
  );
}

/* ── 얼굴 무늬 ───────────────────────────────────────────────────────────── */

function Marks({ mark, clip }) {
  if (mark === 'MASK') {
    return (
      <g clipPath={clip}>
        <rect x="18" y="36" width="64" height="14" rx="7" fill="#453f3a" opacity="0.9" />
      </g>
    );
  }
  if (mark === 'STRIPE') {
    return (
      <g clipPath={clip} fill="none" stroke="#6b4a2b" strokeWidth="3" strokeLinecap="round">
        <path d="M35 27 q3 5 2.5 9" />
        <path d="M50 23 v9" />
        <path d="M65 27 q-3 5 -2.5 9" />
      </g>
    );
  }
  if (mark === 'BIB') {
    return (
      <g clipPath={clip}>
        <ellipse cx="50" cy="58" rx="16" ry="12" fill={WHITE} />
      </g>
    );
  }
  return null;
}

/* ── 표정 ────────────────────────────────────────────────────────────────── */

function Face({ face, eye, beak }) {
  const stroke = { fill: 'none', stroke: eye, strokeWidth: 2.6, strokeLinecap: 'round' };
  const mouth = beak ? (
    <path d="M50 51 L43 57 L57 57 Z" fill="#d9a036" />
  ) : (
    <path d="M44 55 q6 6 12 0" {...stroke} />
  );

  if (face === 'WINK') {
    return (
      <g>
        <ellipse cx="40" cy="45" rx="3.2" ry="3.8" fill={eye} />
        <path d="M56 46.5 q4 -5 8 0" {...stroke} />
        <ellipse cx="31" cy="53" rx="4.5" ry="3" fill="#e8a9a0" opacity="0.75" />
        <ellipse cx="69" cy="53" rx="4.5" ry="3" fill="#e8a9a0" opacity="0.75" />
        {mouth}
      </g>
    );
  }
  if (face === 'PROUD') {
    return (
      <g>
        <path d="M36 46.5 q4 -5 8 0" {...stroke} />
        <path d="M56 46.5 q4 -5 8 0" {...stroke} />
        {beak ? mouth : <path d="M46 55 q4 4 8 0" {...stroke} />}
      </g>
    );
  }
  if (face === 'SURPRISE') {
    return (
      <g>
        <circle cx="40" cy="45" r="4.4" fill={eye} />
        <circle cx="60" cy="45" r="4.4" fill={eye} />
        <circle cx="41.6" cy="43.4" r="1.5" fill={WHITE} />
        <circle cx="61.6" cy="43.4" r="1.5" fill={WHITE} />
        {beak ? mouth : <ellipse cx="50" cy="57" rx="3.2" ry="4.2" fill={eye} />}
      </g>
    );
  }
  if (face === 'COOL') {
    return (
      <g>
        <path d="M35.5 45.5 h9" {...stroke} />
        <path d="M55.5 45.5 h9" {...stroke} />
        {beak ? mouth : <path d="M45 56 q5 2 10 -1" {...stroke} />}
      </g>
    );
  }
  return (
    <g>
      <ellipse cx="40" cy="45" rx="3.2" ry="3.8" fill={eye} />
      <ellipse cx="60" cy="45" rx="3.2" ry="3.8" fill={eye} />
      {mouth}
    </g>
  );
}

/* ── 머리 장식 ───────────────────────────────────────────────────────────── */

function HeadPiece({ id, color, accent }) {
  if (id === 'DAENGGI') {
    return (
      <g fill={color}>
        <path d="M50 21 q-9 -7 -11 1 q9 5 11 -1 Z" />
        <path d="M50 21 q9 -7 11 1 q-9 5 -11 -1 Z" />
        <circle cx="50" cy="21.5" r="3" />
      </g>
    );
  }
  if (id === 'FLOWER') {
    return (
      <g>
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse
            key={deg}
            cx="50"
            cy="14.5"
            rx="4"
            ry="5"
            fill={color}
            transform={`rotate(${deg} 50 20)`}
          />
        ))}
        <circle cx="50" cy="20" r="3.2" fill={accent} />
      </g>
    );
  }
  if (id === 'BEADS') {
    return (
      <g fill={color}>
        <circle cx="41" cy="21" r="3.2" />
        <circle cx="50" cy="17.5" r="3.6" />
        <circle cx="59" cy="21" r="3.2" />
        <circle cx="50" cy="17.5" r="1.4" fill={accent} />
      </g>
    );
  }
  if (id === 'JOKDURI') {
    return (
      <g>
        <path d="M39 25 L42 12 L58 12 L61 25 Z" fill={color} />
        <circle cx="46" cy="17" r="1.8" fill={accent} />
        <circle cx="54" cy="17" r="1.8" fill={accent} />
        <circle cx="50" cy="13.5" r="2.2" fill={accent} />
      </g>
    );
  }
  if (id === 'GAT') {
    return (
      <g>
        <ellipse cx="50" cy="24" rx="26" ry="6" fill={color} />
        <path d="M39 24 L40.5 8 h19 L61 24 Z" fill={color} />
        <rect x="39.5" y="19" width="21" height="3" fill={accent} />
      </g>
    );
  }
  return null;
}

/* ── 캐릭터 ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} props
 * @param {object} props.appearance 파츠 id 조합 (없으면 기본 캐릭터)
 * @param {number} [props.size] 한 변 픽셀
 * @param {'circle' | 'square'} [props.shape]
 * @param {string} [props.className]
 */
export function Avatar({ appearance, size = 40, shape = 'circle', className = '' }) {
  const uid = useId();
  const clipId = `cb-head-${uid}`;
  const clip = `url(#${clipId})`;

  const look = normalizeAppearance(appearance);
  const base = findPart('base', look.base);
  const hanbok = findPart('hanbok', look.hanbok);
  const head = findPart('head', look.head);
  const bg = findPart('bg', look.bg);

  const viewBox = shape === 'circle' ? '14 0 72 72' : '0 0 100 100';
  const behindEye = base.mark === 'MASK' ? '#453f3a' : base.fur;
  const eye = isDark(behindEye) ? WHITE : INK;

  return (
    <span
      className={`avatar avatar--${shape} ${className}`}
      style={{ width: size, height: size, background: bg.color }}
    >
      <svg viewBox={viewBox} width={size} height={size} role="img" aria-label="캐릭터">
        <defs>
          <clipPath id={clipId}>
            <ellipse cx="50" cy="46" rx="26" ry="24" />
          </clipPath>
        </defs>

        {/* 저고리 */}
        <path d="M15 100 C15 78 30 67 50 67 C70 67 85 78 85 100 Z" fill={hanbok.jeogori} />
        {/* 깃(동정) */}
        <path d="M37 68 L50 84 L63 68 L57.5 66 L50 76 L42.5 66 Z" fill={WHITE} />
        {/* 고름 */}
        <g fill={hanbok.goreum}>
          <circle cx="55" cy="82" r="3.4" />
          <path d="M55.5 85 q5 7 3.5 14 l-4 -0.6 q0.8 -7.5 -2.5 -11.4 Z" />
          <path d="M53 85 q-2.5 6.5 -4.5 11.5 l4 1.2 q2 -6 3.2 -11.5 Z" />
        </g>

        <Ears ear={base.ear} fur={base.fur} inner={base.inner} />

        {/* 얼굴 */}
        <ellipse cx="50" cy="46" rx="26" ry="24" fill={base.fur} />
        <Marks mark={base.mark} clip={clip} />
        <Face face={look.face} eye={eye} beak={base.ear === 'BIRD'} />

        <HeadPiece id={head.id} color={head.color} accent={head.accent} />
      </svg>
    </span>
  );
}
