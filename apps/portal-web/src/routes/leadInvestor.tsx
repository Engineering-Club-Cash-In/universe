import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { LeadInvestor } from "@/features/LeadInvestor";

export const Route = createFileRoute("/leadInvestor")({
  validateSearch: (search: Record<string, unknown>) => ({
    amount: typeof search.amount === "string" ? search.amount : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { amount, term, type } = Route.useSearch();

  return (
    <Page>
      <LeadInvestor initialAmount={amount} initialTerm={term} initialType={type} />
    </Page>
  );
}
