import { createFileRoute } from "@tanstack/react-router";
import { ResetPassword } from "@features/Login/ResetPassword";
import { Page } from "@components/Page";

interface ResetPasswordSearch {
  token?: string;
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => {
    return {
      token: typeof search.token === "string" ? search.token : undefined,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useSearch();

  return (
    <Page>
      <ResetPassword token={token || ""} />
    </Page>
  );
}
