import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { MyInvestments } from "@/features/Profile";
import { checkAuth } from "@/lib/auth";

export const Route = createFileRoute("/investments")({
  beforeLoad: async () => {
    await checkAuth();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <MyInvestments />
    </Page>
  );
}
