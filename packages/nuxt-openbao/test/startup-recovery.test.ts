import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStartupLatch, getAllVars, isStartupComplete } from "../src/runtime/utils";
import { injectVars } from "../src/runtime/server/utils";

const runtime = vi.hoisted(() => ({ config: {} }));
vi.mock("nitropack/runtime", () => ({ useRuntimeConfig: () => runtime.config }));
function setRuntimeConfig(config: object) {
  runtime.config = config;
}

const BASE = "https://bao.test";
const location = { app: "heylomeet", environment: "staging" } as const;
const publicAccess = { location, token: "yes_this_ok_to_be_public_token", baseURL: BASE };
const privateAccess = { location, bao: { role: { id: "role" }, secret: { id: "secret" } }, baseURL: BASE };
const openbao = { public: publicAccess, private: privateAccess };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function urlOf(input: unknown) {
  return new URL(input instanceof Request ? input.url : String(input));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getAllVars", () => {
  it("reads the public and private documents concurrently instead of one after the other", async () => {
    const loginStarted = deferred();
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const path = urlOf(input).pathname;
        if (path === "/v1/auth/approle/login") {
          order.push("login");
          loginStarted.resolve();
          return json({ auth: { client_token: "t" } });
        }
        if (path.endsWith("/public")) {
          order.push("public:start");
          // A sequential implementation never reaches the login while this read is waiting, and times out.
          await Promise.race([
            loginStarted.promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("serial")), 1_500)),
          ]);
          order.push("public:end");
          return json({ data: { data: { PUBLIC_KEY: "p" } } });
        }
        order.push("private");
        return json({ data: { data: { PRIVATE_KEY: "s" } } });
      }),
    );
    const vars = await getAllVars(openbao, { baseURL: BASE });
    expect(vars).toEqual({ public: { PUBLIC_KEY: "p" }, private: { PRIVATE_KEY: "s" } });
    expect(order.indexOf("login")).toBeLessThan(order.indexOf("public:end"));
  });

  it("retries a failed read once, and keeps the other document", async () => {
    let publicCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const path = urlOf(input).pathname;
        if (path === "/v1/auth/approle/login") return json({ auth: { client_token: "t" } });
        if (path.endsWith("/public")) {
          publicCalls++;
          if (publicCalls === 1) throw new TypeError("network down");
          return json({ data: { data: { PUBLIC_KEY: "p" } } });
        }
        return json({ data: { data: { PRIVATE_KEY: "s" } } });
      }),
    );
    expect(await getAllVars(openbao, { baseURL: BASE })).toEqual({
      public: { PUBLIC_KEY: "p" },
      private: { PRIVATE_KEY: "s" },
    });
    expect(publicCalls).toBe(2);
  });

  it("leaves out a document that stays unreadable instead of throwing, after exactly one retry", async () => {
    let privateCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const path = urlOf(input).pathname;
        if (path === "/v1/auth/approle/login") {
          privateCalls++;
          return new Response("nope", { status: 503 });
        }
        return json({ data: { data: { PUBLIC_KEY: "p" } } });
      }),
    );
    expect(await getAllVars(openbao, { baseURL: BASE })).toEqual({ public: { PUBLIC_KEY: "p" } });
    expect(privateCalls).toBe(2);
  });

  it("does not wait to retry credentials it knows are unusable", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => json({ data: { data: {} } }));
    vi.stubGlobal("fetch", fetchMock);
    const unusable = { public: { location, baseURL: BASE } } as never; // Deliberately malformed configuration exercises runtime validation.
    let settled = false;
    const result = getAllVars(unusable, { baseURL: BASE }).then((value) => {
      settled = true;
      return value;
    });
    // A retry would sit on a 250 ms timer that this never advances.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives every access one time budget and abandons a read that never answers", async () => {
    const budget = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(budget.signal);
    let publicCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = urlOf(input).pathname;
        if (path === "/v1/auth/approle/login") return json({ auth: { client_token: "t" } });
        if (path.endsWith("/public")) {
          publicCalls++;
          // OpenBao accepts the connection and never answers; only the budget ends the wait.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        }
        return json({ data: { data: { PRIVATE_KEY: "s" } } });
      }),
    );
    const pending = getAllVars(openbao, { baseURL: BASE });
    await vi.waitFor(() => expect(publicCalls).toBe(1));
    budget.abort();
    expect(await pending).toEqual({ private: { PRIVATE_KEY: "s" } });
    // Out of budget means out of retries too: no second attempt at the read that hung.
    expect(publicCalls).toBe(1);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(4_000);
  });
});

describe("isStartupComplete", () => {
  it("recognizes the server fallback used by reads", () => {
    vi.stubEnv("DEFAULT_BAO_BASE_URL", BASE);
    const configured = { public: { location, token: "yes_this_ok_to_be_public_x", baseURL: "" } };
    expect(isStartupComplete(configured, {})).toBe(false);
    expect(isStartupComplete(configured, { public: {} })).toBe(true);
  });

  it("is complete only when every access that could be read was", () => {
    expect(isStartupComplete(openbao, { public: {}, private: {} }, BASE)).toBe(true);
    expect(isStartupComplete(openbao, { public: {} }, BASE)).toBe(false);
    expect(isStartupComplete(openbao, {}, BASE)).toBe(false);
  });

  it("does not wait for what can never be read: no credentials, no server, or a disabled access", () => {
    const credentialless = {
      public: { location },
      private: { location, bao: { role: { id: "r" }, secret: {} } },
    } as never; // Deliberately malformed configuration exercises runtime validation.
    expect(isStartupComplete(credentialless, {}, BASE)).toBe(true);
    const noServer = { public: { location, token: "yes_this_ok_to_be_public_x" } } as never; // Deliberately malformed configuration exercises runtime validation.
    expect(isStartupComplete(noServer, {}, undefined)).toBe(true);
    expect(isStartupComplete(noServer, {}, BASE)).toBe(false);
    expect(isStartupComplete({ public: false, private: undefined } as never, {}, BASE)).toBe(true);
    expect(isStartupComplete(undefined, {}, BASE)).toBe(true);
  });

  it("looks only at the variables it was given, not at names inherited by every object", () => {
    const inherited = { constructor: { location, token: "yes_this_ok_to_be_public_x" } } as never; // Deliberately malformed configuration exercises runtime validation.
    expect(isStartupComplete(inherited, {}, BASE)).toBe(false);
  });
});

describe("createStartupLatch", () => {
  it("recovers a synchronous throw through the same backoff path", async () => {
    let clock = 0;
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("startup failed");
      })
      .mockReturnValue(true);
    const latch = createStartupLatch(run, { now: () => clock });
    await expect(latch()).rejects.toThrow("startup failed");
    clock = 1000;
    expect(latch()).toBeUndefined();
    await vi.waitFor(async () => expect(await latch()).toBe(true));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs once and shares the attempt while it succeeds", async () => {
    const run = vi.fn(async () => true);
    const latch = createStartupLatch(run);
    await Promise.all([latch(), latch(), latch()]);
    await latch();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("holds callers for the first attempt only, then retries behind them after a growing back-off", async () => {
    let clock = 0;
    const retries: Promise<unknown>[] = [];
    const run = vi.fn(async () => false);
    const latch = createStartupLatch(run, {
      retryAfterMs: 1_000,
      maxRetryAfterMs: 4_000,
      now: () => clock,
      background: (attempt) => retries.push(attempt),
    });
    // The first attempt is what callers wait for.
    await latch();
    expect(run).toHaveBeenCalledTimes(1);
    expect(retries).toHaveLength(0);
    // Inside the back-off window the caller proceeds without waiting and without calling Bao again.
    clock = 500;
    expect(latch()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    // A retry starts behind the caller that triggers it: the caller gets nothing to wait for.
    clock = 1_000;
    expect(latch()).toBeUndefined();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    expect(retries).toHaveLength(1);
    await retries[0];
    // Second consecutive failure: 2 s.
    clock = 2_999;
    expect(latch()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    clock = 3_000;
    expect(latch()).toBeUndefined();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(3);
    await retries[1];
    // The back-off stops growing at its cap.
    clock = 3_000 + 3_999;
    expect(latch()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
    clock = 3_000 + 4_000;
    latch();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("does not start a second retry while one is in flight, and does not hold callers for it", async () => {
    let clock = 0;
    let finish!: (complete: boolean) => void;
    const run = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const latch = createStartupLatch(run, { retryAfterMs: 100, now: () => clock });
    await latch();
    clock = 100;
    expect(latch()).toBeUndefined();
    clock = 10_000;
    expect(latch()).toBeUndefined();
    expect(latch()).toBeUndefined();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    finish(true);
    await vi.waitFor(async () => expect(await latch()).toBeDefined());
    clock = 100_000;
    await latch();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets the callers that awaited a rejected first attempt see it, then retries without holding anyone", async () => {
    let clock = 0;
    const retries: Promise<unknown>[] = [];
    const run = vi.fn().mockRejectedValueOnce(new Error("bao down")).mockRejectedValueOnce(new Error("still down"));
    const latch = createStartupLatch(run, { retryAfterMs: 100, now: () => clock, background: (a) => retries.push(a) });
    await expect(latch()).rejects.toThrow("bao down");
    clock = 100;
    expect(latch()).toBeUndefined();
    // The retry handed to the runtime never rejects, so keeping it alive cannot surface an unhandled rejection.
    await expect(retries[0]).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops retrying after success", async () => {
    let clock = 0;
    const run = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const latch = createStartupLatch(run, { retryAfterMs: 100, now: () => clock });
    await latch();
    clock = 100;
    latch();
    await vi.waitFor(async () => expect(await latch()).toBeDefined());
    clock = 10_000_000;
    await latch();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("injectVars startup", () => {
  const hooks = new Map<string, (event: unknown) => Promise<void>>();
  const injected = ["PUBLIC_KEY", "PRIVATE_KEY", "__KIBAO_INJECTED"];
  const isKibaoEnv = (key: string) => /^(?:NUXT_)?(?:KIBAO|OPENBAO)_/.test(key) || key === "DEFAULT_BAO_BASE_URL";
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    hooks.clear();
    // The test process may carry the app's own Kibao settings; Kibao merges those over the runtime config.
    saved = {};
    for (const key of Object.keys(process.env).filter(isKibaoEnv)) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
    // A Workers isolate: startup waits for the first request instead of running at import.
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {});
    setRuntimeConfig({ public: {}, kibao: { openbao, server: { bao: BASE } } });
  });

  afterEach(() => {
    for (const key of injected) Reflect.deleteProperty(process.env, key);
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  });

  function request() {
    const waited: Promise<unknown>[] = [];
    return { event: { context: {}, node: {}, waitUntil: (promise: Promise<unknown>) => waited.push(promise) }, waited };
  }

  async function start() {
    await injectVars({ app: { hooks: { hook: (name: string, handler: never) => hooks.set(name, handler) } } } as never);
    return (event: unknown) => hooks.get("request")!(event);
  }

  it("retries a startup that could not read every document, behind the request, and then stops", async () => {
    let privateReady = false;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const path = urlOf(input).pathname;
        calls.push(path);
        if (path === "/v1/auth/approle/login")
          return privateReady ? json({ auth: { client_token: "t" } }) : new Response("no", { status: 503 });
        if (path.endsWith("/public")) return json({ data: { data: { PUBLIC_KEY: "p" } } });
        return json({ data: { data: { PRIVATE_KEY: "s" } } });
      }),
    );
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const onRequest = await start();

    const first = request();
    await onRequest(first.event);
    expect(process.env.PUBLIC_KEY).toBe("p");
    expect(process.env.PRIVATE_KEY).toBeUndefined();
    const afterFirst = calls.length;

    // Inside the back-off window: no new Bao call, and the request is not held.
    clock += 500;
    const early = request();
    await onRequest(early.event);
    expect(calls).toHaveLength(afterFirst);
    expect(early.waited).toHaveLength(0);

    // Past it, with Bao back: the retry runs behind the request and is kept alive for the runtime.
    privateReady = true;
    clock += 600;
    const retrying = request();
    await onRequest(retrying.event);
    expect(retrying.waited).toHaveLength(1);
    await retrying.waited[0];
    expect(process.env.PRIVATE_KEY).toBe("s");

    // Everything was read: no further Bao calls, however much later.
    const afterRecovery = calls.length;
    clock += 10 * 60_000;
    await onRequest(request().event);
    expect(calls).toHaveLength(afterRecovery);
  });

  it("does not retry when the only thing missing is an access that can never be read", async () => {
    setRuntimeConfig({
      public: {},
      kibao: { openbao: { public: publicAccess, private: { location, baseURL: BASE } }, server: { bao: BASE } },
    });
    const fetchMock = vi.fn(async (input: unknown) => {
      const path = urlOf(input).pathname;
      return path.endsWith("/public")
        ? json({ data: { data: { PUBLIC_KEY: "p" } } })
        : new Response("no", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const onRequest = await start();
    await onRequest(request().event);
    const afterFirst = fetchMock.mock.calls.length;
    clock += 10 * 60_000;
    await onRequest(request().event);
    expect(fetchMock).toHaveBeenCalledTimes(afterFirst);
  });
});
