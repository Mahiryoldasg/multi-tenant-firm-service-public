/** The one rule behind `users.email_normalized`, for storing, lookups and uniqueness. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A light shape check only: one `@` between a non-empty local part and domain, and no whitespace.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/** Whether an email about to be stored has the `local@domain` shape, judged after trimming. */
export function isValidEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email.trim());
}
