// Выгрузка Insurance&Invest Bord, из которой импортированы задачи на этапе 3.
// Таблица считала «Статус просроченности» на 04.10.2026: так получаются её «Просрочена на N дн.»
export const BORD_DEFAULT = {
  file: "data/bord/zadachi-2026-10-05.csv",
  batch: "bord-2026-10-05",
  overdueAsOf: "2026-10-04",
};
