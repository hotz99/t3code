import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

/** A project's TMS tree of causes, live from the environment that owns the checkout. */
export function createTmsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    project: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tms:project",
      tag: WS_METHODS.tmsSubscribeProject,
      // The server polls the checkout while subscribed; stop soon after the panel closes.
      idleTtlMs: 5_000,
    }),
  };
}
