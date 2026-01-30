import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";

// ── Interfaces ──────────────────────────────────────────────────────────

export interface ClientData {
	age: number;
	income: number;
	loan_amount: number;
	credit_card: number;
	own_home: number;
	own_vehicle: number;
	work_time: number;
	occupation: number;
	marital_status: number;
	dependents: number;
	loan_purpose: number;
	num_credits: number;
}

export interface CreditScoreResponse {
	fit: boolean;
	probability: number;
}

interface MappingResult {
	data: ClientData | null;
	missingFields: string[];
}

// ── Encoding helpers ────────────────────────────────────────────────────

function encodeWorkTime(value: string | null | undefined): number | null {
	const map: Record<string, number> = {
		less_than_1: 0,
		"1_to_5": 0,
		"5_to_10": 1,
		"10_plus": 2,
	};
	return value ? (map[value] ?? null) : null;
}

function encodeOccupation(value: string | null | undefined): number | null {
	const map: Record<string, number> = {
		employee: 0,
		owner: 1,
	};
	return value ? (map[value] ?? null) : null;
}

function encodeMaritalStatus(value: string | null | undefined): number | null {
	if (!value) return null;
	return value === "single" ? 0 : 1;
}

function encodeLoanPurpose(value: string | null | undefined): number {
	if (!value || value === "personal") return 0;
	return 1; // business
}

function encodeAge(age: number | null | undefined): number | null {
	if (age == null) return null;
	if (age < 30) return 0;
	if (age < 40) return 1;
	if (age < 50) return 2;
	return 3;
}

function encodeBool(value: boolean | null | undefined): number {
	return value ? 1 : 0;
}

// ── Map lead → ML input ─────────────────────────────────────────────────

export function mapLeadToScoringInput(
	lead: {
		age: number | null;
		monthlyIncome: string | null;
		loanAmount: string | null;
		hasCreditCard: boolean | null;
		ownsHome: boolean | null;
		ownsVehicle: boolean | null;
		workTime: string | null;
		occupation: string | null;
		maritalStatus: string | null;
		dependents: number | null;
	},
	loanPurpose?: string | null,
): MappingResult {
	const missing: string[] = [];

	if (lead.age == null) missing.push("age");
	if (!lead.monthlyIncome) missing.push("monthlyIncome");
	if (!lead.loanAmount) missing.push("loanAmount");
	if (lead.workTime == null) missing.push("workTime");
	if (lead.occupation == null) missing.push("occupation");
	if (lead.maritalStatus == null) missing.push("maritalStatus");

	if (missing.length > 0) {
		return { data: null, missingFields: missing };
	}

	const encodedAge = encodeAge(lead.age);
	const encodedWorkTime = encodeWorkTime(lead.workTime);
	const encodedOccupation = encodeOccupation(lead.occupation);
	const encodedMaritalStatus = encodeMaritalStatus(lead.maritalStatus);

	if (
		encodedAge == null ||
		encodedWorkTime == null ||
		encodedOccupation == null ||
		encodedMaritalStatus == null
	) {
		return { data: null, missingFields: ["encoding_error"] };
	}

	return {
		data: {
			age: encodedAge,
			income: Number.parseFloat(lead.monthlyIncome!),
			loan_amount: Number.parseFloat(lead.loanAmount!),
			credit_card: encodeBool(lead.hasCreditCard),
			own_home: encodeBool(lead.ownsHome),
			own_vehicle: encodeBool(lead.ownsVehicle),
			work_time: encodedWorkTime,
			occupation: encodedOccupation,
			marital_status: encodedMaritalStatus,
			dependents: lead.dependents ?? 0,
			loan_purpose: encodeLoanPurpose(loanPurpose),
			num_credits: 0,
		},
		missingFields: [],
	};
}

// ── ML API call ─────────────────────────────────────────────────────────

const SCORING_API_URL =
	process.env.SCORING_API_URL || "https://scoring.devteamatcci.site/predict";

export async function predictCreditScore(
	data: ClientData,
): Promise<CreditScoreResponse> {
	const response = await fetch(SCORING_API_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});

	if (!response.ok) {
		throw new Error(
			`Scoring API error: ${response.status} ${response.statusText}`,
		);
	}

	return response.json() as Promise<CreditScoreResponse>;
}

// ── Orchestrator ────────────────────────────────────────────────────────

export async function scoreLead(leadId: string, opportunityId?: string) {
	// 1. Fetch lead
	const [lead] = await db
		.select({
			age: leads.age,
			monthlyIncome: leads.monthlyIncome,
			loanAmount: leads.loanAmount,
			hasCreditCard: leads.hasCreditCard,
			ownsHome: leads.ownsHome,
			ownsVehicle: leads.ownsVehicle,
			workTime: leads.workTime,
			occupation: leads.occupation,
			maritalStatus: leads.maritalStatus,
			dependents: leads.dependents,
		})
		.from(leads)
		.where(eq(leads.id, leadId))
		.limit(1);

	if (!lead) {
		throw new Error(`Lead ${leadId} not found`);
	}

	// 2. Get loanPurpose from opportunity if provided
	let loanPurpose: string | null = null;
	if (opportunityId) {
		const [opp] = await db
			.select({ loanPurpose: opportunities.loanPurpose })
			.from(opportunities)
			.where(eq(opportunities.id, opportunityId))
			.limit(1);
		loanPurpose = opp?.loanPurpose ?? null;
	}

	// 3. Map to ML input
	const { data, missingFields } = mapLeadToScoringInput(lead, loanPurpose);

	if (!data) {
		return {
			score: null,
			fit: null,
			scoredAt: null,
			missingFields,
		};
	}

	// 4. Call ML model
	const result = await predictCreditScore(data);

	// 5. Update lead in DB
	const scoredAt = new Date();
	await db
		.update(leads)
		.set({
			score: String(result.probability),
			fit: result.fit,
			scoredAt,
			updatedAt: scoredAt,
		})
		.where(eq(leads.id, leadId));

	return {
		score: result.probability,
		fit: result.fit,
		scoredAt,
		missingFields: [] as string[],
	};
}
