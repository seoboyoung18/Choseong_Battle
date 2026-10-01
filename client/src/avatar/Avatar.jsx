/**
 * 캐릭터 렌더러 — 파츠 id 조합을 SVG로 그린다.
 *
 * 그림 파일을 쓰지 않는 이유: 아직 일러스트가 없고, 조합이 798억 가지라 미리
 * 그려둘 수도 없다. 색은 카탈로그(shared/avatar.js)가 들고 있고 여기는 형태만
 * 안다. 나중에 진짜 일러스트가 나오면 이 파일만 갈아끼우면 되고, 저장된 조합은
 * 그대로 산다.
 *
 * 좌표계는 100×100. 얼굴 중심 (50, 46), 눈 (40·60, 42), 목선 y≈70, 어깨 위쪽 y=68.
 * 겹치는 순서는 저고리 → 무늬 → 깃·고름 → 귀 → 얼굴 → 표정 → 안경 → 목장식 → 머리다.
 *
 * 동그란 액자는 얼굴만 잘라 확대한다. 22~32px짜리 자리에서 전신을 다 넣으면
 * 얼굴이 몇 픽셀밖에 안 남아 누가 누군지 구분되지 않는다.
 */

import { useId } from 'react';

import { TINT_TARGET, findPart, normalizeAppearance, tintHex } from '../../../shared/avatar.js';
import './Avatar.css';

const INK = '#3b2f27';
const WHITE = '#fffcf7';

/**
 * 외곽선. 색을 칠하기만 하면 밝은 털(토끼·고양이)이 밝은 배경에 묻혀 형태가
 * 사라진다. 잉크로 얇게 두르되 불투명도를 낮춰 선이 그림을 눌러 보이지 않게 한다.
 */
const LINE = { stroke: INK, strokeOpacity: 0.55, strokeWidth: 1.4, strokeLinejoin: 'round' };

/** 저고리 몸통 — 무늬를 이 모양으로 잘라야 옷 밖으로 새지 않는다 */
const BODY = 'M15 100 C15 78 30 67 50 67 C70 67 85 78 85 100 Z';

/** 밝기 — 눈·코 색을 뒤집거나 명암 세기를 정하는 데 쓴다 */
function luma(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 배경이 어두우면 눈을 흰색으로 뒤집는다 — 너구리 눈가·까치처럼 */
function isDark(hex) {
  return luma(hex) < 140;
}

/** 색을 어둡게 — 귀 안쪽 그늘, 털 명암에 쓴다 */
function shade(hex, amount = 0.12) {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.round(v * (1 - amount))))
    .map((v) => v.toString(16).padStart(2, '0'));
  return `#${ch.join('')}`;
}

/**
 * 색을 흰쪽으로 섞는다.
 *
 * 저고리 무늬는 어두운 천(먹빛)에도 밝은 천(미색)에도 보여야 한다. 어둡게만
 * 하면 먹빛에서 사라지므로, 밝은 천은 어둡게·어두운 천은 밝게 돌린다.
 */
function tint(hex, amount = 0.3) {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.min(255, Math.round(v + (255 - v) * amount)))
    .map((v) => v.toString(16).padStart(2, '0'));
  return `#${ch.join('')}`;
}

/** 천 위에 얹을 무늬 색 — 밝은 천이면 어둡게, 어두운 천이면 밝게 */
function contrastOn(hex) {
  return luma(hex) > 150 ? shade(hex, 0.3) : tint(hex, 0.52);
}

/**
 * 고른 색을 파츠에 입힌다.
 *
 * 한 칸(저고리·장식 본체·안경테)만 갈아끼우고 나머지 색은 파츠가 정한 대로 둔다.
 * 고름과 장식 포인트까지 같이 물들이면 열네 벌이 전부 한 덩어리 색이 되어,
 * 색을 열어준 보람이 사라진다.
 */
function recolor(slot, part, tint) {
  const hex = tintHex(tint?.[slot]);
  if (!hex) return part;
  return { ...part, [TINT_TARGET[slot]]: hex };
}

/* ── 저고리 무늬 ─────────────────────────────────────────────────────────── */

/**
 * 천 위에 얹는 무늬. 색만 다른 한복이 열넷 있으면 결국 다 같은 옷으로 보이므로,
 * 무늬로 결을 만든다. 저고리 바깥으로 삐져나오지 않게 몸통 모양으로 자른다.
 */
function Weave({ pattern, color, clip }) {
  if (!pattern || pattern === 'NONE') return null;
  const ink = contrastOn(color);

  if (pattern === 'STRIPE') {
    return (
      <g clipPath={clip} stroke={ink} strokeWidth="2.6" strokeOpacity="0.8" fill="none">
        {[22, 32, 42, 58, 68, 78].map((x) => (
          <path key={x} d={`M${x} 68 v34`} />
        ))}
      </g>
    );
  }
  if (pattern === 'DOT') {
    return (
      <g clipPath={clip} fill={ink} opacity="0.85">
        {[
          [24, 82], [38, 76], [52, 80], [66, 76], [78, 84],
          [20, 95], [33, 92], [47, 96], [61, 92], [74, 96],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.9" />
        ))}
      </g>
    );
  }
  // FLOWER — 꽃수. 네 장 꽃잎이면 작게 줄여도 꽃으로 읽힌다
  return (
    <g clipPath={clip} fill={ink} opacity="0.9">
      {[[27, 83], [40, 94], [63, 83], [76, 94]].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          {[0, 90, 180, 270].map((deg) => (
            <ellipse key={deg} cx={cx} cy={cy - 3} rx="2.1" ry="3.2" transform={`rotate(${deg} ${cx} ${cy})`} />
          ))}
          <circle cx={cx} cy={cy} r="1.6" fill={color} />
        </g>
      ))}
    </g>
  );
}

/* ── 귀 ──────────────────────────────────────────────────────────────────── */

function Ears({ ear, fur, inner }) {
  if (ear === 'LONG') {
    return (
      <g>
        <ellipse cx="38" cy="16" rx="7" ry="18" fill={fur} {...LINE} transform="rotate(-8 38 16)" />
        <ellipse cx="62" cy="16" rx="7" ry="18" fill={fur} {...LINE} transform="rotate(8 62 16)" />
        <ellipse cx="38" cy="17" rx="3.4" ry="12" fill={inner} transform="rotate(-8 38 17)" />
        <ellipse cx="62" cy="17" rx="3.4" ry="12" fill={inner} transform="rotate(8 62 17)" />
      </g>
    );
  }
  if (ear === 'POINT') {
    return (
      <g>
        <path d="M24 44 L30 15 L48 32 Z" fill={fur} {...LINE} />
        <path d="M76 44 L70 15 L52 32 Z" fill={fur} {...LINE} />
        <path d="M29.5 39 L32.5 24 L42 33 Z" fill={inner} />
        <path d="M70.5 39 L67.5 24 L58 33 Z" fill={inner} />
      </g>
    );
  }
  if (ear === 'TUFT') {
    return (
      <g>
        <ellipse cx="30" cy="24" rx="8" ry="12.5" fill={fur} {...LINE} transform="rotate(-25 30 24)" />
        <ellipse cx="70" cy="24" rx="8" ry="12.5" fill={fur} {...LINE} transform="rotate(25 70 24)" />
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
      <circle cx="27" cy="27" r="11" fill={fur} {...LINE} />
      <circle cx="73" cy="27" r="11" fill={fur} {...LINE} />
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

/* ── 코·주둥이·수염 ──────────────────────────────────────────────────────── */

/**
 * 얼굴 한가운데가 비어 있으면 아무리 색을 잘 골라도 허전하다. 주둥이(밝은 면) →
 * 코 → 수염 순으로 겹쳐 얼굴에 중심을 만든다.
 *
 * 부리가 있는 까치는 전부 건너뛴다 — 부리가 코와 입을 겸한다.
 */
function Snout({ nose, muzzle, whisker, fur, inner }) {
  if (nose === 'NONE') return null;

  // 주둥이는 털보다 밝게. 밝은 털(토끼)은 더 밝힐 수 없으니 안쪽 색을 옅게 쓴다.
  const pale = luma(fur) > 200 ? inner : WHITE;

  return (
    <g>
      {muzzle && <ellipse cx="50" cy="54" rx="12.5" ry="8.5" fill={pale} opacity="0.5" />}

      {whisker && (
        <g stroke={INK} strokeOpacity="0.3" strokeWidth="1.1" strokeLinecap="round" fill="none">
          <path d="M30 50 h8" />
          <path d="M30.5 54.5 h7.5" />
          <path d="M70 50 h-8" />
          <path d="M69.5 54.5 h-7.5" />
        </g>
      )}

      {nose === 'TRI' && <path d="M46.6 48.5 h6.8 L50 52.6 Z" fill={INK} />}
      {nose === 'ROUND' && <ellipse cx="50" cy="49.5" rx="4" ry="3.2" fill={INK} />}
      {nose === 'TINY' && <ellipse cx="50" cy="49.5" rx="2.6" ry="2.1" fill="#c9767e" />}
    </g>
  );
}

/* ── 표정 ────────────────────────────────────────────────────────────────── */

function Face({ face, eye, beak }) {
  const stroke = { fill: 'none', stroke: eye, strokeWidth: 2.6, strokeLinecap: 'round' };
  const mouth = beak ? (
    <path d="M50 48 L42.5 56 L57.5 56 Z" fill="#d9a036" />
  ) : (
    <path d="M43.5 57.5 q6.5 6 13 0" {...stroke} />
  );

  if (face === 'WINK') {
    return (
      <g>
        <ellipse cx="40" cy="42" rx="3.2" ry="3.8" fill={eye} />
        <circle cx="41.2" cy="40.6" r="1.2" fill={WHITE} opacity="0.9" />
        <path d="M56 43.5 q4 -5 8 0" {...stroke} />
        <ellipse cx="31" cy="52" rx="5" ry="3.2" fill="#e8a9a0" opacity="0.75" />
        <ellipse cx="69" cy="52" rx="5" ry="3.2" fill="#e8a9a0" opacity="0.75" />
        {mouth}
      </g>
    );
  }
  if (face === 'PROUD') {
    return (
      <g>
        <path d="M36 43.5 q4 -5 8 0" {...stroke} />
        <path d="M56 43.5 q4 -5 8 0" {...stroke} />
        {beak ? mouth : <path d="M45.5 57.5 q4.5 4 9 0" {...stroke} />}
      </g>
    );
  }
  if (face === 'SURPRISE') {
    return (
      <g>
        <circle cx="40" cy="42" r="4.4" fill={eye} />
        <circle cx="60" cy="42" r="4.4" fill={eye} />
        <circle cx="41.6" cy="40.4" r="1.5" fill={WHITE} />
        <circle cx="61.6" cy="40.4" r="1.5" fill={WHITE} />
        {beak ? mouth : <ellipse cx="50" cy="58.5" rx="3.2" ry="4.2" fill={eye} />}
      </g>
    );
  }
  if (face === 'COOL') {
    return (
      <g>
        <path d="M35.5 42.5 h9" {...stroke} />
        <path d="M55.5 42.5 h9" {...stroke} />
        {beak ? mouth : <path d="M44.5 58 q5.5 2 11 -1" {...stroke} />}
      </g>
    );
  }
  if (face === 'SLEEPY') {
    // 감은 눈은 아래로 휘어야 졸려 보인다. 위로 휘면 웃는 눈이 된다
    return (
      <g>
        <path d="M35.5 41 q4.5 5 9 0" {...stroke} />
        <path d="M55.5 41 q4.5 5 9 0" {...stroke} />
        {beak ? mouth : <ellipse cx="50" cy="58" rx="2.6" ry="3.4" fill={eye} opacity="0.85" />}
      </g>
    );
  }
  if (face === 'HEART') {
    const heart = 'M0 3.4 C-4.4 0 -4.4 -4.2 -2 -4.2 C-0.7 -4.2 0 -3.2 0 -2.4 C0 -3.2 0.7 -4.2 2 -4.2 C4.4 -4.2 4.4 0 0 3.4 Z';
    return (
      <g>
        <path d={heart} fill="#e0566b" transform="translate(40 42)" />
        <path d={heart} fill="#e0566b" transform="translate(60 42)" />
        {mouth}
      </g>
    );
  }
  return (
    <g>
      <ellipse cx="40" cy="42" rx="3.2" ry="3.8" fill={eye} />
      <ellipse cx="60" cy="42" rx="3.2" ry="3.8" fill={eye} />
      <circle cx="41.2" cy="40.6" r="1.2" fill={WHITE} opacity="0.9" />
      <circle cx="61.2" cy="40.6" r="1.2" fill={WHITE} opacity="0.9" />
      {mouth}
    </g>
  );
}

/* ── 안경 ────────────────────────────────────────────────────────────────── */

/**
 * 눈 중심 (40, 42)·(60, 42) 위에 겹친다.
 *
 * 알을 투명하게 두는 이유: 밑에 그려진 눈이 보여야 표정 파츠가 죽지 않는다.
 * 선글라스만 알을 채우고, 그때는 표정이 가려지는 걸 감수한다.
 */
function Glasses({ id, frame, lens }) {
  if (!id || id === 'NONE') return null;

  const bar = { stroke: frame, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' };
  const glass = lens ? { fill: lens, fillOpacity: 0.85 } : { fill: WHITE, fillOpacity: 0.22 };

  if (id === 'GOGGLE') {
    return (
      <g>
        <path d="M26 42 h-6" {...bar} strokeWidth="2.6" />
        <path d="M74 42 h6" {...bar} strokeWidth="2.6" />
        <rect x="29" y="34.5" width="42" height="15" rx="7.5" {...glass} stroke={frame} strokeWidth="2.4" />
        <path d="M50 34.5 v15" stroke={frame} strokeWidth="2" opacity="0.7" />
      </g>
    );
  }
  if (id === 'SQUARE') {
    return (
      <g>
        <rect x="31.5" y="36" width="17" height="12" rx="2.5" {...glass} stroke={frame} strokeWidth="2" />
        <rect x="51.5" y="36" width="17" height="12" rx="2.5" {...glass} stroke={frame} strokeWidth="2" />
        <path d="M48.5 41.5 h3" {...bar} />
        <path d="M31.5 39.5 l-6 -2" {...bar} />
        <path d="M68.5 39.5 l6 -2" {...bar} />
      </g>
    );
  }
  if (id === 'HALF') {
    // 반달(독서용) — 아래쪽 반원만 있어 눈이 테 위로 나온다
    return (
      <g>
        <path d="M32 41 h16 a8 8 0 0 1 -16 0 Z" {...glass} stroke={frame} strokeWidth="2" />
        <path d="M52 41 h16 a8 8 0 0 1 -16 0 Z" {...glass} stroke={frame} strokeWidth="2" />
        <path d="M48 41 h4" {...bar} />
        <path d="M32 41 l-6 -2.5" {...bar} />
        <path d="M68 41 l6 -2.5" {...bar} />
      </g>
    );
  }
  // ROUND·SUN — 같은 동그란 테, 알만 다르다
  return (
    <g>
      <circle cx="40" cy="42" r="8" {...glass} stroke={frame} strokeWidth="2" />
      <circle cx="60" cy="42" r="8" {...glass} stroke={frame} strokeWidth="2" />
      <path d="M48 42 h4" {...bar} />
      <path d="M32 40 l-6 -2.5" {...bar} />
      <path d="M68 40 l6 -2.5" {...bar} />
      {lens && <path d="M35.5 38 l4 -2" stroke={WHITE} strokeWidth="1.6" strokeOpacity="0.6" strokeLinecap="round" />}
    </g>
  );
}

/* ── 목장식 ──────────────────────────────────────────────────────────────── */

/**
 * 목선(y≈70)에 얹는다. 얼굴보다 뒤에 그리면 턱에 가려 거의 안 보이므로 앞에 둔다.
 *
 * 동그란 액자는 y=72까지만 보이니, 띠는 반드시 y 70 근처에서 시작해야 작은
 * 아바타에서도 흔적이 남는다.
 */
function NeckPiece({ id, color, accent }) {
  if (!id || id === 'NONE') return null;

  if (id === 'SCARF') {
    return (
      <g>
        <path d="M27 68 q23 11 46 0 q1.5 5 1.5 9 q-25 11 -49 0 q0 -4 1.5 -9 Z" fill={color} {...LINE} />
        <path d="M30 73 q20 8 40 0" stroke={shade(color, 0.25)} strokeWidth="1.4" fill="none" />
        <path d="M60 76 q7 9 5 19 l-7 -1 q2 -9 -2 -16 Z" fill={accent} {...LINE} />
      </g>
    );
  }
  if (id === 'NORIGAE') {
    // 고름(오른쪽)과 겹치지 않게 왼쪽 깃에 매단다
    return (
      <g>
        <path d="M38 68 q-2 4 -3 7" stroke={accent} strokeWidth="1.6" fill="none" />
        <circle cx="34.5" cy="78" r="4.2" fill={color} {...LINE} />
        <circle cx="33.2" cy="76.6" r="1.3" fill={WHITE} opacity="0.7" />
        <path d="M31 82 l7 0 l-1.5 11 l-4 0 Z" fill={accent} {...LINE} />
        <path d="M32.5 86 h4.5" stroke={shade(accent, 0.3)} strokeWidth="1.2" />
      </g>
    );
  }
  if (id === 'BEADS') {
    return (
      <g>
        <path d="M33 69 q17 14 34 0" stroke={shade(color, 0.3)} strokeWidth="1.3" fill="none" />
        {[[34.5, 72], [41, 78], [50, 80.5], [59, 78], [65.5, 72]].map(([cx, cy], i) => (
          <circle key={cx} cx={cx} cy={cy} r={i === 2 ? 3.6 : 2.8} fill={i === 2 ? accent : color} {...LINE} />
        ))}
      </g>
    );
  }
  if (id === 'BELL') {
    return (
      <g>
        <path d="M31 68 q19 12 38 0 q0 4 0 5 q-19 12 -38 0 q0 -1 0 -5 Z" fill={color} {...LINE} />
        <circle cx="50" cy="78" r="5" fill={accent} {...LINE} />
        <path d="M45.5 77.5 h9" stroke={shade(accent, 0.4)} strokeWidth="1.3" />
        <circle cx="50" cy="80.5" r="1.3" fill={shade(accent, 0.4)} />
      </g>
    );
  }
  // CAPE — 배자. 가운데를 비워 깃과 고름이 그대로 보이게 한다
  return (
    <g>
      <path d="M31 70 q-6 12 -5 30 h13 q-2 -16 3 -27 Z" fill={color} {...LINE} />
      <path d="M69 70 q6 12 5 30 h-13 q2 -16 -3 -27 Z" fill={color} {...LINE} />
      <path d="M27 92 h11" stroke={accent} strokeWidth="2" fill="none" />
      <path d="M73 92 h-11" stroke={accent} strokeWidth="2" fill="none" />
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
  if (id === 'BINYEO') {
    // 쪽(머리를 틀어 올린 매듭)에 비녀를 가로로 꽂는다
    return (
      <g>
        <ellipse cx="50" cy="19" rx="8.5" ry="6.5" fill={accent} {...LINE} />
        <path d="M34 21 L66 14" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="67" cy="13.5" r="3.2" fill={color} {...LINE} />
      </g>
    );
  }
  if (id === 'RIBBON') {
    return (
      <g>
        <path d="M49 19 q-11 -8 -12 1 q2 7 12 2 Z" fill={color} {...LINE} />
        <path d="M51 19 q11 -8 12 1 q-2 7 -12 2 Z" fill={color} {...LINE} />
        <path d="M47 24 q-3 7 -5 10" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M53 24 q3 7 5 10" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="50" cy="20" r="3" fill={accent} {...LINE} />
      </g>
    );
  }
  if (id === 'BOKGEON') {
    // 복건 — 뒤로 넘어가는 자락이 있어야 두건으로 읽힌다
    return (
      <g>
        <path d="M30 30 q4 -21 20 -21 q16 0 20 21 q-20 -7 -40 0 Z" fill={color} {...LINE} />
        <path d="M68 16 q10 3 9 14 l-7 -2 Z" fill={shade(color, 0.2)} {...LINE} />
        <path d="M31 27 q19 -6 38 0" stroke={accent} strokeWidth="2.2" fill="none" />
      </g>
    );
  }
  if (id === 'LEAF') {
    return (
      <g>
        <path d="M50 24 q-16 -5 -13 -17 q14 1 13 17 Z" fill={color} {...LINE} />
        <path d="M49 23 q-7 -5 -11 -14" stroke={shade(color, 0.3)} strokeWidth="1.2" fill="none" />
        <path d="M50 24 q4 -4 9 -4" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  if (id === 'HWAGWAN') {
    // 화관 — 꽃을 둥글게 둘러 쓴다
    return (
      <g>
        <path d="M33 25 q17 -13 34 0" stroke={accent} strokeWidth="2.4" fill="none" />
        {[[34, 24], [42, 17], [50, 14.5], [58, 17], [66, 24]].map(([cx, cy], i) => (
          <g key={cx}>
            {[0, 72, 144, 216, 288].map((deg) => (
              <ellipse
                key={deg}
                cx={cx}
                cy={cy - (i === 2 ? 3.6 : 3)}
                rx={i === 2 ? 2.4 : 2}
                ry={i === 2 ? 3.2 : 2.7}
                fill={color}
                transform={`rotate(${deg} ${cx} ${cy})`}
              />
            ))}
            <circle cx={cx} cy={cy} r={i === 2 ? 2 : 1.7} fill={accent} />
          </g>
        ))}
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
  const bodyClipId = `cb-body-${uid}`;
  const clip = `url(#${clipId})`;
  const bodyClip = `url(#${bodyClipId})`;

  const look = normalizeAppearance(appearance);
  const base = findPart('base', look.base);
  const hanbok = recolor('hanbok', findPart('hanbok', look.hanbok), look.tint);
  const head = recolor('head', findPart('head', look.head), look.tint);
  const glasses = recolor('glasses', findPart('glasses', look.glasses), look.tint);
  const neck = recolor('neck', findPart('neck', look.neck), look.tint);
  const bg = findPart('bg', look.bg);

  // 동그란 액자는 목장식이 들어오는 y≈84까지 담는다. 얼굴만 자르면 한복도
  // 목장식도 게임 중에는 영영 안 보인다. 얼굴이 액자 높이의 57%라 18px짜리
  // 자리에서도 누가 누군지는 남는다 — 더 내리면 그게 무너진다
  const viewBox = shape === 'circle' ? '8 0 84 84' : '0 0 100 100';
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
          <clipPath id={bodyClipId}>
            <path d={BODY} />
          </clipPath>
        </defs>

        {/* 저고리 — 어깨에서 소매로 떨어지는 선을 넣어 덩어리로 보이지 않게 한다 */}
        <path d={BODY} fill={hanbok.jeogori} {...LINE} />
        <Weave pattern={hanbok.pattern} color={hanbok.jeogori} clip={bodyClip} />
        <g stroke={shade(hanbok.jeogori, 0.3)} strokeWidth="1.3" fill="none" strokeLinecap="round">
          <path d="M28 76 q-3 12 -3 24" />
          <path d="M72 76 q3 12 3 24" />
        </g>
        {/* 깃(동정) */}
        <path d="M37 68 L50 84 L63 68 L57.5 66 L50 76 L42.5 66 Z" fill={WHITE} {...LINE} />
        {/* 고름 */}
        <g fill={hanbok.goreum}>
          <circle cx="55" cy="82" r="3.4" />
          <path d="M55.5 85 q5 7 3.5 14 l-4 -0.6 q0.8 -7.5 -2.5 -11.4 Z" />
          <path d="M53 85 q-2.5 6.5 -4.5 11.5 l4 1.2 q2 -6 3.2 -11.5 Z" />
        </g>

        <Ears ear={base.ear} fur={base.fur} inner={base.inner} />

        {/* 얼굴 */}
        <ellipse cx="50" cy="46" rx="26" ry="24" fill={base.fur} {...LINE} />
        {/* 턱 쪽 그늘 — 납작한 원이 아니라 부피가 있어 보이게 한다 */}
        <ellipse cx="50" cy="52" rx="25" ry="17" fill={shade(base.fur, 0.1)} opacity="0.45" clipPath={clip} />
        <Marks mark={base.mark} clip={clip} />
        <Snout
          nose={base.nose}
          muzzle={base.muzzle}
          whisker={base.whisker}
          fur={base.fur}
          inner={base.inner}
        />
        <Face face={look.face} eye={eye} beak={base.ear === 'BIRD'} />
        <Glasses id={glasses.id} frame={glasses.frame} lens={glasses.lens} />

        {/* 목장식은 턱 앞으로 와야 보인다 — 깃·고름보다 뒤에 그리는 이유 */}
        <NeckPiece id={neck.id} color={neck.color} accent={neck.accent} />
        <HeadPiece id={head.id} color={head.color} accent={head.accent} />
      </svg>
    </span>
  );
}
