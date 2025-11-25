import { createFileRoute } from "@tanstack/react-router";
import { Profile } from "@/features/Profile/MyProfile/Profile";
import { Page } from "@/components";
import { checkAuth } from "@/lib/auth";

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    await checkAuth();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Profile />
    </Page>
  );
}
