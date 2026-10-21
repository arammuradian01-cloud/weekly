import type { Metadata } from "next";
import { currentActor } from "@/lib/action-runner";
import { projectsView } from "@/lib/org/projects";
import { ProjectsBoard } from "@/components/projects/projects-board";

export const metadata: Metadata = { title: "Люди: weekly-проекты" };

/** Weekly-проекты (этап 57): готовые команды по структуре и проекты руководителя, люди перетаскиваются в проект */
export default async function ProjectsPage() {
  const actor = await currentActor();
  const view = await projectsView(actor);
  return <ProjectsBoard view={view} />;
}
