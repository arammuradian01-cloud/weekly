import { redirect } from "next/navigation";

/** Weekly-проекты (этап 57) стали частью экрана «Weekly-команды» (этап 64): старый адрес ведёт туда */
export default function ProjectsPage() {
  redirect("/people/teams");
}
