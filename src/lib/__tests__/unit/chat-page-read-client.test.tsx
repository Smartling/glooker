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
});
