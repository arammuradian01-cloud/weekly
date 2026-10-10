import { redirect } from "next/navigation";

/** Прежний адрес «Аналитика» (до этапа 41): страница «Люди», вкладка «Аналитика» */
export default async function AnalyticsRedirect({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  redirect(team ? `/people/analytics?team=${encodeURIComponent(team)}` : "/people/analytics");
}
