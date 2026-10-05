import { createFileRoute } from "@tanstack/react-router";
import { PrimerIngreso } from "@features/Login/PrimerIngreso";
import { Page } from "@components/Page";
import { checkPrimerIngreso } from "@/lib/auth";

export const Route = createFileRoute("/primer-ingreso")({
  beforeLoad: async () => {
    await checkPrimerIngreso();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <PrimerIngreso />
    </Page>
  );
}
