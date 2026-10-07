import React from 'react';

/* Скелетоны загрузки: строка (SkeletonRow), карточка (SkeletonCard), текст (Skeleton). Движение отключается при уменьшении движения. */
export function Skeleton(props) {
  return <span className={['sv-skeleton', props.circle ? 'sv-skeleton--circle' : '', props.block ? 'sv-skeleton--block' : ''].filter(Boolean).join(' ')} style={Object.assign({ width: props.width || '60%', height: props.height || 12 }, props.style)} aria-hidden="true" />;
}
export function SkeletonRow(props) {
  return <div className="sv-skeleton-row" aria-hidden="true"><Skeleton circle width={32} height={32} /><span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton width={props.w1 || '55%'} /><Skeleton width={props.w2 || '35%'} height={8} /></span><Skeleton width={56} /></div>;
}
export function SkeletonCard(props) {
  return <div className="sv-skeleton-card" aria-hidden="true" style={props.style}><Skeleton width="30%" height={10} /><Skeleton width="80%" height={16} /><Skeleton width="100%" /><Skeleton width="65%" /><span style={{ display: 'flex', gap: 8, marginTop: 4 }}><Skeleton width={72} height={28} block /><Skeleton width={72} height={28} block /></span></div>;
}
