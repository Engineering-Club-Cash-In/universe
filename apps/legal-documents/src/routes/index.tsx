import { createFileRoute } from '@tanstack/react-router'
import { GenerateComponent } from '@/feature/generateDocument/GenerateComponent'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return <GenerateComponent />
}