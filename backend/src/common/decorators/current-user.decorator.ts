import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../constants';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    return data ? user?.[data] : user;
  },
);
