const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalDatabaseHost(hostname: string) {
	return LOCAL_DATABASE_HOSTS.has(hostname);
}

export function databaseSsl(
	hostname: string,
): false | { rejectUnauthorized: true } {
	return isLocalDatabaseHost(hostname) ? false : { rejectUnauthorized: true };
}
