import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@features/HomePage";
import { Page } from "@components/Page";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <Page>
      <HomePage />
    </Page>
  );
}
