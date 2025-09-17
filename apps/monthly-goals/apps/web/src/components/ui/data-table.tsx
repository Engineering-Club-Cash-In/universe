import {
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import type {
	ColumnDef,
	ColumnFiltersState,
	SortingState,
	VisibilityState,
	Column,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, MoreHorizontal, Search, Filter, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData, TValue> {
	columns: ColumnDef<TData, TValue>[];
	data: TData[];
	searchPlaceholder?: string;
	searchKey?: keyof TData;
	isLoading?: boolean;
	emptyMessage?: string;
}

export function DataTable<TData, TValue>({
	columns,
	data,
	searchPlaceholder = "Buscar...",
	searchKey,
	isLoading = false,
	emptyMessage = "No hay datos disponibles",
}: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [globalFilter, setGlobalFilter] = useState("");

	const table = useReactTable({
		data,
		columns,
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: setColumnVisibility,
		onGlobalFilterChange: setGlobalFilter,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			globalFilter,
		},
		initialState: {
			pagination: {
				pageSize: 10,
			},
		},
	});

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex items-center py-4">
					<div className="h-10 w-full max-w-sm bg-gray-200 rounded animate-pulse" />
				</div>
				<div className="rounded-md border">
					<div className="h-64 bg-gray-50 flex items-center justify-center">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex items-center justify-between">
				<div className="flex items-center space-x-2">
					{/* Global Search */}
					<div className="relative">
						<Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
						<Input
							placeholder={searchPlaceholder}
							value={globalFilter}
							onChange={(event) => setGlobalFilter(event.target.value)}
							className="pl-8 max-w-sm"
						/>
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="rounded-md border bg-white">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									return (
										<TableHead key={header.id} className="font-medium">
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext()
													)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() && "selected"}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext()
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									{emptyMessage}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			<div className="flex items-center justify-between space-x-2 py-4">
				<div className="flex-1 text-sm text-gray-600">
					{table.getFilteredSelectedRowModel().rows.length > 0 && (
						<span>
							{table.getFilteredSelectedRowModel().rows.length} de{" "}
							{table.getFilteredRowModel().rows.length} fila(s) seleccionada(s).
						</span>
					)}
				</div>
				<div className="flex items-center space-x-6">
					<div className="flex items-center space-x-2">
						<p className="text-sm font-medium">Filas por página</p>
						<select
							value={table.getState().pagination.pageSize}
							onChange={(e) => {
								table.setPageSize(Number(e.target.value));
							}}
							className="h-8 w-[70px] rounded-md border border-gray-300 bg-white px-2 text-sm"
						>
							{[10, 20, 30, 40, 50].map((pageSize) => (
								<option key={pageSize} value={pageSize}>
									{pageSize}
								</option>
							))}
						</select>
					</div>
					<div className="flex w-[100px] items-center justify-center text-sm font-medium">
						Página {table.getState().pagination.pageIndex + 1} de{" "}
						{table.getPageCount()}
					</div>
					<div className="flex items-center space-x-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.setPageIndex(0)}
							disabled={!table.getCanPreviousPage()}
							className="cursor-pointer disabled:cursor-not-allowed"
						>
							{"<<"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
							className="cursor-pointer disabled:cursor-not-allowed"
						>
							{"<"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.nextPage()}
							disabled={!table.getCanNextPage()}
							className="cursor-pointer disabled:cursor-not-allowed"
						>
							{">"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.setPageIndex(table.getPageCount() - 1)}
							disabled={!table.getCanNextPage()}
							className="cursor-pointer disabled:cursor-not-allowed"
						>
							{">>"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

// Helper para crear columnas sortables
export function createSortableHeader(title: string) {
	return ({ column }: { column: Column<any, unknown> }) => {
		return (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				className="h-auto p-0 hover:bg-transparent cursor-pointer"
			>
				{title}
				<ArrowUpDown className="ml-2 h-4 w-4" />
			</Button>
		);
	};
}

// Helper para crear headers con filtros de select
export function createFilterableHeader(title: string, options: Array<{ label: string; value: string }>) {
	return ({ column }: { column: Column<any, unknown> }) => {
		const filterValue = column.getFilterValue() as string[] || [];
		const hasActiveFilters = filterValue.length > 0;
		
		return (
			<div className="flex items-center space-x-2">
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
					className="h-auto p-0 hover:bg-transparent cursor-pointer"
				>
					{title}
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className={`h-6 w-6 p-0 cursor-pointer ${hasActiveFilters ? 'text-blue-600' : ''}`}
						>
							<Filter className="h-3 w-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem
							onClick={() => {
								// Seleccionar todos
								column.setFilterValue(options.map(opt => opt.value));
							}}
						>
							Seleccionar todos
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								// Deseleccionar todos (mostrar todos)
								column.setFilterValue([]);
							}}
						>
							Mostrar todos
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{options.map((option) => (
							<DropdownMenuCheckboxItem
								key={option.value}
								checked={filterValue.includes(option.value)}
								onCheckedChange={(checked) => {
									if (checked) {
										// Agregar a la lista de filtros
										column.setFilterValue([...filterValue, option.value]);
									} else {
										// Remover de la lista de filtros
										column.setFilterValue(filterValue.filter(v => v !== option.value));
									}
								}}
							>
								{option.label}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		);
	};
}

// Helper para crear columnas con acciones
export function createActionsColumn<T>(
	actions: Array<{
		label: string;
		icon?: React.ComponentType<{ className?: string }>;
		onClick: (item: T) => void;
		variant?: "default" | "destructive";
		show?: (item: T) => boolean;
	}>
) {
	return {
		id: "actions",
		enableHiding: false,
		cell: ({ row }: any) => {
			const item = row.original;

			return (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" className="h-8 w-8 p-0">
							<span className="sr-only">Abrir menú</span>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{actions
							.filter((action) => !action.show || action.show(item))
							.map((action, index) => (
								<DropdownMenuItem
									key={index}
									onClick={() => action.onClick(item)}
									className={action.variant === "destructive" ? "text-red-600" : ""}
								>
									{action.icon && <action.icon className="mr-2 h-4 w-4" />}
									{action.label}
								</DropdownMenuItem>
							))}
					</DropdownMenuContent>
				</DropdownMenu>
			);
		},
	};
}