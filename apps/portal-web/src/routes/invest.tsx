import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components";
import { Investors } from "@/features";
import { useSEO } from "@/lib/seo";

export const Route = createFileRoute("/invest")({
  component: RouteComponent,
});

function RouteComponent() {
  useSEO({
    title: "Invertí con CashIn",
    description:
      "Haz crecer tu dinero con Club CashIn. Únete a nuestro ecosistema de inversión en créditos vehiculares y obtén rendimientos sólidos respaldados por tecnología.",
    canonical: "https://clubcashin.com/invest",
  });

  return (
    <Page>
      <Investors />
    </Page>
  );
}
