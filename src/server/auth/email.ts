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

/** What a user write returns when an active user already has the email. */
export const EMAIL_TAKEN = 'email_taken';

/** The 409 message for `EMAIL_TAKEN`, the same for every write that stores an email. */
export const EMAIL_TAKEN_MESSAGE = 'Bu e-posta adresi zaten kullanılıyor.';
