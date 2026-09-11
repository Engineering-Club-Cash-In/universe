interface VehicleIdentity {
	licensePlate: string | null | undefined;
	vinNumber: string | null | undefined;
}

const normalizeVehicleIdentifier = (value: string | null | undefined) =>
	value?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "";

export function hasVehicleIdentityConflict(
	existing: VehicleIdentity,
	incoming: VehicleIdentity,
): boolean {
	const current = [
		normalizeVehicleIdentifier(existing.licensePlate),
		normalizeVehicleIdentifier(existing.vinNumber),
	];
	const next = [
		normalizeVehicleIdentifier(incoming.licensePlate),
		normalizeVehicleIdentifier(incoming.vinNumber),
	];

	if (current.some((value, index) => value && !next[index])) return true;

	const comparable = current
		.map((value, index) =>
			value && next[index] ? value === next[index] : null,
		)
		.filter((matches): matches is boolean => matches !== null);

	return comparable.some((matches) => !matches);
}
