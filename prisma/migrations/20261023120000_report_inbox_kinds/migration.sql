-- повторяемая: этап 73, события «Мне» о комментариях к отчёту руководителю и напоминание сдать weekly
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'REPORT_COMMENT';
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'WEEKLY_REMIND';
