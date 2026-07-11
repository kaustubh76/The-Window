// Privileged role keys (from the actor registry; overridable via env).
import { ACTORS } from "./actors.mjs";

export const ADMIN_PK = ACTORS.admin.pk;
export const KEEPER_PK = ACTORS.keeper.pk;
export const OPERATOR_PK = ACTORS.operator.pk;
