import { SetMetadata } from '@nestjs/common';
import { Role } from '../constants';

export const ROLES_KEY = 'required_roles';

/** Coarse-grained route protection. Field-level rules live in `application.policy.ts`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
