import { redirect } from "next/navigation";

/** Прежний адрес «Структура» (до этапа 41): страница «Люди», вкладка «Структура» */
export default function StructureRedirect() {
  redirect("/people/structure");
}
