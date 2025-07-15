import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import SignInForm from "@/components/sign-in-form";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	useEffect(() => {
		// Redirect to dashboard if already logged in
		if (session && !isPending) {
			navigate({
				to: "/dashboard",
			});
		}
	}, [session, isPending, navigate]);

	// Show loading while checking session
	if (isPending) {
		return <div>Loading...</div>;
	}

	// Don't render login form if user is already logged in
	if (session) {
		return null;
	}

	return <SignInForm />;
}
