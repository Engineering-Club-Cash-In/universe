// Get the server URL from environment variables
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// Simple fetch wrapper for API calls
const apiCall = async (endpoint: string, data?: any) => {
  const response = await fetch(`${SERVER_URL}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Add auth token if exists
      ...(localStorage.getItem('authToken') && {
        Authorization: `Bearer ${localStorage.getItem('authToken')}`
      })
    },
    body: JSON.stringify(data || {}),
  });
  
  if (!response.ok) {
    throw new Error(`API call failed: ${response.statusText}`);
  }
  
  return response.json();
};

// Export individual methods for easier use
export const vehiclesApi = {
  // Get all vehicles
  getAll: () => apiCall('getVehicles'),
  
  // Get vehicle by ID
  getById: (id: string) => apiCall('getVehicleById', { id }),
  
  // Create new vehicle
  create: (data: any) => apiCall('createVehicle', data),
  
  // Update vehicle
  update: (id: string, data: any) => apiCall('updateVehicle', { id, data }),
  
  // Delete vehicle
  delete: (id: string) => apiCall('deleteVehicle', { id }),
  
  // Search vehicles
  search: (params: any) => apiCall('searchVehicles', params),
  
  // Create full inspection (main method for Taller app)
  createFullInspection: (data: {
    vehicle: any;
    inspection: any;
    checklistItems: any[];
    photos?: any[];
  }) => apiCall('createFullVehicleInspection', data),
  
  // Create inspection only
  createInspection: (data: any) => apiCall('createVehicleInspection', data),
  
  // Upload photo
  uploadPhoto: (data: any) => apiCall('uploadVehiclePhoto', data),
  
  // Get statistics
  getStatistics: () => apiCall('getVehicleStatistics'),
};