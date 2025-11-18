import { createFileRoute } from '@tanstack/react-router'
import { Login } from '@features/Login/Login'
import { Page } from '@components/Page'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <Page>
      <Login />
    </Page>
  )
}
