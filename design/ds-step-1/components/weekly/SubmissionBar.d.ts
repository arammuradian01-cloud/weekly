import * as React from 'react';

/**
 * Полоса сдачи «кто сдал»: сдали 7 из 8, аватары со статусами. people: [{ name, status: submitted | draft | none | late | vacation }].
 * @startingPoint section="Компоненты Сравни" subtitle="Полоса сдачи «кто сдал»: сдали 7 из 8, аватары со статусами. people: [{ name, st" viewport="700x400"
 */
export interface SubmissionBarProps {
  /** people */
  people?: any[];
  /** style */
  style?: React.CSSProperties;
  /** deadline */
  deadline?: string;
  /** size */
  size?: number | string | any;
}
export function SubmissionBar(props: SubmissionBarProps): React.ReactElement | null;

