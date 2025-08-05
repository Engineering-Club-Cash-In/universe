import axios, { AxiosError, Method } from 'axios';
import { SIFCOAuthService } from './auth.service';
import { config } from '../config';

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export class BaseService {
  protected auth: SIFCOAuthService;
  protected baseURL: string;

  constructor() {
    this.auth = SIFCOAuthService.getInstance();
    this.baseURL = config.sifco.baseURL;
  }

  protected async request<T = any>(
    method: Method,
    endpoint: string,
    data?: any,
    params?: any
  ): Promise<ServiceResponse<T>> {
    try {
      const headers = await this.auth.getAuthHeaders();
      
      const response = await axios({
        method,
        url: `${this.baseURL}/rest/${endpoint}`,
        headers,
        data,
        params,
      });

      return {
        success: true,
        data: response.data,
        statusCode: response.status,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      
      // Handle token expiration
      if (axiosError.response?.status === 401) {
        console.log('🔄 Token expired, attempting to re-authenticate...');
        this.auth.clearToken();
        
        try {
          // Retry the request with new token
          const headers = await this.auth.getAuthHeaders();
          const response = await axios({
            method,
            url: `${this.baseURL}/rest/${endpoint}`,
            headers,
            data,
            params,
          });

          return {
            success: true,
            data: response.data,
            statusCode: response.status,
          };
        } catch (retryError) {
          const retryAxiosError = retryError as AxiosError;
          return this.handleError(retryAxiosError);
        }
      }

      return this.handleError(axiosError);
    }
  }

  private handleError(error: AxiosError): ServiceResponse {
    let errorMessage = 'Unknown error occurred';
    let statusCode = 500;

    if (error.response) {
      statusCode = error.response.status;
      const responseData: any = error.response.data;
      
      switch (statusCode) {
        case 400:
          errorMessage = `Bad Request: ${responseData?.message || 'Invalid request parameters'}`;
          break;
        case 401:
          errorMessage = 'Unauthorized: Invalid or expired credentials';
          break;
        case 403:
          errorMessage = 'Forbidden: Insufficient permissions';
          break;
        case 404:
          errorMessage = `Not Found: ${responseData?.message || 'Resource not found'}`;
          break;
        case 429:
          errorMessage = 'Too Many Requests: Rate limit exceeded';
          break;
        case 500:
          errorMessage = 'Internal Server Error: SIFCO server error';
          break;
        default:
          errorMessage = responseData?.message || error.message;
      }
    } else if (error.request) {
      errorMessage = 'Network error: Unable to reach SIFCO server';
    } else {
      errorMessage = error.message;
    }

    console.error(`❌ API Error [${statusCode}]:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      statusCode,
    };
  }
}