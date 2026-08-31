type Nullable<T> = T | null;

type AuditOpportunity = {
	id: string;
	title: string;
	value: Nullable<string>;
	status: string;
	creditType: string;
	source: Nullable<string>;
	campaign: Nullable<string>;
	loanPurpose: Nullable<string>;
	probability: number;
	expectedCloseDate: Nullable<Date>;
	actualCloseDate: Nullable<Date>;
	notes: Nullable<string>;
	numeroCuotas: Nullable<number>;
	tasaInteres: Nullable<string>;
	cuotaMensual: Nullable<string>;
	fechaInicio: Nullable<Date>;
	diaPagoMensual: Nullable<number>;
	numeroSifco: Nullable<string>;
	nit: Nullable<string>;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
};

type AuditStage = {
	id: string | null;
	name: string | null;
	closurePercentage: number | null;
};

type AuditLead = {
	id: string | null;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	phone: string | null;
};

type AuditCompany = { id: string | null; name: string | null };

type AuditVehicle = {
	id: string | null;
	make: string | null;
	model: string | null;
	year: number | null;
	licensePlate: string | null;
};

type AuditUser = {
	id: string | null;
	name: string | null;
	email: string | null;
};

type AuditClient = {
	id: string | null;
	contactPerson: string | null;
	status: string | null;
};

// Verificaciones de QR de licencia (lead o co-deudor de esta oportunidad) que
// se archivan acá antes de borrarlas — si no, el borrado de la oportunidad
// destruye el rastro de auditoría que ese feature existe para conservar.
type AuditLicenseVerification = {
	id: string;
	subjectType: "lead" | "coDebtor";
	subjectId: string;
	result: string;
	qrRawUrl: string | null;
	qrDomainValid: boolean;
	cardCode: string | null;
	apiResponseCode: number | null;
	licenseHolderName: string | null;
	licenseNumber: string | null;
	licenseExpiresAt: string | null;
	identityMatchScore: string | null;
	failureReason: string | null;
	documentKey: string | null;
	rawResponse: unknown;
	createdAt: Date;
	createdBy: string;
};

export type DeletedOpportunitySnapshot = {
	opportunity: {
		id: string;
		title: string;
		value: Nullable<string>;
		status: string;
		creditType: string;
		source: Nullable<string>;
		campaign: Nullable<string>;
		loanPurpose: Nullable<string>;
		probability: number;
		expectedCloseDate: Nullable<string>;
		actualCloseDate: Nullable<string>;
		notes: Nullable<string>;
		numeroSifco: Nullable<string>;
		nit: Nullable<string>;
		creditTerms: {
			numeroCuotas: Nullable<number>;
			tasaInteres: Nullable<string>;
			cuotaMensual: Nullable<string>;
			fechaInicio: Nullable<string>;
			diaPagoMensual: Nullable<number>;
		};
		createdAt: string;
		updatedAt: string;
		createdBy: string;
	};
	stage: AuditStage;
	lead: (AuditLead & { fullName: string | null }) | null;
	company: AuditCompany | null;
	vehicle: AuditVehicle | null;
	assignedUser: AuditUser | null;
	client: AuditClient | null;
	relatedCounts: {
		documents: number;
		coDebtors: number;
		forms: number;
		stageHistory: number;
		licenseVerifications: number;
	};
	licenseVerifications: Array<
		Omit<AuditLicenseVerification, "createdAt"> & { createdAt: string }
	>;
};

function serializeDate(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function buildFullName(lead: AuditLead | null): string | null {
	if (!lead) return null;
	const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
	return fullName || null;
}

export function buildDeletedOpportunitySnapshot({
	opportunity,
	stage,
	lead,
	company,
	vehicle,
	assignedUser,
	client,
	relatedCounts,
	licenseVerifications = [],
}: {
	opportunity: AuditOpportunity;
	stage: AuditStage;
	lead: AuditLead | null;
	company: AuditCompany | null;
	vehicle: AuditVehicle | null;
	assignedUser: AuditUser | null;
	client: AuditClient | null;
	relatedCounts: Omit<
		DeletedOpportunitySnapshot["relatedCounts"],
		"licenseVerifications"
	>;
	licenseVerifications?: AuditLicenseVerification[];
}): DeletedOpportunitySnapshot {
	return {
		opportunity: {
			id: opportunity.id,
			title: opportunity.title,
			value: opportunity.value,
			status: opportunity.status,
			creditType: opportunity.creditType,
			source: opportunity.source,
			campaign: opportunity.campaign,
			loanPurpose: opportunity.loanPurpose,
			probability: opportunity.probability,
			expectedCloseDate: serializeDate(opportunity.expectedCloseDate),
			actualCloseDate: serializeDate(opportunity.actualCloseDate),
			notes: opportunity.notes,
			numeroSifco: opportunity.numeroSifco,
			nit: opportunity.nit,
			creditTerms: {
				numeroCuotas: opportunity.numeroCuotas,
				tasaInteres: opportunity.tasaInteres,
				cuotaMensual: opportunity.cuotaMensual,
				fechaInicio: serializeDate(opportunity.fechaInicio),
				diaPagoMensual: opportunity.diaPagoMensual,
			},
			createdAt: opportunity.createdAt.toISOString(),
			updatedAt: opportunity.updatedAt.toISOString(),
			createdBy: opportunity.createdBy,
		},
		stage,
		lead: lead ? { ...lead, fullName: buildFullName(lead) } : null,
		company,
		vehicle,
		assignedUser,
		client,
		relatedCounts: {
			...relatedCounts,
			licenseVerifications: licenseVerifications.length,
		},
		licenseVerifications: licenseVerifications.map((verification) => ({
			...verification,
			createdAt: verification.createdAt.toISOString(),
		})),
	};
}
