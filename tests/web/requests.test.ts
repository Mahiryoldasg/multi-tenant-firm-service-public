import { describe, expect, it } from 'vitest';
import {
  displayTokenBody,
  employeeChanges,
  type Employee,
} from '../../web/src/workspace/requests.ts';

const employee: Employee = { id: 'e1', email: 'uye@acme.local', role: 'member' };

describe('employeeChanges', () => {
  it('returns null when the email and role are unchanged', () => {
    expect(employeeChanges(employee, { email: 'uye@acme.local', role: 'member' })).toBeNull();
  });

  it('returns only the email when only the email changed', () => {
    expect(employeeChanges(employee, { email: 'yeni@acme.local', role: 'member' })).toEqual({
      email: 'yeni@acme.local',
    });
  });

  it('returns only the role when only the role changed', () => {
    expect(employeeChanges(employee, { email: 'uye@acme.local', role: 'firm_admin' })).toEqual({
      role: 'firm_admin',
    });
  });

  it('returns both fields when both changed', () => {
    expect(employeeChanges(employee, { email: 'yeni@acme.local', role: 'firm_admin' })).toEqual({
      email: 'yeni@acme.local',
      role: 'firm_admin',
    });
  });

  it('counts a casing-only email change as a change', () => {
    expect(employeeChanges(employee, { email: 'Uye@Acme.local', role: 'member' })).toEqual({
      email: 'Uye@Acme.local',
    });
  });

  it('returns the draft email as typed, leaving the trimming to the API', () => {
    expect(employeeChanges(employee, { email: ' uye@acme.local ', role: 'member' })).toEqual({
      email: ' uye@acme.local ',
    });
  });
});

describe('displayTokenBody', () => {
  it('leaves out an empty or blank label', () => {
    expect(displayTokenBody('')).toEqual({});
    expect(displayTokenBody('   ')).toEqual({});
  });

  it('sends a label with text as typed', () => {
    expect(displayTokenBody('Salon A')).toEqual({ label: 'Salon A' });
    expect(displayTokenBody(' Salon A ')).toEqual({ label: ' Salon A ' });
  });
});
