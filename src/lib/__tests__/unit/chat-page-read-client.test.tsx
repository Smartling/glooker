/**
 * @jest-environment jsdom
 */
import { collectPageExtract } from '@/app/chat-panel';

describe('collectPageExtract', () => {
  beforeEach(() => { document.body.innerHTML = ''; document.title = 'Glooker'; });

  it('reads title, first h1 and main text', () => {
    document.title = 'Settings — Glooker';
    document.body.innerHTML = '<main><h1>Settings</h1><p>Teams: 11</p></main>';
    const e = collectPageExtract()!;
    expect(e.title).toBe('Settings — Glooker');
    expect(e.heading).toBe('Settings');
    expect(e.text).toContain('Teams: 11');
  });

  it('falls back to body when there is no main landmark', () => {
    document.body.innerHTML = '<div><h1>Reports</h1><p>Ten reports</p></div>';
    expect(collectPageExtract()!.text).toContain('Ten reports');
  });

  it('records the current path', () => {
    document.body.innerHTML = '<main>x</main>';
    expect(collectPageExtract()!.path).toBe(window.location.pathname);
  });

  // Finding 2: there is no <main> landmark in production before the layout.tsx
  // fix, so every extract was the whole document body — including the chat
  // panel's own open transcript, rendered inside <main> right alongside the
  // page it overlays. Cloning + stripping [data-glooker-chat] must keep the
  // page's own text while dropping the panel's.
  it('excludes a marked chat panel subtree from the extract', () => {
    document.body.innerHTML =
      '<main>' +
      '<h1>Settings</h1><p>Teams: 11</p>' +
      '<div data-glooker-chat="">Ask Glooker: What page is this? This is the Settings page.</div>' +
      '</main>';
    const e = collectPageExtract()!;
    expect(e.text).toContain('Teams: 11');
    expect(e.text).not.toContain('Ask Glooker');
    expect(e.text).not.toContain('This is the Settings page.');
  });

  it('does not mutate the live DOM when stripping the chat panel subtree', () => {
    document.body.innerHTML =
      '<main><p>Teams: 11</p><div data-glooker-chat="">panel text</div></main>';
    collectPageExtract();
    expect(document.querySelector('[data-glooker-chat]')).not.toBeNull();
    expect(document.body.innerHTML).toContain('panel text');
  });
});
