// Кто получит weekly (этап 73а, PR #84 Codex): руководители команд, в чью ленту попадает личный weekly. Этап 73+81:
// сданный weekly читают в разделе «Отчёт руководителю», вкладка «Полученные».

export type WeeklyReader = { team: string; leader: string | null };

export function WeeklyDelivery({ readers, submitted }: { readers: WeeklyReader[]; submitted: boolean }) {
  return (
    <section className="sv-card sv-card--soft p-4" aria-label="Кто получит weekly" data-testid="weekly-delivery">
      <h3 className="text-body font-semibold">{submitted ? "Кто читает ваш weekly" : "Кто получит weekly"}</h3>
      {readers.length ? (
        <>
          <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-small">
            {readers.map((r) => (
              <li key={r.team} className="break-words">
                {r.leader ?? "Руководитель не назначен"} - {r.team}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-small text-muted">
            {submitted ? "Сданный weekly доступен" : "После сдачи weekly появится"} у руководителя в разделе «Отчёт руководителю», вкладка «Полученные». Отправка в приложении, без письма.
          </p>
        </>
      ) : (
        <p className="mt-2 text-small text-muted">
          Получатель не определён: проверьте состав команды и её руководителя в разделе «Люди». Сданный weekly остаётся виден в ленте по действующим правам.
        </p>
      )}
    </section>
  );
}
