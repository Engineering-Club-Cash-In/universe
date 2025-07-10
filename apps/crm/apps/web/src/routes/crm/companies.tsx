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
import { MoreHorizontal, Plus, Building, Phone, Mail, Globe, Filter, Search, Users, Target, HandshakeIcon, MapPin } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

export const Route = createFileRoute("/crm/companies")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");

  const userProfile = useQuery(orpc.getUserProfile.queryOptions());
  const companiesQuery = useQuery({
    ...orpc.getCompanies.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const leadsQuery = useQuery({
    ...orpc.getLeads.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const opportunitiesQuery = useQuery({
    ...orpc.getOpportunities.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });
  const clientsQuery = useQuery({
    ...orpc.getClients.queryOptions(),
    enabled: !!userProfile.data?.role && ['admin', 'sales'].includes(userProfile.data.role),
  });

  const createCompanyForm = useForm({
    defaultValues: {
      name: "",
      industry: "",
      size: "",
      website: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      createCompanyMutation.mutate({
        ...value,
        industry: value.industry && value.industry !== "none" ? value.industry : undefined,
        size: value.size && value.size !== "none" ? value.size : undefined,
        website: value.website || undefined,
        email: value.email || undefined,
        phone: value.phone || undefined,
        address: value.address || undefined,
        notes: value.notes || undefined,
      });
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: (input: {
      name: string;
      industry?: string;
      size?: string;
      website?: string;
      email?: string;
      phone?: string;
      address?: string;
      notes?: string;
    }) => client.createCompany(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getCompanies'] });
      toast.success("Company created successfully");
      setIsCreateDialogOpen(false);
      createCompanyForm.reset();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create company");
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      industry?: string;
      size?: string;
      website?: string;
      email?: string;
      phone?: string;
      address?: string;
      notes?: string;
    }) => client.updateCompany(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getCompanies'] });
      toast.success("Company updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update company");
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

  const getSizeBadgeColor = (size: string) => {
    switch (size) {
      case 'startup': return 'bg-green-100 text-green-800';
      case 'small': return 'bg-blue-100 text-blue-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'large': return 'bg-purple-100 text-purple-800';
      case 'enterprise': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getIndustryBadgeColor = (industry: string) => {
    switch (industry) {
      case 'technology': return 'bg-blue-100 text-blue-800';
      case 'finance': return 'bg-green-100 text-green-800';
      case 'healthcare': return 'bg-red-100 text-red-800';
      case 'retail': return 'bg-orange-100 text-orange-800';
      case 'manufacturing': return 'bg-gray-100 text-gray-800';
      case 'education': return 'bg-purple-100 text-purple-800';
      case 'consulting': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Get company statistics
  const getCompanyStats = (companyId: string) => {
    const leads = leadsQuery.data?.filter(l => l.company?.id === companyId).length || 0;
    const opportunities = opportunitiesQuery.data?.filter(o => o.company?.id === companyId).length || 0;
    const clients = clientsQuery.data?.filter(c => c.company?.id === companyId).length || 0;
    
    return { leads, opportunities, clients };
  };

  // Filter companies based on search, industry, and size
  const filteredCompanies = companiesQuery.data?.filter(company => {
    const matchesSearch = searchTerm === "" || 
      company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.industry?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesIndustry = industryFilter === "all" || company.industry === industryFilter;
    const matchesSize = sizeFilter === "all" || company.size === sizeFilter;
    
    return matchesSearch && matchesIndustry && matchesSize;
  }) || [];

  // Calculate company metrics
  const totalCompanies = companiesQuery.data?.length || 0;
  const techCompanies = companiesQuery.data?.filter(c => c.industry === 'technology').length || 0;
  const largeCompanies = companiesQuery.data?.filter(c => c.size === 'large' || c.size === 'enterprise').length || 0;
  
  // Companies with active relationships
  const companiesWithClients = companiesQuery.data?.filter(company => 
    clientsQuery.data?.some(client => client.company?.id === company.id)
  ).length || 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Company Directory</h1>
        <p className="text-muted-foreground">
          Manage your business relationships and prospects
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Companies</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCompanies}</div>
            <p className="text-xs text-muted-foreground">In database</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tech Companies</CardTitle>
            <Building className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{techCompanies}</div>
            <p className="text-xs text-muted-foreground">Technology sector</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Large + Enterprise</CardTitle>
            <Building className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{largeCompanies}</div>
            <p className="text-xs text-muted-foreground">Major prospects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
            <HandshakeIcon className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{companiesWithClients}</div>
            <p className="text-xs text-muted-foreground">Paying customers</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Company Database</CardTitle>
              <CardDescription>
                Track organizations and business relationships
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                createCompanyForm.reset();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Company
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Company</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void createCompanyForm.handleSubmit();
                  }}
                  className="space-y-4"
                >
                  <div>
                    <createCompanyForm.Field name="name">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Company Name</Label>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Enter company name..."
                          />
                          {field.state.meta.errors.map((error) => (
                            <p key={String(error)} className="text-red-500 text-sm">
                              {String(error)}
                            </p>
                          ))}
                        </div>
                      )}
                    </createCompanyForm.Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createCompanyForm.Field name="industry">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Industry</Label>
                            <Select
                              value={field.state.value}
                              onValueChange={(value) => field.handleChange(value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select industry" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No industry</SelectItem>
                                <SelectItem value="technology">Technology</SelectItem>
                                <SelectItem value="finance">Finance</SelectItem>
                                <SelectItem value="healthcare">Healthcare</SelectItem>
                                <SelectItem value="retail">Retail</SelectItem>
                                <SelectItem value="manufacturing">Manufacturing</SelectItem>
                                <SelectItem value="education">Education</SelectItem>
                                <SelectItem value="consulting">Consulting</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                    <div>
                      <createCompanyForm.Field name="size">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Company Size</Label>
                            <Select
                              value={field.state.value}
                              onValueChange={(value) => field.handleChange(value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select size" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No size</SelectItem>
                                <SelectItem value="startup">Startup (1-10)</SelectItem>
                                <SelectItem value="small">Small (11-50)</SelectItem>
                                <SelectItem value="medium">Medium (51-200)</SelectItem>
                                <SelectItem value="large">Large (201-1000)</SelectItem>
                                <SelectItem value="enterprise">Enterprise (1000+)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createCompanyForm.Field name="website">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Website</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="url"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="https://company.com"
                            />
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                    <div>
                      <createCompanyForm.Field name="email">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Email</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="email"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="contact@company.com"
                            />
                            {field.state.meta.errors.map((error) => (
                              <p key={String(error)} className="text-red-500 text-sm">
                                {String(error)}
                              </p>
                            ))}
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <createCompanyForm.Field name="phone">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Phone</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="tel"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="+1 (555) 123-4567"
                            />
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                    <div>
                      <createCompanyForm.Field name="address">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Address</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="Company address..."
                            />
                          </div>
                        )}
                      </createCompanyForm.Field>
                    </div>
                  </div>

                  <div>
                    <createCompanyForm.Field name="notes">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Notes</Label>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Additional notes about this company..."
                          />
                        </div>
                      )}
                    </createCompanyForm.Field>
                  </div>

                  <createCompanyForm.Subscribe>
                    {(state) => (
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={!state.canSubmit || state.isSubmitting || createCompanyMutation.isPending}
                      >
                        {state.isSubmitting || createCompanyMutation.isPending ? "Creating..." : "Create Company"}
                      </Button>
                    )}
                  </createCompanyForm.Subscribe>
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
                  placeholder="Search companies..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={industryFilter} onValueChange={setIndustryFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Industries</SelectItem>
                <SelectItem value="technology">Technology</SelectItem>
                <SelectItem value="finance">Finance</SelectItem>
                <SelectItem value="healthcare">Healthcare</SelectItem>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="manufacturing">Manufacturing</SelectItem>
                <SelectItem value="education">Education</SelectItem>
                <SelectItem value="consulting">Consulting</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sizeFilter} onValueChange={setSizeFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sizes</SelectItem>
                <SelectItem value="startup">Startup</SelectItem>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {companiesQuery.isPending ? (
            <div>Loading companies...</div>
          ) : companiesQuery.error ? (
            <div className="text-red-500">Error loading companies: {companiesQuery.error.message}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact Info</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Relationships</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((company) => {
                  const stats = getCompanyStats(company.id);
                  return (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            <Building className="h-4 w-4" />
                            {company.name}
                          </div>
                          {company.address && (
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {company.address}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {company.email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3" />
                              {company.email}
                            </div>
                          )}
                          {company.phone && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {company.phone}
                            </div>
                          )}
                          {company.website && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Globe className="h-3 w-3" />
                              <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                Website
                              </a>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {company.industry ? (
                          <Badge className={getIndustryBadgeColor(company.industry)} variant="outline">
                            {company.industry}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No industry</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {company.size ? (
                          <Badge className={getSizeBadgeColor(company.size)} variant="outline">
                            {company.size}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No size</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {stats.leads > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Users className="h-3 w-3 mr-1" />
                              {stats.leads} leads
                            </Badge>
                          )}
                          {stats.opportunities > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Target className="h-3 w-3 mr-1" />
                              {stats.opportunities} opps
                            </Badge>
                          )}
                          {stats.clients > 0 && (
                            <Badge variant="outline" className="text-xs text-green-700">
                              <HandshakeIcon className="h-3 w-3 mr-1" />
                              {stats.clients} clients
                            </Badge>
                          )}
                          {stats.leads === 0 && stats.opportunities === 0 && stats.clients === 0 && (
                            <span className="text-xs text-muted-foreground">No relationships</span>
                          )}
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
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              Create Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              Create Opportunity
                            </DropdownMenuItem>
                            {userProfile.data?.role === 'admin' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem>
                                  Edit Company
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}