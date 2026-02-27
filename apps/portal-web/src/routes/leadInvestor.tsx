import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { LeadInvestor } from "@/features/LeadInvestor";

export const Route = createFileRoute("/leadInvestor")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <LeadInvestor />
    </Page>
  );
}
