import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { FormLeads } from "@/features/FormLeads";

export const Route = createFileRoute("/leads")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    type: (search.type as string) || undefined,
  }),
});

function RouteComponent() {
  return (
    <Page footerNotShowRedirects>
      <FormLeads />
    </Page>
  );
}
