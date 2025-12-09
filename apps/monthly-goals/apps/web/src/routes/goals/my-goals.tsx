import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
import { usePermissions } from "@/lib/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  createSortableHeader,
  createFilterableHeader,
} from "@/components/ui/data-table";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/goals/my-goals")({
  component: MyGoalsPage,
});

function MyGoalsPage() {
  const { data: session } = authClient.useSession();
  const { canEditGoals } = usePermissions();
  const queryClient = useQueryClient();
  const areas = useQuery(orpc.areas.list.queryOptions());
  
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    currentDate.getMonth() + 1
  );
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState<any>(null);

  // Queries - Get goals filtered by role on server side
  const myGoals = useQuery(
    orpc.monthlyGoals.my.queryOptions({
      input: {
        month: selectedMonth,
        year: selectedYear,
      },
    })
  );

  // Mutations
  const updateMutation = useMutation(
    orpc.monthlyGoals.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.monthlyGoals.my.key(),
        });
        queryClient.invalidateQueries({
          queryKey: orpc.monthlyGoals.list.key(),
        });
        setIsUpdateDialogOpen(false);
        setUpdatingGoal(null);
        toast.success("Meta actualizada exitosamente");
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, "Error al actualizar meta"));
      },
    })
  );

  const handleUpdateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      achievedValue: formData.get("achievedValue") as string,
      description: formData.get("description") as string,
      status: formData.get("status") as "pending" | "in_progress" | "completed",
    };
    updateMutation.mutate({
      id: updatingGoal.id,
      data,
    });
  };

  const handleUpdate = (goal: any) => {
    setUpdatingGoal(goal);
    setIsUpdateDialogOpen(true);
  };

  const getStatusBadge = (
    percentage: number,
    successThreshold: string,
    warningThreshold: string
  ) => {
    const success = parseFloat(successThreshold || "80");
    const warning = parseFloat(warningThreshold || "50");

    if (percentage >= success) {
      return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
    } else if (percentage >= warning) {
      return (
        <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>
      );
    } else {
      return (
        <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>
      );
    }
  };

  const getStatusText = (
    percentage: number,
    successThreshold: string,
    warningThreshold: string
  ) => {
    const success = parseFloat(successThreshold || "80");
    const warning = parseFloat(warningThreshold || "50");

    if (percentage >= success) return "exitoso";
    else if (percentage >= warning) return "en_progreso";
    else return "necesita_atencion";
  };

  // Generar opciones de área dinámicamente desde los datos
  const areaOptions = useMemo(() => {
    if (!myGoals.data) return [];
    const uniqueAreas = new Set(myGoals.data.map((goal: any) => goal.areaName).filter(Boolean));
    return Array.from(uniqueAreas).sort().map((area) => ({
      label: area as string,
      value: area as string,
    }));
  }, [myGoals.data]);

  // Definir columnas para TanStack Table
  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        accessorKey: "userName",
        header: createSortableHeader("Empleado"),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.getValue("userName")}</div>
            <div className="text-sm text-gray-500">
             {row.original.departmentName}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "areaName",
        header: createFilterableHeader("Área", areaOptions),
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue("areaName")}</div>
        ),
        filterFn: (row, id, value) => {
          if (!value || value.length === 0) return true;
          const areaName = row.getValue("areaName") as string;
          return value.includes(areaName);
        },
      },
      {
        accessorKey: "goalTemplateName",
        header: createSortableHeader("Meta"),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.getValue("goalTemplateName")}
            </div>
            {row.original.goalTemplateUnit && (
              <div className="text-sm text-gray-500">
                {row.original.goalTemplateUnit}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "targetValue",
        header: createSortableHeader("Objetivo"),
        cell: ({ row }) =>
          parseFloat(row.getValue("targetValue")).toLocaleString(),
      },
      {
        accessorKey: "achievedValue",
        header: createSortableHeader("Logrado"),
        cell: ({ row }) =>
          parseFloat(row.getValue("achievedValue")).toLocaleString(),
      },
      {
  id: "progress",
  header: "Progreso",
  cell: ({ row }) => {
    const target = parseFloat(row.original.targetValue);
    const achieved = parseFloat(row.original.achievedValue);
    const isInverse = row.original.isInverse;

    let percentage = 0;

    if (!isNaN(target)) {
      if (isInverse) {
        // Para metas inversas: menor o igual al target = 100%
        if (achieved <= target) {
          percentage = 100;
        } else {
          percentage = target === 0 ? 0 : Math.max((target / achieved) * 100, 0);
        }
      } else if (target > 0) {
        // Para metas normales: mayor es mejor
        percentage = (achieved / target) * 100;
      }
    }

    const clamped = Math.min(percentage, 100);

    return (
      <div className="space-y-2">
        <Progress value={clamped} className="w-[60px]" />
        <span className="text-sm font-medium">{Math.round(clamped)}%</span>
      </div>
    );
  },
},
      {
        id: "status",
        header: createFilterableHeader("Estado", [
          { label: "Exitoso", value: "exitoso" },
          { label: "En Progreso", value: "en_progreso" },
          { label: "Necesita Atención", value: "necesita_atencion" },
        ]),
        cell: ({ row }) => {
          const target = parseFloat(row.original.targetValue);
          const achieved = parseFloat(row.original.achievedValue);
          const isInverse = row.original.isInverse;

          let percentage = 0;
          if (isInverse) {
            if (achieved <= target) {
              percentage = 100;
            } else {
              percentage = target === 0 ? 0 : Math.max((target / achieved) * 100, 0);
            }
          } else if (target > 0) {
            percentage = (achieved / target) * 100;
          }

          return getStatusBadge(
            percentage,
            row.original.successThreshold,
            row.original.warningThreshold
          );
        },
        filterFn: (row, id, value) => {
          if (!value || value.length === 0) return true;

          const target = parseFloat(row.original.targetValue);
          const achieved = parseFloat(row.original.achievedValue);
          const isInverse = row.original.isInverse;

          let percentage = 0;
          if (isInverse) {
            if (achieved <= target) {
              percentage = 100;
            } else {
              percentage = target === 0 ? 0 : Math.max((target / achieved) * 100, 0);
            }
          } else if (target > 0) {
            percentage = (achieved / target) * 100;
          }

          const status = getStatusText(
            percentage,
            row.original.successThreshold,
            row.original.warningThreshold
          );

          return value.includes(status);
        },
      },
      {
        id: "actions",
        header: "Acciones",
        cell: ({ row }) => {
          const goal = row.original;
          const canUpdate =
            canEditGoals &&
            (["super_admin", "department_manager", "area_lead"].includes(
              session?.user?.role || ""
            ) ||
              goal.userEmail === session?.user?.email);

          if (!canUpdate) return null;

          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUpdate(goal)}
              className="flex items-center gap-2"
            >
              <Edit className="h-4 w-4" />
              Actualizar
            </Button>
          );
        },
      },
    ],
    [canEditGoals, session, areaOptions]
  );

  const months = [
    { value: 1, label: "Enero" },
    { value: 2, label: "Febrero" },
    { value: 3, label: "Marzo" },
    { value: 4, label: "Abril" },
    { value: 5, label: "Mayo" },
    { value: 6, label: "Junio" },
    { value: 7, label: "Julio" },
    { value: 8, label: "Agosto" },
    { value: 9, label: "Septiembre" },
    { value: 10, label: "Octubre" },
    { value: 11, label: "Noviembre" },
    { value: 12, label: "Diciembre" },
  ];

  const years = Array.from(
    { length: 5 },
    (_, i) => currentDate.getFullYear() - 2 + i
  );

  // Goals are already filtered by role on the server side
  const userGoals = myGoals.data || [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Actualizar Progreso</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Registra y actualiza el progreso de tus metas mensuales. Aquí puedes actualizar los valores logrados y el estado de cada meta asignada.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <div className="flex items-end gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mes</Label>
            <Select
              value={selectedMonth.toString()}
              onValueChange={(value) => setSelectedMonth(parseInt(value))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value.toString()}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Año</Label>
            <Select
              value={selectedYear.toString()}
              onValueChange={(value) => setSelectedYear(parseInt(value))}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Metas para {months.find((m) => m.value === selectedMonth)?.label}{" "}
            {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={userGoals}
            isLoading={myGoals.isLoading}
            searchPlaceholder="Buscar metas..."
            emptyMessage="No tienes metas configuradas para este período"
          />
        </CardContent>
      </Card>

      {/* Update Goal Dialog */}
      <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Actualizar Progreso de Meta</DialogTitle>
          </DialogHeader>

          {updatingGoal && (
            <form onSubmit={handleUpdateSubmit} className="space-y-6">
              {/* Context Card */}
              <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase">Empleado</p>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{updatingGoal.userName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase">Meta</p>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{updatingGoal.goalTemplateName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase">Área / Departamento</p>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{updatingGoal.areaName} / {updatingGoal.departmentName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase">Período</p>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Progress Section */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase mb-1">
                      {updatingGoal.isInverse ? "Meta (máx)" : "Objetivo"}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {parseFloat(updatingGoal.targetValue).toLocaleString()}
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                        {updatingGoal.goalTemplateUnit || "unidades"}
                      </span>
                    </p>
                    {updatingGoal.isInverse && (
                      <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                        Meta de reducción: menor es mejor
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase mb-1">Logrado Actual</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {parseFloat(updatingGoal.achievedValue).toLocaleString()}
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                        {updatingGoal.goalTemplateUnit || "unidades"}
                      </span>
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Progreso</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100">
                    {(() => {
                      const target = parseFloat(updatingGoal.targetValue);
                      const achieved = parseFloat(updatingGoal.achievedValue);
                      const isInverse = updatingGoal.isInverse;

                      let percentage = 0;
                      if (isInverse) {
                        if (achieved <= target) {
                          percentage = 100;
                        } else {
                          percentage = target === 0 ? 0 : Math.max((target / achieved) * 100, 0);
                        }
                      } else if (target > 0) {
                        percentage = (achieved / target) * 100;
                      }
                      return Math.round(percentage);
                    })()}%
                  </span>
                </div>
                <Progress
                  value={(() => {
                    const target = parseFloat(updatingGoal.targetValue);
                    const achieved = parseFloat(updatingGoal.achievedValue);
                    const isInverse = updatingGoal.isInverse;

                    let percentage = 0;
                    if (isInverse) {
                      if (achieved <= target) {
                        percentage = 100;
                      } else {
                        percentage = target === 0 ? 0 : Math.max((target / achieved) * 100, 0);
                      }
                    } else if (target > 0) {
                      percentage = (achieved / target) * 100;
                    }
                    return Math.min(percentage, 100);
                  })()}
                  className="h-3"
                />
              </div>

              {/* Form Fields */}
              <div className="space-y-4 pt-4 border-t dark:border-gray-700">
                <div className="space-y-2">
                  <Label htmlFor="achievedValue">Nuevo Valor Logrado</Label>
                  <Input
                    id="achievedValue"
                    name="achievedValue"
                    type="number"
                    step="0.01"
                    defaultValue={updatingGoal.achievedValue}
                    required
                    placeholder="Ingresa el valor logrado"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Unidad: {updatingGoal.goalTemplateUnit || "unidades"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Estado</Label>
                  <Select name="status" defaultValue={updatingGoal.status}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pendiente</SelectItem>
                      <SelectItem value="in_progress">En Progreso</SelectItem>
                      <SelectItem value="completed">Completado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Notas (Opcional)</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={updatingGoal.description}
                    placeholder="Agrega notas sobre el progreso, logros, obstáculos, etc."
                    rows={4}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsUpdateDialogOpen(false)}
                  disabled={updateMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Actualizando..." : "Actualizar Progreso"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
