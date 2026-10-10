import { redirect } from "next/navigation";

/** Прежний адрес «Команда» (до этапа 41): страница «Люди», вкладка «Команда» */
export default function TeamRedirect() {
  redirect("/people");
}
