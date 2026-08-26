import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public_route';

/**
 * Marks a route as unauthenticated. The JWT guard is registered globally (deny-by-default), so
 * forgetting this decorator makes an endpoint private — the safe direction to fail.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
