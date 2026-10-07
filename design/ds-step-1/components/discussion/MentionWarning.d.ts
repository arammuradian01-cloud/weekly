import * as React from 'react';

/**
 * Предупреждение автору: «Упоминание не дошло: Никита Т. не видит эту задачу». names: массив имён, subject: «эту задачу» или «эту запись».
 * @startingPoint section="Компоненты Сравни" subtitle="Предупреждение автору: «Упоминание не дошло: Никита Т. не видит эту задачу». nam" viewport="700x400"
 */
export interface MentionWarningProps {
  /** names */
  names?: any[];
  /** subject */
  subject?: string;
  /** hint */
  hint?: string;
}
export function MentionWarning(props: MentionWarningProps): React.ReactElement | null;

