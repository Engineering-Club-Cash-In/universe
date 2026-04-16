import { createFileRoute, redirect } from '@tanstack/react-router'
import { Login } from '@features/Login/Login'
import { Page } from '@components/Page'
import { authClient } from '@/lib/auth'
import { useSEO } from '@/lib/seo'

// Verificar si ya tiene sesión activa
const checkIfLoggedIn = async () => {
  const sessionData = await authClient.getSession();
  
  if (sessionData?.data?.user) {
    console.log("User is already logged in, redirecting to profile");
    // Si ya tiene sesión, redirigir a profile
    throw redirect({
      to: "/profile",
    });
  }
};

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    await checkIfLoggedIn();
  },
  component: RouteComponent,
})

function RouteComponent() {
  useSEO({
    title: "Iniciar Sesión",
    description: "Inicia sesión en Club CashIn para gestionar tus créditos e inversiones.",
    noindex: true,
  });

  return (
    <Page>
      <Login />
    </Page>
  )
}
