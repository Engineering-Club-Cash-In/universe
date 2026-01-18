import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/marketplace/search/$id')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
  component: () => null,
})
