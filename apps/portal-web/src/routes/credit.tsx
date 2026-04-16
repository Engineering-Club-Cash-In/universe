import { Page } from "@/components";
import { Credit } from "@/features/Credit";
import { createFileRoute } from "@tanstack/react-router";
import { useSEO } from "@/lib/seo";

export const Route = createFileRoute("/credit")({
  component: RouteComponent,
});

function RouteComponent() {
  useSEO({
    title: "Crédito Vehicular",
    description:
      "Obtén el financiamiento ideal para tu vehículo con Club CashIn. Disfruta de procesos claros, tecnología confiable y asesoría humana para estrenar tu auto hoy.",
    canonical: "https://clubcashin.com/credit",
  });

  return (
    <Page>
      <Credit />
    </Page>
  );
}
