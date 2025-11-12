import { createFileRoute, redirect } from "@tanstack/react-router";
import { Profile } from "@features/Profile/Profile";
import { Page } from "@/components";
import { authClient } from "@/lib/auth";

// Función para verificar autenticación con better-auth
const checkAuth = async () => {
  try {
    const sessionData = await authClient.getSession();
    console.log("checkAuth - Respuesta de getSession:", sessionData);
    
    if (sessionData?.data?.user) {
      return; // Sesión válida
    }
    
    // Si no hay sesión, redirigir al login
    throw redirect({
      to: "/login",
    });
  } catch (error) {
    console.error("checkAuth - Error:", error);
    throw redirect({
      to: "/login",
    });
  }
};

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    await checkAuth();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Page>
      <Profile />
    </Page>
  );
}
