import { Slot } from "@radix-ui/react-slot";
import { MoreHorizontal } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Breadcrumb — Figma "02 · Componentes › Breadcrumb" (121:917).
 *
 * Figma → código (API composable, igual a la de shadcn):
 *   niveles anteriores (500, text/tertiary)  → <BreadcrumbLink> (asChild para usar <Link> del router)
 *   separador "/" (400, text/tertiary)       → <BreadcrumbSeparator> (children opcional para cambiarlo)
 *   nivel actual (600, text/primary)         → <BreadcrumbPage> (aria-current="page")
 * Texto 13px con interlineado auto (126%) y gap de 8px entre piezas.
 * Hover de los enlaces (no definido en Figma): pasan a text/secondary.
 *
 * Ejemplo:
 *   <Breadcrumb>
 *     <BreadcrumbList>
 *       <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Dashboard</Link></BreadcrumbLink></BreadcrumbItem>
 *       <BreadcrumbSeparator />
 *       <BreadcrumbItem><BreadcrumbPage>Crédito #48213</BreadcrumbPage></BreadcrumbItem>
 *     </BreadcrumbList>
 *   </Breadcrumb>
 */

function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
	return (
		<nav aria-label="Ruta de navegación" data-slot="breadcrumb" {...props} />
	);
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
	return (
		<ol
			data-slot="breadcrumb-list"
			className={cn(
				"flex flex-wrap items-center gap-2 break-words text-[13px] text-fg-tertiary leading-[1.26]",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-item"
			className={cn("inline-flex items-center gap-2", className)}
			{...props}
		/>
	);
}

function BreadcrumbLink({
	asChild,
	className,
	...props
}: React.ComponentProps<"a"> & {
	asChild?: boolean;
}) {
	const Comp = asChild ? Slot : "a";

	return (
		<Comp
			data-slot="breadcrumb-link"
			className={cn(
				"rounded-sm font-medium text-fg-tertiary outline-none transition-colors duration-150 hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="breadcrumb-page"
			aria-current="page"
			className={cn("font-semibold text-fg", className)}
			{...props}
		/>
	);
}

function BreadcrumbSeparator({
	children,
	className,
	...props
}: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-separator"
			role="presentation"
			aria-hidden="true"
			className={cn("font-normal text-fg-tertiary [&>svg]:size-3.5", className)}
			{...props}
		>
			{children ?? "/"}
		</li>
	);
}

function BreadcrumbEllipsis({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="breadcrumb-ellipsis"
			role="presentation"
			aria-hidden="true"
			className={cn("flex size-4 items-center justify-center", className)}
			{...props}
		>
			<MoreHorizontal className="size-4" />
			<span className="sr-only">Más niveles</span>
		</span>
	);
}

export {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	BreadcrumbSeparator,
	BreadcrumbEllipsis,
};
