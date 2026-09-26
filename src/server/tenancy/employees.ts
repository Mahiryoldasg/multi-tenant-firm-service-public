import Database from 'better-sqlite3';
import { EMAIL_TAKEN, normalizeEmail } from '../auth/email.ts';
import type { Role } from '../auth/tokens.ts';
import { findActiveUserByEmail, insertUser } from '../modules/platform/users.ts';

// An employee always has a firm, and the users CHECK keeps the platform admin firmless.
export type EmployeeRole = Exclude<Role, 'platform_admin'>;

/** A user of the scope's firm, with exactly the fields the contract returns for an employee. */
export interface Employee {
  id: string;
  email: string;
  role: EmployeeRole;
}

/** An employee to create; the email is already trimmed and the password already hashed. */
export interface NewEmployee {
  email: string;
  role: EmployeeRole;
  passwordHash: string;
}

/** What `create` returns when the scope's firm was deleted after the request was authenticated. */
export const FIRM_GONE = 'firm_gone';

/** The fields a firm admin may change; an absent field keeps its value. The email is trimmed. */
export interface EmployeeChanges {
  email?: string;
  role?: EmployeeRole;
}

/** The employees of one firm. No method takes a firm id: the firm is fixed at construction. */
export interface EmployeesRepository {
  /** The firm's active employees, oldest first. */
  list(): Employee[];
  /** An active employee of this firm; unknown, deleted and other-firm ids are all `undefined`. */
  findById(id: string): Employee | undefined;
  /**
   * Creates an employee of this firm, unless an active user anywhere already has the email
   * (`EMAIL_TAKEN`) or the firm itself is gone (`FIRM_GONE`); either way nothing is written.
   */
  create(now: string, employee: NewEmployee): Employee | typeof EMAIL_TAKEN | typeof FIRM_GONE;
  /**
   * Changes an active employee of this firm and returns them; `undefined` when there is no such
   * employee, `EMAIL_TAKEN` when another active user has the new email. Both write nothing.
   */
  update(
    now: string,
    id: string,
    changes: EmployeeChanges,
  ): Employee | undefined | typeof EMAIL_TAKEN;
}

/** Binds the employee statements to `firmId`; every statement filters on it. */
export function createEmployeesRepository(
  db: Database.Database,
  firmId: string,
): EmployeesRepository {
  function findById(id: string): Employee | undefined {
    return db
      .prepare<{ firmId: string; id: string }, Employee>(
        `SELECT id, email, role
           FROM users
          WHERE id = @id
            AND firm_id = @firmId
            AND deleted_at IS NULL`,
      )
      .get({ firmId, id });
  }

  return {
    list() {
      // rowid keeps the insertion order of employees created in the same instant (the seed).
      return db
        .prepare<{ firmId: string }, Employee>(
          `SELECT id, email, role
             FROM users
            WHERE firm_id = @firmId
              AND deleted_at IS NULL
            ORDER BY created_at, rowid`,
        )
        .all({ firmId });
    },

    findById,

    create(now, employee) {
      const create = db.transaction((): Employee | typeof EMAIL_TAKEN | typeof FIRM_GONE => {
        // The caller hashed the password after authentication, so the firm may have been deleted
        // since. An active user of a deleted firm would keep its email taken for good.
        const firm = db
          .prepare<{ firmId: string }>(
            'SELECT 1 FROM firms WHERE id = @firmId AND deleted_at IS NULL',
          )
          .get({ firmId });
        if (!firm) return FIRM_GONE;

        // Email uniqueness is system-wide (contract §3): the same check as a firm's first admin.
        if (findActiveUserByEmail(db, normalizeEmail(employee.email))) return EMAIL_TAKEN;

        const id = insertUser(db, now, { firmId, ...employee });
        return { id, email: employee.email, role: employee.role };
      });

      try {
        return create.immediate();
      } catch (error) {
        // Mapped only after the rollback, like the firm create does.
        if (isUniqueViolation(error)) return EMAIL_TAKEN;
        throw error;
      }
    },

    update(now, id, changes) {
      const update = db.transaction((): Employee | undefined | typeof EMAIL_TAKEN => {
        const current = findById(id);
        if (!current) return undefined;

        if (changes.email !== undefined) {
          // The employee's own email, in any casing, is not a clash.
          const holder = findActiveUserByEmail(db, normalizeEmail(changes.email));
          if (holder && holder.id !== id) return EMAIL_TAKEN;
        }

        const email = changes.email ?? current.email;
        return db
          .prepare<
            {
              firmId: string;
              id: string;
              email: string;
              emailNormalized: string;
              role: EmployeeRole;
              now: string;
            },
            Employee
          >(
            `UPDATE users
                SET email = @email, email_normalized = @emailNormalized, role = @role,
                    updated_at = @now
              WHERE id = @id
                AND firm_id = @firmId
                AND deleted_at IS NULL
              RETURNING id, email, role`,
          )
          .get({
            firmId,
            id,
            email,
            emailNormalized: normalizeEmail(email),
            role: changes.role ?? current.role,
            now,
          });
      });

      try {
        return update.immediate();
      } catch (error) {
        if (isUniqueViolation(error)) return EMAIL_TAKEN;
        throw error;
      }
    },
  };
}

// The partial unique index on active emails is the safety net for a clash the pre-check missed, such
// as an active user of a firm whose users were never cascaded.
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
