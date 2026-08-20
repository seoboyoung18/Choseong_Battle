/**
 * 단어 등록 요청 (FR-W1).
 *
 * 사전에 없다고 거절당한 직후에만 뜬다 — 억울한 그 순간이 신고를 받기에 가장
 * 좋은 자리이고, 그때가 아니면 유저는 어떤 낱말이 막혔는지 다시 떠올리지 못한다.
 *
 * 패턴·글자수가 틀려서 거절된 경우에는 뜨지 않는다. 그건 사전 잘못이 아니다.
 */

import './ReportWord.css';

/**
 * @param {object} props
 * @param {{ word: string, done: boolean } | null} props.report
 * @param {(word: string) => void} props.onReport
 */
export function ReportWord({ report, onReport }) {
  if (!report) return null;

  if (report.done) {
    return (
      <p className="report report--done">
        <strong>{report.word}</strong> 접수했어요 · 검토 후 사전에 넣을게요
      </p>
    );
  }

  return (
    <button type="button" className="report" onClick={() => onReport(report.word)}>
      <strong>{report.word}</strong>, 실제로 쓰는 말인가요? 등록 요청
    </button>
  );
}
