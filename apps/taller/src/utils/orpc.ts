import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { appRouter } from "../../../crm/apps/server/src/routers/index";

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			toast.error(`Error: ${error.message}`, {
				action: {
					label: "retry",
					onClick: () => {
						queryClient.invalidateQueries();
					},
				},
			});
		},
	}),
});

export const link = new RPCLink({
	url: `${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const client: RouterClient<typeof appRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

// Export individual methods for easier use (keeping the same interface)
export const vehiclesApi = {
  // Get all vehicles
  getAll: () => client.getVehicles(),
  
  // Get vehicle by ID
  getById: (id: string) => client.getVehicleById({ id }),
  
  // Create new vehicle
  create: (data: Parameters<typeof client.createVehicle>[0]) => client.createVehicle(data),
  
  // Update vehicle
  update: (id: string, data: Parameters<typeof client.updateVehicle>[0]['data']) => 
    client.updateVehicle({ id, data }),
  
  // Delete vehicle
  delete: (id: string) => client.deleteVehicle({ id }),
  
  // Search vehicles
  search: (params: Parameters<typeof client.searchVehicles>[0]) => client.searchVehicles(params),
  
  // Create full inspection (main method for Taller app)
  createFullInspection: (data: Parameters<typeof client.createFullVehicleInspection>[0]) => 
    client.createFullVehicleInspection(data),
  
  // Create inspection only
  createInspection: (data: Parameters<typeof client.createVehicleInspection>[0]) => 
    client.createVehicleInspection(data),
  
  // Upload photo
  uploadPhoto: (data: Parameters<typeof client.uploadVehiclePhoto>[0]) => 
    client.uploadVehiclePhoto(data),
  
  // Get statistics
  getStatistics: () => client.getVehicleStatistics(),
  
  // Process vehicle registration OCR
  processRegistrationOCR: (data: Parameters<typeof client.processVehicleRegistrationOCR>[0]) => 
    client.processVehicleRegistrationOCR(data),
  
  // Get AI vehicle valuation
  getAIValuation: (data: Parameters<typeof client.getAIVehicleValuation>[0]) =>
    client.getAIVehicleValuation(data),
};