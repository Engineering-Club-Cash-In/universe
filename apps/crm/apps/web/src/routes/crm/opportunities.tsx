import { authClient } from "@/lib/auth-client";
import { orpc, client } from "@/utils/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Target, DollarSign, Calendar, Building, TrendingUp, Filter } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

export const Route = createFileRoute("/crm/opportunities")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());
  const opportunitiesQuery = useQuery({
    ...orpc.getOpportunities.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const salesStagesQuery = useQuery({
    ...orpc.getSalesStages.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const companiesQuery = useQuery({
    ...orpc.getCompanies.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });

  const createOpportunityForm = useForm({
    defaultValues: {
      title: "",
      companyId: "none",
      value: "",
      stageId: "",
      probability: 0,
      expectedCloseDate: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      const firstStage = salesStagesQuery.data?.[0];
      createOpportunityMutation.mutate({
        ...value,
        stageId: value.stageId || firstStage?.id || "",
        companyId: value.companyId && value.companyId !== "none" ? value.companyId : undefined,
        value: value.value || undefined,
        expectedCloseDate: value.expectedCloseDate || undefined,
        notes: value.notes || undefined,
        probability: value.probability || undefined,
      });
    },
  });

  const createOpportunityMutation = useMutation({
    mutationFn: (input: {
      title: string;
      leadId?: string;
      companyId?: string;
      value?: string;
      stageId: string;
      probability?: number;
      expectedCloseDate?: string;
      assignedTo?: string;
      notes?: string;
    }) => client.createOpportunity(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getOpportunities'] });
      toast.success("Opportunity created successfully");
      setIsCreateDialogOpen(false);
      createOpportunityForm.reset();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create opportunity");
    },
  });

  useEffect(() => {
    if (!session && !isPending) {
      navigate({ to: "/login" });
    } else if (session && userProfile.data?.role && !['admin', 'sales'].includes(userProfile.data.role)) {
      navigate({ to: "/dashboard" });
      toast.error("Access denied: CRM access required");
    }
  }, [session, isPending, userProfile.data?.role]);

  if (isPending || userProfile.isPending) {
    return <div>Loading...</div>;
  }

  if (!userProfile.data?.role || !['admin', 'sales'].includes(userProfile.data.role)) {
    return null;
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'won': return 'bg-green-100 text-green-800';
      case 'lost': return 'bg-red-100 text-red-800';
      case 'on_hold': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Group opportunities by stage
  const opportunitiesByStage = salesStagesQuery.data?.map(stage => {
    const stageOpportunities = opportunitiesQuery.data?.filter(opp => 
      opp.stage?.id === stage.id && (stageFilter === "all" || opp.status === stageFilter)
    ) || [];
    
    const totalValue = stageOpportunities.reduce((sum, opp) => 
      sum + (parseFloat(opp.value || '0') || 0), 0
    );

    return {
      stage,
      opportunities: stageOpportunities,
      totalValue,
      count: stageOpportunities.length
    };
  }) || [];

  // Calculate comprehensive pipeline metrics
  const totalOpportunities = opportunitiesQuery.data?.length || 0;
  const totalValue = opportunitiesQuery.data?.reduce((sum, opp) => 
    sum + (parseFloat(opp.value || '0') || 0), 0
  ) || 0;
  const wonOpportunities = opportunitiesQuery.data?.filter(opp => opp.status === 'won').length || 0;
  const lostOpportunities = opportunitiesQuery.data?.filter(opp => opp.status === 'lost').length || 0;
  const openOpportunities = opportunitiesQuery.data?.filter(opp => opp.status === 'open').length || 0;
  
  // Calculate win rate from closed deals only
  const closedOpportunities = wonOpportunities + lostOpportunities;
  const winRate = closedOpportunities > 0 ? Math.round((wonOpportunities / closedOpportunities) * 100) : 0;
  
  // Calculate weighted pipeline value (value * probability / 100)
  const weightedValue = opportunitiesQuery.data?.reduce((sum, opp) => {
    const value = parseFloat(opp.value || '0') || 0;
    const probability = opp.probability || opp.stage?.closurePercentage || 0;
    return sum + (value * probability / 100);
  }, 0) || 0;
  
  // Calculate average deal size
  const avgDealSize = totalOpportunities > 0 ? totalValue / totalOpportunities : 0;
  
  // Calculate conversion rate by stage
  const stageConversions = salesStagesQuery.data?.map(stage => {
    const stageOpportunities = opportunitiesQuery.data?.filter(opp => opp.stage?.id === stage.id) || [];
    const nextStageOpportunities = salesStagesQuery.data?.find(s => s.order === stage.order + 1);
    const nextStageCount = nextStageOpportunities 
      ? opportunitiesQuery.data?.filter(opp => opp.stage?.order && opp.stage.order >= nextStageOpportunities.order).length || 0
      : wonOpportunities;
    
    const conversionRate = stageOpportunities.length > 0 
      ? Math.round((nextStageCount / stageOpportunities.length) * 100)
      : 0;
    
    return {
      stage: stage.name,
      conversionRate,
      count: stageOpportunities.length
    };
  }) || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sales Pipeline</h1>
        <p className="text-muted-foreground">
          Track opportunities through your sales process
        </p>
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pipeline Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{totalOpportunities} opportunities</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Weighted Value</CardTitle>
            <DollarSign className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${weightedValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Probability-adjusted</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{winRate}%</div>
            <p className="text-xs text-muted-foreground">{wonOpportunities}/{closedOpportunities} closed deals</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Deal Size</CardTitle>
            <Target className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${avgDealSize.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Per opportunity</p>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Stage Conversion Analysis
          </CardTitle>
          <CardDescription>
            Track how opportunities move through your sales process
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {stageConversions.map((conversion, index) => (
              <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium text-sm">{conversion.stage}</p>
                  <p className="text-xs text-muted-foreground">{conversion.count} opportunities</p>
                </div>
                <div className="text-right">
                  <Badge 
                    variant="outline"
                    className={conversion.conversionRate >= 70 ? 'bg-green-100 text-green-800' : 
                              conversion.conversionRate >= 40 ? 'bg-yellow-100 text-yellow-800' : 
                              'bg-red-100 text-red-800'}
                  >
                    {conversion.conversionRate}%
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">conversion</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) {
            createOpportunityForm.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Opportunity
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Opportunity</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void createOpportunityForm.handleSubmit();
              }}
              className="space-y-4"
            >
              <div>
                <createOpportunityForm.Field name="title">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Opportunity Title</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Enter opportunity title..."
                      />
                      {field.state.meta.errors.map((error) => (
                        <p key={String(error)} className="text-red-500 text-sm">
                          {String(error)}
                        </p>
                      ))}
                    </div>
                  )}
                </createOpportunityForm.Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <createOpportunityForm.Field name="companyId">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Company</Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select company" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No company</SelectItem>
                            {companiesQuery.data?.map((company) => (
                              <SelectItem key={company.id} value={company.id}>
                                {company.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </createOpportunityForm.Field>
                </div>
                <div>
                  <createOpportunityForm.Field name="value">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Deal Value</Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="number"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                    )}
                  </createOpportunityForm.Field>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <createOpportunityForm.Field name="stageId">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Initial Stage</Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select stage" />
                          </SelectTrigger>
                          <SelectContent>
                            {salesStagesQuery.data?.map((stage) => (
                              <SelectItem key={stage.id} value={stage.id}>
                                {stage.name} ({stage.closurePercentage}%)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </createOpportunityForm.Field>
                </div>
                <div>
                  <createOpportunityForm.Field name="expectedCloseDate">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Expected Close Date</Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="date"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </div>
                    )}
                  </createOpportunityForm.Field>
                </div>
              </div>

              <div>
                <createOpportunityForm.Field name="notes">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Notes</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Additional notes about this opportunity..."
                      />
                    </div>
                  )}
                </createOpportunityForm.Field>
              </div>

              <createOpportunityForm.Subscribe>
                {(state) => (
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!state.canSubmit || state.isSubmitting || createOpportunityMutation.isPending}
                  >
                    {state.isSubmitting || createOpportunityMutation.isPending ? "Creating..." : "Create Opportunity"}
                  </Button>
                )}
              </createOpportunityForm.Subscribe>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Enhanced Pipeline Kanban View */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {opportunitiesByStage.map(({ stage, opportunities, totalValue, count }) => {
          // Calculate weighted value for this stage
          const stageWeightedValue = opportunities.reduce((sum, opp) => {
            const value = parseFloat(opp.value || '0') || 0;
            const probability = opp.probability || stage.closurePercentage || 0;
            return sum + (value * probability / 100);
          }, 0);
          
          // Calculate average deal size for this stage
          const stageAvgDeal = count > 0 ? totalValue / count : 0;
          
          return (
            <Card key={stage.id} className="h-fit">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge 
                    style={{ backgroundColor: stage.color, color: 'white' }}
                    className="text-xs"
                  >
                    {stage.closurePercentage}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">{count} deals</span>
                </div>
                <CardTitle className="text-sm font-medium">{stage.name}</CardTitle>
                <div className="space-y-1">
                  <CardDescription className="text-xs">
                    ${totalValue.toLocaleString()} total value
                  </CardDescription>
                  <CardDescription className="text-xs text-blue-600">
                    ${stageWeightedValue.toLocaleString()} weighted
                  </CardDescription>
                  <CardDescription className="text-xs text-muted-foreground">
                    ${stageAvgDeal.toLocaleString()} avg/deal
                  </CardDescription>
                </div>
              </CardHeader>
            <CardContent className="space-y-3">
              {opportunities.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No opportunities</p>
                </div>
              ) : (
                opportunities.map((opportunity) => (
                  <Card key={opportunity.id} className="p-3 hover:shadow-md transition-shadow cursor-pointer">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <h4 className="font-medium text-sm leading-tight">{opportunity.title}</h4>
                        <Badge className={getStatusBadgeColor(opportunity.status)} variant="outline">
                          {opportunity.status}
                        </Badge>
                      </div>
                      
                      {opportunity.company && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building className="h-3 w-3" />
                          {opportunity.company.name}
                        </div>
                      )}
                      
                      {opportunity.value && (
                        <div className="flex items-center gap-1 text-xs font-medium text-green-600">
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(opportunity.value).toLocaleString()}
                        </div>
                      )}
                      
                      {opportunity.expectedCloseDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(opportunity.expectedCloseDate).toLocaleDateString()}
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">
                          {opportunity.probability || opportunity.stage?.closurePercentage || 0}% probability
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(opportunity.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {/* Weighted value display */}
                      {opportunity.value && (
                        <div className="pt-1 border-t">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Weighted:</span>
                            <span className="font-medium text-blue-600">
                              ${((parseFloat(opportunity.value) * (opportunity.probability || opportunity.stage?.closurePercentage || 0)) / 100).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        );
        })}
      </div>
    </div>
  );
}