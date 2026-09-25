/** The one rule behind `users.email_normalized`, for storing, lookups and uniqueness. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
