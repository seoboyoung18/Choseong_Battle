/**
 * 2벌식 한글 조합 오토마타.
 *
 * 자모를 하나씩 받아 완성형 글자를 만들어 나간다. 브라우저 IME를 쓰지 않고
 * 직접 구현하는 이유는, 게임 화면에서 자체 키보드를 띄우고 입력을 완전히
 * 통제해야 하기 때문이다 (한글 외 문자 차단 — FR-J3).
 *
 * 다뤄야 하는 규칙 네 가지
 *   복합모음   ㅗ + ㅏ → ㅘ
 *   복합종성   ㄹ + ㄱ → ㄺ
 *   도깨비불   각 + ㅏ → 가가   (종성이 다음 글자 초성으로 넘어간다)
 *              값 + ㅣ → 갑시   (겹종성은 뒤쪽만 넘어간다)
 *   되돌리기   백스페이스는 글자가 아니라 자모 하나씩 지운다
 */

const BASE = 0xac00;

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ',
  'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ',
  'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 모음 두 개가 합쳐지는 조합 */
const JUNG_COMPOUND = new Map([
  ['ㅗㅏ', 'ㅘ'], ['ㅗㅐ', 'ㅙ'], ['ㅗㅣ', 'ㅚ'],
  ['ㅜㅓ', 'ㅝ'], ['ㅜㅔ', 'ㅞ'], ['ㅜㅣ', 'ㅟ'],
  ['ㅡㅣ', 'ㅢ'],
]);

/** 받침 두 개가 합쳐지는 조합 */
const JONG_COMPOUND = new Map([
  ['ㄱㅅ', 'ㄳ'],
  ['ㄴㅈ', 'ㄵ'], ['ㄴㅎ', 'ㄶ'],
  ['ㄹㄱ', 'ㄺ'], ['ㄹㅁ', 'ㄻ'], ['ㄹㅂ', 'ㄼ'], ['ㄹㅅ', 'ㄽ'],
  ['ㄹㅌ', 'ㄾ'], ['ㄹㅍ', 'ㄿ'], ['ㄹㅎ', 'ㅀ'],
  ['ㅂㅅ', 'ㅄ'],
]);

/** 겹자모를 되돌릴 때 쓰는 역방향 표 */
const SPLIT = new Map();
for (const [pair, merged] of [...JUNG_COMPOUND, ...JONG_COMPOUND]) {
  SPLIT.set(merged, [pair[0], pair[1]]);
}

const isCho = (ch) => CHO.includes(ch);
const isJung = (ch) => JUNG.includes(ch);
const isJong = (ch) => JONG.includes(ch) && ch !== '';

/** 자음인지 (초성이 될 수 있으면 자음이다) */
export const isConsonant = (ch) => isCho(ch);
/** 모음인지 */
export const isVowel = (ch) => isJung(ch);

/**
 * 조합 중인 글자를 화면에 보일 문자열로 만든다.
 * 아직 완성형이 못 되는 중간 상태(초성만·모음만)는 자모 그대로 보여준다.
 * @param {{ cho: string, jung: string, jong: string }} syl
 * @returns {string}
 */
function render(syl) {
  const { cho, jung, jong } = syl;
  if (cho && jung) {
    const code = BASE + (CHO.indexOf(cho) * JUNG.length + JUNG.indexOf(jung)) * JONG.length + JONG.indexOf(jong);
    return String.fromCharCode(code);
  }
  return `${cho}${jung}${jong}`;
}

const emptySyllable = () => ({ cho: '', jung: '', jong: '' });
const isEmpty = (syl) => !syl.cho && !syl.jung && !syl.jong;

/**
 * 한글 조합기.
 *
 * 확정된 앞부분(committed)과 조합 중인 마지막 글자(current)를 나눠 들고 있다.
 * 화면에 보이는 값은 언제나 `committed + render(current)`다.
 */
export class HangulComposer {
  constructor(initial = '') {
    this.committed = initial;
    this.current = emptySyllable();
  }

  /** 지금까지 입력된 전체 문자열 */
  get value() {
    return this.committed + (isEmpty(this.current) ? '' : render(this.current));
  }

  /** 글자 수 — 조합 중인 글자도 한 글자로 센다 */
  get length() {
    return [...this.value].length;
  }

  reset() {
    this.committed = '';
    this.current = emptySyllable();
    return this;
  }

  /** 조합 중인 글자를 확정하고 빈 상태로 만든다 */
  #flush() {
    if (!isEmpty(this.current)) this.committed += render(this.current);
    this.current = emptySyllable();
  }

  /**
   * 자모 하나를 입력한다.
   * @param {string} jamo 자음 또는 모음 낱글자
   * @returns {this}
   */
  insert(jamo) {
    if (isVowel(jamo)) return this.#insertVowel(jamo);
    if (isConsonant(jamo)) return this.#insertConsonant(jamo);
    return this; // 한글 자모가 아니면 무시한다 (FR-J3)
  }

  #insertConsonant(jamo) {
    const cur = this.current;

    // 빈 상태이거나 모음만 있으면 새 글자의 초성으로 시작한다
    if (isEmpty(cur)) {
      this.current = { ...emptySyllable(), cho: jamo };
      return this;
    }
    if (!cur.cho) {
      this.#flush();
      this.current = { ...emptySyllable(), cho: jamo };
      return this;
    }

    // 초성만 있는데 자음이 또 왔다 — 앞 자음을 확정하고 새로 시작 (ㄱ ㄱ → "ㄱㄱ")
    if (!cur.jung) {
      this.#flush();
      this.current = { ...emptySyllable(), cho: jamo };
      return this;
    }

    // 받침이 비었으면 받침으로 붙인다
    if (!cur.jong) {
      if (isJong(jamo)) {
        cur.jong = jamo;
        return this;
      }
      this.#flush();
      this.current = { ...emptySyllable(), cho: jamo };
      return this;
    }

    // 받침이 있으면 겹받침을 시도하고, 안 되면 새 글자로 넘어간다
    const compound = JONG_COMPOUND.get(cur.jong + jamo);
    if (compound) {
      cur.jong = compound;
      return this;
    }
    this.#flush();
    this.current = { ...emptySyllable(), cho: jamo };
    return this;
  }

  #insertVowel(jamo) {
    const cur = this.current;

    if (isEmpty(cur)) {
      this.current = { ...emptySyllable(), jung: jamo };
      return this;
    }

    // 초성만 있으면 중성을 채워 글자를 완성한다
    if (cur.cho && !cur.jung) {
      cur.jung = jamo;
      return this;
    }

    // 받침이 없으면 복합모음을 시도한다
    if (!cur.jong) {
      const compound = JUNG_COMPOUND.get(cur.jung + jamo);
      if (compound) {
        cur.jung = compound;
        return this;
      }
      this.#flush();
      this.current = { ...emptySyllable(), jung: jamo };
      return this;
    }

    // ── 도깨비불 ──
    // 받침이 있는데 모음이 왔다. 받침이 다음 글자의 초성으로 넘어간다.
    // 겹받침이면 뒤쪽 하나만 넘어가고 앞쪽은 받침으로 남는다 (값 + ㅣ → 갑시).
    const split = SPLIT.get(cur.jong);
    const moving = split ? split[1] : cur.jong;
    cur.jong = split ? split[0] : '';

    this.#flush();
    this.current = { ...emptySyllable(), cho: moving, jung: jamo };
    return this;
  }

  /**
   * 자모 하나를 지운다. 완성된 글자도 자모 단위로 풀어서 지운다.
   * @returns {this}
   */
  backspace() {
    const cur = this.current;

    if (!isEmpty(cur)) {
      if (cur.jong) {
        const split = SPLIT.get(cur.jong);
        cur.jong = split ? split[0] : '';
      } else if (cur.jung) {
        const split = SPLIT.get(cur.jung);
        cur.jung = split ? split[0] : '';
      } else {
        cur.cho = '';
      }
      return this;
    }

    // 조합 중인 글자가 없으면 확정된 마지막 글자를 꺼내 조합 상태로 되돌린 뒤 지운다
    const chars = [...this.committed];
    const last = chars.pop();
    if (last === undefined) return this;

    this.committed = chars.join('');
    this.current = decompose(last);
    return this.backspace();
  }

  /** 확정된 부분까지 포함해 전부 비운다 */
  clear() {
    return this.reset();
  }
}

/**
 * 완성형 글자를 조합 상태로 되돌린다. 완성형이 아니면 그 글자를 그대로 담는다.
 * @param {string} ch
 * @returns {{ cho: string, jung: string, jong: string }}
 */
function decompose(ch) {
  const code = ch.charCodeAt(0);
  if (code < BASE || code > 0xd7a3) {
    if (isVowel(ch)) return { ...emptySyllable(), jung: ch };
    return { ...emptySyllable(), cho: isConsonant(ch) ? ch : '' };
  }
  const offset = code - BASE;
  return {
    cho: CHO[Math.floor(offset / (JUNG.length * JONG.length))],
    jung: JUNG[Math.floor(offset / JONG.length) % JUNG.length],
    jong: JONG[offset % JONG.length],
  };
}

/**
 * 전부 완성형 글자로 끝났는지 본다.
 *
 * 조합이 덜 끝난 상태('감ㅈ')를 서버로 보내면 NOT_HANGUL로 되돌아온다.
 * 선착순 게임에서 그 왕복은 그대로 손해라 제출 전에 걸러낸다 (FR-J3).
 *
 * @param {string} text
 * @returns {boolean} 빈 문자열은 false
 */
export function isComplete(text) {
  if (!text) return false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < BASE || code > 0xd7a3) return false;
  }
  return true;
}

/**
 * 자모 배열을 한 번에 조합한다. 테스트·초기값 세팅용.
 * @param {string[] | string} jamos
 * @returns {string}
 */
export function compose(jamos) {
  const composer = new HangulComposer();
  for (const jamo of typeof jamos === 'string' ? [...jamos] : jamos) composer.insert(jamo);
  return composer.value;
}
