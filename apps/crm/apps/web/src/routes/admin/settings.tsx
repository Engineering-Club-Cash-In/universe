import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = Route.useNavigate();

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());

  useEffect(() => {
    if (!session && !isPending) {
      navigate({ to: "/login" });
    } else if (session && userProfile.data?.role !== 'admin') {
      navigate({ to: "/dashboard" });
      toast.error("Access denied: Admin role required");
    }
  }, [session, isPending, userProfile.data?.role]);

  if (isPending || userProfile.isPending) {
    return <div>Loading...</div>;
  }

  if (userProfile.data?.role !== 'admin') {
    return null;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Settings</h1>
        <p className="text-muted-foreground">Configure system-wide settings and preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            System configuration options
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Settings panel coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}