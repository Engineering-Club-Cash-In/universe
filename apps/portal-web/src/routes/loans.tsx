import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { MyLoans } from "@/features/Profile";
import { checkAuth } from "@/lib/auth";

export const Route = createFileRoute("/loans")({
  beforeLoad: async () => {
    await checkAuth();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <MyLoans />
    </Page>
  );
}
