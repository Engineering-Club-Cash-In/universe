import { createFileRoute } from "@tanstack/react-router";
import { MyDocuments } from "@/features/Profile";
import { Page } from "@/components";
import { checkAuth } from "@/lib/auth";

export const Route = createFileRoute("/documents")({
  beforeLoad: async () => {
    await checkAuth();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <MyDocuments />
    </Page>
  );
}
