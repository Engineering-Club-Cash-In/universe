import { protectedProcedure } from "../lib/orpc";
import { ORPCError } from "@orpc/server";
import { db } from "../db";
import { presentations, goalSubmissions } from "../db/schema/presentations";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { user } from "../db/schema/auth";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { eq, and, or } from "drizzle-orm";
import * as z from "zod";
import puppeteer from "puppeteer";

const PresentationSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1, "Name is required"),
	month: z.number().int().min(1).max(12),
	year: z.number().int().min(2020),
	status: z.enum(["draft", "ready", "presented"]),
	createdBy: z.string(),
	presentedAt: z.date().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const CreatePresentationSchema = PresentationSchema.omit({
	id: true,
	createdBy: true,
	presentedAt: true,
	createdAt: true,
	updatedAt: true,
	status: true,
});

const UpdatePresentationSchema = z.object({
	name: z.string().min(1).optional(),
	status: z.enum(["draft", "ready", "presented"]).optional(),
	presentedAt: z.date().optional(),
});

const GoalSubmissionSchema = z.object({
	monthlyGoalId: z.string().uuid(),
	submittedValue: z.string(),
	notes: z.string().optional(),
});

const BulkSubmitGoalsSchema = z.object({
	presentationId: z.string().uuid(),
	submissions: z.array(GoalSubmissionSchema),
});

export const listPresentations = protectedProcedure.handler(async ({ context }) => {
	if (!context.session?.user) {
		throw new Error("Unauthorized");
	}

	const currentUser = context.session.user;
	
	let query = db
		.select({
			id: presentations.id,
			name: presentations.name,
			month: presentations.month,
			year: presentations.year,
			status: presentations.status,
			createdBy: presentations.createdBy,
			presentedAt: presentations.presentedAt,
			createdAt: presentations.createdAt,
			updatedAt: presentations.updatedAt,
			createdByName: user.name,
			createdByEmail: user.email,
		})
		.from(presentations)
		.leftJoin(user, eq(presentations.createdBy, user.id));

	// Apply role-based filtering
	if (currentUser.role === "department_manager" || currentUser.role === "area_lead") {
		// Only see presentations they created or are relevant to their area/dept
		query = query.where(eq(presentations.createdBy, currentUser.id)) as typeof query;
	}
	// Super admin and viewer see all presentations

	return await query;
});

export const getPresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		const presentation = await db
			.select({
				id: presentations.id,
				name: presentations.name,
				month: presentations.month,
				year: presentations.year,
				status: presentations.status,
				createdBy: presentations.createdBy,
				presentedAt: presentations.presentedAt,
				createdAt: presentations.createdAt,
				updatedAt: presentations.updatedAt,
				createdByName: user.name,
				createdByEmail: user.email,
			})
			.from(presentations)
			.leftJoin(user, eq(presentations.createdBy, user.id))
			.where(eq(presentations.id, input.id))
			.limit(1);
		
		if (!presentation[0]) {
			throw new Error("Presentation not found");
		}
		
		return presentation[0];
	});

export const createPresentation = protectedProcedure
	.input(CreatePresentationSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const [newPresentation] = await db
			.insert(presentations)
			.values({
				...input,
				createdBy: context.session.user.id,
				status: "draft",
			})
			.returning();
		
		return newPresentation;
	});

export const updatePresentation = protectedProcedure
	.input(
		z.object({
			id: z.string().uuid(),
			data: UpdatePresentationSchema,
		})
	)
	.handler(async ({ input }) => {
		const [updatedPresentation] = await db
			.update(presentations)
			.set(input.data)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!updatedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return updatedPresentation;
	});

export const deletePresentation = protectedProcedure
	.input(z.object({ id: z.string().uuid() }))
	.handler(async ({ input }) => {
		// First delete related goal submissions
		await db.delete(goalSubmissions).where(eq(goalSubmissions.presentationId, input.id));
		
		// Then delete the presentation
		const [deletedPresentation] = await db
			.delete(presentations)
			.where(eq(presentations.id, input.id))
			.returning();
		
		if (!deletedPresentation) {
			throw new Error("Presentation not found");
		}
		
		return { success: true };
	});

// Get monthly goals available for a presentation (filtered by user role)
export const getAvailableGoalsForPresentation = protectedProcedure
	.input(z.object({ 
		month: z.number().int().min(1).max(12),
		year: z.number().int().min(2020),
	}))
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const currentUser = context.session.user;
		
		// Build where conditions with role-based filtering
		let whereConditions = [
			eq(monthlyGoals.month, input.month),
			eq(monthlyGoals.year, input.year)
		];

		// Apply role-based filtering
		if (currentUser.role === "department_manager") {
			whereConditions.push(eq(departments.managerId, currentUser.id));
		} else if (currentUser.role === "area_lead") {
			whereConditions.push(eq(areas.leadId, currentUser.id));
		}

		// Execute query with combined conditions
		return await db
			.select({
				id: monthlyGoals.id,
				month: monthlyGoals.month,
				year: monthlyGoals.year,
				targetValue: monthlyGoals.targetValue,
				achievedValue: monthlyGoals.achievedValue,
				description: monthlyGoals.description,
				status: monthlyGoals.status,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				// User and organizational info
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(monthlyGoals)
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(and(...whereConditions));
	});

// Submit goals for a presentation
export const submitGoalsForPresentation = protectedProcedure
	.input(BulkSubmitGoalsSchema)
	.handler(async ({ input, context }) => {
		if (!context.session?.user) {
			throw new Error("Unauthorized");
		}

		const goalSubmissionValues = input.submissions.map(submission => ({
			...submission,
			presentationId: input.presentationId,
			submittedBy: context.session.user.id,
		}));

		const newSubmissions = await db
			.insert(goalSubmissions)
			.values(goalSubmissionValues)
			.returning();

		// Update the monthly goals with the submitted values
		for (const submission of input.submissions) {
			await db
				.update(monthlyGoals)
				.set({ 
					achievedValue: submission.submittedValue,
					status: "completed",
				})
				.where(eq(monthlyGoals.id, submission.monthlyGoalId));
		}
		
		return newSubmissions;
	});

// Get goal submissions for a presentation
export const getPresentationSubmissions = protectedProcedure
	.input(z.object({ presentationId: z.string().uuid() }))
	.handler(async ({ input }) => {
		return await db
			.select({
				id: goalSubmissions.id,
				submittedValue: goalSubmissions.submittedValue,
				submittedBy: goalSubmissions.submittedBy,
				submittedAt: goalSubmissions.submittedAt,
				notes: goalSubmissions.notes,
				// Monthly goal info
				goalId: monthlyGoals.id,
				targetValue: monthlyGoals.targetValue,
				goalDescription: monthlyGoals.description,
				// Goal template info
				goalTemplateName: goalTemplates.name,
				goalTemplateUnit: goalTemplates.unit,
				// User info
				userName: user.name,
				userEmail: user.email,
				areaName: areas.name,
				departmentName: departments.name,
			})
			.from(goalSubmissions)
			.leftJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
			.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
			.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
			.leftJoin(user, eq(teamMembers.userId, user.id))
			.leftJoin(areas, eq(teamMembers.areaId, areas.id))
			.leftJoin(departments, eq(areas.departmentId, departments.id))
			.where(eq(goalSubmissions.presentationId, input.presentationId));
	});

// Helper function to get presentation data
async function getPresentationData(presentationId: string) {
	// Get presentation info
	const presentation = await db
		.select({
			id: presentations.id,
			name: presentations.name,
			month: presentations.month,
			year: presentations.year,
			status: presentations.status,
		})
		.from(presentations)
		.where(eq(presentations.id, presentationId))
		.limit(1);
	
	if (!presentation[0]) {
		throw new ORPCError("NOT_FOUND", { message: "Presentation not found" });
	}

	// Get submissions for this presentation
	const submissions = await db
		.select({
			id: goalSubmissions.id,
			submittedValue: goalSubmissions.submittedValue,
			submittedBy: goalSubmissions.submittedBy,
			submittedAt: goalSubmissions.submittedAt,
			notes: goalSubmissions.notes,
			goalId: monthlyGoals.id,
			targetValue: monthlyGoals.targetValue,
			goalDescription: monthlyGoals.description,
			goalTemplateName: goalTemplates.name,
			goalTemplateUnit: goalTemplates.unit,
			userName: user.name,
			userEmail: user.email,
			areaName: areas.name,
			departmentName: departments.name,
		})
		.from(goalSubmissions)
		.leftJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
		.leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
		.leftJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
		.leftJoin(user, eq(teamMembers.userId, user.id))
		.leftJoin(areas, eq(teamMembers.areaId, areas.id))
		.leftJoin(departments, eq(areas.departmentId, departments.id))
		.where(eq(goalSubmissions.presentationId, presentationId));

	return { presentation: presentation[0], submissions };
}

// Helper function to calculate progress percentage
function getProgressPercentage(target: string, achieved: string) {
	const targetNum = parseFloat(target);
	const achievedNum = parseFloat(achieved);
	return targetNum > 0 ? (achievedNum / targetNum) * 100 : 0;
}

// Helper function to organize submissions by department and area
function organizeSubmissions(submissions: any[]) {
	return submissions.reduce((acc: any, submission: any) => {
		const dept = submission.departmentName || 'Sin Departamento';
		const area = submission.areaName || 'Sin Área';
		
		if (!acc[dept]) {
			acc[dept] = {};
		}
		if (!acc[dept][area]) {
			acc[dept][area] = [];
		}
		acc[dept][area].push(submission);
		
		return acc;
	}, {});
}

// Helper function to generate HTML for the presentation
function generatePresentationHTML(presentation: any, submissions: any[]) {
	const months = [
		"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
		"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
	];

	const organized = organizeSubmissions(submissions);
	const allSlides = [];

	// Title slide
	allSlides.push({
		type: 'title',
		content: `
			<div class="slide-page">
				<div class="text-center space-y-8">
					<div class="space-y-4">
						<h1 class="text-6xl font-bold gradient-blue">${presentation.name}</h1>
						<h2 class="text-3xl text-gray-600">${months[presentation.month]} ${presentation.year}</h2>
					</div>
					<div class="grid grid-cols-3 gap-8 mt-12">
						<div class="p-6 bg-gray-50 rounded-lg text-center">
							<div class="text-3xl font-bold text-blue-600">${submissions.length}</div>
							<div class="text-lg text-gray-600">Metas Presentadas</div>
						</div>
						<div class="p-6 bg-gray-50 rounded-lg text-center">
							<div class="text-3xl font-bold text-green-600">
								${submissions.filter(s => getProgressPercentage(s.targetValue || "0", s.submittedValue || "0") >= 80).length}
							</div>
							<div class="text-lg text-gray-600">Metas Exitosas</div>
						</div>
						<div class="p-6 bg-gray-50 rounded-lg text-center">
							<div class="text-3xl font-bold text-yellow-600">
								${submissions.filter(s => {
									const pct = getProgressPercentage(s.targetValue || "0", s.submittedValue || "0");
									return pct >= 50 && pct < 80;
								}).length}
							</div>
							<div class="text-lg text-gray-600">En Progreso</div>
						</div>
					</div>
				</div>
			</div>
		`
	});

	// Department and area slides
	Object.keys(organized).forEach(dept => {
		allSlides.push({
			type: 'department',
			content: `
				<div class="slide-page">
					<div class="text-center space-y-8">
						<div class="space-y-4">
							<h1 class="text-5xl font-bold gradient-green">${dept}</h1>
							<h2 class="text-2xl text-gray-600">Departamento</h2>
						</div>
					</div>
				</div>
			`
		});

		Object.keys(organized[dept]).forEach(area => {
			allSlides.push({
				type: 'area',
				content: `
					<div class="slide-page">
						<div class="text-center space-y-8">
							<div class="space-y-4">
								<h1 class="text-4xl font-bold gradient-purple">${area}</h1>
								<h2 class="text-xl text-gray-600">Área - ${dept}</h2>
							</div>
						</div>
					</div>
				`
			});

			organized[dept][area].forEach((goal: any) => {
				const percentage = getProgressPercentage(goal.targetValue || "0", goal.submittedValue || "0");
				const statusBadge = percentage >= 80 ? 'badge-green">Exitoso' : 
								   percentage >= 50 ? 'badge-yellow">En Progreso' : 
								   'badge-red">Necesita Atención';

				allSlides.push({
					type: 'goal',
					content: `
						<div class="slide-page">
							<div class="text-center space-y-8">
								<div class="space-y-4 mb-8">
									<h2 class="text-4xl font-bold">${goal.userName}</h2>
									<h3 class="text-2xl text-gray-600">${goal.areaName} - ${goal.departmentName}</h3>
								</div>
								<div class="card max-w-2xl mx-auto">
									<div class="p-6">
										<h3 class="text-2xl font-bold mb-6">${goal.goalTemplateName}</h3>
										<div class="grid grid-cols-2 gap-8 text-center mb-6">
											<div>
												<div class="text-3xl font-bold text-gray-600">${goal.targetValue}</div>
												<div class="text-lg text-gray-600">Objetivo (${goal.goalTemplateUnit || "unidades"})</div>
											</div>
											<div>
												<div class="text-3xl font-bold text-blue-600">${goal.submittedValue}</div>
												<div class="text-lg text-gray-600">Logrado (${goal.goalTemplateUnit || "unidades"})</div>
											</div>
										</div>
										<div class="space-y-4">
											<div style="display: flex; justify-content: space-between; align-items: center;">
												<span class="text-lg font-bold">Progreso</span>
												<span class="text-2xl font-bold">${Math.round(percentage)}%</span>
											</div>
											<div class="progress-bar">
												<div class="progress-fill" style="width: ${percentage}%"></div>
											</div>
											<div class="text-center">
												<span class="badge ${statusBadge}</span>
											</div>
										</div>
										${goal.notes ? `
											<div class="bg-gray-50 p-4 rounded-lg mt-6">
												<h4 class="font-bold mb-2">Notas:</h4>
												<p class="text-gray-600">${goal.notes}</p>
											</div>
										` : ''}
									</div>
								</div>
							</div>
						</div>
					`
				});
			});
		});
	});

	// Summary slide
	allSlides.push({
		type: 'summary',
		content: `
			<div class="slide-page">
				<div class="text-center space-y-8">
					<div class="space-y-4 mb-8">
						<h2 class="text-5xl font-bold">Resumen Final</h2>
						<h3 class="text-2xl text-gray-600">${months[presentation.month]} ${presentation.year}</h3>
					</div>
					<div class="grid grid-cols-3 gap-8 max-w-4xl mx-auto mb-8">
						<div class="card text-center">
							<div class="pt-6 p-6">
								<div class="text-4xl font-bold text-green-600 mb-2">
									${submissions.filter(s => getProgressPercentage(s.targetValue, s.submittedValue) >= 80).length}
								</div>
								<div class="text-lg font-bold">Metas Exitosas</div>
								<div class="text-gray-600">≥80% cumplimiento</div>
							</div>
						</div>
						<div class="card text-center">
							<div class="pt-6 p-6">
								<div class="text-4xl font-bold text-yellow-600 mb-2">
									${submissions.filter(s => {
										const pct = getProgressPercentage(s.targetValue, s.submittedValue);
										return pct >= 50 && pct < 80;
									}).length}
								</div>
								<div class="text-lg font-bold">En Progreso</div>
								<div class="text-gray-600">50-79% cumplimiento</div>
							</div>
						</div>
						<div class="card text-center">
							<div class="pt-6 p-6">
								<div class="text-4xl font-bold text-red-600 mb-2">
									${submissions.filter(s => getProgressPercentage(s.targetValue, s.submittedValue) < 50).length}
								</div>
								<div class="text-lg font-bold">Necesitan Atención</div>
								<div class="text-gray-600">&lt;50% cumplimiento</div>
							</div>
						</div>
					</div>
					<div class="text-center space-y-4">
						<h3 class="text-2xl font-bold">¡Gracias por su atención!</h3>
						<p class="text-lg text-gray-600">Presentación generada con CCI Sync</p>
					</div>
				</div>
			</div>
		`
	});

	const slidesHTML = allSlides.map(slide => slide.content.trim()).join('');

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<title>${presentation.name} - ${months[presentation.month]} ${presentation.year}</title>
			<style>
				@page {
					margin: 1cm;
					size: A4 landscape;
				}
				* {
					box-sizing: border-box;
				}
				body {
					font-family: system-ui, -apple-system, sans-serif;
					margin: 0;
					padding: 0;
					line-height: 1.6;
					background: white;
				}
				.slide-page {
					page-break-after: always;
					page-break-inside: avoid;
					height: 100vh;
					display: flex;
					flex-direction: column;
					justify-content: center;
					align-items: center;
					padding: 2rem;
					margin: 0;
					background: white;
				}
				.slide-page:last-child {
					page-break-after: avoid;
				}
				.text-center { text-align: center; }
				.font-bold { font-weight: bold; }
				.text-6xl { font-size: 3.75rem; line-height: 1; }
				.text-5xl { font-size: 3rem; line-height: 1; }
				.text-4xl { font-size: 2.25rem; line-height: 1; }
				.text-3xl { font-size: 1.875rem; line-height: 1; }
				.text-2xl { font-size: 1.5rem; line-height: 1; }
				.text-xl { font-size: 1.25rem; line-height: 1; }
				.text-lg { font-size: 1.125rem; line-height: 1; }
				.gradient-blue { color: #2563eb; }
				.gradient-green { color: #059669; }
				.gradient-purple { color: #7c3aed; }
				.text-gray-600 { color: #4b5563; }
				.text-blue-600 { color: #2563eb; }
				.text-green-600 { color: #059669; }
				.text-yellow-600 { color: #d97706; }
				.text-red-600 { color: #dc2626; }
				.grid { display: grid; }
				.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
				.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
				.gap-4 { gap: 1rem; }
				.gap-8 { gap: 2rem; }
				.space-y-4 > * + * { margin-top: 1rem; }
				.space-y-6 > * + * { margin-top: 1.5rem; }
				.space-y-8 > * + * { margin-top: 2rem; }
				.mb-2 { margin-bottom: 0.5rem; }
				.mb-4 { margin-bottom: 1rem; }
				.mb-6 { margin-bottom: 1.5rem; }
				.mb-8 { margin-bottom: 2rem; }
				.mt-6 { margin-top: 1.5rem; }
				.mt-12 { margin-top: 3rem; }
				.mx-auto { margin-left: auto; margin-right: auto; }
				.p-4 { padding: 1rem; }
				.p-6 { padding: 1.5rem; }
				.pt-6 { padding-top: 1.5rem; }
				.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
				.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
				.rounded-lg { border-radius: 0.5rem; }
				.bg-gray-50 { background-color: #f9fafb; }
				.bg-gray-100 { background-color: #f3f4f6; }
				.border { border: 1px solid #e5e7eb; }
				.card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; }
				.badge { display: inline-flex; align-items: center; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
				.badge-green { background-color: #dcfce7; color: #166534; }
				.badge-yellow { background-color: #fef3c7; color: #92400e; }
				.badge-red { background-color: #fee2e2; color: #991b1b; }
				.progress-bar { width: 100%; height: 1rem; background-color: #e5e7eb; border-radius: 0.5rem; overflow: hidden; }
				.progress-fill { height: 100%; background-color: #3b82f6; transition: width 0.3s ease; }
				.max-w-2xl { max-width: 42rem; }
				.max-w-4xl { max-width: 56rem; }
				.w-full { width: 100%; }
			</style>
		</head>
		<body>
			${slidesHTML}
		</body>
		</html>
	`;
}

// Utility function for PDF generation
export async function generatePDF(presentationId: string, baseUrl: string = "http://localhost:3001") {
	let browser;
	
	try {
		console.log(`Starting PDF generation for presentation ${presentationId}`);
		
		// Get presentation data from database
		const { presentation, submissions } = await getPresentationData(presentationId);
		console.log(`Found presentation: ${presentation.name} with ${submissions.length} submissions`);
		
		// Generate HTML content
		const htmlContent = generatePresentationHTML(presentation, submissions);
		
		// Debug: save HTML to file for inspection
		const fs = await import('fs');
		await fs.promises.writeFile('/tmp/presentation-debug.html', htmlContent);
		console.log('HTML saved to /tmp/presentation-debug.html for debugging');
		
		browser = await puppeteer.launch({ 
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
		});
		
		console.log('Browser launched successfully');
		
		const page = await browser.newPage();
		
		// Set viewport for consistent rendering
		await page.setViewport({ width: 1920, height: 1080 });
		
		// Set the HTML content directly
		await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
		console.log('HTML content set successfully');
		
		// Debug: take screenshot to see what's rendered
		await page.screenshot({ path: '/tmp/presentation-render.png', fullPage: true });
		console.log('Screenshot saved to /tmp/presentation-render.png');
		
		// Generate PDF
		console.log('Generating PDF...');
		const pdfBuffer = await page.pdf({
			format: 'A4',
			landscape: true,
			margin: {
				top: '1cm',
				right: '1cm',
				bottom: '1cm',
				left: '1cm'
			},
			printBackground: true,
			preferCSSPageSize: true
		});
		
		console.log(`PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
		
		// Convert to base64 for ORPC transport
		const base64PDF = Buffer.from(pdfBuffer).toString('base64');
		console.log(`PDF converted to base64. Size: ${base64PDF.length} characters`);
		
		const months = [
			"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
			"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
		];
		
		return {
			pdf: base64PDF,
			filename: `${presentation.name} - ${months[presentation.month]} ${presentation.year}.pdf`
		};
		
	} catch (error) {
		console.error('Error in PDF generation:', error);
		
		if (error instanceof ORPCError) {
			throw error;
		}
		
		throw new ORPCError("INTERNAL_SERVER_ERROR", { 
			message: `PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
		});
	} finally {
		if (browser) {
			await browser.close();
			console.log('Browser closed');
		}
	}
}

// Generate PDF for presentation
export const generatePresentationPDF = protectedProcedure
	.input(z.object({ 
		presentationId: z.string().uuid(),
		baseUrl: z.string().url().optional().default("http://localhost:3001")
	}))
	.handler(async ({ input }) => {
		return await generatePDF(input.presentationId, input.baseUrl);
	});