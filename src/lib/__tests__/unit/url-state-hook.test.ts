/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { useUrlState, type UrlSchema } from '@/lib/url-state';

const mockReplace = jest.fn();
const mockPush = jest.fn();

let mockSearchParams = new URLSearchParams('');
const mockPathname = '/projects';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams('');
});

const tabSchema: UrlSchema<'impact' | 'spend'> = {
  key: 'tab', type: 'enum', values: ['impact', 'spend'] as const,
  default: 'impact', history: 'push',
};

describe('useUrlState — read', () => {
  it('returns default when URL has no value', () => {
    const { result } = renderHook(() => useUrlState(tabSchema));
    expect(result.current[0]).toBe('impact');
  });

  it('returns URL value when present', () => {
    mockSearchParams = new URLSearchParams('tab=spend');
    const { result } = renderHook(() => useUrlState(tabSchema));
    expect(result.current[0]).toBe('spend');
  });

  it('returns default for invalid URL value', () => {
    mockSearchParams = new URLSearchParams('tab=nope');
    const { result } = renderHook(() => useUrlState(tabSchema));
    expect(result.current[0]).toBe('impact');
  });
});
