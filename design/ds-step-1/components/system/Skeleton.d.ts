import * as React from 'react';

/**
 * Скелетоны загрузки: строка (SkeletonRow), карточка (SkeletonCard), текст (Skeleton). Движение отключается при уменьшении движения.
 * @startingPoint section="Компоненты Сравни" subtitle="Скелетоны загрузки: строка (SkeletonRow), карточка (SkeletonCard), текст (Skelet" viewport="700x400"
 */
export interface SkeletonProps {
  /** circle */
  circle?: any;
  /** block */
  block?: boolean;
  /** width */
  width?: number;
  /** height */
  height?: number;
  /** style */
  style?: React.CSSProperties;
}
export function Skeleton(props: SkeletonProps): React.ReactElement | null;

/** Скелетоны загрузки: строка (SkeletonRow), карточка (SkeletonCard), текст (Skeleton). Движение отключается при уменьшении движения. */
export interface SkeletonRowProps {
  /** w1 */
  w1?: any;
  /** w2 */
  w2?: any;
}
export function SkeletonRow(props: SkeletonRowProps): React.ReactElement | null;

/** Скелетоны загрузки: строка (SkeletonRow), карточка (SkeletonCard), текст (Skeleton). Движение отключается при уменьшении движения. */
export interface SkeletonCardProps {
  /** style */
  style?: React.CSSProperties;
}
export function SkeletonCard(props: SkeletonCardProps): React.ReactElement | null;

