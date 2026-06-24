import { describe, expect, test } from "bun:test";
import { NexaClient } from "./client";

describe("NexaClient", () => {
  test("sends apiKey and bearer token headers when creating token users", async () => {
    const requests: Request[] = [];
    const client = new NexaClient({
      baseUrl: "https://nexa.example",
      apiKey: "api-key",
      bearerToken: "bearer-token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({ users: [{ id: 10, token: "1234567000000001" }], errorUsers: [] }, { status: 200 });
      },
    });

    await client.createTokenUsers({
      tokenId: 5,
      users: [{ identifier: 100000001, description: "Credito 42", nationalId: 1234567890101 }],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://nexa.example/api/v1/open-api-nexa/payment-token/token/user");
    expect(requests[0].headers.get("apikey")).toBe("api-key");
    expect(requests[0].headers.get("Authorization")).toBe("Bearer bearer-token");
  });

  test("confirms approved payments through Nexa review endpoint", async () => {
    let body: unknown;
    const client = new NexaClient({
      baseUrl: "https://nexa.example/",
      apiKey: "api-key",
      bearerToken: "bearer-token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        body = await request.json();
        return Response.json({ reference: 1234, status: "APPROVED" });
      },
    });

    const response = await client.reviewTransfer({ id: 99, reference: 1234, status: "APPROVED" });

    expect(body).toEqual({ id: 99, reference: 1234, status: "APPROVED" });
    expect(response.status).toBe("APPROVED");
  });

  test("passes Bun TLS client certificate options when configured", async () => {
    let tls: unknown;
    const client = new NexaClient({
      baseUrl: "https://nexa.example",
      apiKey: "api-key",
      bearerToken: "bearer-token",
      tls: {
        certPath: "/certs/nexa/cashin-nexa-uat-client.crt",
        keyPath: "/certs/nexa/cashin-nexa-uat-client.key",
      },
      fetch: async (_input, init) => {
        tls = init.tls;
        return Response.json({ transactions: [] });
      },
    });

    await client.getPaymentTokenStatement("2026-06-24");

    expect(tls).toMatchObject({
      cert: expect.any(Blob),
      key: expect.any(Blob),
    });
  });
});
