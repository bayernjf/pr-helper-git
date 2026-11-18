import { describe, expect, it } from 'vitest';
import { errorDetail, errorMessage, errorStatus } from './errors';

describe('error helpers', () => {
  it('reads a native Error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('accepts strings and plain objects with a message', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ message: 'api said no' })).toBe('api said no');
    expect(errorMessage({ detail: 'only detail' })).toBe('');
  });

  it('ignores non-message values', () => {
    expect(errorMessage(null)).toBe('');
    expect(errorMessage({ message: 42 })).toBe('');
  });

  it('turns the admin-gate wire error into an actionable message', () => {
    expect(errorMessage(new Error('admin access required'))).toContain('admin');
    expect(errorMessage(new Error('unknown or unregistered repo'))).toBe('unknown or unregistered repo');
  });

  it('extracts optional detail and status fields', () => {
    expect(errorDetail({ detail: 'index locked' })).toBe('index locked');
    expect(errorDetail({ detail: 1 })).toBe('');
    expect(errorStatus({ status: 409 })).toBe(409);
    expect(errorStatus({ status: '409' })).toBeUndefined();
  });
});
