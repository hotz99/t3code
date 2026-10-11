import { createTmsEnvironmentAtoms } from "@t3tools/client-runtime/state/tms";

import { connectionAtomRuntime } from "../connection/runtime";

export const tmsEnvironment = createTmsEnvironmentAtoms(connectionAtomRuntime);
