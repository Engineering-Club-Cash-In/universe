"use client";

import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
	searchColumn?: string;
	filterContent?: React.ReactNode;
	extraSearch?: React.ReactNode;
	isLoading?: boolean;
	// Paginación del servidor
	serverPagination?: {
		page: number;
		pageSize: number;
		totalPages: number;
		totalItems: number;
		onPageChange: (page: number) => void;
		onPageSizeChange?: (pageSize: number) => void;
	};
	setGlobalFilterParam?: (filter: string) => void;
	onRowClick?: (row: TData) => void;
	hideSearch?: boolean;
	pageSizeOptions?: number[];
	tableContainerClass?: string;
	stickyFirstColumn?: boolean;
	stickyHeader?: boolean;
}

export function DataTable<TData, TValue>({
	columns,
	data,
	searchPlaceholder = "Buscar...",
	isLoading,
	searchColumn,
	filterContent,
	extraSearch,
	serverPagination,
	setGlobalFilterParam,
	onRowClick,
	hideSearch,
	pageSizeOptions = [10, 20, 30, 40, 50],
	tableContainerClass,
	stickyFirstColumn,
	stickyHeader,
}: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [rowSelection, setRowSelection] = useState({});
	const [globalFilter, setGlobalFilter] = useState("");

	const isServerPagination = !!serverPagination;

	const table = useReactTable({
		data,
		columns,
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: isServerPagination
			? undefined
			: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: setColumnVisibility,
		onRowSelectionChange: setRowSelection,
		onGlobalFilterChange: isServerPagination ? undefined : setGlobalFilter,
		globalFilterFn: "includesString",
		...(isServerPagination && {
			manualPagination: true,
			pageCount: serverPagination.totalPages,
		}),
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection,
			globalFilter: isServerPagination ? "" : globalFilter,
			...(isServerPagination && {
				pagination: {
					pageIndex: serverPagination.page - 1,
					pageSize: serverPagination.pageSize,
				},
			}),
		},
	});

	return (
		<div className="w-full min-w-0 space-y-4">
			{(!hideSearch || filterContent || extraSearch) && (
				<div className="flex flex-col gap-4">
					{(!hideSearch || extraSearch) && (
						<div className="flex flex-wrap items-center gap-2">
							{!hideSearch && (
								<Input
									placeholder={searchPlaceholder}
									value={globalFilter ?? ""}
									onChange={(event) => {
										if (setGlobalFilterParam) {
											setGlobalFilterParam(event.target.value);
										}
										setGlobalFilter(event.target.value);
									}}
									className="max-w-sm"
								/>
							)}
							{extraSearch}
						</div>
					)}
					{filterContent && (
						<div className="flex flex-wrap gap-2">{filterContent}</div>
					)}
				</div>
			)}

			<div className={`w-full overflow-x-auto rounded-md border${tableContainerClass ? ` ${tableContainerClass}` : ""}`}>
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header, idx) => {
									return (
										<TableHead
											key={header.id}
											className={stickyFirstColumn && idx === 0 ? "sticky left-0 z-20 bg-background shadow-[1px_0_0_0_hsl(var(--border))]" : ""}
										>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									<div className="flex items-center justify-center gap-2">
										<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
										<span className="text-muted-foreground">
											Cargando datos...
										</span>
									</div>
								</TableCell>
							</TableRow>
						) : table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() && "selected"}
									className={
										onRowClick ? "cursor-pointer hover:bg-muted/50" : ""
									}
									onClick={() => onRowClick?.(row.original)}
								>
									{row.getVisibleCells().map((cell, idx) => (
										<TableCell
											key={cell.id}
											className={stickyFirstColumn && idx === 0 ? "sticky left-0 z-10 bg-background shadow-[1px_0_0_0_hsl(var(--border))]" : ""}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
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
									No se encontraron resultados.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className="flex items-center justify-between px-2">
				<div className="flex-1 text-muted-foreground text-sm">
					{isServerPagination ? (
						<span>
							Mostrando{" "}
							{Math.min(
								(serverPagination.page - 1) * serverPagination.pageSize + 1,
								serverPagination.totalItems,
							)}{" "}
							a{" "}
							{Math.min(
								serverPagination.page * serverPagination.pageSize,
								serverPagination.totalItems,
							)}{" "}
							de {serverPagination.totalItems} registros
						</span>
					) : (
						table.getFilteredSelectedRowModel().rows.length > 0 && (
							<span>
								{table.getFilteredSelectedRowModel().rows.length} de{" "}
								{table.getFilteredRowModel().rows.length} fila(s)
								seleccionada(s).
							</span>
						)
					)}
				</div>
				<div className="flex items-center space-x-6 lg:space-x-8">
					<div className="flex items-center space-x-2">
						<p className="font-medium text-sm">Filas por página</p>
						<select
							value={
								isServerPagination
									? serverPagination.pageSize
									: table.getState().pagination.pageSize
							}
							onChange={(e) => {
								const size = Number(e.target.value);
								if (isServerPagination) {
									serverPagination.onPageSizeChange?.(size);
								} else {
									table.setPageSize(size);
								}
							}}
							className="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-sm"
						>
							{pageSizeOptions.map((pageSize) => (
								<option key={pageSize} value={pageSize}>
									{pageSize}
								</option>
							))}
						</select>
					</div>
					<div className="flex w-[100px] items-center justify-center font-medium text-sm">
						Página{" "}
						{isServerPagination
							? serverPagination.page
							: table.getState().pagination.pageIndex + 1}{" "}
						de{" "}
						{isServerPagination
							? serverPagination.totalPages
							: table.getPageCount()}
					</div>
					<div className="flex items-center space-x-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								if (isServerPagination) {
									serverPagination.onPageChange(1);
								} else {
									table.setPageIndex(0);
								}
							}}
							disabled={
								isLoading ||
								(isServerPagination
									? serverPagination.page === 1
									: !table.getCanPreviousPage())
							}
						>
							Primera
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								if (isServerPagination) {
									serverPagination.onPageChange(serverPagination.page - 1);
								} else {
									table.previousPage();
								}
							}}
							disabled={
								isLoading ||
								(isServerPagination
									? serverPagination.page === 1
									: !table.getCanPreviousPage())
							}
						>
							Anterior
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								if (isServerPagination) {
									serverPagination.onPageChange(serverPagination.page + 1);
								} else {
									table.nextPage();
								}
							}}
							disabled={
								isLoading ||
								(isServerPagination
									? serverPagination.page >= serverPagination.totalPages
									: !table.getCanNextPage())
							}
						>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Cargando
								</>
							) : (
								"Siguiente"
							)}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								if (isServerPagination) {
									serverPagination.onPageChange(serverPagination.totalPages);
								} else {
									table.setPageIndex(table.getPageCount() - 1);
								}
							}}
							disabled={
								isLoading ||
								(isServerPagination
									? serverPagination.page >= serverPagination.totalPages
									: !table.getCanNextPage())
							}
						>
							Última
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
