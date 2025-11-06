import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { Register } from "@/features/Login/Register";

export const Route = createFileRoute("/register")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Register />
    </Page>
  );
}
