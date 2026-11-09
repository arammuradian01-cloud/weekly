import type { Person } from "@/domain/types";
export const PEOPLE_FIXTURE: Person[] = [
  { slug: "muradyan", fullName: "Мурадян Арам", shortName: "Арам", role: "OWNER", zone: "Департамент целиком", direction: "department" },
  { slug: "golovkin", fullName: "Головкин Владислав", shortName: "Влад", role: "ADMIN", zone: "Департамент, ОСАГО", direction: "osago" },
  { slug: "reva", fullName: "Рева Тарас", shortName: "Тарас", role: "LEADER", zone: "Продукт и CJM по всем линиям", direction: "product" },
  { slug: "loginova", fullName: "Логинова Светлана", shortName: "Света", role: "LEADER", zone: "RED: ДВС, ипотека, ВЗР, ИФЛ", direction: "red" },
  { slug: "fatyanov", fullName: "Фатьянов Евгений", shortName: "Евгений Ф.", role: "LEADER", zone: "КАСКО", direction: "kasko" },
  { slug: "sakhibullina", fullName: "Сахибуллина Алсу", shortName: "Алсу", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "afanasyev", fullName: "Афанасьев Павел", shortName: "Павел", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "cheychenets", fullName: "Чейченец Евгений", shortName: "Евгений Ч.", role: "LEADER", zone: "Депозиты и инвестиции", direction: "deposits" },
];
