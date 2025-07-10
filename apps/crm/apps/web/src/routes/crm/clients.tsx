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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, HandshakeIcon, Building, Filter, Search, Calendar, DollarSign, User } from "lucide-react";
import { useForm } from "@tanstack/react-form";

export const Route = createFileRoute("/crm/clients")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());
  const clientsQuery = useQuery({
    ...orpc.getClients.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const companiesQuery = useQuery({
    ...orpc.getCompanies.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });

  const createClientForm = useForm({
    defaultValues: {
      companyId: "",
      contactPerson: "",
      contractValue: "",
      startDate: "",
      endDate: "",
      assignedTo: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      createClientMutation.mutate({
        ...value,
        companyId: value.companyId,
        contractValue: value.contractValue || undefined,
        startDate: value.startDate || undefined,
        endDate: value.endDate || undefined,
        assignedTo: value.assignedTo || undefined,
        notes: value.notes || undefined,
      });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (input: {
      companyId: string;
      contactPerson: string;
      contractValue?: string;
      startDate?: string;
      endDate?: string;
      assignedTo?: string;
      notes?: string;
    }) => client.createClient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getClients'] });
      toast.success("Client created successfully");
      setIsCreateDialogOpen(false);
      createClientForm.reset();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create client");
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: (input: {
      id: string;
      companyId?: string;
      contactPerson?: string;
      contractValue?: string;
      startDate?: string;
      endDate?: string;
      status?: "active" | "inactive" | "churned";
      assignedTo?: string;
      notes?: string;
    }) => client.updateClient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getClients'] });
      toast.success("Client updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update client");
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
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'churned': return 'bg-red-100 text-red-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  const handleStatusChange = (clientId: string, newStatus: string) => {
    updateClientMutation.mutate({ id: clientId, status: newStatus as "active" | "inactive" | "churned" });
  };

  // Filter clients based on search and status
  const filteredClients = clientsQuery.data?.filter(clientData => {
    const matchesSearch = searchTerm === "" || 
      clientData.contactPerson.toLowerCase().includes(searchTerm.toLowerCase()) ||
      clientData.company?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || clientData.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

  // Calculate client metrics
  const totalClients = clientsQuery.data?.length || 0;
  const activeClients = clientsQuery.data?.filter(c => c.status === 'active').length || 0;
  const inactiveClients = clientsQuery.data?.filter(c => c.status === 'inactive').length || 0;
  const churnedClients = clientsQuery.data?.filter(c => c.status === 'churned').length || 0;

  // Calculate total contract value
  const totalContractValue = clientsQuery.data?.reduce((sum, client) => {
    return sum + (parseFloat(client.contractValue || '0') || 0);
  }, 0) || 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clients Portfolio</h1>
        <p className="text-muted-foreground">
          {userProfile.data.role === 'admin' ? 'Manage all client relationships' : 'Manage your assigned clients'}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <HandshakeIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalClients}</div>
            <p className="text-xs text-muted-foreground">Active relationships</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
            <HandshakeIcon className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClients}</div>
            <p className="text-xs text-muted-foreground">Currently engaged</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Churned</CardTitle>
            <HandshakeIcon className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{churnedClients}</div>
            <p className="text-xs text-muted-foreground">Lost clients</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contract Value</CardTitle>
            <DollarSign className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalContractValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total portfolio</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Client Directory</CardTitle>
              <CardDescription>
                Manage and nurture your client relationships
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                createClientForm.reset();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Client
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Client</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void createClientForm.handleSubmit();
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createClientForm.Field name="companyId">
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
                                {companiesQuery.data?.map((company) => (
                                  <SelectItem key={company.id} value={company.id}>
                                    {company.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </createClientForm.Field>
                    </div>
                    <div>
                      <createClientForm.Field name="contactPerson">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Contact Person</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="Primary contact name"
                            />
                          </div>
                        )}
                      </createClientForm.Field>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createClientForm.Field name="contractValue">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Contract Value</Label>
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
                      </createClientForm.Field>
                    </div>
                    <div>
                      <createClientForm.Field name="assignedTo">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Assigned To</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="Leave empty for yourself"
                            />
                          </div>
                        )}
                      </createClientForm.Field>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createClientForm.Field name="startDate">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Start Date</Label>
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
                      </createClientForm.Field>
                    </div>
                    <div>
                      <createClientForm.Field name="endDate">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>End Date</Label>
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
                      </createClientForm.Field>
                    </div>
                  </div>

                  <div>
                    <createClientForm.Field name="notes">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Notes</Label>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Additional notes about this client..."
                          />
                        </div>
                      )}
                    </createClientForm.Field>
                  </div>

                  <createClientForm.Subscribe>
                    {(state) => (
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={!state.canSubmit || state.isSubmitting || createClientMutation.isPending}
                      >
                        {state.isSubmitting || createClientMutation.isPending ? "Creating..." : "Create Client"}
                      </Button>
                    )}
                  </createClientForm.Subscribe>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="churned">Churned</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {clientsQuery.isPending ? (
            <div>Loading clients...</div>
          ) : clientsQuery.error ? (
            <div className="text-red-500">Error loading clients: {clientsQuery.error.message}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contract Value</TableHead>
                  <TableHead>Contract Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((clientData) => (
                  <TableRow key={clientData.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <div className="font-medium">{clientData.contactPerson}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {clientData.company ? (
                        <div className="flex items-center gap-1">
                          <Building className="h-3 w-3" />
                          {clientData.company.name}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No company</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {clientData.contractValue ? (
                        <div className="flex items-center gap-1 font-medium text-green-600">
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(clientData.contractValue).toLocaleString()}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No value</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {clientData.startDate && (
                          <div className="flex items-center gap-1 text-sm">
                            <Calendar className="h-3 w-3" />
                            {new Date(clientData.startDate).toLocaleDateString()}
                          </div>
                        )}
                        {clientData.endDate && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(clientData.endDate).toLocaleDateString()}
                          </div>
                        )}
                        {!clientData.startDate && !clientData.endDate && (
                          <span className="text-muted-foreground text-sm">No dates set</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeColor(clientData.status)} variant="outline">
                        {clientData.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="h-3 w-3" />
                        {new Date(clientData.createdAt).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Status</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(clientData.id, 'active')}
                            disabled={clientData.status === 'active'}
                          >
                            Mark as Active
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(clientData.id, 'inactive')}
                            disabled={clientData.status === 'inactive'}
                          >
                            Mark as Inactive
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(clientData.id, 'churned')}
                            disabled={clientData.status === 'churned'}
                          >
                            Mark as Churned
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}