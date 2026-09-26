import { describe, expect, it } from 'vitest';
import { isValidEmail } from '../../src/server/auth/email.ts';

describe('isValidEmail', () => {
  it.each(['a@b', 'Boss@First.Test', '  admin@acme.local\t', 'first.last+tag@sub.example.com'])(
    'accepts %j',
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each(['', '   ', 'ab.x', 'a@', '@b', 'a b@x', 'a@b c', 'a@@b', 'a@b@c'])(
    'rejects %j',
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});
