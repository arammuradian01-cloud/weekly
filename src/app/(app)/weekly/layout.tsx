import { Suspense } from "react";
import { currentActor } from "@/lib/action-runner";
import { teamInboxScope } from "@/lib/weekly/team-inbox";
import { WeeklyNav } from "@/components/weekly/weekly-nav";

export default async function WeeklyLayout({ children }: { children: React.ReactNode }) {
  const scope = await teamInboxScope(await currentActor());
  return <><Suspense><WeeklyNav received={scope.allowed} /></Suspense>{children}</>;
}
