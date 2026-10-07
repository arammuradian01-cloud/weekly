import * as React from 'react';

/**
 * Аватар с инициалами на спокойном круге. Цвет выбирается по имени, фотографий нет. size: xs 20, sm 24, md 32, lg 40, xl 56. status: точка weekly (success, warning, danger, neutral, accent). vacancy: пустой пунктирный круг.
 * @startingPoint section="Компоненты Сравни" subtitle="Аватар с инициалами на спокойном круге. Цвет выбирается по имени, фотографий нет" viewport="700x400"
 */
export interface AvatarProps {
  /** size */
  size?: number | string | any;
  /** tone */
  tone?: string;
  /** name */
  name?: string;
  /** vacancy */
  vacancy?: boolean;
  /** round */
  round?: boolean;
  /** className */
  className?: string;
  /** style */
  style?: React.CSSProperties;
  /** status */
  status?: string;
}
export function Avatar(props: AvatarProps): React.ReactElement | null;

