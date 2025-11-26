import { Page } from '@/components/Page'
import { SearchAll } from '@/features/Marketplace/SearchAll'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/marketplace/search')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <Page>
      <SearchAll />
    </Page>
  )
}

