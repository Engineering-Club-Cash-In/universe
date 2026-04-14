import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize, Minimize } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/presentations/$id/view")({
	component: ViewPresentationPage,
});

type PresentationMode = "detail" | "consolidated";

type DetailRow = {
	month: number;
	year: number;
	periodLabel: string;
	progressPercentage: number;
	departmentId: string | null;
	departmentName: string | null;
	areaId: string | null;
	areaName: string | null;
	userId: string | null;
	userName: string | null;
	goalTemplateId: string | null;
	goalTemplateName: string | null;
	goalTemplateUnit: string | null;
	targetValue: string;
	achievedValue: string;
	isInverse: boolean | null;
	notes: string | null;
};

type ConsolidatedRow = {
	departmentId: string;
	departmentName: string;
	areaId: string;
	areaName: string;
	userId: string;
	goalTemplateId: string;
	userName: string | null;
	userEmail: string | null;
	goalTemplateName: string | null;
	goalTemplateUnit: string | null;
	isInverse: boolean | null;
	includedMonths: Array<{ month: number; year: number }>;
	monthlyRows: DetailRow[];
	consolidatedTargetValue: string;
	consolidatedAchievedValue: string;
	consolidatedProgressPercentage: number;
};

type PresentationPayload = {
	presentation: {
		id: string;
		name: string;
		startMonth: number;
		startYear: number;
		endMonth: number;
		endYear: number;
		status: string;
	};
	periods: Array<{ month: number; year: number; label: string }>;
	detailRows: DetailRow[];
	consolidatedRows: ConsolidatedRow[];
};

type PresentationPayloadClient = typeof client & {
	presentations: typeof client.presentations & {
		payload: (input: { presentationId: string }) => Promise<PresentationPayload>;
	};
};

type OrganizedPerson = {
	name: string;
	userName: string;
	departmentName: string;
	areaName: string;
	goals: DetailRow[];
};

type OrganizedArea = {
	name: string;
	people: OrganizedPerson[];
};

type OrganizedDepartment = {
	name: string;
	areas: OrganizedArea[];
};

type OrganizedConsolidatedArea = {
	name: string;
	rows: ConsolidatedRow[];
};

type OrganizedConsolidatedDepartment = {
	name: string;
	areas: OrganizedConsolidatedArea[];
};

const MONTH_NAMES = [
	"",
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

function formatMonthLabel(month: number, year: number) {
	return `${MONTH_NAMES[month] ?? `Mes ${month}`} ${year}`;
}

function formatRangeLabel(startMonth: number, startYear: number, endMonth: number, endYear: number) {
	const startLabel = formatMonthLabel(startMonth, startYear);
	const endLabel = formatMonthLabel(endMonth, endYear);
	return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function formatNumber(value: string | number | null | undefined) {
	const numericValue = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
	if (Number.isNaN(numericValue)) {
		return "0";
	}

	return numericValue.toLocaleString(undefined, {
		maximumFractionDigits: 2,
	});
}

function getProgressPercentage(target: string, achieved: string, isInverse?: boolean) {
	const targetNum = Number.parseFloat(target);
	const achievedNum = Number.parseFloat(achieved);

	if (targetNum <= 0) return 0;

	if (isInverse) {
		if (achievedNum <= targetNum) {
			return 100;
		}

		return Math.max((targetNum / achievedNum) * 100, 0);
	}

	return (achievedNum / targetNum) * 100;
}

function getStatusBadge(percentage: number) {
	if (percentage >= 80) {
		return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
	}

	if (percentage >= 50) {
		return <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>;
	}

	return <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>;
}

function getPresentationLoadErrorMessage(error: unknown) {
	if (!error || typeof error !== "object") {
		return "No se pudo cargar la presentación.";
	}

	const normalizedError = error as {
		status?: number;
		code?: string;
		message?: string;
	};

	if (normalizedError.status === 404 || normalizedError.code === "NOT_FOUND") {
		return "Presentación no encontrada.";
	}

	if (normalizedError.status === 401 || normalizedError.code === "UNAUTHORIZED") {
		return "Tu sesión expiró. Vuelve a iniciar sesión para ver la presentación.";
	}

	if (normalizedError.status === 403 || normalizedError.code === "FORBIDDEN") {
		return "No tienes permisos para ver esta presentación.";
	}

	return normalizedError.message
		? `No se pudo cargar la presentación: ${normalizedError.message}`
		: "No se pudo cargar la presentación.";
}

function organizeDetailRows(rows: DetailRow[]): OrganizedDepartment[] {
	const departmentMap = new Map<
		string,
		{
			name: string;
			areas: Map<
				string,
				{
					name: string;
					people: Map<
						string,
						{
							name: string;
							userName: string;
							departmentName: string;
							areaName: string;
							goals: DetailRow[];
						}
					>;
				}
			>;
		}
	>();

	for (const row of rows) {
		const departmentName = row.departmentName ?? "Sin Departamento";
		const areaName = row.areaName ?? "Sin Área";
		const userName = row.userName ?? "Sin Usuario";
		const departmentKey = row.departmentId ? `id:${row.departmentId}` : `name:${departmentName}`;
		const areaKey = row.areaId ? `id:${row.areaId}` : `name:${areaName}`;
		const userKey = row.userId ? `id:${row.userId}` : `name:${userName}`;

		let department = departmentMap.get(departmentKey);
		if (!department) {
			department = {
				name: departmentName,
				areas: new Map(),
			};
			departmentMap.set(departmentKey, department);
		}

		let area = department.areas.get(areaKey);
		if (!area) {
			area = {
				name: areaName,
				people: new Map(),
			};
			department.areas.set(areaKey, area);
		}

		let person = area.people.get(userKey);
		if (!person) {
			person = {
				name: userName,
				userName,
				departmentName,
				areaName,
				goals: [],
			};
			area.people.set(userKey, person);
		}

		person.goals.push(row);
	}

	return Array.from(departmentMap.values()).map((department) => ({
		name: department.name,
		areas: Array.from(department.areas.values()).map((area) => ({
			name: area.name,
			people: Array.from(area.people.values()),
		})),
	}));
}

function organizeConsolidatedRows(rows: ConsolidatedRow[]): OrganizedConsolidatedDepartment[] {
	const departmentMap = new Map<
		string,
		{
			name: string;
			areas: Map<string, { name: string; rows: ConsolidatedRow[] }>;
		}
	>();

	for (const row of rows) {
		const departmentId = row.departmentId;
		const areaId = row.areaId;
		const departmentName = row.departmentName || "Sin Departamento";
		const areaName = row.areaName || "Sin Área";
		const departmentKey = departmentId ? `id:${departmentId}` : `name:${departmentName}`;
		const areaKey = areaId ? `id:${areaId}` : `name:${areaName}`;

		let department = departmentMap.get(departmentKey);
		if (!department) {
			department = {
				name: departmentName,
				areas: new Map(),
			};
			departmentMap.set(departmentKey, department);
		}

		let area = department.areas.get(areaKey);
		if (!area) {
			area = {
				name: areaName,
				rows: [],
			};
			department.areas.set(areaKey, area);
		}

		area.rows.push(row);
	}

	return Array.from(departmentMap.values()).map((department) => ({
		name: department.name,
		areas: Array.from(department.areas.values()),
	}));
}

function getMaxGoalsPerSlide() {
	if (typeof window === "undefined") return 4;

	const width = window.innerWidth;
	if (width < 640) return 1;
	if (width < 1024) return 2;
	if (width < 1280) return 3;
	return 4;
}

function ViewPresentationPage() {
	const { id } = Route.useParams();
	const [viewMode, setViewMode] = useState<PresentationMode>("detail");
	const [currentSlide, setCurrentSlide] = useState(0);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showControls, setShowControls] = useState(true);
	const [screenSize, setScreenSize] = useState(0);
	const payloadClient = client as PresentationPayloadClient;
	const payloadQuery = useQuery({
		queryKey: ["presentations", "payload", id],
		queryFn: () => payloadClient.presentations.payload({ presentationId: id }),
	});

	const payload: PresentationPayload | undefined = payloadQuery.data;
	const presentation = payload?.presentation;
	const periodLabel = presentation
		? formatRangeLabel(presentation.startMonth, presentation.startYear, presentation.endMonth, presentation.endYear)
		: "";

	const detailPeriods = useMemo(() => {
		if (!payload) return [];

		return payload.periods.map((period) => ({
			...period,
			rows: payload.detailRows.filter((row) => row.month === period.month && row.year === period.year),
		}));
	}, [payload]);

	const organizedDetailPeriods = useMemo(
		() =>
			detailPeriods.map((period) => ({
				...period,
				departments: organizeDetailRows(period.rows),
			})),
		[detailPeriods],
	);

	const organizedConsolidatedRows = useMemo(
		() => organizeConsolidatedRows(payload?.consolidatedRows ?? []),
		[payload],
	);

	useEffect(() => {
		setCurrentSlide(0);
	}, [viewMode, payload?.presentation.id]);

	useEffect(() => {
		let timeout: NodeJS.Timeout;

		const resetTimeout = () => {
			if (timeout) clearTimeout(timeout);
			setShowControls(true);
			timeout = setTimeout(() => setShowControls(false), 3000);
		};

		const handleMouseMove = () => resetTimeout();
		const handleKeyPress = () => resetTimeout();

		resetTimeout();
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("keydown", handleKeyPress);
		window.addEventListener("click", handleMouseMove);

		return () => {
			if (timeout) clearTimeout(timeout);
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("keydown", handleKeyPress);
			window.removeEventListener("click", handleMouseMove);
		};
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsFullscreen(false);
				return;
			}

			if (event.key === "f" || event.key === "F") {
				toggleFullscreen();
				return;
			}

			if (viewMode !== "detail") {
				return;
			}

			if (event.key === "ArrowRight" || event.key === " ") {
				nextSlide();
			} else if (event.key === "ArrowLeft") {
				prevSlide();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [currentSlide, organizedDetailPeriods, screenSize, viewMode]);

	useEffect(() => {
		const handleResize = () => {
			setScreenSize(window.innerWidth);
		};

		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	const detailSlideCount = useMemo(() => {
		let totalSlides = 2;
		const maxGoalsPerSlide = getMaxGoalsPerSlide();

		for (const period of organizedDetailPeriods) {
			totalSlides += 1;

			for (const department of period.departments) {
				totalSlides += 1;

				for (const area of department.areas) {
					totalSlides += 1;

					for (const person of area.people) {
						totalSlides += Math.ceil(person.goals.length / maxGoalsPerSlide);
					}
				}
			}
		}

		return totalSlides;
	}, [organizedDetailPeriods, screenSize]);

	useEffect(() => {
		if (viewMode === "detail" && currentSlide >= detailSlideCount) {
			setCurrentSlide(Math.max(detailSlideCount - 1, 0));
		}
	}, [currentSlide, detailSlideCount, viewMode]);

	const nextSlide = () => {
		if (viewMode !== "detail") return;
		setCurrentSlide((previous) => (previous + 1) % detailSlideCount);
	};

	const prevSlide = () => {
		if (viewMode !== "detail") return;
		setCurrentSlide((previous) => (previous - 1 + detailSlideCount) % detailSlideCount);
	};

	const toggleFullscreen = () => {
		setIsFullscreen((previous) => !previous);
	};

	const generatePDFMutation = useMutation({
		...orpc.presentations.generatePDF.mutationOptions({
			onSuccess: (response) => {
				const binaryString = atob(response.pdf);
				const bytes = new Uint8Array(binaryString.length);

				for (let index = 0; index < binaryString.length; index += 1) {
					bytes[index] = binaryString.charCodeAt(index);
				}

				const blob = new Blob([bytes], { type: "application/pdf" });
				const url = window.URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = response.filename;

				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				window.URL.revokeObjectURL(url);
			},
			onError: () => {
				alert("Error al generar el PDF. Por favor, inténtalo de nuevo.");
			},
		}),
	});

	const handlePrintToPDF = () => {
		generatePDFMutation.mutate({
			presentationId: id,
			baseUrl: window.location.origin,
		});
	};

	if (payloadQuery.isLoading) {
		return <div>Cargando presentación...</div>;
	}

	if (payloadQuery.isError) {
		return (
			<div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
				<div className="space-y-2">
					<h2 className="text-lg font-semibold">No se pudo cargar la presentación</h2>
					<p className="text-sm">{getPresentationLoadErrorMessage(payloadQuery.error)}</p>
					<Button variant="outline" size="sm" onClick={() => payloadQuery.refetch()}>
						Reintentar
					</Button>
				</div>
			</div>
		);
	}

	if (!payload || !presentation) {
		return <div>Presentación no encontrada.</div>;
	}

	const currentDetailSlide = (() => {
		if (viewMode !== "detail") {
			return { type: "consolidated" as const };
		}

		let slideIndex = 0;
		const maxGoalsPerSlide = getMaxGoalsPerSlide();

		if (currentSlide === slideIndex) {
			return { type: "title" as const };
		}
		slideIndex += 1;

		for (const period of organizedDetailPeriods) {
			if (currentSlide === slideIndex) {
				return {
					type: "period" as const,
					data: {
						label: period.label,
						rowCount: period.rows.length,
						month: period.month,
						year: period.year,
					},
				};
			}
			slideIndex += 1;

			for (const department of period.departments) {
				if (currentSlide === slideIndex) {
					return {
						type: "department" as const,
						data: {
							name: department.name,
							periodLabel: period.label,
						},
					};
				}
				slideIndex += 1;

				for (const area of department.areas) {
					if (currentSlide === slideIndex) {
						return {
							type: "area" as const,
							data: {
								name: area.name,
								department: department.name,
								periodLabel: period.label,
							},
						};
					}
					slideIndex += 1;

					for (const person of area.people) {
						const totalSlides = Math.ceil(person.goals.length / maxGoalsPerSlide);

						for (let personSlide = 0; personSlide < totalSlides; personSlide += 1) {
							if (currentSlide === slideIndex) {
								const startIndex = personSlide * maxGoalsPerSlide;
								const endIndex = Math.min(startIndex + maxGoalsPerSlide, person.goals.length);
								const goalsForSlide = person.goals.slice(startIndex, endIndex);

								return {
									type: "person" as const,
									data: {
										...person,
										periodLabel: period.label,
										goals: goalsForSlide,
										slideNumber: personSlide + 1,
										totalSlides,
										maxGoalsPerSlide,
									},
								};
							}
							slideIndex += 1;
						}
					}
				}
			}
		}

		return { type: "summary" as const };
	})();

	const renderDetailSlide = () => {
		switch (currentDetailSlide.type) {
			case "title":
				return (
					<div className="flex min-h-[500px] flex-col items-center justify-center space-y-8 px-8 py-12 text-center">
						<div className="space-y-4">
							<h1 className="pb-2 text-6xl font-bold leading-normal bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
								{presentation.name}
							</h1>
							<h2 className="text-3xl leading-normal text-gray-600 dark:text-gray-400">
								{periodLabel}
							</h2>
						</div>

						<div className="grid grid-cols-3 gap-8 mt-12">
							<div className="rounded-lg bg-gray-50 p-6 dark:bg-gray-800">
								<div className="text-3xl font-bold text-blue-600">{payload.detailRows.length}</div>
								<div className="text-lg text-gray-600">Metas en el rango</div>
							</div>

							<div className="rounded-lg bg-gray-50 p-6 dark:bg-gray-800">
								<div className="text-3xl font-bold text-green-600">
									{payload.detailRows.filter((row) => row.progressPercentage >= 80).length}
								</div>
								<div className="text-lg text-gray-600">Metas Exitosas</div>
							</div>

							<div className="rounded-lg bg-gray-50 p-6 dark:bg-gray-800">
								<div className="text-3xl font-bold text-yellow-600">
									{
										payload.detailRows.filter(
											(row) => row.progressPercentage >= 50 && row.progressPercentage < 80,
										).length
									}
								</div>
								<div className="text-lg text-gray-600">En Progreso</div>
							</div>
						</div>
					</div>
				);

			case "period":
				return (
					<div className="flex min-h-[500px] flex-col items-center justify-center space-y-8 px-8 py-12 text-center">
						<div className="space-y-4">
							<h1 className="pb-2 text-5xl font-bold leading-normal bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
								{currentDetailSlide.data.label}
							</h1>
							<h2 className="text-2xl leading-normal text-gray-600 dark:text-gray-400">
								Periodo mensual
							</h2>
						</div>

						<div className="rounded-lg bg-gray-50 px-8 py-6 dark:bg-gray-800">
							<div className="text-3xl font-bold text-blue-600">{currentDetailSlide.data.rowCount}</div>
							<div className="text-lg text-gray-600">Metas registradas en este mes</div>
						</div>
					</div>
				);

			case "department":
				return (
					<div className="flex min-h-[500px] flex-col items-center justify-center space-y-8 px-8 py-12 text-center">
						<div className="space-y-4">
							<h1 className="pb-2 text-5xl font-bold leading-normal bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
								{currentDetailSlide.data.name}
							</h1>
							<h2 className="text-2xl leading-normal text-gray-600 dark:text-gray-400">
								Departamento - {currentDetailSlide.data.periodLabel}
							</h2>
						</div>
					</div>
				);

			case "area":
				return (
					<div className="flex min-h-[500px] flex-col items-center justify-center space-y-8 px-8 py-12 text-center">
						<div className="space-y-4">
							<h1 className="pb-2 text-4xl font-bold leading-normal bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
								{currentDetailSlide.data.name}
							</h1>
							<h2 className="text-xl leading-normal text-gray-600 dark:text-gray-400">
								Área - {currentDetailSlide.data.department} - {currentDetailSlide.data.periodLabel}
							</h2>
						</div>
					</div>
				);

			case "person": {
				const personData = currentDetailSlide.data;

				return (
					<div className="flex min-h-[500px] flex-col px-8 py-8">
						<div className="mb-8 text-center">
							<div className="mb-3 flex items-center justify-center gap-2">
								<Badge variant="outline">{personData.periodLabel}</Badge>
								<Badge variant="outline">{personData.departmentName}</Badge>
								<Badge variant="outline">{personData.areaName}</Badge>
							</div>
							<h2 className="text-4xl font-bold">{personData.userName}</h2>
							<h3 className="text-xl text-gray-600">
								{personData.areaName} - {personData.departmentName}
							</h3>
							<div className="mt-2 text-sm text-gray-500">
								<p>
									{personData.goals.length} {personData.goals.length === 1 ? "meta" : "metas"}
									{personData.totalSlides > 1 && (
										<span className="ml-2 font-medium">
											- Slide {personData.slideNumber} de {personData.totalSlides}
										</span>
									)}
								</p>
							</div>
						</div>

						<div className="flex flex-1 justify-center px-4">
							<div
								className={`grid w-full gap-4 ${
									personData.goals.length === 1
										? "max-w-sm grid-cols-1"
										: personData.goals.length === 2
											? "max-w-3xl grid-cols-1 sm:grid-cols-2"
											: personData.goals.length === 3
												? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
												: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
								}`}
							>
								{personData.goals.map((goal, index) => {
									const percentage = goal.progressPercentage ?? getProgressPercentage(
										goal.targetValue || "0",
										goal.achievedValue || "0",
										goal.isInverse ?? undefined,
									);

									return (
										<Card key={`${goal.goalTemplateName ?? "goal"}-${index}`} className="flex min-w-0 flex-col justify-between">
											<CardHeader className="pb-2">
												<CardTitle className="text-sm leading-tight sm:text-base">
													{goal.goalTemplateName}
												</CardTitle>
											</CardHeader>
											<CardContent className="flex flex-1 flex-col justify-between space-y-3">
												<div className="grid grid-cols-2 gap-3 text-center">
													<div>
														<div className="text-base font-bold break-words text-blue-600 sm:text-lg">
															{formatNumber(goal.achievedValue)}
														</div>
														<div className="text-xs text-gray-500">Logrado</div>
													</div>
													<div>
														<div className="text-base font-bold break-words text-gray-600 sm:text-lg">
															{formatNumber(goal.targetValue)}
														</div>
														<div className="text-xs text-gray-500">
															{goal.isInverse ? "Meta (máx)" : "Objetivo"}
														</div>
													</div>
												</div>

												<div className="space-y-2">
													<div className="flex items-center justify-between text-sm">
														<span>Progreso</span>
														<span className="font-bold">{Math.round(percentage)}%</span>
													</div>
													<Progress value={percentage} className="h-2" />
													<div className="text-center">{getStatusBadge(percentage)}</div>
												</div>

												{goal.notes && (
													<div className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-800">
														<p className="line-clamp-2 text-gray-700 dark:text-gray-300">{goal.notes}</p>
													</div>
												)}
											</CardContent>
										</Card>
									);
								})}
							</div>
						</div>
					</div>
				);
			}

			case "summary":
			default:
				return (
					<div className="flex min-h-[500px] flex-col items-center px-12 py-12">
						<div className="mb-8 text-center space-y-4">
							<h2 className="text-5xl font-bold">Resumen Final</h2>
							<h3 className="text-2xl text-gray-600">{periodLabel}</h3>
						</div>

						<div className="mb-8 grid w-full max-w-4xl grid-cols-3 gap-8">
							<Card className="text-center">
								<CardContent className="pt-6">
									<div className="mb-2 text-4xl font-bold text-green-600">
										{payload.detailRows.filter((row) => row.progressPercentage >= 80).length}
									</div>
									<div className="text-lg font-medium">Metas Exitosas</div>
									<div className="text-sm text-gray-500">≥80% cumplimiento</div>
								</CardContent>
							</Card>

							<Card className="text-center">
								<CardContent className="pt-6">
									<div className="mb-2 text-4xl font-bold text-yellow-600">
										{
											payload.detailRows.filter(
												(row) => row.progressPercentage >= 50 && row.progressPercentage < 80,
											).length
										}
									</div>
									<div className="text-lg font-medium">En Progreso</div>
									<div className="text-sm text-gray-500">50-79% cumplimiento</div>
								</CardContent>
							</Card>

							<Card className="text-center">
								<CardContent className="pt-6">
									<div className="mb-2 text-4xl font-bold text-red-600">
										{payload.detailRows.filter((row) => row.progressPercentage < 50).length}
									</div>
									<div className="text-lg font-medium">Necesitan Atención</div>
									<div className="text-sm text-gray-500">&lt;50% cumplimiento</div>
								</CardContent>
							</Card>
						</div>

						<div className="text-center space-y-4">
							<h3 className="text-2xl font-bold">¡Gracias por su atención!</h3>
							<p className="text-lg text-gray-600">Presentación generada con CCI Sync</p>
						</div>
					</div>
				);
		}
	};

	const renderConsolidatedView = () => {
		return (
			<div className="space-y-6 px-6 py-6">
				<div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
						<div className="space-y-2">
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">Vista consolidada</Badge>
								<Badge variant="outline">{periodLabel}</Badge>
								<Badge variant="outline">{payload.periods.length} meses</Badge>
							</div>
							<h1 className="text-3xl font-bold">{presentation.name}</h1>
							<p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
								Los promedios se calculan a partir de los valores mensuales disponibles. Las filas
								muestran los meses incluidos en cada agrupación.
							</p>
						</div>

						<div className="grid grid-cols-3 gap-3">
							<div className="rounded-lg bg-gray-50 px-4 py-3 text-center dark:bg-gray-800">
								<div className="text-2xl font-bold text-blue-600">{payload.consolidatedRows.length}</div>
								<div className="text-xs text-gray-500">Grupos consolidados</div>
							</div>
							<div className="rounded-lg bg-gray-50 px-4 py-3 text-center dark:bg-gray-800">
								<div className="text-2xl font-bold text-green-600">{payload.periods.length}</div>
								<div className="text-xs text-gray-500">Meses</div>
							</div>
							<div className="rounded-lg bg-gray-50 px-4 py-3 text-center dark:bg-gray-800">
								<div className="text-2xl font-bold text-yellow-600">{payload.detailRows.length}</div>
								<div className="text-xs text-gray-500">Filas detalle</div>
							</div>
						</div>
					</div>
				</div>

				<div className="space-y-6">
					{organizedConsolidatedRows.map((department) => (
						<Card key={department.name} className="overflow-hidden">
							<CardHeader className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
								<CardTitle className="text-2xl">{department.name}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-6 pt-6">
								{department.areas.map((area) => (
									<div key={area.name} className="space-y-3">
										<div className="flex items-center justify-between">
											<div>
												<h3 className="text-lg font-semibold">{area.name}</h3>
												<p className="text-sm text-gray-500">{department.name}</p>
											</div>
											<Badge variant="outline">{area.rows.length} metas consolidadas</Badge>
										</div>

										<div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
											<table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
												<thead className="bg-gray-50 dark:bg-gray-800">
													<tr>
														<th className="px-4 py-3 text-left font-medium text-gray-600">Persona</th>
														<th className="px-4 py-3 text-left font-medium text-gray-600">Meta</th>
														<th className="px-4 py-3 text-left font-medium text-gray-600">Meses incluidos</th>
														<th className="px-4 py-3 text-right font-medium text-gray-600">
															Promedio objetivo
														</th>
														<th className="px-4 py-3 text-right font-medium text-gray-600">
															Promedio logrado
														</th>
														<th className="px-4 py-3 text-right font-medium text-gray-600">
															Promedio progreso
														</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
													{area.rows.map((row) => (
														<tr key={`${row.userId}-${row.goalTemplateId}-${row.departmentId}-${row.areaId}`}>
															<td className="px-4 py-3 align-top">
																<div className="font-medium">{row.userName}</div>
																<div className="text-xs text-gray-500">{row.userEmail}</div>
															</td>
															<td className="px-4 py-3 align-top">
																<div className="font-medium">{row.goalTemplateName}</div>
																<div className="text-xs text-gray-500">{row.goalTemplateUnit}</div>
															</td>
															<td className="px-4 py-3 align-top">
																<div className="flex flex-wrap gap-2">
																	{row.includedMonths.map((period) => (
																		<Badge key={`${period.month}-${period.year}`} variant="secondary">
																			{formatMonthLabel(period.month, period.year)}
																		</Badge>
																	))}
																</div>
															</td>
															<td className="px-4 py-3 align-top text-right font-medium">
																{formatNumber(row.consolidatedTargetValue)}
															</td>
															<td className="px-4 py-3 align-top text-right font-medium">
																{formatNumber(row.consolidatedAchievedValue)}
															</td>
															<td className="px-4 py-3 align-top text-right">
																<div className="flex flex-col items-end gap-2">
																	<div className="font-semibold">
																		{Math.round(row.consolidatedProgressPercentage)}%
																	</div>
																	<Progress value={row.consolidatedProgressPercentage} className="h-2 w-32" />
																	<div>{getStatusBadge(row.consolidatedProgressPercentage)}</div>
																</div>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>
								))}
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		);
	};

	const renderModeControls = (compact = false) => {
		const modeButtons = (
			<div className="flex items-center gap-2">
				<Button
					variant={viewMode === "detail" ? "default" : "outline"}
					size="sm"
					onClick={() => setViewMode("detail")}
				>
					Detalle mensual
				</Button>
				<Button
					variant={viewMode === "consolidated" ? "default" : "outline"}
					size="sm"
					onClick={() => setViewMode("consolidated")}
				>
					Consolidado
				</Button>
			</div>
		);

		const detailNavigation = viewMode === "detail" ? (
			<div className="flex items-center gap-2">
				<Button variant="outline" size="sm" onClick={prevSlide} disabled={currentSlide === 0}>
					<ChevronLeft className="h-4 w-4" />
					Anterior
				</Button>

				<span className="rounded bg-gray-100 px-3 py-1 text-sm font-medium dark:bg-gray-800">
					{currentSlide + 1} / {detailSlideCount}
				</span>

				<Button variant="outline" size="sm" onClick={nextSlide} disabled={currentSlide === detailSlideCount - 1}>
					Siguiente
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		) : (
			<Badge variant="outline">Vista consolidada</Badge>
		);

		const actionButtons = (
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={handlePrintToPDF}
					disabled={generatePDFMutation.isPending}
				>
					{generatePDFMutation.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Download className="h-4 w-4" />
					)}
					{generatePDFMutation.isPending ? "Generando PDF..." : "Exportar PDF"}
				</Button>
				<Button variant="outline" size="sm" onClick={toggleFullscreen}>
					{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
					{isFullscreen ? "Salir" : "Pantalla Completa"}
				</Button>
			</div>
		);

		if (compact) {
			return (
				<div className="flex flex-wrap items-center justify-between gap-3">
					{modeButtons}
					<div className="flex flex-wrap items-center gap-3">
						{detailNavigation}
						{actionButtons}
					</div>
				</div>
			);
		}

		return (
			<div className="flex flex-wrap items-center justify-between gap-3">
				{modeButtons}
				<div className="flex flex-wrap items-center gap-3">
					{detailNavigation}
					{actionButtons}
				</div>
			</div>
		);
	};

	const content = viewMode === "detail" ? renderDetailSlide() : renderConsolidatedView();

	return (
		<div
			className={`${isFullscreen ? "fixed inset-0 z-50 bg-white dark:bg-gray-900" : ""}`}
			data-presentation-loaded="true"
		>
			{isFullscreen ? (
				<div className="relative h-full w-full">
					<div
						className={`absolute right-4 top-4 z-10 transition-opacity duration-300 ${
							showControls ? "opacity-100" : "opacity-0"
						}`}
					>
						{renderModeControls(true)}
					</div>

					{viewMode === "detail" && (
						<>
							<div className="absolute left-0 top-0 z-[5] h-full w-1/2 cursor-pointer" onClick={prevSlide} />
							<div className="absolute right-0 top-0 z-[5] h-full w-1/2 cursor-pointer" onClick={nextSlide} />
						</>
					)}

					{content}
				</div>
			) : (
				<div className="space-y-4">
					<div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
						{renderModeControls()}
					</div>

					<div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
						{content}
					</div>
				</div>
			)}
		</div>
	);
}
