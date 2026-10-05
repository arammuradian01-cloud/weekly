import type { Metadata } from "next";
import { MeetingMode } from "@/components/weekly/meeting-mode";

export const metadata: Metadata = { title: "Режим встречи" };

export default function MeetingPage() {
  return <MeetingMode />;
}
