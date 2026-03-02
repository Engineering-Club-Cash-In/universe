import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { LeadInvestor } from "@/features/LeadInvestor";

export const Route = createFileRoute("/leadInvestor")({
  validateSearch: (search: Record<string, unknown>) => ({
    amount: typeof search.amount === "string" ? search.amount : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { amount } = Route.useSearch();

  return (
    <Page>
      <LeadInvestor initialAmount={amount} />
    </Page>
  );
}
