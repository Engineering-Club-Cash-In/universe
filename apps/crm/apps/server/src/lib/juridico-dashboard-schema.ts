import { z } from "zod";

export const juridicoDashboardMetricSchema = z.object({
	value: z.number().nonnegative(),
	label: z.string().min(1),
	helper: z.string().optional(),
	changeText: z.string().optional(),
	changeTone: z.enum(["neutral", "positive", "warning", "danger"]).default("neutral"),
});

export const juridicoDashboardTrendPointSchema = z.object({
	label: z.string().min(1),
	collectedAmount: z.number().nonnegative(),
	casesIntervened: z.number().nonnegative(),
});

export const juridicoDashboardFunnelStepSchema = z.object({
	label: z.string().min(1),
	value: z.number().nonnegative(),
	pct: z.number().min(0).max(100),
	tone: z.enum(["primary", "info", "success", "warning"]).default("primary"),
});

export const juridicoDashboardOrderSchema = z.object({
	id: z.string().min(1),
	court: z.string().min(1),
	municipality: z.string().min(1),
	assignedAt: z.string().min(1),
	status: z.string().min(1),
	daysInProcess: z.number().nonnegative(),
	changeText: z.string().optional(),
});

export const juridicoDashboardQualityItemSchema = z.object({
	label: z.string().min(1),
	pct: z.number().min(0).max(100),
	tone: z.enum(["success", "warning", "danger"]),
});

export const juridicoDashboardPayloadSchema = z.object({
	header: z.object({
		title: z.string().min(1).default("Jurídico"),
		subtitle: z
			.string()
			.min(1)
			.default("Impacto operativo y recaudación jurídica"),
		periodLabel: z.string().min(1),
		sourceLabel: z.string().optional(),
	}),
	metrics: z.array(juridicoDashboardMetricSchema).min(4).max(6),
	trend: z.array(juridicoDashboardTrendPointSchema).min(1).max(12),
	funnel: z.array(juridicoDashboardFunnelStepSchema).min(3).max(6),
	orders: z.array(juridicoDashboardOrderSchema).max(20).default([]),
	quality: z.array(juridicoDashboardQualityItemSchema).min(1).max(5),
});

export const updateJuridicoDashboardSnapshotInputSchema = z.object({
	periodLabel: z.string().min(1),
	notes: z.string().optional(),
	payload: juridicoDashboardPayloadSchema,
});

export type JuridicoDashboardPayload = z.infer<
	typeof juridicoDashboardPayloadSchema
>;
