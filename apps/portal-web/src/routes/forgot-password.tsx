import { createFileRoute } from "@tanstack/react-router";
import { ForgotPassword } from "@features/Login/ForgotPassword";
import { Page } from "@components/Page";
import { useSEO } from "@/lib/seo";

export const Route = createFileRoute("/forgot-password")({
  component: RouteComponent,
});

function RouteComponent() {
  useSEO({
    title: "Recuperar Contraseña",
    description: "Recupera tu contraseña de Club CashIn.",
    noindex: true,
  });

  return (
    <Page>
      <ForgotPassword />
    </Page>
  );
}
