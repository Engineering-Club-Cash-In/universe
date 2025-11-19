import { createFileRoute } from '@tanstack/react-router'
import { Marketplace } from '@/features/Marketplace/Marketplace'
import { Page } from '@/components'

export const Route = createFileRoute('/marketplace')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <Page>
      <Marketplace />
    </Page>
  )
}
