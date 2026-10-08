"use server";

// Анонимная оценка встреч (этап 29)

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import { submitRating } from "@/lib/meeting-rating/service";

export async function submitRatingAction(teamId: string, month: string, score: number, remove: string) {
  const result = await runAction("Оценка встреч", (a) => submitRating(a, { teamId: String(teamId ?? ""), month: String(month ?? ""), score, remove: String(remove ?? "") }));
  if (result.ok) {
    revalidatePath("/meeting-rating");
    revalidatePath("/");
  }
  return result;
}
