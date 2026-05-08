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

  it('enum: omits key when value set back to default', () => {
    mockSearchParams = new URLSearchParams('tab=spend');
    const { result } = renderHook(() => useUrlState(tabSchema));
    act(() => result.current[1]('impact'));
    expect(mockPush).toHaveBeenCalledWith('/projects');
  });
});

import { useUrlBatch } from '@/lib/url-state';

const teamSchema: UrlSchema<string | null> = {
  key: 'team', type: 'string', default: null, history: 'replace',
};
const devSchema: UrlSchema<Set<string>> = {
  key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
};

describe('useUrlBatch', () => {
  it('collapses N writes into a single router call', () => {
    mockSearchParams = new URLSearchParams('dev=alice&dev=bob');
    const { result } = renderHook(() => ({
      batch: useUrlBatch(),
      tab: useUrlState(tabSchema),
      team: useUrlState(teamSchema),
      devs: useUrlState(devSchema),
    }));

    act(() => {
      result.current.batch(() => {
        result.current.team[1]('Platform');
        result.current.devs[1](new Set());
      });
    });

    // Only ONE router call total
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split('?')[1] || '');
    expect(params.get('team')).toBe('Platform');
    expect(params.has('dev')).toBe(false);
  });

  it('uses push when any participating setter is push', () => {
    const { result } = renderHook(() => ({
      batch: useUrlBatch(),
      tab: useUrlState(tabSchema),
      team: useUrlState(teamSchema),
    }));

    act(() => {
      result.current.batch(() => {
        result.current.tab[1]('spend');     // history: 'push'
        result.current.team[1]('Platform'); // history: 'replace'
      });
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('nested batch runs inline without re-flushing', () => {
    const { result } = renderHook(() => ({
      batch: useUrlBatch(),
      team: useUrlState(teamSchema),
      devs: useUrlState(devSchema),
    }));

    act(() => {
      result.current.batch(() => {
        result.current.team[1]('A');
        result.current.batch(() => {
          result.current.devs[1](new Set(['x']));
        });
      });
    });

    // Outer batch flushes once; inner batch must not call router
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('throws when callback returns a Promise (async fn)', () => {
    const { result } = renderHook(() => useUrlBatch());
    expect(() => {
      act(() => {
        result.current(async () => {
          // simulate an async-marker return
        });
      });
    }).toThrow(/synchronous/);
  });

  it('clears the singleton and skips flush if callback throws', () => {
    const { result } = renderHook(() => ({
      batch: useUrlBatch(),
      team: useUrlState(teamSchema),
    }));

    expect(() => {
      act(() => {
        result.current.batch(() => {
          result.current.team[1]('Platform');
          throw new Error('boom');
        });
      });
    }).toThrow('boom');

    // No router call for the failed batch
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    // Singleton is cleared — a subsequent non-batched setter goes directly to router
    act(() => result.current.team[1]('Frontend'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
