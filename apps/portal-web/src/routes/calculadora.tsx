import { createFileRoute } from "@tanstack/react-router";
import { CalculatorCredit } from "@/features/Marketplace/Sections/CalculatorCredit";
import { NavBar, Page } from "@/components";
import { useSEO } from "@/lib/seo";

export const Route = createFileRoute("/calculadora")({
  component: RouteComponent,
});

function RouteComponent() {
  useSEO({
    title: "Calculadora de Crédito Vehicular",
    description:
      "Calcula una cuota mensual estimada para tu crédito vehicular en Club CashIn.",
    canonical: "https://clubcashin.com/calculadora",
  });

  return (
    <Page>
      <NavBar />
      <main className="pt-24 lg:pt-36">
        <CalculatorCredit />
      </main>
    </Page>
  );
}
