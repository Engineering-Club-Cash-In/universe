import { describe, expect, test } from "bun:test";

/**
 * Tests for presentation utility functions
 * These functions are used both in server-side PDF generation and client-side presentation view
 */

// Progress calculation function (duplicated from presentations.ts and view component)
function getProgressPercentage(target: string, achieved: string, goalName?: string): number {
	const targetNum = parseFloat(target);
	const achievedNum = parseFloat(achieved);
	
	if (targetNum <= 0) return 0;
	
	// Detectar meta inversa por nombre (palabras clave que indican "reducir es mejor")
	const inversaKeywords = ['mora', 'error', 'reclamo', 'falla', 'retraso', 'costo', 'gasto'];
	const isInverseMeta = goalName ? 
		inversaKeywords.some(keyword => goalName.toLowerCase().includes(keyword)) : 
		false;
	
	if (isInverseMeta) {
		// Para metas inversas: targetValue = logrado, submittedValue = meta máxima
		// Si logrado <= meta = 100%, si logrado > meta = menos %
		if (targetNum <= achievedNum) {
			return 100; // Cumplió o superó la meta de reducción
		} else {
			return Math.max((achievedNum / targetNum) * 100, 0);
		}
	} else {
		// Para metas normales: mayor valor logrado = mejor progreso
		return (achievedNum / targetNum) * 100;
	}
}

// Status badge calculation function
function getStatusFromPercentage(percentage: number): { status: string; color: string } {
	if (percentage >= 80) {
		return { status: "Exitoso", color: "green" };
	} else if (percentage >= 50) {
		return { status: "En Progreso", color: "yellow" };
	} else {
		return { status: "Necesita Atención", color: "red" };
	}
}

// Organization function for submissions
function organizeSubmissions(submissions: any[]) {
	return submissions.reduce((acc: any, submission: any) => {
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
}

// Chunk goals for pagination
function chunkGoals(goals: any[], maxPerSlide: number = 4) {
	const chunks = [];
	for (let i = 0; i < goals.length; i += maxPerSlide) {
		chunks.push(goals.slice(i, i + maxPerSlide));
	}
	return chunks;
}

// Responsive goals per slide calculation
function getMaxGoalsPerSlide(screenWidth: number = 1920): number {
	if (screenWidth < 640) return 1;  // Mobile: 1 meta por slide
	if (screenWidth < 1024) return 2; // Small: 2 metas por slide  
	if (screenWidth < 1280) return 3; // Large: 3 metas por slide
	return 4; // XL: 4 metas por slide
}

describe("Presentation Utility Functions", () => {
	describe("getProgressPercentage", () => {
		test("should calculate normal goal progress correctly", () => {
			// Normal goal: higher achieved value = better
			expect(getProgressPercentage("100", "85", "Ventas")).toBe(85);
			expect(getProgressPercentage("50", "40", "Ingresos")).toBe(80);
			expect(getProgressPercentage("200", "250", "Clientes")).toBe(125);
		});

		test("should calculate inverse goal progress correctly", () => {
			// Inverse goal: lower achieved value = better
			expect(getProgressPercentage("3", "5", "Mora Cartera")).toBe(100); // 3 <= 5 = success
			expect(getProgressPercentage("4", "5", "Error Rate")).toBe(100); // 4 <= 5 = success
			expect(getProgressPercentage("6", "5", "Reclamos")).toBe(Math.max((5 / 6) * 100, 0));
		});

		test("should detect inverse goals by keywords", () => {
			const inverseKeywords = ['mora', 'error', 'reclamo', 'falla', 'retraso', 'costo', 'gasto'];
			
			inverseKeywords.forEach(keyword => {
				// Test uppercase
				expect(getProgressPercentage("5", "3", `Meta de ${keyword.toUpperCase()}`)).toBe(100);
				// Test lowercase
				expect(getProgressPercentage("5", "3", `reducir ${keyword}`)).toBe(100);
				// Test mixed case
				expect(getProgressPercentage("5", "3", `Control ${keyword}s`)).toBe(100);
			});
		});

		test("should handle edge cases", () => {
			// Zero target
			expect(getProgressPercentage("0", "50")).toBe(0);
			
			// Negative values
			expect(getProgressPercentage("-10", "5")).toBe(0);
			
			// Invalid strings (should parse as NaN and return 0)
			expect(getProgressPercentage("abc", "def")).toBe(0);
			
			// Empty strings
			expect(getProgressPercentage("", "")).toBe(0);
		});

		test("should handle inverse goal edge cases", () => {
			// Perfect achievement (0 errors)
			expect(getProgressPercentage("0", "5", "error rate")).toBe(0);
			
			// High achievement on inverse goal
			expect(getProgressPercentage("10", "5", "mora")).toBe(100);
			
			// Underperformance on inverse goal
			expect(getProgressPercentage("8", "5", "retrasos")).toBe(Math.max((5 / 8) * 100, 0));
		});
	});

	describe("getStatusFromPercentage", () => {
		test("should return correct status for different percentages", () => {
			expect(getStatusFromPercentage(100)).toEqual({ status: "Exitoso", color: "green" });
			expect(getStatusFromPercentage(85)).toEqual({ status: "Exitoso", color: "green" });
			expect(getStatusFromPercentage(80)).toEqual({ status: "Exitoso", color: "green" });
			
			expect(getStatusFromPercentage(75)).toEqual({ status: "En Progreso", color: "yellow" });
			expect(getStatusFromPercentage(65)).toEqual({ status: "En Progreso", color: "yellow" });
			expect(getStatusFromPercentage(50)).toEqual({ status: "En Progreso", color: "yellow" });
			
			expect(getStatusFromPercentage(45)).toEqual({ status: "Necesita Atención", color: "red" });
			expect(getStatusFromPercentage(25)).toEqual({ status: "Necesita Atención", color: "red" });
			expect(getStatusFromPercentage(0)).toEqual({ status: "Necesita Atención", color: "red" });
		});
	});

	describe("organizeSubmissions", () => {
		test("should organize submissions by department, area, and person", () => {
			const submissions = [
				{
					departmentName: "Ventas",
					areaName: "Ventas Directas",
					userName: "Juan Pérez",
					goalTemplateName: "Meta 1",
					submittedValue: "100"
				},
				{
					departmentName: "Ventas",
					areaName: "Ventas Directas",
					userName: "Juan Pérez",
					goalTemplateName: "Meta 2",
					submittedValue: "80"
				},
				{
					departmentName: "Operaciones",
					areaName: "Logística",
					userName: "María García",
					goalTemplateName: "Meta 3",
					submittedValue: "90"
				}
			];

			const organized = organizeSubmissions(submissions);

			expect(organized["Ventas"]["Ventas Directas"]["Juan Pérez"].goals).toHaveLength(2);
			expect(organized["Operaciones"]["Logística"]["María García"].goals).toHaveLength(1);
			expect(organized["Ventas"]["Ventas Directas"]["Juan Pérez"].userName).toBe("Juan Pérez");
		});

		test("should handle missing department/area/user names", () => {
			const submissions = [
				{
					departmentName: null,
					areaName: undefined,
					userName: "",
					goalTemplateName: "Meta 1",
					submittedValue: "100"
				}
			];

			const organized = organizeSubmissions(submissions);

			expect(organized["Sin Departamento"]["Sin Área"]["Sin Usuario"]).toBeDefined();
			expect(organized["Sin Departamento"]["Sin Área"]["Sin Usuario"].goals).toHaveLength(1);
		});
	});

	describe("chunkGoals", () => {
		test("should chunk goals into slides correctly", () => {
			const goals = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Goal ${i}` }));
			
			// Default chunk size (4)
			const chunks4 = chunkGoals(goals);
			expect(chunks4).toHaveLength(3); // 4 + 4 + 2
			expect(chunks4[0]).toHaveLength(4);
			expect(chunks4[1]).toHaveLength(4);
			expect(chunks4[2]).toHaveLength(2);

			// Custom chunk size
			const chunks3 = chunkGoals(goals, 3);
			expect(chunks3).toHaveLength(4); // 3 + 3 + 3 + 1
			expect(chunks3[0]).toHaveLength(3);
			expect(chunks3[3]).toHaveLength(1);
		});

		test("should handle empty array", () => {
			const chunks = chunkGoals([]);
			expect(chunks).toHaveLength(0);
		});

		test("should handle single item", () => {
			const chunks = chunkGoals([{ id: 1 }], 4);
			expect(chunks).toHaveLength(1);
			expect(chunks[0]).toHaveLength(1);
		});
	});

	describe("getMaxGoalsPerSlide", () => {
		test("should return correct goals per slide for different screen sizes", () => {
			// Mobile
			expect(getMaxGoalsPerSlide(320)).toBe(1);
			expect(getMaxGoalsPerSlide(600)).toBe(1);

			// Small tablets
			expect(getMaxGoalsPerSlide(768)).toBe(2);
			expect(getMaxGoalsPerSlide(1000)).toBe(2);

			// Large tablets/small desktops
			expect(getMaxGoalsPerSlide(1024)).toBe(3);
			expect(getMaxGoalsPerSlide(1200)).toBe(3);

			// Large desktops
			expect(getMaxGoalsPerSlide(1280)).toBe(4);
			expect(getMaxGoalsPerSlide(1920)).toBe(4);
			expect(getMaxGoalsPerSlide(2560)).toBe(4);
		});

		test("should default to desktop size", () => {
			expect(getMaxGoalsPerSlide()).toBe(4);
		});
	});

	describe("Integration tests", () => {
		test("should process complete presentation data correctly", () => {
			const submissions = [
				{
					departmentName: "Ventas",
					areaName: "Ventas Online",
					userName: "Ana López",
					goalTemplateName: "Ventas Mensuales",
					targetValue: "100",
					submittedValue: "120",
				},
				{
					departmentName: "Ventas",
					areaName: "Ventas Online",
					userName: "Ana López",
					goalTemplateName: "Mora Cartera",
					targetValue: "2",
					submittedValue: "5",
				},
				{
					departmentName: "Operaciones",
					areaName: "Soporte",
					userName: "Carlos Ruiz",
					goalTemplateName: "Tiempo Respuesta",
					targetValue: "60",
					submittedValue: "45",
				}
			];

			// Organize data
			const organized = organizeSubmissions(submissions);
			
			// Calculate progress for each goal
			const ventasGoal = submissions[0];
			const moraGoal = submissions[1];
			const soporteGoal = submissions[2];

			const ventasProgress = getProgressPercentage(ventasGoal.targetValue, ventasGoal.submittedValue, ventasGoal.goalTemplateName);
			const moraProgress = getProgressPercentage(moraGoal.targetValue, moraGoal.submittedValue, moraGoal.goalTemplateName);
			const soporteProgress = getProgressPercentage(soporteGoal.targetValue, soporteGoal.submittedValue, soporteGoal.goalTemplateName);

			// Verify calculations
			expect(ventasProgress).toBe(120); // Normal goal: 120/100 = 120%
			expect(moraProgress).toBe(100); // Inverse goal: 2 <= 5 = 100%
			expect(soporteProgress).toBe(75); // Normal goal: 45/60 = 75%

			// Verify status
			expect(getStatusFromPercentage(ventasProgress)).toEqual({ status: "Exitoso", color: "green" });
			expect(getStatusFromPercentage(moraProgress)).toEqual({ status: "Exitoso", color: "green" });
			expect(getStatusFromPercentage(soporteProgress)).toEqual({ status: "En Progreso", color: "yellow" });

			// Verify organization
			expect(organized["Ventas"]["Ventas Online"]["Ana López"].goals).toHaveLength(2);
			expect(organized["Operaciones"]["Soporte"]["Carlos Ruiz"].goals).toHaveLength(1);

			// Test chunking for Ana's goals (2 goals)
			const anaGoals = organized["Ventas"]["Ventas Online"]["Ana López"].goals;
			const chunks = chunkGoals(anaGoals, 4);
			expect(chunks).toHaveLength(1); // All fit in one slide
			expect(chunks[0]).toHaveLength(2);
		});
	});
});