/**
 * 판정용 사전 · 출제 풀.
 *
 * 서버 기동 시 words 테이블을 통째로 메모리에 올린다. 제출은 초당 수십 건이
 * 몰리고 p95 150ms 안에 답해야 하므로(NFR-1), 판정 경로에 DB 왕복을 두지 않는다.
 *
 *   판정용 — status='ACTIVE'인 전체. Set이라 조회 O(1)
 *   출제용 — 그중 is_curated=true인 부분집합. 길이별로 미리 갈라둔다
 */

import { choSequence, jungSequence } from '../judge/hangul.js';

export class Dictionary {
  /** @type {Set<string>} 판정용 — 등재 여부만 본다 */
  #words = new Set();

  /** @type {Map<number, string[]>} 출제용 — 글자 수 → 단어 배열 */
  #curatedByLength = new Map();

  /**
   * @param {Array<{ text: string, is_curated: boolean }>} rows words 테이블 행
   */
  constructor(rows = []) {
    for (const row of rows) this.add(row.text, row.is_curated);
  }

  /**
   * 단어를 사전에 넣는다.
   * @param {string} text
   * @param {boolean} [isCurated] true면 출제 풀에도 들어간다
   */
  add(text, isCurated = false) {
    if (this.#words.has(text)) return;
    this.#words.add(text);
    if (!isCurated) return;

    const bucket = this.#curatedByLength.get(text.length);
    if (bucket) bucket.push(text);
    else this.#curatedByLength.set(text.length, [text]);
  }

  /**
   * 판정용 사전 등재 여부. 제출 판정의 마지막 관문이다.
   * @param {string} word
   * @returns {boolean}
   */
  has(word) {
    return this.#words.has(word);
  }

  /** 판정용 사전 크기 */
  get size() {
    return this.#words.size;
  }

  /** 출제 풀 크기 */
  get curatedSize() {
    let total = 0;
    for (const bucket of this.#curatedByLength.values()) total += bucket.length;
    return total;
  }

  /**
   * 출제할 단어를 하나 뽑는다.
   *
   * 후보를 전부 모아 셔플하지 않고 무작위 인덱스를 몇 번 찔러본 뒤,
   * 계속 제외 목록에 걸리면 그때만 전수 필터링으로 넘어간다. 제외 목록이
   * 후보에 비해 작은 보통 상황에서 할당 없이 끝난다.
   *
   * @param {object} params
   * @param {{ min: number, max: number }} params.lengthRange 출제 가능 글자 수
   * @param {Set<string>} [params.exclude] 최근 출제되어 제외할 단어
   * @param {() => number} [params.rng] 난수 생성기
   * @returns {string | null} 뽑을 단어가 없으면 null
   */
  pickWord({ lengthRange, exclude = new Set(), rng = Math.random }) {
    const candidates = [];
    for (let len = lengthRange.min; len <= lengthRange.max; len += 1) {
      const bucket = this.#curatedByLength.get(len);
      if (bucket?.length) candidates.push(bucket);
    }
    if (candidates.length === 0) return null;

    const total = candidates.reduce((sum, bucket) => sum + bucket.length, 0);

    const at = (index) => {
      let i = index;
      for (const bucket of candidates) {
        if (i < bucket.length) return bucket[i];
        i -= bucket.length;
      }
      return null; // 도달하지 않는다
    };

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const word = at(Math.floor(rng() * total));
      if (word && !exclude.has(word)) return word;
    }

    // 제외 목록이 후보를 거의 다 덮은 상황 — 남은 것을 전부 훑는다
    const remaining = candidates.flat().filter((w) => !exclude.has(w));
    if (remaining.length === 0) return null;
    return remaining[Math.floor(rng() * remaining.length)];
  }
}

/**
 * words 테이블에서 사전을 적재한다.
 * @param {{ query: (text: string) => Promise<{ rows: any[] }> }} db
 * @returns {Promise<Dictionary>}
 */
export async function loadDictionary(db) {
  const { rows } = await db.query(
    `SELECT text, is_curated FROM words WHERE status = 'ACTIVE'`,
  );
  const dictionary = new Dictionary(rows);
  console.log(
    `[dict] 판정용 ${dictionary.size}개 · 출제용 ${dictionary.curatedSize}개 적재`,
  );
  return dictionary;
}

/**
 * 시드·임포트에서 쓰는 행 변환기. 초성열·중성열을 미리 계산해 둔다.
 * @param {string} text
 * @param {{ isCurated?: boolean, source?: string, difficulty?: number }} [opts]
 */
export function toWordRow(text, { isCurated = false, source = 'STD', difficulty = 2 } = {}) {
  return {
    text,
    length: text.length,
    cho: choSequence(text),
    jung: jungSequence(text),
    is_curated: isCurated,
    difficulty,
    source,
  };
}
