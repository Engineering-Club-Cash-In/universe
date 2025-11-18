import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/admin/")({
	component: AdminIndexPage,
});

function AdminIndexPage() {
	const navigate = Route.useNavigate();

	useEffect(() => {
		// Redirect to departments by default
		navigate({ to: "/admin/departments", replace: true });
	}, [navigate]);

	return null;
}