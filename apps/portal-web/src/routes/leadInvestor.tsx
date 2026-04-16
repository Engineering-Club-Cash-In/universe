import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { LeadInvestor } from "@/features/LeadInvestor";
import { useSEO } from "@/lib/seo";

interface LeadInvestorSearch {
  amount?: string;
  term?: string;
  type?: string;
  source?: string;
  campaign?: string;
}

export const Route = createFileRoute("/leadInvestor")({
  validateSearch: (search: Record<string, unknown>): LeadInvestorSearch => {
    const amount = typeof search.amount === "string" ? search.amount : undefined;
    const term = typeof search.term === "string" ? search.term : undefined;
    const type = typeof search.type === "string" ? search.type : undefined;
    const source = typeof search.source === "string" ? search.source : undefined;
    const campaign =
      typeof search.campaign === "string" ? search.campaign : undefined;

    return {
      ...(amount ? { amount } : {}),
      ...(term ? { term } : {}),
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
      ...(campaign ? { campaign } : {}),
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { amount, term, type, source, campaign } = Route.useSearch();

  useSEO({
    title: "Invertí con CashIn",
    description:
      "Conviértete en inversionista con Club CashIn. Completa tu registro y haz crecer tu capital en la primera plataforma Fintech P2P Lending de Centroamérica.",
    canonical: "https://clubcashin.com/leadInvestor",
  });

  return (
    <Page>
      <LeadInvestor
        initialAmount={amount}
        initialTerm={term}
        initialType={type}
        source={source}
        campaign={campaign}
      />
    </Page>
  );
}
