import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { FormLeads } from "@/features/FormLeads";

export const Route = createFileRoute("/leads")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page footerNotShowRedirects>
      <FormLeads />
    </Page>
  );
}
