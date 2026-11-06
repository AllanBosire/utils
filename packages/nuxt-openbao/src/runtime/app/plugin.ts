import { defineNuxtPlugin, createError } from "nuxt/app";
import { consola } from "consola";
import { defu } from "defu";
import { joinURL } from "ufo";
import { setEnv } from "../env";
import { /* getAllVars */ getSecrets } from "../utils";
import type { KibaoVars } from "../types";
// import { entries } from "@chiballc/utils";

export default defineNuxtPlugin({
  enforce: "pre",
  async setup(app) {
    const console = consola.withTag("kibao");
    const config = app.$config.kibao || app.$config.public.kibao;
    if (!config) {
      throw createError({
        message: "Unable to find config",
        data: app.$config,
      });
    }
    
    if (config.disabled) {
      return {};
    }
    async function _getPublicVars() {
      if (!config.openbao.public?.token) {
        console.fatal("Unable to fetch public variables no token found", config.openbao);
        return;
      }

      if (!config.openbao.public.location) {
        console.fatal("No location passed in to find the openbao instance", config.openbao);
        return;
      }

      console.info("Fetching public vars");
      const _vars = await getSecrets(
        {
          baseURL: joinURL(config.server?.bao || "", "/bao-proxy"),
          token: config.openbao.public.token as any,
          location: config.openbao.public?.location as any,
        },
        "public",
      );
      setEnv(_vars);
      console.success("Successfully substituted public variables from OpenBao");
      return _vars;
    }

    if (!config.vars) {
      config.vars = {} as any;
    }

    if (config.test?.vars) {
      config.vars._created = "true";
    }

    if (config.vars?._created) {
      setEnv({ vars: config.vars });
      console.debug("Variables already exist in environment, skipping refetch");
    } else if (config.openbao?.public) {
      const { vars: _vars } = (await _getPublicVars()) || {};
      config.vars = defu(_vars, config.vars) as KibaoVars;
      setEnv({ vars: config.vars });
      console.debug("Successfully fetched vars");
    }

    // TODO: investigate implications if enabled, probably a bad idea to
    // if (import.meta.server && config.openbao.private) {
    //   try {
    //     const _vars = await getAllVars(config.openbao, { baseURL: joinURL(config.server?.bao || "", "/bao-proxy") });
    //     for (const [_, _var] of entries(_vars)) {
    //       setEnv({
    //         vars: _var || {},
    //       });
    //     }
    //   } catch (e) {
    //     console.warn(e);
    //   }
    // }

    return {
      provide: {
        vars: {
          get data() {
            return config.vars;
          },
          async refresh() {
            const { vars: _vars } = (await _getPublicVars()) || {};
            config.vars = defu(_vars, config.vars);
          },
        },
      },
    };
  },
});
