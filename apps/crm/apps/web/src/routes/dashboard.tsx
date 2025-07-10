import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();

  const navigate = Route.useNavigate();

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());
  const adminData = useQuery({
    ...orpc.adminOnlyData.queryOptions(),
    enabled: userProfile.data?.role === 'admin',
  });

  useEffect(() => {
    if (!session && !isPending) {
      navigate({
        to: "/login",
      });
    }
  }, [session, isPending]);

  if (isPending || userProfile.isPending) {
    return <div>Loading...</div>;
  }

  const userRole = userProfile.data?.role;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {session?.user.name}</p>
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 mt-2">
          Role: {userRole}
        </div>
      </div>

      {userRole === 'admin' && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-red-600">Admin Panel</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{adminData.data?.adminStats.totalUsers || 0}</div>
                <p className="text-xs text-muted-foreground">Registered users</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{adminData.data?.adminStats.totalSales || 0}</div>
                <p className="text-xs text-muted-foreground">Completed transactions</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{adminData.data?.adminStats.revenue || "$0"}</div>
                <p className="text-xs text-muted-foreground">Total revenue</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {userRole === 'sales' && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-blue-600">Sales Dashboard</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>My Sales Performance</CardTitle>
                <CardDescription>Your personal sales metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">12</div>
                <p className="text-xs text-muted-foreground">Sales this month</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>My Commission</CardTitle>
                <CardDescription>Your earnings this month</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">$3,240</div>
                <p className="text-xs text-muted-foreground">Commission earned</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Your latest actions in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Logged in</span>
              <span className="text-muted-foreground">Just now</span>
            </div>
            {userRole === 'admin' && (
              <div className="flex justify-between">
                <span>Reviewed user permissions</span>
                <span className="text-muted-foreground">2 hours ago</span>
              </div>
            )}
            {userRole === 'sales' && (
              <div className="flex justify-between">
                <span>Updated lead status</span>
                <span className="text-muted-foreground">1 hour ago</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
