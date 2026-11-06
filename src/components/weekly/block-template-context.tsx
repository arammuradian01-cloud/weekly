"use client";

import { createContext } from "react";
import type { TemplateBlock } from "@/lib/weekly-blocks/types";

/** Только шаблон выбранной команды; общая лента не смешивает несовместимые шаблоны. */
export const BlockTemplateContext = createContext<TemplateBlock[] | null>(null);
