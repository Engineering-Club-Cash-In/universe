import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Building, Target, HandshakeIcon, TrendingUp, DollarSign } from "lucide-react";

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
  
  // CRM Dashboard Stats
  const crmStats = useQuery({
    ...orpc.getDashboardStats.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });

  // Sales Stages for funnel
  const salesStages = useQuery({
    ...orpc.getSalesStages.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });

  useEffect(() => {
    // Only redirect if we're absolutely sure there's no session
    // Wait a bit longer to ensure session has time to update after sign-in
    if (!session && !isPending) {
      const timer = setTimeout(() => {
        // Re-check the current session state
        const currentSession = authClient.useSession();
        if (!currentSession.data && !currentSession.isPending) {
          navigate({
            to: "/login",
          });
        }
      }, 1000); // Increased delay to 1 second
      
      return () => clearTimeout(timer);
    }
  }, [session, isPending, navigate]);

  if (isPending || userProfile.isPending) {
    return <div>Loading...</div>;
  }

  const userRole = userProfile.data?.role;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">CRM Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {session?.user.name}</p>
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 mt-2">
          Role: {userRole}
        </div>
      </div>

      {/* CRM Metrics */}
      {userRole === 'admin' && crmStats.data && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Global CRM Overview</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.totalLeads || 0}</div>
                <p className="text-xs text-muted-foreground">Active prospects</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.totalOpportunities || 0}</div>
                <p className="text-xs text-muted-foreground">In pipeline</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
                <HandshakeIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.totalClients || 0}</div>
                <p className="text-xs text-muted-foreground">Paying customers</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Building className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{adminData.data?.adminStats.totalUsers || 0}</div>
                <p className="text-xs text-muted-foreground">System users</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {userRole === 'sales' && crmStats.data && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-blue-600">My Sales Performance</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">My Leads</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.myLeads || 0}</div>
                <p className="text-xs text-muted-foreground">Assigned to me</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">My Opportunities</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.myOpportunities || 0}</div>
                <p className="text-xs text-muted-foreground">In my pipeline</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">My Clients</CardTitle>
                <HandshakeIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{crmStats.data.myClients || 0}</div>
                <p className="text-xs text-muted-foreground">Managed by me</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Sales Funnel Visualization */}
      {salesStages.data && salesStages.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Sales Pipeline Stages
            </CardTitle>
            <CardDescription>
              Track opportunities through the sales process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {salesStages.data.map((stage) => (
                <div key={stage.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Badge 
                      style={{ backgroundColor: stage.color, color: 'white' }}
                      className="min-w-[60px] justify-center"
                    >
                      {stage.closurePercentage}%
                    </Badge>
                    <div>
                      <p className="font-medium">{stage.name}</p>
                      {stage.description && (
                        <p className="text-sm text-muted-foreground">{stage.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Stage {stage.order}</p>
                    <p className="text-xs text-muted-foreground">
                      {stage.closurePercentage}% closure rate
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common CRM tasks and shortcuts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <button className="flex items-center gap-2 p-3 rounded-lg border hover:bg-accent transition-colors">
              <Users className="h-4 w-4" />
              <span className="text-sm">Add New Lead</span>
            </button>
            <button className="flex items-center gap-2 p-3 rounded-lg border hover:bg-accent transition-colors">
              <Target className="h-4 w-4" />
              <span className="text-sm">Create Opportunity</span>
            </button>
            <button className="flex items-center gap-2 p-3 rounded-lg border hover:bg-accent transition-colors">
              <Building className="h-4 w-4" />
              <span className="text-sm">Add Company</span>
            </button>
            <button className="flex items-center gap-2 p-3 rounded-lg border hover:bg-accent transition-colors">
              <DollarSign className="h-4 w-4" />
              <span className="text-sm">View Reports</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
