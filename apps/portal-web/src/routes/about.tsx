import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { About } from "@/features";

export const Route = createFileRoute("/about")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <About />
    </Page>
  );
}
