import { Page } from "@/components";
import { Credit } from "@/features/Credit";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/credit")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Credit />
    </Page>
  );
}
