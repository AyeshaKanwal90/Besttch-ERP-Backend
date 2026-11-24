export interface AuthUser {
  id: number;
  email: string;
  roleId: number;
  roleName: string;
  // Must match users.token_version or the session is rejected.
  tokenVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
