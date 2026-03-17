import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { LeadInvestor } from "@/features/LeadInvestor";

interface LeadInvestorSearch {
  amount?: string;
  term?: string;
  type?: string;
  source?: string;
}

export const Route = createFileRoute("/leadInvestor")({
  validateSearch: (search: Record<string, unknown>): LeadInvestorSearch => {
    const amount = typeof search.amount === "string" ? search.amount : undefined;
    const term = typeof search.term === "string" ? search.term : undefined;
    const type = typeof search.type === "string" ? search.type : undefined;
    const source = typeof search.source === "string" ? search.source : undefined;

    return {
      ...(amount ? { amount } : {}),
      ...(term ? { term } : {}),
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { amount, term, type, source } = Route.useSearch();

  return (
    <Page>
      <LeadInvestor
        initialAmount={amount}
        initialTerm={term}
        initialType={type}
        source={source}
      />
    </Page>
  );
}
