import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { Thanks } from "@/features/FormLeads/components/Thanks";
import { ThanksInvestor } from "@/features/LeadInvestor/components/ThanksInvestor";

export const Route = createFileRoute("/thanks")({
  validateSearch: (search: Record<string, unknown>) => ({
    type: (search.type as string) || "lead",
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { type } = Route.useSearch();

  return (
    <Page footerNotShowRedirects>
      {type === "investor" ? <ThanksInvestor /> : <Thanks />}
    </Page>
  );
}
