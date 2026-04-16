import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { FormLeads } from "@/features/FormLeads";
import { useSEO } from "@/lib/seo";

interface LeadsSearch {
  type?: string;
  source?: string;
  campaign?: string;
}

export const Route = createFileRoute("/leads")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): LeadsSearch => {
    const type = typeof search.type === "string" ? search.type : undefined;
    const source = typeof search.source === "string" ? search.source : undefined;
    const campaign =
      typeof search.campaign === "string" ? search.campaign : undefined;

    return {
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
      ...(campaign ? { campaign } : {}),
    };
  },
});

function RouteComponent() {
  const { type } = Route.useSearch();

  useSEO({
    title: "Aplicá a tu Crédito",
    description:
      "Aplica hoy a tu crédito vehicular con Club CashIn. Completa el formulario y obtén financiamiento rápido, simple y seguro con nuestra asesoría personalizada.",
    canonical: "https://clubcashin.com/leads",
    noindex: type === "buy",
  });

  return (
    <Page footerNotShowRedirects>
      <FormLeads />
    </Page>
  );
}
