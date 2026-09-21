/**
 * api-client — the transport contract, not the endpoints.
 *
 * Every endpoint now goes through one `request()`, so what is worth pinning is
 * that one function's behaviour: what counts as absent versus failed, where the
 * failure detail comes from, and that a 401 rotates the session exactly once.
 * The endpoints themselves are a URL and a schema each.
 *
 * `fetch` is stubbed rather than a server being run: these assertions are about
 * how the client reads a response, and a real server cannot be made to produce
 * a malformed body or a timeout on demand.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DEFAULT_CONFIG } from "@/store/config-store";
import {
  setTokenRefresher,
  syncGetWorkingCopy,
  syncListProjects,
  adminSetRole,
  exchangeOidcCode,
  checkServerHealth,
  logoutSession,
} from "@/lib/api-client";

/** A Response carrying `body` as text, so the client parses it as it would a real one. */
function reply(status: number, body = "", statusText = ""): Response {
  return new Response(body, { status, statusText });
}

const realFetch = globalThis.fetch;
let calls: string[];

beforeEach(() => {
  calls = [];
  setTokenRefresher(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setTokenRefresher(null);
  vi.useRealTimers();
});

/** Stub fetch with a queue of replies, recording the URLs asked for. */
function stub(...replies: (Response | (() => Promise<Response>))[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = replies[Math.min(i++, replies.length - 1)];
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof fetch;
}

// A real bundle, built from the shipped default Model Configuration rather
// than hand-written: the point is that a well-formed reply parses, and a
// hand-rolled config would only be testing my transcription of the schema.
const WORKING_COPY = JSON.stringify({
  id: "w1",
  name: "Net",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  data: {
    project: {
      version: "2.0",
      meta: { name: "Net" },
      canvases: [],
      nodes: {},
      edges: {},
      update_history: [],
    },
    config: DEFAULT_CONFIG,
  },
});

describe("absent versus failed", () => {
  it("reports a missing Working Copy as success with no data", async () => {
    stub(reply(404));
    const res = await syncGetWorkingCopy("Net");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });

  it("reports a server error as a failure, NOT as a missing Working Copy", async () => {
    // The whole point of the result shape. While these were the same answer,
    // the File panel folded a 500 into "there is no auto-save" and told the
    // user nothing at all.
    stub(reply(500, JSON.stringify({ detail: "database is down" })));
    const res = await syncGetWorkingCopy("Net");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.detail).toBe("database is down");
    }
  });

  it("returns the Working Copy when there is one", async () => {
    stub(reply(200, WORKING_COPY));
    const res = await syncGetWorkingCopy("Net");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.id).toBe("w1");
  });
});

describe("failure detail", () => {
  it("takes a plain string FastAPI detail", async () => {
    stub(reply(403, JSON.stringify({ detail: "Not permitted" })));
    expect(await adminSetRole("u1", "admin")).toBe("Role change failed (403): Not permitted");
  });

  it("takes code and message from a structured detail", async () => {
    stub(reply(400, JSON.stringify({ detail: { code: "email_not_verified", message: "Verify first" } })));
    const res = await exchangeOidcCode("c", "v");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("email_not_verified");
      expect(res.detail).toBe("Verify first");
    }
  });

  it("falls back to a non-JSON body — the case the old code could not report", async () => {
    // The previous implementation called res.json(), and on the parse failure
    // called res.text() from the catch. The body is a single-use stream, so by
    // then it was consumed and the fallback could only yield statusText.
    stub(reply(502, "<html>Bad Gateway</html>"));
    expect(await adminSetRole("u1", "admin")).toBe(
      "Role change failed (502): <html>Bad Gateway</html>",
    );
  });

  it("falls back to statusText on an empty body", async () => {
    stub(reply(503, "", "Service Unavailable"));
    expect(await adminSetRole("u1", "admin")).toBe(
      "Role change failed (503): Service Unavailable",
    );
  });

  it("reports a network failure as status 0", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const res = await syncGetWorkingCopy("Net");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.code).toBe("network_error");
    }
  });
});

describe("response validation", () => {
  it("fails rather than returning a body that does not match the schema", async () => {
    stub(reply(200, JSON.stringify([{ nope: true }])));
    await expect(syncListProjects()).rejects.toThrow(/did not match the expected shape/);
  });

  it("fails on a body that is not JSON at all", async () => {
    stub(reply(200, "not json"));
    await expect(syncListProjects()).rejects.toThrow(/not valid JSON/);
  });
});

describe("401 rotate-and-retry", () => {
  it("refreshes once and retries the original request", async () => {
    const refresher = vi.fn(async () => true);
    setTokenRefresher(refresher);
    stub(reply(401), reply(200, "[]"));
    await expect(syncListProjects()).resolves.toEqual([]);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("gives up when the refresh fails, without a second attempt", async () => {
    const refresher = vi.fn(async () => false);
    setTokenRefresher(refresher);
    stub(reply(401, JSON.stringify({ detail: "expired" })));
    await expect(syncListProjects()).rejects.toThrow(/expired/);
    expect(calls).toHaveLength(1);
  });

  it("shares ONE refresh across concurrent 401s", async () => {
    // An IdP that rotates refresh tokens invalidates the cookie after the first
    // use, so a second concurrent refresh would sign the user out spuriously.
    // Both callers must 401 before either refresh resolves, so the refresher is
    // held open until the second request has arrived.
    let seenSecond: () => void = () => {};
    const bothArrived = new Promise<void>((r) => { seenSecond = r; });
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n += 1;
      if (n === 2) seenSecond();
      return n <= 2 ? reply(401) : reply(200, "[]");
    }) as unknown as typeof fetch;

    const refresher = vi.fn(async () => {
      await bothArrived;
      return true;
    });
    setTokenRefresher(refresher);

    await expect(Promise.all([syncListProjects(), syncListProjects()])).resolves.toEqual([[], []]);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("does not try to refresh the session-establishing calls", async () => {
    // refreshSession itself 401s when the refresh cookie is spent; retrying
    // would recurse into the single-flight promise it is already inside.
    const refresher = vi.fn(async () => true);
    setTokenRefresher(refresher);
    stub(reply(401));
    expect(await logoutSession()).toBeNull();
    expect(refresher).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe("endpoint shapes", () => {
  it("health is true only on 2xx", async () => {
    stub(reply(200));
    expect(await checkServerHealth()).toBe(true);
    stub(reply(500));
    expect(await checkServerHealth()).toBe(false);
  });

  it("logout yields the IdP end_session URL, and null when there is none", async () => {
    stub(reply(200, JSON.stringify({ logout_url: "https://idp/end" })));
    expect(await logoutSession()).toBe("https://idp/end");
    stub(reply(200, JSON.stringify({ logout_url: null })));
    expect(await logoutSession()).toBeNull();
  });

  it("names the endpoint being called", async () => {
    stub(reply(200, "[]"));
    await syncListProjects();
    expect(calls[0]).toMatch(/\/api\/projects$/);
  });
});
