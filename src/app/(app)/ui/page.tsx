import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { UiSample } from "@/components/ui-sample/ui-sample";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Образец компонентов" };

export default function UiPage() {
  return (
    <>
      <PageHeader title="Образец компонентов" description="Все элементы интерфейса в одном месте: по ним утверждается дизайн" />
      <Suspense>
        <UiSample />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
