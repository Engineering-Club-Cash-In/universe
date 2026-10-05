export function resolveMembershipForCartera(
	quotationMembershipCost: string | null | undefined,
	opportunityMembershipCost: string | null | undefined,
	isInternalCredit = false,
): number | undefined {
	if (isInternalCredit) return 0;

	for (const value of [quotationMembershipCost, opportunityMembershipCost]) {
		const normalized = value?.trim();
		if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) continue;

		const [whole, fraction = ""] = normalized.split(".");
		const firstTwoDecimals = fraction.slice(0, 2).padEnd(2, "0");
		const shouldRoundUp = (fraction[2] ?? "0") >= "5";
		const cents =
			BigInt(whole) * 100n +
			BigInt(firstTwoDecimals) +
			(shouldRoundUp ? 1n : 0n);
		return Number(cents) / 100;
	}

	return undefined;
}
