import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { SearchAll } from "@/features/Marketplace/SearchAll";

export const Route = createFileRoute("/marketplace/search/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <SearchAll />
    </Page>
  );
}
