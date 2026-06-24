import {
  createPaymentTokenResponseSchema,
  createTokenUsersResponseSchema,
  paymentTokenStatementResponseSchema,
  reviewTransferResponseSchema,
  type ReviewTransferStatus,
} from "./schemas";

type BunTlsFetchOptions = {
  cert: Blob;
  key: Blob;
  ca?: Blob;
};

type BunFetchInit = RequestInit & { tls?: BunTlsFetchOptions };
type Fetch = (input: RequestInfo | URL, init: BunFetchInit) => Promise<Response>;
const DEFAULT_TIMEOUT_MS = 10_000;

type NexaClientTlsOptions = {
  certPath: string;
  keyPath: string;
  caPath?: string;
};

export class NexaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly bearerToken: string;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly tls?: BunTlsFetchOptions;

  constructor(options: { baseUrl: string; apiKey: string; bearerToken: string; fetch?: Fetch; timeoutMs?: number; tls?: NexaClientTlsOptions }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.bearerToken = options.bearerToken;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init as RequestInit));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tls = options.tls ? {
      cert: Bun.file(options.tls.certPath),
      key: Bun.file(options.tls.keyPath),
      ca: options.tls.caPath ? Bun.file(options.tls.caPath) : undefined,
    } : undefined;
  }

  async createPaymentToken(payload: { account: number | string; name: string }) {
    const response = await this.request("/api/v1/open-api-nexa/payment-token/token", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return createPaymentTokenResponseSchema.parse(await response.json());
  }

  async createTokenUsers(payload: {
    tokenId: number;
    users: Array<{ identifier: number; description: string; nationalId: number }>;
  }) {
    if (process.env.NEXA_DEBUG === "true") {
      console.log("[NexaClient] createTokenUsers payload", JSON.stringify(payload));
    }
    const response = await this.request("/api/v1/open-api-nexa/payment-token/token/user", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (process.env.NEXA_DEBUG === "true") {
      console.log("[NexaClient] createTokenUsers response", JSON.stringify(body));
    }
    return createTokenUsersResponseSchema.parse(body);
  }

  async getPaymentTokenStatement(date: string) {
    const response = await this.request(`/api/v1/open-api-nexa/accountStatement/payment-token/${date}`, {
      method: "GET",
    });

    return paymentTokenStatementResponseSchema.parse(await response.json());
  }

  async reviewTransfer(payload: { id: number; reference: number; status: ReviewTransferStatus }) {
    const response = await this.request("/api/v1/open-api-nexa/payment-token/transfers/review", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return reviewTransferResponseSchema.parse(await response.json());
  }

  private async request(path: string, init: RequestInit) {
    const requestInit: BunFetchInit = {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      tls: this.tls,
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
        Authorization: `Bearer ${this.bearerToken}`,
        ...init.headers,
      },
    };
    const response = await this.fetch(`${this.baseUrl}${path}`, requestInit);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Nexa request failed with ${response.status}: ${text}`);
    }

    return response;
  }
}
