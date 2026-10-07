import React from 'react';
import { Tag } from '../core/Tag.jsx';

/* Метка «Наверх» у записи weekly: отмеченная руководителем запись попадает в его черновик weekly уровнем выше. by: кто отметил. */
export function UpBadge(props) {
  return <Tag kind="up" className={props.className}>{props.by ? 'Наверх, ' + props.by : 'Наверх'}</Tag>;
}
