import type { Role } from '../shared/constants';
import type { Db } from './db';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  dealerId: string | null;
  permissions: string[];
  mustChangePassword: boolean;
  sessionId: string;
}

/** Per-request context passed to services. */
export interface Ctx {
  user: AuthUser;
  ip: string | null;
  userAgent: string | null;
  origin: string;
}

/** Context for unauthenticated actions (login, public verification). */
export interface AnonCtx {
  user: null;
  ip: string | null;
  userAgent: string | null;
  origin: string;
}

export type AppEnv = {
  Variables: {
    db: Db;
    ctx: Ctx;
  };
};
