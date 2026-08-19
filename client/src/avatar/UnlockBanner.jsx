/**
 * 새로 열린 파츠 알림.
 *
 * 게임 결과·연습 결과 양쪽에서 쓴다. 파츠를 이름으로만 알려주면 뭐가 열렸는지
 * 와닿지 않아서, 지금 내 캐릭터에 그 파츠만 입힌 모습을 그려 보여준다.
 */

import { Avatar } from './Avatar.jsx';
import './UnlockBanner.css';

/**
 * @param {object} props
 * @param {Array<{ slot: string, id: string, label: string }>} props.parts
 * @param {object} props.appearance 지금 내 캐릭터 — 여기에 새 파츠만 얹어 그린다
 */
export function UnlockBanner({ parts, appearance }) {
  if (!parts?.length) return null;

  return (
    <section className="card unlock">
      <strong className="unlock__title">
        🎉 새 파츠 {parts.length}개가 열렸어요
      </strong>

      <div className="unlock__list">
        {parts.map((part) => (
          <div key={`${part.slot}:${part.id}`} className="unlock__item">
            <Avatar appearance={{ ...appearance, [part.slot]: part.id }} size={56} shape="square" />
            <span className="unlock__name">{part.label}</span>
          </div>
        ))}
      </div>

      <p className="muted unlock__hint">마이페이지에서 꾸며보세요</p>
    </section>
  );
}
