import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components'
import { Marketplace } from '@/features/Marketplace/Marketplace'

export const Route = createFileRoute('/marketplace/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <Page>
      <Marketplace />
    </Page>
  )
}
