import { createFileRoute, redirect } from "@tanstack/react-router";
import { Page } from "@/components";
import { Register } from "@/features/Login/Register";
import { authClient } from "@/lib/auth";

// Verificar si ya tiene sesión activa
const checkIfLoggedIn = async () => {
  const sessionData = await authClient.getSession();
  
  if (sessionData?.data?.user) {
    // Si ya tiene sesión, redirigir a profile
    throw redirect({
      to: "/profile",
    });
  }
};

export const Route = createFileRoute("/register")({
  beforeLoad: async () => {
    await checkIfLoggedIn();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Register />
    </Page>
  );
}
