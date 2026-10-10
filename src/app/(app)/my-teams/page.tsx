import { redirect } from "next/navigation";

/** Прежний адрес «Мои команды» (до этапа 41): страница «Люди», вкладка «Руководителю» */
export default async function MyTeamsRedirect({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  redirect(team ? `/people/leader?team=${encodeURIComponent(team)}` : "/people/leader");
}
