import { createFileRoute } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import * as React from "react";
import type { ShowcaseMeta } from "@/components/design-system/showcase/_layout";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

/**
 * Catálogo vivo del Design System (Figma "CRM Ventas"). Sirve para comparar cada
 * componente contra Figma en modo claro y oscuro. No consume datos del servidor.
 */
export const Route = createFileRoute("/design-system")({
	// ?theme=light|dark fuerza el modo y ?only=a,b muestra solo esas secciones
	// (nombre del archivo sin ".showcase.tsx"). Útiles para capturas automáticas.
	validateSearch: (
		search: Record<string, unknown>,
	): { theme?: "light" | "dark"; only?: string; brand?: Brand } => ({
		...(search.theme === "light" || search.theme === "dark"
			? { theme: search.theme }
			: {}),
		...(typeof search.only === "string" ? { only: search.only } : {}),
		...(search.brand === "violeta" || search.brand === "teal"
			? { brand: search.brand }
			: {}),
	}),
	component: DesignSystemPage,
	head: () => ({ meta: [{ title: "Design System — CCI CRM" }] }),
});

type Brand = "violeta" | "teal";

/**
 * Comparar con el teal original de Figma, solo en esta página (presentaciones).
 * No se guarda: al salir de /design-system el CRM vuelve al violeta oficial.
 */
function useBrandPreview(initial: Brand = "violeta") {
	const [brand, setBrand] = React.useState<Brand>(initial);
	React.useEffect(() => {
		const root = document.documentElement;
		if (brand === "teal") root.dataset.brand = "teal";
		else delete root.dataset.brand;
		return () => {
			delete root.dataset.brand;
		};
	}, [brand]);
	return [brand, setBrand] as const;
}

type ShowcaseModule = {
	meta: ShowcaseMeta;
	default: () => React.JSX.Element;
};

// Carga diferida: si una sección no compila, solo esa muestra el error.
const loaders = import.meta.glob<ShowcaseModule>(
	"../components/design-system/showcase/*.showcase.tsx",
);

type LoadedSection =
	| {
			id: string;
			ok: true;
			meta: ShowcaseMeta;
			Component: () => React.JSX.Element;
	  }
	| { id: string; ok: false; error: string };

function idFromPath(path: string) {
	return path.split("/").pop()?.replace(".showcase.tsx", "") ?? path;
}

class SectionBoundary extends React.Component<
	{ children: React.ReactNode },
	{ error: Error | null }
> {
	state = { error: null as Error | null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	render() {
		if (this.state.error) {
			return <SectionError message={this.state.error.message} />;
		}
		return this.props.children;
	}
}

function SectionError({ message }: { message: string }) {
	return (
		<pre className="type-body-sm whitespace-pre-wrap rounded-xl bg-danger-subtle p-4 text-danger-text">
			{message}
		</pre>
	);
}

function DesignSystemPage() {
	const { theme, setTheme } = useTheme();
	const { theme: forcedTheme, only, brand: initialBrand } = Route.useSearch();
	const [brand, setBrand] = useBrandPreview(initialBrand);
	const [sections, setSections] = React.useState<LoadedSection[] | null>(null);

	React.useEffect(() => {
		if (forcedTheme) setTheme(forcedTheme);
	}, [forcedTheme, setTheme]);

	React.useEffect(() => {
		const onlyIds = only?.split(",");
		const entries = Object.entries(loaders).filter(
			([path]) => !onlyIds || onlyIds.includes(idFromPath(path)),
		);
		let cancelled = false;
		Promise.allSettled(entries.map(([, load]) => load())).then((results) => {
			if (cancelled) return;
			const loaded: LoadedSection[] = results.map((r, i) => {
				const id = idFromPath(entries[i][0]);
				return r.status === "fulfilled"
					? { id, ok: true, meta: r.value.meta, Component: r.value.default }
					: { id, ok: false, error: String(r.reason?.message ?? r.reason) };
			});
			loaded.sort(
				(a, b) =>
					(a.ok ? a.meta.order : 9999) - (b.ok ? b.meta.order : 9999) ||
					a.id.localeCompare(b.id),
			);
			setSections(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [only]);

	const isDark =
		theme === "dark" ||
		(theme === "system" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);

	return (
		<div className="overflow-y-auto bg-canvas">
			<div className="mx-auto grid max-w-360 grid-cols-[220px_1fr] gap-10 px-10 py-8">
				<nav className="sticky top-8 h-fit space-y-1">
					<p className="type-label-sm mb-3 text-fg-tertiary uppercase">
						Componentes
					</p>
					{sections?.map((s) => (
						<a
							key={s.id}
							href={`#${s.id}`}
							className="type-body-sm block rounded-md px-2 py-1 text-fg-secondary hover:bg-muted hover:text-fg"
						>
							{s.ok ? s.meta.title : `⚠ ${s.id}`}
						</a>
					))}
				</nav>
				<main className="space-y-8">
					<header className="flex items-start justify-between gap-6">
						<div>
							<h1 className="type-display-md text-fg">
								Design System — CCI CRM
							</h1>
							<p className="type-body-base mt-1 text-fg-secondary">
								Componentes del Figma «CRM Ventas» implementados en el CRM.
								Fuente: docs/design-system/.
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-3">
							<div
								title="Color de marca (solo para presentaciones)"
								className="flex items-center gap-1 rounded-xl border border-line p-1"
							>
								{(
									[
										["violeta", "Violeta (oficial)", "bg-[#5260ff]"],
										["teal", "Verde (Figma)", "bg-[#1fa79b]"],
									] as const
								).map(([value, label, swatch]) => (
									<button
										key={value}
										type="button"
										aria-pressed={brand === value}
										onClick={() => setBrand(value)}
										className={`type-label-sm flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 ${brand === value ? "bg-muted text-fg" : "text-fg-secondary hover:text-fg"}`}
									>
										<span className={`size-3 rounded-full ${swatch}`} />
										{label}
									</button>
								))}
							</div>
							<Button
								variant="outline"
								onClick={() => setTheme(isDark ? "light" : "dark")}
							>
								{isDark ? <Sun /> : <Moon />}
								{isDark ? "Modo claro" : "Modo oscuro"}
							</Button>
						</div>
					</header>
					{sections === null ? (
						<p className="type-body-base text-fg-secondary">Cargando…</p>
					) : null}
					{sections?.map((s) => (
						<section
							key={s.id}
							id={s.id}
							className="scroll-mt-8 rounded-2xl border border-line-subtle bg-surface p-8 shadow-clay-subtle"
						>
							{s.ok ? (
								<>
									<div className="mb-6">
										<h2 className="type-heading-lg text-fg">{s.meta.title}</h2>
										<p className="type-caption mt-1 text-fg-tertiary">
											Figma: {s.meta.figma}
										</p>
										{s.meta.description ? (
											<p className="type-body-sm mt-2 max-w-3xl text-fg-secondary">
												{s.meta.description}
											</p>
										) : null}
									</div>
									<SectionBoundary>
										<s.Component />
									</SectionBoundary>
								</>
							) : (
								<>
									<h2 className="type-heading-lg mb-4 text-fg">{s.id}</h2>
									<SectionError message={s.error} />
								</>
							)}
						</section>
					))}
				</main>
			</div>
		</div>
	);
}
