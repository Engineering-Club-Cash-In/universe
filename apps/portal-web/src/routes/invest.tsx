import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { Investors } from "@/features";

export const Route = createFileRoute("/invest")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Investors />
    </Page>
  );
}
