import type { Metadata } from "next";
import { Suspense } from "react";
import { WeeklyFeed } from "@/components/weekly/weekly-feed";

export const metadata: Metadata = { title: "Weekly" };

export default function WeeklyPage() {
  return (
    <Suspense>
      <WeeklyFeed />
    </Suspense>
  );
}
