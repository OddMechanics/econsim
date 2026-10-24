// Registries other modules add to at load time. Kept in a module with no
// imports of its own, so load order (and circular imports) can't break them.

import type { Ctx } from './ctx';
import type { Building } from './types';

/** Called when a building is finished. */
export const onFinished: ((ctx: Ctx, b: Building) => void)[] = [];

/** Put a building up for sale (set by estate.ts). */
export const sellHooks = { sell: (_ctx: Ctx, _b: Building, _why: string): void => {} };
