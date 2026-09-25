import type { ActiveUser } from '../modules/platform/users.ts';
import type { Role } from './tokens.ts';

/** The `user` object of the login and `/api/auth/me` responses. */
export interface UserResponse {
  id: string;
  email: string;
  role: Role;
  firmId?: string;
}

/** `firmId` is omitted, not `null`, for the platform admin (contract §2). */
export function toUserResponse({ id, email, role, firmId }: ActiveUser): UserResponse {
  return firmId === null ? { id, email, role } : { id, email, role, firmId };
}
