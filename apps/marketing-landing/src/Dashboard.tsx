import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type CellContext,
  type HeaderGroup,
  type Header,
  type Row,
  type Cell,
} from "@tanstack/react-table";
import { getAllInvestorLeads, getAllClientLeads } from "@/services/eden";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InvestorLead, ClientLead } from "@repo/backend-2/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Define column helpers outside the component
const investorColumnHelper = createColumnHelper<InvestorLead>();
const clientColumnHelper = createColumnHelper<ClientLead>();

// Define columns for Investor Leads
const investorColumns = [
  investorColumnHelper.accessor("id", {
    header: "ID",
    cell: (info: CellContext<InvestorLead, number>) => info.getValue(),
  }),
  investorColumnHelper.accessor("fullName", {
    header: "Nombre Completo",
    cell: (info: CellContext<InvestorLead, string | null>) => info.getValue(),
  }),
  investorColumnHelper.accessor("email", {
    header: "Correo Electrónico",
    cell: (info: CellContext<InvestorLead, string | null>) => info.getValue(),
  }),
  investorColumnHelper.accessor("phoneNumber", {
    header: "Número de Teléfono",
    cell: (info: CellContext<InvestorLead, string | null>) => info.getValue(),
  }),
  investorColumnHelper.accessor("hasInvested", {
    header: "¿Ha Invertido?",
    cell: (info: CellContext<InvestorLead, boolean>) => (info.getValue() ? "Sí" : "No"),
  }),
  investorColumnHelper.accessor("hasBankAccount", {
    header: "¿Tiene Cuenta Bancaria?",
    cell: (info: CellContext<InvestorLead, boolean>) => (info.getValue() ? "Sí" : "No"),
  }),
  investorColumnHelper.accessor("investmentRange", {
    header: "Rango de Inversión",
    cell: (info: CellContext<InvestorLead, string | null>) => info.getValue(),
  }),
  investorColumnHelper.accessor("contactMethod", {
    header: "Método de Contacto",
    cell: (info: CellContext<InvestorLead, string | null>) => info.getValue(),
  }),
  investorColumnHelper.accessor("createdAt", {
    header: "Fecha de Creación",
    cell: (info: CellContext<InvestorLead, Date | null>) =>
      info.getValue() ? new Date(info.getValue()!).toLocaleDateString() : "N/D",
  }),
];

// Define columns for Client Leads
const clientColumns = [
  clientColumnHelper.accessor("id", {
    header: "ID",
    cell: (info: CellContext<ClientLead, number>) => info.getValue(),
  }),
  clientColumnHelper.accessor("firstName", {
    header: "Nombre",
    cell: (info: CellContext<ClientLead, string>) => info.getValue(),
  }),
  clientColumnHelper.accessor("lastName", {
    header: "Apellido",
    cell: (info: CellContext<ClientLead, string>) => info.getValue(),
  }),
  clientColumnHelper.accessor("phoneNumber", {
    header: "Número de Teléfono",
    cell: (info: CellContext<ClientLead, string>) => info.getValue(),
  }),
  clientColumnHelper.accessor("ready", {
    header: "¿Listo para Proceder?",
    cell: (info: CellContext<ClientLead, boolean>) => (info.getValue() ? "Sí" : "No"),
  }),
  clientColumnHelper.accessor("loanType", {
    header: "Tipo de Préstamo",
    cell: (info: CellContext<ClientLead, string>) =>
      info.getValue() === "carLoan" ? "Préstamo Vehicular" : "Préstamo Prendario",
  }),
  clientColumnHelper.accessor("createdAt", {
    header: "Fecha de Creación",
    cell: (info: CellContext<ClientLead, Date | null>) =>
      info.getValue() ? new Date(info.getValue()!).toLocaleDateString() : "N/D",
  }),
];

// Generic LeadsTable component
interface LeadsTableProps<TData> {
  data: TData[];
  columns: any[]; // Adjust columns type if needed, or use ColumnDef<TData>[]
}

const LeadsTable = <TData,>({ data, columns }: LeadsTableProps<TData>) => {
  const table = useReactTable<TData>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10, // Show 10 rows per page
      },
    },
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup: HeaderGroup<TData>) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header: Header<TData, unknown>) => (
                <TableHead
                  key={header.id}
                  style={{
                    width: header.getSize() !== 150 ? header.getSize() : undefined,
                  }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row: Row<TData>) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                {row.getVisibleCells().map((cell: Cell<TData, unknown>) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end space-x-2 py-4 px-4">
        <span className="flex items-center gap-1">
          <div>Página</div>
          <strong>
            {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </strong>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
};

export default function Dashboard() {
  // --- Login State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // --- Data Fetching (conditionally enabled) ---
  const {
    data: investorLeadsResult,
    isLoading: isLoadingInvestor,
    error: investorError,
  } = useQuery({
    queryKey: ["investorLeads"],
    queryFn: getAllInvestorLeads,
    enabled: isAuthenticated, // Only fetch when authenticated
  });

  const {
    data: clientLeadsResult,
    isLoading: isLoadingClient,
    error: clientError,
  } = useQuery({
    queryKey: ["clientLeads"],
    queryFn: getAllClientLeads,
    enabled: isAuthenticated, // Only fetch when authenticated
  });

  // --- Memoized Data ---
  const investorLeads = useMemo<InvestorLead[]>(() => {
    if (investorLeadsResult?.data?.success && Array.isArray(investorLeadsResult.data.data)) {
      return investorLeadsResult.data.data as InvestorLead[];
    }
    return [];
  }, [investorLeadsResult]);

  const clientLeads = useMemo<ClientLead[]>(() => {
    if (clientLeadsResult?.data?.success && Array.isArray(clientLeadsResult.data.data)) {
      return clientLeadsResult.data.data as ClientLead[];
    }
    return [];
  }, [clientLeadsResult]);

  // --- Login Handler ---
  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(""); // Clear previous errors
    if (username === "admin" && password === "admin") {
      setIsAuthenticated(true);
    } else {
      setLoginError("Credenciales inválidas.");
    }
  };

  // --- Render Login Form if not authenticated ---
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-center">Iniciar Sesión</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="usuario"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="contraseña"
                />
              </div>
              {loginError && <p className="text-sm text-red-500 text-center">{loginError}</p>}
              <Button type="submit" className="w-full">
                Ingresar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Render Dashboard Content if authenticated ---

  // Check loading state *after* authentication check
  if (isLoadingInvestor || isLoadingClient) {
    return <div className="p-4">Cargando...</div>;
  }

  // Check error state *after* authentication check
  if (investorError || clientError) {
    return (
      <div className="p-4 text-red-500">
        {investorError && <p>Error al cargar leads de inversores: {investorError.message}</p>}
        {clientError && <p>Error al cargar leads de clientes: {clientError.message}</p>}
      </div>
    );
  }

  // Calculate totals *after* ensuring data is loaded and valid
  const totalInvestorLeads = investorLeads.length;
  const totalClientLeads = clientLeads.length;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Panel de Leads</h1>

      {/* Stats Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Leads de Inversores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalInvestorLeads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Leads de Clientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalClientLeads}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Tables */}
      <Tabs defaultValue="investor" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="investor">Leads de Inversores</TabsTrigger>
          <TabsTrigger value="client">Leads de Clientes</TabsTrigger>
        </TabsList>
        <TabsContent value="investor" className="mt-4">
          <LeadsTable<InvestorLead> data={investorLeads} columns={investorColumns} />
        </TabsContent>
        <TabsContent value="client" className="mt-4">
          <LeadsTable<ClientLead> data={clientLeads} columns={clientColumns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
