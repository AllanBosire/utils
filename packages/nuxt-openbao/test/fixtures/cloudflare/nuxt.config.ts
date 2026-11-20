import { PUBLIC_TOKEN_ATTESTATION } from "../../../src/runtime/utils";
import EnvObserverModule from "../basic/modules/env-observer";

const mockOpenBaoURL = process.env.MOCK_OPENBAO_URL || "";

export default defineNuxtConfig({
  extends: ["../base"],
  modules: [EnvObserverModule],
  runtimeConfig: {
    observerSecret: "",
    public: {
      observerValue: "",
      observerModule: {},
    },
  },
  nitro: {
    preset: "cloudflare_module",
  },
  kibao: {
    // A ready Worker serves everything: the requests below must still answer 200 through the middleware.
    requireReady: true,
    server: {
      bao: mockOpenBaoURL,
    },
    openbao: {
      public: {
        baseURL: mockOpenBaoURL,
        location: {
          app: "demo",
          environment: "test",
        },
        token: `${PUBLIC_TOKEN_ATTESTATION}fixture-public-token`,
      },
      private: {
        baseURL: mockOpenBaoURL,
        location: {
          app: "demo",
          environment: "test",
        },
        bao: {
          role: {
            id: "fixture-role-id",
          },
          secret: {
            id: "fixture-secret-id",
          },
        },
      },
    },
  },
});
