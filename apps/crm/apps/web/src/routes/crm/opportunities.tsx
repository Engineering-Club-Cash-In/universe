import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { DropIndicator } from "@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box";
import invariant from "tiny-invariant";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building,
  Calendar,
  DollarSign,
  Filter,
  Plus,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

// Simple draggable opportunity card component
function DraggableOpportunityCard({
  opportunity,
  getStatusBadgeColor,
}: {
  opportunity: any;
  getStatusBadgeColor: (status: string) => string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    invariant(element);

    return draggable({
      element,
      getInitialData: () => ({
        type: "opportunity",
        opportunityId: opportunity.id,
        currentStageId: opportunity.stage?.id,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [opportunity.id, opportunity.stage?.id]);

  return (
    <Card
      ref={ref}
      className={`cursor-pointer p-3 transition-shadow hover:shadow-md ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <h4 className="font-medium text-sm leading-tight">
            {opportunity.title}
          </h4>
          <Badge
            className={getStatusBadgeColor(opportunity.status)}
            variant="outline"
          >
            {opportunity.status}
          </Badge>
        </div>

        {opportunity.company && (
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <Building className="h-3 w-3" />
            {opportunity.company.name}
          </div>
        )}

        {opportunity.value && (
          <div className="flex items-center gap-1 font-medium text-green-600 text-xs">
            <DollarSign className="h-3 w-3" />$
            {Number.parseFloat(opportunity.value).toLocaleString()}
          </div>
        )}

        {opportunity.expectedCloseDate && (
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <Calendar className="h-3 w-3" />
            {new Date(opportunity.expectedCloseDate).toLocaleDateString()}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-muted-foreground text-xs">
            {opportunity.probability ||
              opportunity.stage?.closurePercentage ||
              0}
            % probabilidad
          </span>
          <span className="text-muted-foreground text-xs">
            {new Date(opportunity.createdAt).toLocaleDateString()}
          </span>
        </div>

        {opportunity.value && (
          <div className="border-t pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Ponderado:</span>
              <span className="font-medium text-blue-600">
                $
                {(
                  (Number.parseFloat(opportunity.value) *
                    (opportunity.probability ||
                      opportunity.stage?.closurePercentage ||
                      0)) /
                  100
                ).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// Simple droppable stage column component
function DroppableStageColumn({
  stage,
  opportunities,
  totalValue,
  count,
  getStatusBadgeColor,
  onDropOpportunity,
}: {
  stage: any;
  opportunities: any[];
  totalValue: number;
  count: number;
  getStatusBadgeColor: (status: string) => string;
  onDropOpportunity: (opportunityId: string, newStageId: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    invariant(element);

    return dropTargetForElements({
      element,
      getData: () => ({ type: "stage", stageId: stage.id }),
      canDrop: ({ source }) => source.data.type === "opportunity",
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: ({ source }) => {
        setIsDraggedOver(false);
        const opportunityId = source.data.opportunityId as string;
        const currentStageId = source.data.currentStageId as string;

        if (opportunityId && currentStageId !== stage.id) {
          onDropOpportunity(opportunityId, stage.id);
        }
      },
    });
  }, [stage.id, onDropOpportunity]);

  const stageWeightedValue = opportunities.reduce((sum, opp) => {
    const value = Number.parseFloat(opp.value || "0") || 0;
    const probability = opp.probability || stage.closurePercentage || 0;
    return sum + (value * probability) / 100;
  }, 0);

  const stageAvgDeal = count > 0 ? totalValue / count : 0;

  return (
    <Card
      className={`h-fit min-w-80 flex-shrink-0 ${
        isDraggedOver ? "ring-2 ring-blue-500" : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Badge
            style={{ backgroundColor: stage.color, color: "white" }}
            className="text-xs"
          >
            {stage.closurePercentage}%
          </Badge>
          <span className="text-muted-foreground text-xs">
            {count} negocios
          </span>
        </div>
        <CardTitle className="font-medium text-sm">{stage.name}</CardTitle>
        <div className="space-y-1">
          <CardDescription className="text-xs">
            ${totalValue.toLocaleString()} valor total
          </CardDescription>
          <CardDescription className="text-blue-600 text-xs">
            ${stageWeightedValue.toLocaleString()} ponderado
          </CardDescription>
          <CardDescription className="text-muted-foreground text-xs">
            ${stageAvgDeal.toLocaleString()} promedio/negocio
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3" ref={ref}>
        {opportunities.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">No hay oportunidades</p>
          </div>
        ) : (
          opportunities.map((opportunity) => (
            <DraggableOpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              getStatusBadgeColor={getStatusBadgeColor}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/crm/opportunities")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const handleDropOpportunity = (opportunityId: string, newStageId: string) => {
    updateOpportunityMutation.mutate({
      id: opportunityId,
      stageId: newStageId,
    });
  };

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());
  const opportunitiesQuery = useQuery({
    ...orpc.getOpportunities.queryOptions(),
    enabled:
      !!userProfile.data?.role &&
      ["admin", "sales"].includes(userProfile.data.role),
  });
  const salesStagesQuery = useQuery({
    ...orpc.getSalesStages.queryOptions(),
    enabled:
      !!userProfile.data?.role &&
      ["admin", "sales"].includes(userProfile.data.role),
  });
  const companiesQuery = useQuery({
    ...orpc.getCompanies.queryOptions(),
    enabled:
      !!userProfile.data?.role &&
      ["admin", "sales"].includes(userProfile.data.role),
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
        companyId:
          value.companyId && value.companyId !== "none"
            ? value.companyId
            : undefined,
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
      queryClient.invalidateQueries({
        queryKey: orpc.getOpportunities.queryOptions().queryKey,
      });
      toast.success("Opportunity created successfully");
      setIsCreateDialogOpen(false);
      createOpportunityForm.reset();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create opportunity");
    },
  });

  const updateOpportunityMutation = useMutation({
    mutationFn: (input: { id: string; stageId: string }) =>
      client.updateOpportunity({ id: input.id, stageId: input.stageId }),
    onMutate: async (variables) => {
      const opportunitiesQueryKey =
        orpc.getOpportunities.queryOptions().queryKey;
      const salesStagesQueryKey = orpc.getSalesStages.queryOptions().queryKey;
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: opportunitiesQueryKey });

      // Snapshot the previous value
      const previousOpportunities = queryClient.getQueryData(
        opportunitiesQueryKey
      );

      // Get the current sales stages data
      const salesStages =
        (queryClient.getQueryData(salesStagesQueryKey) as any[]) || [];

      // Optimistically update to the new value
      queryClient.setQueryData(opportunitiesQueryKey, (old: any) => {
        if (!old) return old;

        return old.map((opportunity: any) => {
          if (opportunity.id === variables.id) {
            // Find the new stage to update the opportunity
            const newStage = salesStages.find(
              (stage) => stage.id === variables.stageId
            );

            if (newStage) {
              return {
                ...opportunity,
                stage: newStage,
                stageId: variables.stageId,
              };
            }
          }
          return opportunity;
        });
      });

      // Return a context object with the snapshotted value
      return { previousOpportunities };
    },
    onSuccess: () => {
      toast.success("Oportunidad actualizada exitosamente");
    },
    onError: (error: any, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousOpportunities) {
        queryClient.setQueryData(
          orpc.getOpportunities.queryOptions().queryKey,
          context.previousOpportunities
        );
      }
      toast.error(error.message || "Error al actualizar la oportunidad");
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have correct data
      queryClient.invalidateQueries({
        queryKey: orpc.getOpportunities.queryOptions().queryKey,
      });
    },
  });

  useEffect(() => {
    if (!session && !isPending) {
      navigate({ to: "/login" });
    } else if (
      session &&
      userProfile.data?.role &&
      !["admin", "sales"].includes(userProfile.data.role)
    ) {
      navigate({ to: "/dashboard" });
      toast.error("Access denied: CRM access required");
    }
  }, [session, isPending, userProfile.data?.role]);

  if (isPending || userProfile.isPending) {
    return <div>Loading...</div>;
  }

  if (
    !userProfile.data?.role ||
    !["admin", "sales"].includes(userProfile.data.role)
  ) {
    return null;
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-800";
      case "won":
        return "bg-green-100 text-green-800";
      case "lost":
        return "bg-red-100 text-red-800";
      case "on_hold":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // Group opportunities by stage
  const opportunitiesByStage =
    salesStagesQuery.data?.map((stage) => {
      const stageOpportunities =
        opportunitiesQuery.data?.filter(
          (opp) =>
            opp.stage?.id === stage.id &&
            (stageFilter === "all" || opp.status === stageFilter)
        ) || [];

      const totalValue = stageOpportunities.reduce(
        (sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
        0
      );

      return {
        stage,
        opportunities: stageOpportunities,
        totalValue,
        count: stageOpportunities.length,
      };
    }) || [];

  // Calculate comprehensive opportunities metrics
  const totalOpportunities = opportunitiesQuery.data?.length || 0;
  const totalValue =
    opportunitiesQuery.data?.reduce(
      (sum, opp) => sum + (Number.parseFloat(opp.value || "0") || 0),
      0
    ) || 0;
  const wonOpportunities =
    opportunitiesQuery.data?.filter((opp) => opp.status === "won").length || 0;
  const lostOpportunities =
    opportunitiesQuery.data?.filter((opp) => opp.status === "lost").length || 0;
  const openOpportunities =
    opportunitiesQuery.data?.filter((opp) => opp.status === "open").length || 0;

  // Calculate win rate from closed deals only
  const closedOpportunities = wonOpportunities + lostOpportunities;
  const winRate =
    closedOpportunities > 0
      ? Math.round((wonOpportunities / closedOpportunities) * 100)
      : 0;

  // Calculate weighted opportunities value (value * probability / 100)
  const weightedValue =
    opportunitiesQuery.data?.reduce((sum, opp) => {
      const value = Number.parseFloat(opp.value || "0") || 0;
      const probability = opp.probability || opp.stage?.closurePercentage || 0;
      return sum + (value * probability) / 100;
    }, 0) || 0;

  // Calculate average deal size
  const avgDealSize =
    totalOpportunities > 0 ? totalValue / totalOpportunities : 0;

  // Calculate conversion rate by stage
  const stageConversions =
    salesStagesQuery.data?.map((stage) => {
      const stageOpportunities =
        opportunitiesQuery.data?.filter((opp) => opp.stage?.id === stage.id) ||
        [];
      const nextStageOpportunities = salesStagesQuery.data?.find(
        (s) => s.order === stage.order + 1
      );
      const nextStageCount = nextStageOpportunities
        ? opportunitiesQuery.data?.filter(
            (opp) =>
              opp.stage?.order &&
              opp.stage.order >= nextStageOpportunities.order
          ).length || 0
        : wonOpportunities;

      const conversionRate =
        stageOpportunities.length > 0
          ? Math.round((nextStageCount / stageOpportunities.length) * 100)
          : 0;

      return {
        stage: stage.name,
        conversionRate,
        count: stageOpportunities.length,
      };
    }) || [];

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="font-bold text-3xl">Oportunidades</h1>
        <p className="text-muted-foreground">
          Rastrea las oportunidades a través de tu proceso de ventas
        </p>
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Valor de Oportunidades
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              ${totalValue.toLocaleString()}
            </div>
            <p className="text-muted-foreground text-xs">
              {totalOpportunities} oportunidades
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Valor Ponderado
            </CardTitle>
            <DollarSign className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              ${weightedValue.toLocaleString()}
            </div>
            <p className="text-muted-foreground text-xs">
              Ajustado por probabilidad
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">Tasa de Éxito</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{winRate}%</div>
            <p className="text-muted-foreground text-xs">
              {wonOpportunities}/{closedOpportunities} negocios cerrados
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Valor Promedio
            </CardTitle>
            <Target className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              ${avgDealSize.toLocaleString()}
            </div>
            <p className="text-muted-foreground text-xs">Por oportunidad</p>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Análisis de Conversión por Etapa
          </CardTitle>
          <CardDescription>
            Rastrea cómo se mueven las oportunidades a través de tu proceso de
            ventas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {stageConversions.map((conversion, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium text-sm">{conversion.stage}</p>
                  <p className="text-muted-foreground text-xs">
                    {conversion.count} oportunidades
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    variant="outline"
                    className={
                      conversion.conversionRate >= 70
                        ? "bg-green-100 text-green-800"
                        : conversion.conversionRate >= 40
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                    }
                  >
                    {conversion.conversionRate}%
                  </Badge>
                  <p className="mt-1 text-muted-foreground text-xs">
                    conversión
                  </p>
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
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filtrar por estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los Estados</SelectItem>
              <SelectItem value="open">Abierto</SelectItem>
              <SelectItem value="won">Ganado</SelectItem>
              <SelectItem value="lost">Perdido</SelectItem>
              <SelectItem value="on_hold">En Espera</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Dialog
          open={isCreateDialogOpen}
          onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              createOpportunityForm.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Agregar Oportunidad
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Crear Nueva Oportunidad</DialogTitle>
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
                      <Label htmlFor={field.name}>
                        Título de la Oportunidad
                      </Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Ingresa el título de la oportunidad..."
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
                        <Label htmlFor={field.name}>Empresa</Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar empresa" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin empresa</SelectItem>
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
                        <Label htmlFor={field.name}>Valor del Negocio</Label>
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
                        <Label htmlFor={field.name}>Etapa Inicial</Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar etapa" />
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
                        <Label htmlFor={field.name}>
                          Fecha de Cierre Esperada
                        </Label>
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
                      <Label htmlFor={field.name}>Notas</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Notas adicionales sobre esta oportunidad..."
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
                    disabled={
                      !state.canSubmit ||
                      state.isSubmitting ||
                      createOpportunityMutation.isPending
                    }
                  >
                    {state.isSubmitting || createOpportunityMutation.isPending
                      ? "Creando..."
                      : "Crear Oportunidad"}
                  </Button>
                )}
              </createOpportunityForm.Subscribe>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Enhanced Opportunities Kanban View */}
      <div className="flex gap-6 overflow-x-auto pb-4">
        {opportunitiesByStage.map(
          ({ stage, opportunities, totalValue, count }) => (
            <DroppableStageColumn
              key={stage.id}
              stage={stage}
              opportunities={opportunities}
              totalValue={totalValue}
              count={count}
              getStatusBadgeColor={getStatusBadgeColor}
              onDropOpportunity={handleDropOpportunity}
            />
          )
        )}
      </div>
    </div>
  );
}
