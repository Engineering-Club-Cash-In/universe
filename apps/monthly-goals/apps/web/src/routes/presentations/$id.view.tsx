import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Download, Loader2 } from "lucide-react";

export const Route = createFileRoute("/presentations/$id/view")({
	component: ViewPresentationPage,
});

function ViewPresentationPage() {
	const { id } = Route.useParams();
	const [currentSlide, setCurrentSlide] = useState(0);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showControls, setShowControls] = useState(true);
	const [screenSize, setScreenSize] = useState(0);

	// Queries
	const presentation = useQuery(
		orpc.presentations.get.queryOptions({
			input: { id }
		})
	)

	const submissions = useQuery(
		orpc.presentations.submissions.queryOptions({
			input: { presentationId: id }
		})
	)

	// Auto-hide controls
	useEffect(() => {
		let timeout: NodeJS.Timeout;
		
		const resetTimeout = () => {
			if (timeout) clearTimeout(timeout);
			setShowControls(true);
			timeout = setTimeout(() => setShowControls(false), 3000);
		}

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
		}
	}, []);

	// Keyboard navigation
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "ArrowRight" || event.key === " ") {
				nextSlide()
			} else if (event.key === "ArrowLeft") {
				prevSlide()
			} else if (event.key === "Escape") {
				setIsFullscreen(false);
			} else if (event.key === "f" || event.key === "F") {
				toggleFullscreen();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [currentSlide]);

	// Window resize listener to recalculate slides
	useEffect(() => {
		const handleResize = () => {
			setScreenSize(window.innerWidth);
		};

		handleResize(); // Set initial size
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	const nextSlide = () => {
		const totalSlides = getTotalSlides();
		setCurrentSlide(prev => (prev + 1) % totalSlides);
	}

	const prevSlide = () => {
		const totalSlides = getTotalSlides();
		setCurrentSlide(prev => (prev - 1 + totalSlides) % totalSlides);
	}

	const getOrganizedSubmissions = () => {
		if (!submissions.data) return {};
		
		const organized = submissions.data.reduce((acc: any, submission: any) => {
			const dept = submission.departmentName || 'Sin Departamento';
			const area = submission.areaName || 'Sin Área';
			const person = submission.userName || 'Sin Usuario';
			
			if (!acc[dept]) {
				acc[dept] = {};
			}
			if (!acc[dept][area]) {
				acc[dept][area] = {};
			}
			if (!acc[dept][area][person]) {
				acc[dept][area][person] = {
					userName: person,
					departmentName: dept,
					areaName: area,
					goals: []
				};
			}
			acc[dept][area][person].goals.push(submission);
			
			return acc;
		}, {});
		
		return organized;
	}

	// Helper function to get max goals per slide based on screen size
	const getMaxGoalsPerSlide = () => {
		if (typeof window === 'undefined') return 4; // SSR fallback
		
		const width = window.innerWidth;
		if (width < 640) return 1;  // Mobile: 1 meta por slide
		if (width < 1024) return 2; // Small: 2 metas por slide  
		if (width < 1280) return 3; // Large: 3 metas por slide
		return 4; // XL: 4 metas por slide
	};

	const getTotalSlides = () => {
		if (!submissions.data) return 2; // Title + Summary
		
		const organized = getOrganizedSubmissions();
		const maxGoalsPerSlide = getMaxGoalsPerSlide();
		let totalSlides = 1; // Title slide
		
		// Count department, area separator slides + person slides (with pagination)
		Object.keys(organized).forEach(dept => {
			totalSlides += 1; // Department separator slide
			Object.keys(organized[dept]).forEach(area => {
				totalSlides += 1; // Area separator slide
				Object.keys(organized[dept][area]).forEach(person => {
					const personData = organized[dept][area][person];
					// Calculate slides needed for this person based on screen size
					const slidesNeeded = Math.ceil(personData.goals.length / maxGoalsPerSlide);
					totalSlides += slidesNeeded;
				});
			});
		});
		
		totalSlides += 1; // Summary slide
		return totalSlides;
	}

	const getSlideData = () => {
		if (!submissions.data) return { type: 'summary', data: null };
		
		const organized = getOrganizedSubmissions();
		const maxGoalsPerSlide = getMaxGoalsPerSlide();
		let currentIndex = 0;
		
		// Title slide
		if (currentSlide === currentIndex) {
			return { type: 'title', data: null };
		}
		currentIndex++;
		
		// Department, area, and person slides
		for (const dept of Object.keys(organized)) {
			// Department separator slide
			if (currentSlide === currentIndex) {
				return { type: 'department', data: { name: dept } };
			}
			currentIndex++;
			
			for (const area of Object.keys(organized[dept])) {
				// Area separator slide
				if (currentSlide === currentIndex) {
					return { type: 'area', data: { name: area, department: dept } };
				}
				currentIndex++;
				
				// Person slides for this area (with pagination)
				for (const person of Object.keys(organized[dept][area])) {
					const personData = organized[dept][area][person];
					const totalSlides = Math.ceil(personData.goals.length / maxGoalsPerSlide);
					
					for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
						if (currentSlide === currentIndex) {
							const startIndex = slideIndex * maxGoalsPerSlide;
							const endIndex = Math.min(startIndex + maxGoalsPerSlide, personData.goals.length);
							const goalsForSlide = personData.goals.slice(startIndex, endIndex);
							
							return { 
								type: 'person', 
								data: {
									...personData,
									goals: goalsForSlide,
									slideNumber: slideIndex + 1,
									totalSlides: totalSlides,
									maxGoalsPerSlide: maxGoalsPerSlide
								}
							};
						}
						currentIndex++;
					}
				}
			}
		}
		
		// Summary slide
		return { type: 'summary', data: null };
	}

	const toggleFullscreen = () => {
		setIsFullscreen(!isFullscreen);
	}

	const months = [
		"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
		"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
	];

	const generatePDFMutation = useMutation({
		...orpc.presentations.generatePDF.mutationOptions({
			onSuccess: (response) => {
				console.log('PDF response received:', response);
				
				// Convert base64 to binary
				const binaryString = atob(response.pdf);
				const bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				
				// Create blob from binary data
				const blob = new Blob([bytes], { type: 'application/pdf' });
				console.log('Blob created. Size:', blob.size);
				
				// Create download link
				const url = window.URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download = response.filename;
				
				// Trigger download
				document.body.appendChild(link);
				link.click();
				
				// Cleanup
				document.body.removeChild(link);
				window.URL.revokeObjectURL(url);
				
				console.log('PDF generado y descargado exitosamente');
			},
			onError: (error) => {
				console.error('Error al generar PDF:', error);
				alert('Error al generar el PDF. Por favor, inténtalo de nuevo.');
			}
		})
	});

	const handlePrintToPDF = () => {
		console.log('Preparando generación de PDF...');
		generatePDFMutation.mutate({
			presentationId: id,
			baseUrl: window.location.origin
		});
	}


	const getProgressPercentage = (target: string, achieved: string) => {
		const targetNum = parseFloat(target);
		const achievedNum = parseFloat(achieved);
		return targetNum > 0 ? (achievedNum / targetNum) * 100 : 0;
	}

	const getStatusBadge = (percentage: number) => {
		if (percentage >= 80) {
			return <Badge className="bg-green-100 text-green-800">Exitoso</Badge>;
		} else if (percentage >= 50) {
			return <Badge className="bg-yellow-100 text-yellow-800">En Progreso</Badge>;
		} else {
			return <Badge className="bg-red-100 text-red-800">Necesita Atención</Badge>;
		}
	}

	if (presentation.isLoading || submissions.isLoading) {
		return <div>Cargando presentación...</div>;
	}

	if (!presentation.data) {
		return <div>Presentación no encontrada</div>;
	}

	const renderSlide = () => {
		const slideData = getSlideData();

		switch (slideData.type) {
			case 'title':
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
										return pct >= 80
									}).length || 0}
								</div>
								<div className="text-lg text-gray-600">Metas Exitosas</div>
							</div>
							
							<div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
								<div className="text-3xl font-bold text-yellow-600">
									{submissions.data?.filter((s: any) => {
										const pct = getProgressPercentage(s.targetValue || "0", s.submittedValue || "0");
										return pct >= 50 && pct < 80
									}).length || 0}
								</div>
								<div className="text-lg text-gray-600">En Progreso</div>
							</div>
						</div>
					</div>
				)

			case 'department':
				return (
					<div className="flex flex-col items-center justify-center min-h-[500px] text-center space-y-8 py-12 px-8">
						<div className="space-y-4">
							<h1 className="text-5xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent leading-normal pb-2">
								{slideData.data.name}
							</h1>
							<h2 className="text-2xl text-gray-600 dark:text-gray-400 leading-normal">
								Departamento
							</h2>
						</div>
					</div>
				)

			case 'area':
				return (
					<div className="flex flex-col items-center justify-center min-h-[500px] text-center space-y-8 py-12 px-8">
						<div className="space-y-4">
							<h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent leading-normal pb-2">
								{slideData.data.name}
							</h1>
							<h2 className="text-xl text-gray-600 dark:text-gray-400 leading-normal">
								Área - {slideData.data.department}
							</h2>
						</div>
					</div>
				)

			case 'person':
				const personData = slideData.data;
				
				return (
					<div className="flex flex-col py-8 px-8 min-h-[500px]">
						{/* Person header */}
						<div className="text-center mb-8">
							<h2 className="text-4xl font-bold">{personData.userName}</h2>
							<h3 className="text-xl text-gray-600">{personData.areaName} - {personData.departmentName}</h3>
							<div className="text-sm text-gray-500 mt-2">
								<p>{personData.goals.length} {personData.goals.length === 1 ? 'meta' : 'metas'} 
								{personData.totalSlides > 1 && (
									<span className="ml-2 font-medium">
										- Slide {personData.slideNumber} de {personData.totalSlides}
									</span>
								)}
								</p>
							</div>
						</div>
						
						{/* Goals grid - responsive with proper limits and centering */}
						<div className="flex justify-center flex-1 px-4">
							<div className={`grid gap-4 w-full ${
								// Grid responsive que respeta el espacio disponible
								personData.goals.length === 1 ? 'grid-cols-1 max-w-sm' :
								personData.goals.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl' :
								personData.goals.length === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
								'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
							}`}>
							{personData.goals.map((goal: any, index: number) => {
								const percentage = getProgressPercentage(goal.targetValue || "0", goal.submittedValue || "0");
								
								return (
									<Card key={index} className="w-full min-w-0 flex flex-col justify-between">
										<CardHeader className="pb-2">
											<CardTitle className="text-sm sm:text-base leading-tight">{goal.goalTemplateName}</CardTitle>
										</CardHeader>
										<CardContent className="space-y-3 flex-1 flex flex-col justify-between">
											<div className="grid grid-cols-2 gap-3 text-center">
												<div>
													<div className="text-base sm:text-lg font-bold text-gray-600 break-words">
														{parseFloat(goal.targetValue).toLocaleString()}
													</div>
													<div className="text-xs text-gray-500">Objetivo</div>
												</div>
												<div>
													<div className="text-base sm:text-lg font-bold text-blue-600 break-words">
														{parseFloat(goal.submittedValue).toLocaleString()}
													</div>
													<div className="text-xs text-gray-500">Logrado</div>
												</div>
											</div>
											
											<div className="space-y-2">
												<div className="flex items-center justify-between text-sm">
													<span>Progreso</span>
													<span className="font-bold">{Math.round(percentage)}%</span>
												</div>
												<Progress value={percentage} className="h-2" />
												<div className="text-center">
													{getStatusBadge(percentage)}
												</div>
											</div>
											
											{goal.notes && (
												<div className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs">
													<p className="text-gray-700 dark:text-gray-300 line-clamp-2">{goal.notes}</p>
												</div>
											)}
										</CardContent>
									</Card>
								);
							})}
							</div>
						</div>
					</div>
				)

			case 'summary':
			default:
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
											return pct >= 80
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
											return pct >= 50 && pct < 80
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
											return pct < 50
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
				)
		}
	}

	return (
        <div className={`${isFullscreen ? `fixed inset-0 z-50 bg-white dark:bg-gray-900` : ``}`} data-presentation-loaded="true">
            {isFullscreen ? (
				// Fullscreen mode - Fill entire screen
				(<div className="relative w-full h-full">
                    {/* Fullscreen controls overlay */}
                    <div className={`absolute top-4 right-4 z-10 transition-opacity duration-300 ${
						showControls ? 'opacity-100' : 'opacity-0'
					}`}>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={handlePrintToPDF}
								disabled={generatePDFMutation.isPending}
								className="bg-white/80 backdrop-blur"
							>
								{generatePDFMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Download className="h-4 w-4" />
								)}
								{generatePDFMutation.isPending ? 'Generando...' : 'PDF'}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={toggleFullscreen}
								className="bg-white/80 backdrop-blur"
							>
								<Minimize className="h-4 w-4" /> Salir
							</Button>
						</div>
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
                </div>)
			) : (
				// Normal mode - Compact layout
				(<div className="space-y-4">
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
								{(() => {
									const totalSlides = getTotalSlides();
									const maxDots = 5;
									let startIndex = Math.max(0, currentSlide - Math.floor(maxDots / 2));
									let endIndex = Math.min(totalSlides, startIndex + maxDots);
									
									// Ajustar si estamos cerca del final
									if (endIndex - startIndex < maxDots && startIndex > 0) {
										startIndex = Math.max(0, endIndex - maxDots);
									}
									
									return Array.from({ length: endIndex - startIndex }, (_, i) => {
										const slideIndex = startIndex + i;
										return (
											<button
												key={slideIndex}
												onClick={() => setCurrentSlide(slideIndex)}
												className={`w-3 h-3 rounded-full transition-colors flex-shrink-0 ${
													slideIndex === currentSlide 
														? "bg-blue-600" 
														: "bg-gray-300 dark:bg-gray-600"
												}`}
											/>
										);
									});
								})()}
							</div>
							
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
									{generatePDFMutation.isPending ? 'Generando PDF...' : 'Exportar PDF'}
								</Button>
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
                </div>)
			)}
        </div>
    )
}