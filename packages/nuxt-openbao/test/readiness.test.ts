import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectVars, kibaoReadiness } from "../src/runtime/server/utils";
import requireReady from "../src/runtime/server/middleware/require-ready";

const runtime = vi.hoisted(() => ({ config: {} as Record<string, any> }));
// `h3` is Nitro's, not a dependency of this package: stand in for the three helpers the middleware uses.
vi.mock("h3", () => ({
  defineEventHandler: <T>(handler: T) => handler,
  setResponseHeader: (event: { node: { res: { setHeader(name: string, value: unknown): void } } }, name: string, value: unknown) =>
    event.node.res.setHeader(name, value),
  createError: (input: { statusCode: number; data?: unknown }) => Object.assign(new Error("http error"), input),
}));
vi.mock("nitropack/runtime", () => ({ useRuntimeConfig: () => runtime.config }));

const BASE = "https://bao.test";
const location = { app: "heylomeet", environment: "staging" } as const;
const publicAccess = { location, token: "yes_this_ok_to_be_public_token", baseURL: BASE };
const privateAccess = { location, bao: { role: { id: "role" }, secret: { id: "secret" } }, baseURL: BASE };
const openbao = { public: publicAccess, private: privateAccess };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function urlOf(input: unknown) {
  return new URL(input instanceof Request ? input.url : String(input));
}

type Mode = "ok" | "private-down" | "down" | "hang";

describe("kibao readiness", () => {
  const hooks = new Map<string, (event: unknown) => Promise<void>>();
  const injected = ["PUBLIC_KEY", "PRIVATE_KEY", "__KIBAO_INJECTED"];
  const isKibaoEnv = (key: string) => /^(?:NUXT_)?(?:KIBAO|OPENBAO)_/.test(key) || key === "DEFAULT_BAO_BASE_URL";
  let saved: Record<string, string | undefined>;
  let mode: Mode;
  let clock: number;

  beforeEach(() => {
    hooks.clear();
    saved = {};
    for (const key of Object.keys(process.env).filter(isKibaoEnv)) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
    vi.stubGlobal("WebSocketPair", function WebSocketPair() {});
    runtime.config = { public: {}, kibao: { openbao, server: { bao: BASE } } };
    mode = "ok";
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown) => {
        const path = urlOf(input).pathname;
        if (mode === "hang") return new Promise<Response>(() => {});
        if (mode === "down") return Promise.resolve(new Response("no", { status: 503 }));
        if (path === "/v1/auth/approle/login")
          return Promise.resolve(
            mode === "private-down" ? new Response("no", { status: 503 }) : json({ auth: { client_token: "t" } }),
          );
        if (path.endsWith("/public")) return Promise.resolve(json({ data: { data: { PUBLIC_KEY: "p" } } }));
        return Promise.resolve(json({ data: { data: { PRIVATE_KEY: "s" } } }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of injected) Reflect.deleteProperty(process.env, key);
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  });

  async function start() {
    await injectVars({ app: { hooks: { hook: (name: string, handler: never) => hooks.set(name, handler) } } } as never);
    return async () => {
      const event = { context: {} as Record<string, any>, node: {}, waitUntil: () => {} };
      await hooks.get("request")!(event);
      return event;
    };
  }

  it("is loaded once the latest read succeeded", async () => {
    const request = await start();
    const event = await request();
    expect(kibaoReadiness(event)).toBe("loaded");
    expect(event.context.vars.state).toBe("loaded");
  });

  it("is none when the first read timed out, and the request still runs", async () => {
    mode = "hang";
    runtime.config.kibao.startupWaitMs = 40;
    const request = await start();
    const event = await request();
    expect(kibaoReadiness(event)).toBe("none");
    expect(process.env.PUBLIC_KEY).toBeUndefined();
  });

  it("is none when nothing could be read at all", async () => {
    mode = "down";
    const request = await start();
    expect(kibaoReadiness(await request())).toBe("none");
  });

  it("follows the read: none, then loaded once a fresh read succeeds", async () => {
    mode = "hang";
    runtime.config.kibao.startupWaitMs = 40;
    const request = await start();
    expect(kibaoReadiness(await request())).toBe("none");
    mode = "ok";
    expect(kibaoReadiness(await request())).toBe("loaded");
  });

  it("is stale when only some documents were read, and loaded when a retry completes them", async () => {
    mode = "private-down";
    const request = await start();
    const first = await request();
    expect(kibaoReadiness(first)).toBe("stale");
    mode = "ok";
    clock += 1_100;
    const retrying = await request();
    // The retry runs behind the request; the same payload sees the result as it lands.
    await vi.waitFor(() => expect(kibaoReadiness(retrying)).toBe("loaded"));
    expect(kibaoReadiness(first)).toBe("loaded");
  });

  it("is stale when a later read fails after an earlier one succeeded", async () => {
    mode = "private-down";
    const request = await start();
    await request();
    mode = "down";
    clock += 1_100;
    const event = await request();
    await vi.waitFor(() => expect(process.env.PUBLIC_KEY).toBe("p"));
    // The last good values stay in use.
    expect(event.context.vars.data.PUBLIC_KEY).toBe("p");
    await vi.waitFor(() => expect(kibaoReadiness(event)).toBe("stale"));
  });

  it("reports none for a context Kibao did not inject", () => {
    expect(kibaoReadiness({})).toBe("none");
    expect(kibaoReadiness({ context: { vars: { state: "weird" } } })).toBe("none");
  });

  describe("requireReady", () => {
    function http(path: string, state?: string) {
      const headers: Record<string, unknown> = {};
      return {
        headers,
        event: {
          path,
          context: state ? { vars: { state } } : {},
          node: { req: {}, res: { setHeader: (name: string, value: unknown) => (headers[name] = value) } },
        } as never,
      };
    }
    const handle = requireReady as unknown as (event: never) => unknown;

    function expect503(call: () => unknown, headers: Record<string, unknown>, retryAfter: number) {
      let thrown: any;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.statusCode).toBe(503);
      expect(thrown?.data).toEqual({ code: "KIBAO_NOT_READY" });
      expect(headers["retry-after"]).toBe(retryAfter);
    }

    it("does nothing unless the option is set", () => {
      runtime.config = { kibao: {} };
      expect(handle(http("/api/x").event)).toBeUndefined();
    });

    it("answers 503 with Retry-After while nothing is loaded", () => {
      runtime.config = { kibao: { requireReady: true } };
      const { event, headers } = http("/api/x");
      expect503(() => handle(event), headers, 2);
    });

    it("lets loaded and stale requests through", () => {
      runtime.config = { kibao: { requireReady: true } };
      expect(handle(http("/api/x", "loaded").event)).toBeUndefined();
      expect(handle(http("/api/x", "stale").event)).toBeUndefined();
    });

    it("exempts the proxy, static assets and configured prefixes, and honours Retry-After", () => {
      runtime.config = { kibao: { requireReady: { exclude: ["/health"], retryAfter: 7 } } };
      for (const path of ["/bao-proxy/v1/x", "/_nuxt/a.js", "/health", "/health?deep=1"])
        expect(handle(http(path).event)).toBeUndefined();
      const { event, headers } = http("/healthy");
      expect503(() => handle(event), headers, 7);
    });
  });
});
