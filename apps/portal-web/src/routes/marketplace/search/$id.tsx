import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components'
import { SingleCar } from '@/features/Marketplace/SingleCar'

export const Route = createFileRoute('/marketplace/search/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Page><SingleCar /></Page>
}
