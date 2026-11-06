import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "std-env";

const mocks = vi.hoisted(() => ({
  applyRuntimeConfigEnv: vi.fn(),
  getAllVars: vi.fn(),
  reconsileConfig: vi.fn(),
  setEnv: vi.fn(),
  useRuntimeConfig: vi.fn(),
}));

vi.mock("nitropack/runtime", () => ({
  useRuntimeConfig: mocks.useRuntimeConfig,
}));

vi.mock("../src/runtime/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/runtime/utils")>()),
  getAllVars: mocks.getAllVars,
}));

vi.mock("../src/runtime/env", () => ({
  applyRuntimeConfigEnv: mocks.applyRuntimeConfigEnv,
  crawlVarsFromEnv: vi.fn(() => ({})),
  reconsileConfig: mocks.reconsileConfig,
  setEnv: mocks.setEnv,
}));

describe("kibao server env injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.__KIBAO_INJECTED;
    delete process.env.SECRET_FROM_BAO;
    delete env.__KIBAO_INJECTED;
    delete env.SECRET_FROM_BAO;

    mocks.useRuntimeConfig.mockReturnValue({
      kibao: {},
      public: {},
    });
    mocks.reconsileConfig.mockReturnValue({
      disabled: false,
      openbao: { private: {} },
      server: { bao: "https://bao.example.test" },
    });
    mocks.getAllVars.mockResolvedValue({
      private: {
        SECRET_FROM_BAO: "secret-value",
      },
    });
    mocks.setEnv.mockImplementation(({ vars }: { vars: Record<string, unknown> }) => {
      for (const [key, value] of Object.entries(vars)) {
        const stringValue = typeof value === "string" ? value : JSON.stringify(value);
        process.env[key] = stringValue;
        env[key] = stringValue;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips request reinjection when startup already marked env as injected", async () => {
    const { injectVars } = await import("../src/runtime/server/utils");
    const { request } = await createHooks(injectVars);

    await request({ context: {} });

    expect(mocks.setEnv).toHaveBeenCalledTimes(1);
    expect(mocks.setEnv).toHaveBeenLastCalledWith({
      vars: {
        SECRET_FROM_BAO: "secret-value",
        __KIBAO_INJECTED: "true",
      },
    });
  });

  it("reinjects cached vars when the injected marker is missing", async () => {
    const { injectVars } = await import("../src/runtime/server/utils");
    const { request } = await createHooks(injectVars);

    await request({ context: {} });
    delete process.env.__KIBAO_INJECTED;

    await request({ context: {} });

    expect(mocks.setEnv).toHaveBeenCalledTimes(2);
    expect(mocks.setEnv).toHaveBeenLastCalledWith({
      vars: {
        SECRET_FROM_BAO: "secret-value",
        __KIBAO_INJECTED: "true",
      },
    });
  });

  it("exposes refreshed vars through the current request context", async () => {
    const { injectVars } = await import("../src/runtime/server/utils");
    const { request } = await createHooks(injectVars);
    const event = { context: {}, node: {} } as any;

    await request(event);
    expect(event.context.vars.data.SECRET_FROM_BAO).toBe("secret-value");

    mocks.getAllVars.mockResolvedValueOnce({
      private: {
        SECRET_FROM_BAO: "refreshed-secret-value",
      },
    });

    await event.context.vars.refresh(event);

    expect(event.context.vars.data).toMatchObject({
      SECRET_FROM_BAO: "refreshed-secret-value",
      __KIBAO_INJECTED: "true",
    });
  });

  it("attaches vars to Nitro Cloudflare hook payloads and env bindings", async () => {
    const { injectVars } = await import("../src/runtime/server/utils");
    const { hooks } = await createHooks(injectVars);
    const queue = hooks["cloudflare:queue"];
    const scheduled = hooks["cloudflare:scheduled"];
    const durableInit = hooks["cloudflare:durable:init"];

    expect(queue).toBeTypeOf("function");
    expect(scheduled).toBeTypeOf("function");
    expect(durableInit).toBeTypeOf("function");
    if (!queue) {
      throw new Error("cloudflare:queue hook was not registered");
    }

    const payload = {
      batch: {},
      env: {},
      context: {},
    } as any;

    await queue(payload);

    expect(payload.env).toMatchObject({
      SECRET_FROM_BAO: "secret-value",
    });
    expect(payload.vars).toBeUndefined();
    expect(payload.context.vars.data).toMatchObject({
      SECRET_FROM_BAO: "secret-value",
      __KIBAO_INJECTED: "true",
    });
  });

  it("defers and deduplicates startup fetching in Cloudflare Workers", async () => {
    vi.stubGlobal("WebSocketPair", Object);
    let resolveVars: (value: { private: { SECRET_FROM_BAO: string } }) => void;
    mocks.getAllVars.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVars = resolve;
      }),
    );

    const { injectVars } = await import("../src/runtime/server/utils");
    const { request } = await createHooks(injectVars);

    expect(mocks.getAllVars).not.toHaveBeenCalled();

    const firstRequest = request({ context: {}, node: {} });
    const secondRequest = request({ context: {}, node: {} });
    await Promise.resolve();
    expect(mocks.getAllVars).toHaveBeenCalledTimes(1);

    resolveVars!({
      private: {
        SECRET_FROM_BAO: "secret-value",
      },
    });
    await Promise.all([firstRequest, secondRequest]);

    expect(mocks.setEnv).toHaveBeenCalledTimes(1);
  });
});

async function createHooks(injectVars: (options: { app: any }) => Promise<void>) {
  const hooks: Record<string, (event: any) => Promise<void>> = {};
  await injectVars({
    app: {
      hooks: {
        hook(name: string, handler: (event: any) => Promise<void>) {
          hooks[name] = handler;
        },
      },
    },
  });

  const request = hooks.request;
  if (!request) {
    throw new Error("request hook was not registered");
  }

  return { hooks, request };
}
