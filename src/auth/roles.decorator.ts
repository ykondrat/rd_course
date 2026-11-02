import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_roles';

export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
