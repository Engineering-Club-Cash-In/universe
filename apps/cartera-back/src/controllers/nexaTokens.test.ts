import { expect, test } from "bun:test";
import {
  processNexaTokenRegistration,
  nexaTokenSchema,
  NexaTokenError,
  isNexaTokenInUseError,
  type NexaTokenBody,
  type NexaTokenDependencies,
} from "./nexaTokens";

const body: NexaTokenBody = {
  creditoId: 123,
  token: "1234567123456789",
  identifier: "123456789",
  nexaUserId: 456,
};

const fakeDeps = (
  overrides?: Partial<{
    claimNonce: boolean;
    creditExists: boolean;
    creditCancelled: boolean;
    upsertToken: string;
  }>,
): { deps: NexaTokenDependencies; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      claimNonce: async () => {
        calls.push("claimNonce");
        return overrides?.claimNonce ?? true;
      },
      creditExists: async () => {
        calls.push("creditExists");
        return overrides?.creditExists ?? true;
      },
      creditCancelled: async () => {
        calls.push("creditCancelled");
        return overrides?.creditCancelled ?? false;
      },
      upsertToken: async () => {
        calls.push("upsertToken");
        return (overrides?.upsertToken ?? "created") as any;
      },
    },
  };
};

const cases = [
  { name: "created", upsert: "created", expectResult: "created", expectCalls: ["claimNonce", "creditExists", "creditCancelled", "upsertToken"] },
  { name: "updated", upsert: "updated", expectResult: "updated", expectCalls: ["claimNonce", "creditExists", "creditCancelled", "upsertToken"] },
  { name: "unchanged", upsert: "unchanged", expectResult: "unchanged", expectCalls: ["claimNonce", "creditExists", "creditCancelled", "upsertToken"] },
  { name: "token_conflict", upsert: "token_conflict", expectError: "token_conflict", expectStatus: 409 },
  { name: "token_in_use", upsert: "token_in_use", expectError: "token_in_use", expectStatus: 409 },
  { name: "credit_not_found (upsert)", upsert: "credit_not_found", expectError: "credit_not_found", expectStatus: 404 },
  { name: "credit_cancelled (upsert, carrera)", upsert: "credit_cancelled", expectError: "credit_cancelled", expectStatus: 409 },
  { name: "crédito CANCELADO se rechaza sin llegar al upsert", creditCancelled: true, expectError: "credit_cancelled", expectStatus: 409, expectCalls: ["claimNonce", "creditExists", "creditCancelled"] },
  { name: "claimNonce false", claimNonce: false, expectError: "replay", expectStatus: 409, expectCalls: ["claimNonce"] },
  { name: "creditExists false", creditExists: false, expectError: "credit_not_found", expectStatus: 404, expectCalls: ["claimNonce", "creditExists"] },
];

for (const c of cases) {
  test(`processNexaTokenRegistration: ${c.name}`, async () => {
    const { deps, calls } = fakeDeps({
      claimNonce: c.claimNonce,
      creditExists: c.creditExists,
      creditCancelled: (c as any).creditCancelled,
      upsertToken: (c as any).upsert,
    });

    if ((c as any).expectError) {
      let error: NexaTokenError | undefined;
      try {
        await processNexaTokenRegistration(body, "nonce-1", deps);
      } catch (e) {
        error = e as NexaTokenError;
      }
      expect(error).toBeDefined();
      expect(error!.code).toBe((c as any).expectError);
      expect(error!.status).toBe((c as any).expectStatus);
    } else {
      const result = await processNexaTokenRegistration(body, "nonce-1", deps);
      expect(result).toBe((c as any).expectResult);
    }

    if ((c as any).expectCalls) {
      expect(calls).toEqual((c as any).expectCalls);
    }
  });
}

const schemaCases = [
  { name: "accepts valid body", obj: body, expectSuccess: true },
  { name: "accepts a 14-digit token (short Nexa prefix)", obj: { ...body, token: "12345100000001", identifier: "100000001" }, expectSuccess: true },
  { name: "rejects token that does not end with identifier", obj: { ...body, identifier: "999999999" }, expectSuccess: false },
  { name: "rejects token of 9 digits", obj: { ...body, token: "123456789" }, expectSuccess: false },
  { name: "rejects token of 33 digits", obj: { ...body, token: "1".repeat(33) }, expectSuccess: false },
  { name: "rejects token with letters", obj: { ...body, token: "123456789012345a" }, expectSuccess: false },
  { name: "rejects identifier of 8 digits", obj: { ...body, identifier: "12345678" }, expectSuccess: false },
  { name: "rejects creditoId of 0", obj: { ...body, creditoId: 0 }, expectSuccess: false },
  { name: "rejects extra field", obj: { ...body, extra: "field" } as any, expectSuccess: false },
];

for (const sc of schemaCases) {
  test(`nexaTokenSchema ${sc.name}`, () => {
    const result = nexaTokenSchema.safeParse(sc.obj);
    expect(result.success).toBe(sc.expectSuccess);
  });
}

test("23505 de cualquiera de los dos índices únicos del token es token en uso", () => {
  for (const constraint of ["uq_nexa_credit_bindings_token", "nexa_credit_bindings_uq_token"]) {
    expect(isNexaTokenInUseError({ code: "23505", constraint })).toBe(true);
  }
});

test("otros 23505 u otros códigos no son token en uso", () => {
  expect(isNexaTokenInUseError({ code: "23505", constraint: "nexa_credit_bindings_pkey" })).toBe(false);
  expect(isNexaTokenInUseError({ code: "23505" })).toBe(false);
  expect(isNexaTokenInUseError({ code: "23503", constraint: "nexa_credit_bindings_uq_token" })).toBe(false);
  expect(isNexaTokenInUseError(null)).toBe(false);
});
