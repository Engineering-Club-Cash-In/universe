import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize } from "lucide-react";

export const Route = createFileRoute("/presentations/$id/view")({
	component: ViewPresentationPage,
});

function ViewPresentationPage() {
	const { id } = Route.useParams();
	const [currentSlide, setCurrentSlide] = useState(0);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showControls, setShowControls] = useState(true);

	// Queries
	const presentation = useQuery(
		orpc.presentations.get.queryOptions({
			input: { id }
		})
	);

	const submissions = useQuery(
		orpc.presentations.submissions.queryOptions({
			input: { presentationId: id }
		})
	);

	// Auto-hide controls
	useEffect(() => {
		let timeout: NodeJS.Timeout;
		
		const resetTimeout = () => {
			if (timeout) clearTimeout(timeout);
			setShowControls(true);
			timeout = setTimeout(() => setShowControls(false), 3000);
		};

		const handleMouseMove = () => resetTimeout();
		const handleKeyPress = () => resetTimeout();

		// Show controls initially and on activity
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

	// Keyboard navigation
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "ArrowRight" || event.key === " ") {
				nextSlide();
			} else if (event.key === "ArrowLeft") {
				prevSlide();
			} else if (event.key === "Escape") {
				setIsFullscreen(false);
			} else if (event.key === "f" || event.key === "F") {
				toggleFullscreen();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [currentSlide]);

	const nextSlide = () => {
		const totalSlides = getTotalSlides();
		setCurrentSlide(prev => (prev + 1) % totalSlides);
	};

	const prevSlide = () => {
		const totalSlides = getTotalSlides();
		setCurrentSlide(prev => (prev - 1 + totalSlides) % totalSlides);
	};

	const getTotalSlides = () => {
		// Title slide + goals slides + summary slide
		return 1 + (submissions.data?.length || 0) + 1;
	};

	const toggleFullscreen = () => {
		setIsFullscreen(!isFullscreen);
	};

	const getProgressPercentage = (target: string, achieved: string) => {
		const targetNum = parseFloat(target);
		const achievedNum = parseFloat(achieved);
		return targetNum > 0 ? (achievedNum / targetNum) * 100 : 0;
	};

	const getStatusBadge = (percentage: number) => {
		if (percentage >= 80) {
			return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
		} else if (percentage >= 50) {
			return <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>;
		} else {
			return <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>;
		}
	};

	const months = [
		"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
		"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
	];

	if (presentation.isLoading || submissions.isLoading) {
		return <div>Cargando presentación...</div>;
	}

	if (!presentation.data) {
		return <div>Presentación no encontrada</div>;
	}

	const renderSlide = () => {
		const totalSlides = getTotalSlides();

		// Title slide
		if (currentSlide === 0) {
			return (
				<div className="flex flex-col items-center justify-center min-h-[500px] text-center space-y-8 py-12 px-8">
					<div className="space-y-4">
						<h1 className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-normal pb-2">
							{presentation.data.name}
						</h1>
						<h2 className="text-3xl text-gray-600 dark:text-gray-400 leading-normal">
							{months[presentation.data.month]} {presentation.data.year}
						</h2>
					</div>
					
					<div className="grid grid-cols-3 gap-8 mt-12">
						<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
							<div className="text-3xl font-bold text-blue-600">{submissions.data?.length || 0}</div>
							<div className="text-lg text-gray-600">Metas Presentadas</div>
						</div>
						
						<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
							<div className="text-3xl font-bold text-green-600">
								{submissions.data?.filter((s: any) => {
									const pct = getProgressPercentage(s.targetValue || "0", s.submittedValue || "0");
									return pct >= 80;
								}).length || 0}
							</div>
							<div className="text-lg text-gray-600">Metas Exitosas</div>
						</div>
						
						<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
							<div className="text-3xl font-bold text-yellow-600">
								{submissions.data?.filter((s: any) => {
									const pct = getProgressPercentage(s.targetValue || "0", s.submittedValue || "0");
									return pct >= 50 && pct < 80;
								}).length || 0}
							</div>
							<div className="text-lg text-gray-600">En Progreso</div>
						</div>
					</div>
				</div>
			);
		}

		// Goal slides
		if (currentSlide <= (submissions.data?.length || 0)) {
			const goal = submissions.data?.[currentSlide - 1];
			if (!goal) return null;
			const percentage = getProgressPercentage(goal.targetValue || "0", goal.submittedValue || "0");

			return (
				<div className="flex flex-col items-center py-12 px-12 min-h-[500px]">
					<div className="text-center space-y-4 mb-8">
						<h2 className="text-4xl font-bold">{goal.userName}</h2>
						<h3 className="text-2xl text-gray-600">{goal.areaName} - {goal.departmentName}</h3>
					</div>
					
					<Card className="w-full max-w-2xl">
						<CardHeader>
							<CardTitle className="text-2xl">{goal.goalTemplateName}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="grid grid-cols-2 gap-8 text-center">
								<div>
									<div className="text-3xl font-bold text-gray-600">{goal.targetValue}</div>
									<div className="text-lg text-gray-500">
										Objetivo ({goal.goalTemplateUnit || "unidades"})
									</div>
								</div>
								<div>
									<div className="text-3xl font-bold text-blue-600">{goal.submittedValue}</div>
									<div className="text-lg text-gray-500">
										Logrado ({goal.goalTemplateUnit || "unidades"})
									</div>
								</div>
							</div>
							
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-lg font-medium">Progreso</span>
									<span className="text-2xl font-bold">{Math.round(percentage)}%</span>
								</div>
								<Progress value={percentage} className="h-4" />
								<div className="text-center">
									{getStatusBadge(percentage)}
								</div>
							</div>
							
							{goal.notes && (
								<div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
									<h4 className="font-medium mb-2">Notas:</h4>
									<p className="text-gray-700 dark:text-gray-300">{goal.notes}</p>
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			);
		}

		// Summary slide
		return (
			<div className="flex flex-col items-center py-12 px-12 min-h-[500px]">
				<div className="text-center space-y-4 mb-8">
					<h2 className="text-5xl font-bold">Resumen Final</h2>
					<h3 className="text-2xl text-gray-600">
						{months[presentation.data.month]} {presentation.data.year}
					</h3>
				</div>
				
				<div className="grid grid-cols-3 gap-8 max-w-4xl w-full mb-8">
					<Card className="text-center">
						<CardContent className="pt-6">
							<div className="text-4xl font-bold text-green-600 mb-2">
								{submissions.data?.filter((s: any) => {
									const pct = getProgressPercentage(s.targetValue, s.submittedValue);
									return pct >= 80;
								}).length || 0}
							</div>
							<div className="text-lg font-medium">Metas Exitosas</div>
							<div className="text-sm text-gray-500">≥80% cumplimiento</div>
						</CardContent>
					</Card>
					
					<Card className="text-center">
						<CardContent className="pt-6">
							<div className="text-4xl font-bold text-yellow-600 mb-2">
								{submissions.data?.filter((s: any) => {
									const pct = getProgressPercentage(s.targetValue, s.submittedValue);
									return pct >= 50 && pct < 80;
								}).length || 0}
							</div>
							<div className="text-lg font-medium">En Progreso</div>
							<div className="text-sm text-gray-500">50-79% cumplimiento</div>
						</CardContent>
					</Card>
					
					<Card className="text-center">
						<CardContent className="pt-6">
							<div className="text-4xl font-bold text-red-600 mb-2">
								{submissions.data?.filter((s: any) => {
									const pct = getProgressPercentage(s.targetValue, s.submittedValue);
									return pct < 50;
								}).length || 0}
							</div>
							<div className="text-lg font-medium">Necesitan Atención</div>
							<div className="text-sm text-gray-500">&lt;50% cumplimiento</div>
						</CardContent>
					</Card>
				</div>

				<div className="text-center space-y-4">
					<h3 className="text-2xl font-bold">¡Gracias por su atención!</h3>
					<p className="text-lg text-gray-600">
						Presentación generada con CCI Sync
					</p>
				</div>
			</div>
		);
	};

	return (
		<div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-gray-900' : ''}`}>
			{isFullscreen ? (
				// Fullscreen mode - Fill entire screen
				<div className="relative w-full h-full">
					{/* Fullscreen controls overlay */}
					<div className={`absolute top-4 right-4 z-10 transition-opacity duration-300 ${
						showControls ? 'opacity-100' : 'opacity-0'
					}`}>
						<Button
							variant="outline"
							size="sm"
							onClick={toggleFullscreen}
							className="bg-white/80 backdrop-blur"
						>
							<Minimize className="h-4 w-4" /> Salir
						</Button>
					</div>

					{/* Invisible click areas for navigation in fullscreen */}
					<div 
						className="absolute left-0 top-0 w-1/2 h-full z-5 cursor-pointer" 
						onClick={prevSlide}
					/>
					<div 
						className="absolute right-0 top-0 w-1/2 h-full z-5 cursor-pointer" 
						onClick={nextSlide}
					/>
					
					{renderSlide()}
				</div>
			) : (
				// Normal mode - Compact layout
				<div className="space-y-4">
					{/* Slide Content */}
					<div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
						{renderSlide()}
					</div>

					{/* Controls directly below content */}
					<div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
						<div className="flex items-center justify-between max-w-4xl mx-auto">
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={prevSlide}
									disabled={currentSlide === 0}
								>
									<ChevronLeft className="h-4 w-4" />
									Anterior
								</Button>
								
								<span className="text-sm font-medium px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded">
									{currentSlide + 1} / {getTotalSlides()}
								</span>
								
								<Button
									variant="outline"
									size="sm"
									onClick={nextSlide}
									disabled={currentSlide === getTotalSlides() - 1}
								>
									Siguiente
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>

							{/* Slide indicators */}
							<div className="flex items-center gap-1">
								{Array.from({ length: getTotalSlides() }, (_, i) => (
									<button
										key={i}
										onClick={() => setCurrentSlide(i)}
										className={`w-3 h-3 rounded-full transition-colors ${
											i === currentSlide 
												? 'bg-blue-600' 
												: 'bg-gray-300 dark:bg-gray-600'
										}`}
									/>
								))}
							</div>
							
							<Button
								variant="outline"
								size="sm"
								onClick={toggleFullscreen}
							>
								<Maximize className="h-4 w-4" /> Pantalla Completa
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}