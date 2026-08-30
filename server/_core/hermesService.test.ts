import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { hermesIdentityFromRequest } from "./hermesService";

const SUBJECT = "35300621-b866-4cb2-8092-8b772cad435e";
const TOKEN = "a-long-high-entropy-service-token";

function request(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const saved = { ...process.env };

beforeEach(() => {
  process.env.HERMES_SERVICE_ENABLED = "true";
  process.env.HERMES_SERVICE_TOKEN = TOKEN;
  process.env.HERMES_SERVICE_SUBJECT = SUBJECT;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("hermes service boundary", () => {
  it("authenticates a correct token as the configured subject", () => {
    const identity = hermesIdentityFromRequest(
      request({ "x-hermes-service-token": TOKEN })
    );
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe(SUBJECT);
    expect(identity?.origin).toBe("hermes");
  });

  it("is off unless explicitly enabled", () => {
    process.env.HERMES_SERVICE_ENABLED = "false";
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": TOKEN }))
    ).toBeNull();

    delete process.env.HERMES_SERVICE_ENABLED;
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": TOKEN }))
    ).toBeNull();
  });

  it("refuses a request with no token header", () => {
    expect(hermesIdentityFromRequest(request())).toBeNull();
  });

  it("refuses a wrong token", () => {
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": "nope" }))
    ).toBeNull();
  });

  // The bypass that has bitten this estate before: a blank or whitespace-only
  // configured secret must authenticate nothing, including a blank header.
  it("never authenticates when the configured secret is blank", () => {
    process.env.HERMES_SERVICE_TOKEN = "";
    expect(hermesIdentityFromRequest(request({ "x-hermes-service-token": "" }))).toBeNull();

    process.env.HERMES_SERVICE_TOKEN = "   ";
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": "   " }))
    ).toBeNull();
  });

  it("refuses when no subject is configured", () => {
    delete process.env.HERMES_SERVICE_SUBJECT;
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": TOKEN }))
    ).toBeNull();

    process.env.HERMES_SERVICE_SUBJECT = "   ";
    expect(
      hermesIdentityFromRequest(request({ "x-hermes-service-token": TOKEN }))
    ).toBeNull();
  });

  it("cannot be pointed at a different subject by the caller", () => {
    const identity = hermesIdentityFromRequest(
      request({
        "x-hermes-service-token": TOKEN,
        "x-hermes-service-subject": "00000000-0000-0000-0000-000000000000",
      })
    );
    expect(identity?.subject).toBe(SUBJECT);
  });
});
