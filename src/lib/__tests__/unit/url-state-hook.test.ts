/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
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

const filterSchema: UrlSchema<string> = {
  key: 'q', type: 'string', default: '', history: 'replace',
};

describe('useUrlState — write', () => {
  it('calls router.push for enum schema with history=push', () => {
    const { result } = renderHook(() => useUrlState(tabSchema));
    act(() => result.current[1]('spend'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/projects?tab=spend');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('calls router.replace for string schema with history=replace', () => {
    const { result } = renderHook(() => useUrlState(filterSchema));
    act(() => result.current[1]('hello'));
    expect(mockReplace).toHaveBeenCalledWith('/projects?q=hello');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('omits the key when set back to default (clean URL)', () => {
    mockSearchParams = new URLSearchParams('q=hello');
    const { result } = renderHook(() => useUrlState(filterSchema));
    act(() => result.current[1](''));
    // Pathname-only URL when all params are at default
    expect(mockReplace).toHaveBeenCalledWith('/projects');
  });

  it('preserves unrelated keys when writing', () => {
    mockSearchParams = new URLSearchParams('tab=spend&other=keep');
    const { result } = renderHook(() => useUrlState(filterSchema));
    act(() => result.current[1]('hi'));
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url.startsWith('/projects?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('q')).toBe('hi');
    expect(params.get('tab')).toBe('spend');
    expect(params.get('other')).toBe('keep');
  });
});
