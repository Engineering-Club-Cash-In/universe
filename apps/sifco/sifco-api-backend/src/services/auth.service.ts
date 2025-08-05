import axios, { AxiosError } from 'axios';
import { config } from '../config';

interface TokenResponse {
  access_token: string;
  scope: string;
  refresh_token: string;
  user_guid: string;
  expires_in?: number;
}

export class SIFCOAuthService {
  private static instance: SIFCOAuthService;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private baseURL: string;

  private constructor() {
    this.baseURL = config.sifco.baseURL;
  }

  static getInstance(): SIFCOAuthService {
    if (!SIFCOAuthService.instance) {
      SIFCOAuthService.instance = new SIFCOAuthService();
    }
    return SIFCOAuthService.instance;
  }

  async authenticate(): Promise<string> {
    try {
      console.log('🔐 Authenticating with SIFCO...');
      
      const formData = new URLSearchParams({
        client_id: config.sifco.clientId,
        client_secret: config.sifco.clientSecret,
        granttype: 'password',
        scope: 'FullControl',
        username: config.sifco.username,
        password: config.sifco.password,
      });

      const response = await axios.post<TokenResponse>(
        `${this.baseURL}/oauth/access_token`,
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.token = response.data.access_token;
      
      // Set token expiry (default to 1 hour if not provided)
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
      
      console.log('✅ Authentication successful');
      return this.token;
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error('❌ Authentication failed:', axiosError.response?.data || axiosError.message);
      throw new Error(`Authentication failed: ${axiosError.message}`);
    }
  }

  async getToken(): Promise<string> {
    // Check if token exists and is still valid
    if (!this.token || !this.tokenExpiry || new Date() >= this.tokenExpiry) {
      await this.authenticate();
    }
    
    if (!this.token) {
      throw new Error('Failed to obtain authentication token');
    }
    
    return this.token;
  }

  getHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('No authentication token available. Call authenticate() first.');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `OAuth ${this.token}`,
      'GENEXUS-AGENT': 'SmartDevice Application',
    };
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `OAuth ${token}`,
      'GENEXUS-AGENT': 'SmartDevice Application',
    };
  }

  clearToken(): void {
    this.token = null;
    this.tokenExpiry = null;
  }
}