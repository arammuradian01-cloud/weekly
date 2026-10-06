export function PageHeader({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-page font-semibold leading-tight text-ink sm:text-page-lg">{title}</h1>
        {description ? <p className="mt-1.5 text-body text-muted">{description}</p> : null}
      </div>
      {children}
    </header>
  );
}
