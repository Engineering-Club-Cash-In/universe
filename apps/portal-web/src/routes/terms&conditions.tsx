import { createFileRoute } from '@tanstack/react-router'
import { TermsAndConditions } from '@/features/Terms/TermsAndConditions'
import { Page } from '@/components';

export const Route = createFileRoute('/terms&conditions')({
  component: RouteComponent,
})



function RouteComponent() {
  return (
    <Page>
      <TermsAndConditions />
    </Page>
  );
}
