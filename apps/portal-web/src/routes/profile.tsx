import { createFileRoute, redirect } from "@tanstack/react-router";
import { Profile } from "@features/Profile/Profile";
import { Page } from "@/components";
import { authClient } from "@/lib/auth";

// Función para verificar autenticación con better-auth
const checkAuth = async () => {
  const sessionData = await authClient.getSession();
  
  if (!sessionData?.data?.user) {
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
