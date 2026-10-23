import type { Metadata } from "next";
import { ChartLine, Lock } from "lucide-react";
import { requireContext } from "@/lib/auth";
import { canSeeMarket, canUploadMarket, MARKET_CLOSED_TEXT } from "@/lib/market/access";
import { marketMeta } from "@/lib/market/service";
import { stateFromSearch } from "@/lib/market/params";
import { formatDateTime } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MarketFrame } from "@/components/market/market-frame";
import { MarketUpload } from "@/components/market/market-upload";

export const metadata: Metadata = { title: "Рынок" };

/**
 * Рынок КАСКО и ОСАГО (этап 62): дашборд из пакета рынка, который загружает владелец при личном входе. Раздел всегда
 * открыт владельцам, всем в режиме управления и всем, кто вошёл по общему логину (этап 72), а при личном входе без
 * режима управления людям из списка в «Настройках».
 * Остальным страница пишет, что раздел закрыт, без цифр.
 * Вкладки КАСКО и ОСАГО внутри самого дашборда, вкладка и фильтры в адресе
 */
export default async function MarketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!(await canSeeMarket({ personId: ctx.person.id, via: ctx.via, management: ctx.management?.role ?? null }))) {
    return (
      <>
        <PageHeader title="Рынок" />
        <EmptyState icon={Lock} title="Раздел закрыт" centered className="mx-auto max-w-xl">
          <span data-testid="market-closed">{MARKET_CLOSED_TEXT}</span>
        </EmptyState>
      </>
    );
  }
  const [meta, sp] = await Promise.all([marketMeta(), searchParams]);
  const upload = canUploadMarket({ role: ctx.person.role, via: ctx.via });
  return (
    <>
      <PageHeader
        title="Рынок КАСКО и ОСАГО"
        description={
          meta ? (
            <span data-testid="market-meta">
              Данные от {formatDateTime(new Date(meta.uploadedAt))}, загрузил {meta.uploadedBy}
            </span>
          ) : (
            "Пакет рынка ещё не загружен"
          )
        }
      >
        {upload ? <MarketUpload /> : null}
      </PageHeader>
      {meta ? (
        <MarketFrame key={meta.stamp} stamp={meta.stamp} initial={stateFromSearch(sp)} />
      ) : (
        <EmptyState icon={ChartLine} title="Данных рынка пока нет" centered className="mx-auto max-w-xl">
          {upload ? "Загрузите пакет рынка: один файл JSON с кодом дашборда и наборами данных. Новый пакет целиком заменяет прежний." : "Владелец ещё не загрузил пакет рынка. Когда загрузит, дашборд появится здесь."}
        </EmptyState>
      )}
    </>
  );
}
