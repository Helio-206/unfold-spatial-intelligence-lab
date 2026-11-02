import { describe, expect, it } from 'vitest';
import { initialWorkspaceState, reduceWorkspace, visibility, type Message, type WorkspaceAction, type WorkspaceState } from '../../../src/living/workspace-design/workspace-state';

const run = (actions: WorkspaceAction[], s: WorkspaceState = initialWorkspaceState()) => actions.reduce(reduceWorkspace, s);
const msg = (id: string, role: Message['role'] = 'assistant', proposal: Message['proposal'] = null): Message => ({ id, role, text: id, source: 'fixture', sourceNote: 'Fixture', evidence: [], proposal, error: null, at: 0 });

describe('workspace visibility modes', () => {
  it('starts in assisted mode with a compact composer', () => {
    const v = visibility(initialWorkspaceState());
    expect(initialWorkspaceState().mode).toBe('assisted');
    expect(v.composer).toBe('compact');
    expect(v.conversation).toBe(false);
    expect(v.rail).toBe('full');
  });

  it('opens and collapses the conversation without touching history', () => {
    const s = run([{ type: 'user_message', message: msg('u1', 'user') }, { type: 'toggle_conversation' }]);
    expect(s.mode).toBe('conversation');
    expect(visibility(s).composer).toBe('expanded');
    const back = reduceWorkspace(s, { type: 'toggle_conversation' });
    expect(back.mode).toBe('assisted');
    expect(back.messages).toHaveLength(1);
  });

  it('focus mode keeps only a restore control and returns to the previous mode', () => {
    const s = run([{ type: 'toggle_conversation' }, { type: 'enter_focus' }]);
    const v = visibility(s);
    expect(v.composer).toBe('restore_only');
    expect(v.rail).toBe('hidden');
    expect(v.conversation).toBe(false);
    expect(v.spatialAnnotations).toBe(false);
    expect(reduceWorkspace(s, { type: 'exit_focus' }).mode).toBe('conversation');
  });

  it('Escape steps back one level at a time and always leaves focus mode', () => {
    let s = run([{ type: 'assistant_message', message: msg('a1') }]);
    expect(s.transientId).toBe('a1');
    s = reduceWorkspace(s, { type: 'escape' });
    expect(s.transientId).toBeNull();
    s = run([{ type: 'toggle_conversation' }, { type: 'escape' }], s);
    expect(s.mode).toBe('assisted');
    s = run([{ type: 'enter_focus' }, { type: 'escape' }], s);
    expect(s.mode).toBe('assisted');
  });

  it('replies during focus mode are counted, not shown', () => {
    const s = run([{ type: 'enter_focus' }, { type: 'assistant_message', message: msg('a1') }, { type: 'assistant_message', message: msg('a2') }]);
    expect(visibility(s).transient).toBeNull();
    expect(visibility(s).unseen).toBe(2);
    const back = run([{ type: 'return_to_last_response' }], s);
    expect(back.mode).toBe('assisted');
    expect(back.transientId).toBe('a2');
    expect(back.messages).toHaveLength(2);
  });

  it('critical notices and pending approvals are never hidden by focus or overlay level', () => {
    const pending = msg('a1', 'assistant', { id: 'p1', title: 't', detail: 'd', kind: 'preview_fixture', approveLabel: 'ok', state: 'pending' });
    const s = run([
      { type: 'assistant_message', message: pending },
      { type: 'notice', notice: { id: 'pose', severity: 'critical', text: 'fixture pose' } },
      { type: 'set_overlay', level: 'hidden' },
      { type: 'enter_focus' },
    ]);
    const v = visibility(s);
    expect(v.critical.map((n) => n.id)).toEqual(['pose']);
    expect(v.pendingApprovals.map((m) => m.id)).toEqual(['a1']);
    expect(v.overlayOpacity).toBe(0);
  });

  it('overlay cycles visible → dimmed → hidden → visible and dims transient text', () => {
    const s1 = run([{ type: 'cycle_overlay' }]);
    expect(s1.overlay).toBe('dimmed');
    expect(visibility(s1).overlayOpacity).toBeLessThan(1);
    const s2 = reduceWorkspace(s1, { type: 'cycle_overlay' });
    expect(s2.overlay).toBe('hidden');
    expect(visibility(run([{ type: 'assistant_message', message: msg('a') }], s2)).transient).toBeNull();
    expect(reduceWorkspace(s2, { type: 'cycle_overlay' }).overlay).toBe('visible');
  });

  it('return to last response restores hidden overlays', () => {
    const s = run([{ type: 'assistant_message', message: msg('a1') }, { type: 'set_overlay', level: 'hidden' }, { type: 'dismiss_transient' }, { type: 'return_to_last_response' }]);
    expect(s.overlay).toBe('visible');
    expect(visibility(s).transient?.id).toBe('a1');
  });

  it('the rail cannot be expanded in focus mode', () => {
    const s = run([{ type: 'enter_focus' }, { type: 'toggle_rail' }]);
    expect(s.railOpen).toBe(false);
  });
});
