// Этап 71: владелец или администратор выбран по общему логину team. Режима управления у такого входа нет: вместо
// молчаливого ухода на главную страница объясняет почему и предлагает войти своим логином (выход из общего логина).

import { logout } from "@/app/actions/auth";
import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { MANAGEMENT_TEAM_REFUSAL } from "@/lib/roles";

export function TeamRefusal() {
  return (
    <div className="max-w-md">
      <PageHeader title="Режим управления" />
      <p role="alert" className="sv-alert sv-alert--warning" data-testid="management-team-refusal">
        {MANAGEMENT_TEAM_REFUSAL}
      </p>
      <form action={logout} className="mt-4">
        <button type="submit" className={buttonClass("secondary", "md", "max-sm:min-h-11")}>
          Войти своим логином
        </button>
      </form>
    </div>
  );
}
