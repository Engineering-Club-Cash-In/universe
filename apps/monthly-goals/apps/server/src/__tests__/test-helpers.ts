export function createMockContext(userRole: "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer", userId?: string) {
	const id = userId || crypto.randomUUID();
	
	return {
		session: {
			user: {
				id,
				email: `${userRole}@test.com`,
				name: `Test ${userRole}`,
				role: userRole,
				emailVerified: true,
				image: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			session: {
				id: crypto.randomUUID(),
				userId: id,
				expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
				token: crypto.randomUUID(),
				createdAt: new Date(),
				updatedAt: new Date(),
				ipAddress: null,
				userAgent: null,
				impersonatedBy: null,
			}
		}
	};
}