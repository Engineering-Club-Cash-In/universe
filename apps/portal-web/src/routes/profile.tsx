import { createFileRoute, redirect } from "@tanstack/react-router";
import { Profile } from "@features/Profile/Profile";
import { Page } from "@/components";

// Función para verificar autenticación
const checkAuth = () => {
  const token = localStorage.getItem("auth-token");
  if (!token) {
    throw redirect({
      to: "/login",
    });
  }
};

export const Route = createFileRoute("/profile")({
  beforeLoad: () => {
    checkAuth();
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
