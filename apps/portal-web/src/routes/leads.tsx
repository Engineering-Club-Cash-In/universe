import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { FormLeads } from "@/features/FormLeads";

interface LeadsSearch {
  type?: string;
  source?: string;
  campaign?: string;
}

export const Route = createFileRoute("/leads")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): LeadsSearch => {
    const type = typeof search.type === "string" ? search.type : undefined;
    const source = typeof search.source === "string" ? search.source : undefined;
    const campaign =
      typeof search.campaign === "string" ? search.campaign : undefined;

    return {
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
      ...(campaign ? { campaign } : {}),
    };
  },
});

function RouteComponent() {
  return (
    <Page footerNotShowRedirects>
      <FormLeads />
    </Page>
  );
}
