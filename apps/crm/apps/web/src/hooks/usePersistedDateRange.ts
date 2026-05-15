import type { DateRange } from "react-day-picker";
import { usePersistedState } from "./usePersistedState";

export function usePersistedDateRange(key: string) {
	const [persisted, setPersisted] = usePersistedState<
		{ from?: string; to?: string } | undefined
	>(key, undefined);

	const dateRange: DateRange | undefined = persisted
		? {
				from: persisted.from ? new Date(persisted.from) : undefined,
				to: persisted.to ? new Date(persisted.to) : undefined,
			}
		: undefined;

	const setDateRange = (range: DateRange | undefined) =>
		setPersisted(
			range
				? { from: range.from?.toISOString(), to: range.to?.toISOString() }
				: undefined,
		);

	return [dateRange, setDateRange] as const;
}
