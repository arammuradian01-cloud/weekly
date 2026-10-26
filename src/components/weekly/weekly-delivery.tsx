// Кому уходит weekly (этап 73а, правки ревью): руководители команд, которые ждут weekly человека. Честно: weekly видят
// и руководители выше, и участники команды по общим правам ленты, поэтому это сказано отдельной строкой.

export type WeeklyReader = { team: string; leader: string | null; inactive?: boolean };

export function WeeklyDelivery({ readers }: { readers: WeeklyReader[]; submitted?: boolean }) {
  return (
    <section className="sv-card sv-card--soft p-4" aria-labelledby="weekly-delivery-title" data-testid="weekly-delivery">
      <h3 id="weekly-delivery-title" className="text-body font-semibold">
        Кому вы сдаёте
      </h3>
      {readers.length ? (
        <>
          <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-small">
            {readers.map((r) => (
              <li key={r.team} className="break-words">
                {r.leader ? `${r.leader}${r.inactive ? " (выключен)" : ""}` : "Руководитель не назначен"}, команда «{r.team}»
              </li>
            ))}
          </ul>
          <p className="mt-2 text-small text-muted">Ваш weekly также видят руководители выше и участники команды в ленте weekly.</p>
        </>
      ) : (
        <p className="mt-2 text-small text-muted">Руководитель не определён: проверьте состав команды и её руководителя в разделе «Люди». Сданный weekly виден в ленте команды.</p>
      )}
    </section>
  );
}
