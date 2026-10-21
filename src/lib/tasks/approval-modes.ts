// Режимы согласования задач (этап 54) без обращения к базе: их читают и экраны в браузере.

export type ApprovalMode = "off" | "inform" | "approve";
export const APPROVAL_MODES: ApprovalMode[] = ["off", "inform", "approve"];
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  off: "Без согласования",
  inform: "Информировать руководителя",
  approve: "Согласование руководителем",
};
export const APPROVAL_KEY = "tasks.crossDepartment";

/** Настройка: правило по умолчанию и правила департаментов по id подразделения */
export type ApprovalSetting = { default: ApprovalMode; departments: Record<string, ApprovalMode> };
/** По умолчанию информирование: руководитель знает о задачах своих людей, а работа не встаёт до первой настройки */
export const DEFAULT_APPROVAL: ApprovalSetting = { default: "inform", departments: {} };

const isMode = (v: unknown): v is ApprovalMode => typeof v === "string" && (APPROVAL_MODES as string[]).includes(v);

export function approvalSettingOf(value: unknown): ApprovalSetting {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const departments: Record<string, ApprovalMode> = {};
  const deps = raw.departments && typeof raw.departments === "object" ? (raw.departments as Record<string, unknown>) : {};
  for (const [id, mode] of Object.entries(deps)) if (isMode(mode)) departments[id] = mode;
  return { default: isMode(raw.default) ? raw.default : DEFAULT_APPROVAL.default, departments };
}

