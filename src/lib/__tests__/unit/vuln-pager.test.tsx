/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-pager.test.tsx
// The alert list's pager: its text, its page numbering and its fixed height.
import { render, screen, fireEvent } from '@testing-library/react';
import Pager, { PAGER_H, PAGER_NOTE, pageCount, pagerText } from '@/app/vulnerabilities/pager';
import { PAGER_INDICATOR_W } from '@/app/vulnerabilities/dimensions';

const NOTE = 'counted per Dependabot alert, not per CVE';

describe('pagerText', () => {
  it('reads "1–10 of 26 alerts · counted per Dependabot alert, not per CVE" on the first page', () => {
    expect(PAGER_NOTE).toBe(NOTE);
    expect(pagerText(1, 10, 26)).toBe(`1–10 of 26 alerts · ${NOTE}`);
  });

  it('the last page ends at the total, not at a full page', () => {
    expect(pagerText(3, 10, 26)).toBe(`21–26 of 26 alerts · ${NOTE}`);
  });

  it('one alert is singular, and an empty result reads "0 alerts"', () => {
    expect(pagerText(1, 10, 1)).toBe(`1–1 of 1 alert · ${NOTE}`);
    expect(pagerText(1, 10, 0)).toBe(`0 alerts · ${NOTE}`);
  });

  it('a page number past the end never reads a range beyond the total', () => {
    expect(pagerText(9, 10, 26)).toBe(`26–26 of 26 alerts · ${NOTE}`);
  });

  it('groups thousands, so a large result stays readable', () => {
    expect(pagerText(1, 10, 1234)).toBe(`1–10 of 1,234 alerts · ${NOTE}`);
  });
});

describe('pageCount', () => {
  it('rounds up, and an empty result still has one page', () => {
    expect(pageCount(26, 10)).toBe(3);
    expect(pageCount(20, 10)).toBe(2);
    expect(pageCount(0, 10)).toBe(1);
  });
});

describe('Pager', () => {
  it('shows "Page X of Y" with Previous aria-disabled on the first page and Next reporting page 2', () => {
    const onPage = jest.fn();
    render(<Pager page={1} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Previous/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('Next is aria-disabled on the last page and Previous reports the page before', () => {
    const onPage = jest.fn();
    render(<Pager page={3} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByRole('button', { name: /Next/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('an empty result is "Page 1 of 1" with both buttons aria-disabled', () => {
    render(<Pager page={1} pageSize={10} totalCount={0} onPage={jest.fn()} />);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Previous/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: /Next/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('a page number ahead of a shrunken result never reads "Page 4 of 3"', () => {
    const onPage = jest.fn();
    render(<Pager page={4} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  // Revert: drop the lower clamp (Math.max(1, page)): a hand-edited page 0 would read "Page 0 of 3" and Next would go to page 1.
  it('a page number below 1 reads as page 1, and Next goes to page 2', () => {
    const onPage = jest.fn();
    render(<Pager page={0} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText(`1–10 of 26 alerts · ${NOTE}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Previous/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  // Revert: call pagerText(page, ...) instead of pagerText(shown, ...): the range would read "26–26 of 26 alerts" beside "Page 3 of 3".
  it('a page number ahead of a shrunken result reads the last page\'s range beside "Page 3 of 3"', () => {
    render(<Pager page={4} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(screen.getByText(`21–26 of 26 alerts · ${NOTE}`)).toBeTruthy();
  });

  it('carries the full note as a title, since a narrow row truncates it', () => {
    render(<Pager page={1} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByText(`1–10 of 26 alerts · ${NOTE}`).getAttribute('title')).toBe(NOTE);
  });

  // Revert: drop the indicator's fixed width: Previous would shift left when "Page 9 of 10" becomes "Page 10 of 10".
  it('the page indicator has one fixed width and tabular numerals, whatever it reads', () => {
    const widthOf = (page: number, total: number) => {
      const { unmount } = render(<Pager page={page} pageSize={10} totalCount={total} onPage={jest.fn()} />);
      const el = screen.getByTestId('alert-pager-page');
      const out = { width: el.style.width, cls: el.className.split(/\s+/), text: el.textContent };
      unmount();
      return out;
    };
    const short = widthOf(1, 26);
    const long = widthOf(10, 120);
    expect(short.text).toBe('Page 1 of 3');
    expect(long.text).toBe('Page 10 of 12');
    expect(short.width).toBe(`${PAGER_INDICATOR_W}px`);
    expect(long.width).toBe(short.width);
    expect(short.cls).toEqual(expect.arrayContaining(['tabular-nums', 'text-center']));
  });

  it.each([
    ['a known count', 26],
    ['an empty result', 0],
    ['an unknown count (loading or error)', null],
  ])('keeps its %s height of PAGER_H as an inline style', (_label, totalCount) => {
    render(<Pager page={1} pageSize={10} totalCount={totalCount} onPage={jest.fn()} />);
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
  });

  it('does not clip its own overflow, so a focused button\'s ring shows', () => {
    render(<Pager page={1} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByTestId('alert-pager').className.split(/\s+/)).not.toContain('overflow-hidden');
  });

  it('with no known count the note is an aria-hidden blank, never a fake "0 alerts", and both buttons are aria-disabled', () => {
    render(<Pager page={1} pageSize={10} totalCount={null} onPage={jest.fn()} />);
    const pager = screen.getByTestId('alert-pager');
    expect(pager.textContent).not.toMatch(/alerts/);
    expect(pager.textContent).not.toMatch(/Page/);
    // The note is hidden; the page indicator is the live region, so it stays in the accessibility tree (a blank reads as nothing).
    expect(pager.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
    expect(screen.getByTestId('alert-pager-page').getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('button', { name: /Previous/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: /Next/ }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Pager buttons at the ends (B7)', () => {
  // Revert: use the `disabled` attribute again: a click that lands on the last page disables the button under focus, and focus drops to <body>.
  it('Previous and Next are aria-disabled, not disabled, so a focused button keeps focus when its click moves the page to an end', () => {
    const { rerender } = render(<Pager page={2} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    const next = screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement;
    next.focus();
    rerender(<Pager page={3} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Next/ })).toBe(next);
    expect(next.disabled).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(next);
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Revert: call onPage without the guard.
  it('a click on an aria-disabled button does nothing', () => {
    const onPage = jest.fn();
    const { rerender } = render(<Pager page={1} pageSize={10} totalCount={26} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    rerender(<Pager page={3} pageSize={10} totalCount={26} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    rerender(<Pager page={1} pageSize={10} totalCount={null} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPage).not.toHaveBeenCalled();
  });

  it('an enabled button reads aria-disabled="false" and still pages', () => {
    const onPage = jest.fn();
    render(<Pager page={2} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByRole('button', { name: /Previous/ }).getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  // Revert: drop aria-live from the indicator.
  it('"Page X of Y" is a polite live region, so a page change is announced', () => {
    render(<Pager page={2} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByTestId('alert-pager-page').getAttribute('aria-live')).toBe('polite');
  });
});

describe('light theme', () => {
  // Revert: give the pager (or one of its buttons) the card-shell class: the light remap's 1px border would grow the fixed 28px row.
  it('uses no card-shell class (bg-gray-900), so the light theme\'s border and shadow cannot grow the fixed row', () => {
    const { container } = render(<Pager page={1} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
  });
});
