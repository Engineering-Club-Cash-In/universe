import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { Sell } from "@/features";

export const Route = createFileRoute("/sell")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Sell />
    </Page>
  );
}
