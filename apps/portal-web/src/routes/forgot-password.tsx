import { createFileRoute } from "@tanstack/react-router";
import { ForgotPassword } from "@features/Login/ForgotPassword";
import { Page } from "@components/Page";

export const Route = createFileRoute("/forgot-password")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <ForgotPassword />
    </Page>
  );
}
