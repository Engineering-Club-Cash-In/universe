import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@features/HomePage";
import { Page } from "@components/Page";
import { useSEO } from "@/lib/seo";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  useSEO({
    title: "Inicio",
    description:
      "Descubre Club CashIn, la primera Fintech P2P Lending de Centroamérica. Financia tu vehículo o invierte con rendimientos atractivos de forma simple y segura.",
    canonical: "https://clubcashin.com/",
  });

  return (
    <Page>
      <HomePage />
    </Page>
  );
}
