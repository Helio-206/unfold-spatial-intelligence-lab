/**
 * Workspace interface state: three visibility modes, AI overlay visibility, conversation history and the notices that
 * may never be hidden. Pure reducer, no DOM: the view derives everything it shows from `visibility(state)`.
 *
 *  - conversation: the conversation panel is open over the scene.
 *  - assisted (default): compact composer; responses appear briefly as a contextual overlay.
 *  - focus: almost only the object. One restore control stays. Critical notices and pending approvals stay visible.
 */

export type VisibilityMode = 'conversation' | 'assisted' | 'focus';
export type OverlayLevel = 'visible' | 'dimmed' | 'hidden';
export type MessageSource = 'live' | 'fixture' | 'local';

export type EvidenceLink = { componentId: string; label: string; status: 'resolved' | 'missing' };
export type ProposalView = {
  id: string; title: string; detail: string; kind: 'preview_fixture' | 'unavailable';
  /** What approving does. Never a commit to confirmed data in this prototype. */
  approveLabel: string; state: 'pending' | 'approved' | 'rejected' | 'running' | 'done' | 'cancelled';
  /** The canonical actuator the experiment plan was made for. Approval runs exactly this; never inferred from evidence order. */
  actuatorId: string | null;
};
export type Message = {
  id: string; role: 'user' | 'assistant' | 'system'; text: string; source: MessageSource; sourceNote: string | null;
  evidence: EvidenceLink[]; proposal: ProposalView | null; error: string | null; at: number;
  /** A reference image the person attached; kept locally, never sent to the model by this route. */
  attachment?: { name: string; size: number; dataUrl: string };
};
export type Notice = { id: string; severity: 'critical' | 'approval' | 'info'; text: string };

export type WorkspaceState = {
  mode: VisibilityMode;
  /** The mode to return to when focus ends. Never 'focus'. */
  restoreMode: Exclude<VisibilityMode, 'focus'>;
  overlay: OverlayLevel;
  messages: Message[];
  /** The assistant message currently shown as a transient overlay in assisted mode. */
  transientId: string | null;
  /** Assistant replies that arrived while in focus mode and were not shown. */
  unseen: number;
  notices: Notice[];
  processing: boolean;
  railOpen: boolean;
};

export type WorkspaceAction =
  | { type: 'set_mode'; mode: VisibilityMode }
  | { type: 'toggle_conversation' }
  | { type: 'enter_focus' }
  | { type: 'exit_focus' }
  | { type: 'escape' }
  | { type: 'set_overlay'; level: OverlayLevel }
  | { type: 'cycle_overlay' }
  | { type: 'user_message'; message: Message }
  | { type: 'assistant_message'; message: Message }
  | { type: 'dismiss_transient' }
  | { type: 'return_to_last_response' }
  | { type: 'processing'; value: boolean }
  | { type: 'notice'; notice: Notice }
  | { type: 'clear_notice'; id: string }
  | { type: 'proposal_state'; messageId: string; state: ProposalView['state'] }
  | { type: 'toggle_rail' };

export const initialWorkspaceState = (): WorkspaceState => ({
  mode: 'assisted', restoreMode: 'assisted', overlay: 'visible', messages: [], transientId: null, unseen: 0, notices: [], processing: false, railOpen: false,
});

const MAX_MESSAGES = 60;

export function reduceWorkspace(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'set_mode':
      if (action.mode === 'focus') return reduceWorkspace(state, { type: 'enter_focus' });
      return { ...state, mode: action.mode, restoreMode: action.mode, unseen: action.mode === 'conversation' ? 0 : state.unseen };
    case 'toggle_conversation':
      if (state.mode === 'conversation') return { ...state, mode: 'assisted', restoreMode: 'assisted' };
      return { ...state, mode: 'conversation', restoreMode: 'conversation', unseen: 0, transientId: null };
    case 'enter_focus':
      if (state.mode === 'focus') return state;
      return { ...state, mode: 'focus', restoreMode: state.mode, transientId: null, railOpen: false };
    case 'exit_focus':
      if (state.mode !== 'focus') return state;
      return { ...state, mode: state.restoreMode, unseen: state.restoreMode === 'conversation' ? 0 : state.unseen };
    case 'escape':
      // one step back per press: transient overlay → conversation → focus → nothing
      if (state.mode === 'focus') return reduceWorkspace(state, { type: 'exit_focus' });
      if (state.transientId) return { ...state, transientId: null };
      if (state.mode === 'conversation') return { ...state, mode: 'assisted', restoreMode: 'assisted' };
      if (state.railOpen) return { ...state, railOpen: false };
      return state;
    case 'set_overlay':
      return { ...state, overlay: action.level };
    case 'cycle_overlay':
      return { ...state, overlay: state.overlay === 'visible' ? 'dimmed' : state.overlay === 'dimmed' ? 'hidden' : 'visible' };
    case 'user_message':
      return { ...state, messages: [...state.messages, action.message].slice(-MAX_MESSAGES) };
    case 'assistant_message': {
      const messages = [...state.messages, action.message].slice(-MAX_MESSAGES);
      if (state.mode === 'focus') return { ...state, messages, unseen: state.unseen + 1 };
      if (state.mode === 'assisted') return { ...state, messages, transientId: action.message.id };
      return { ...state, messages };
    }
    case 'dismiss_transient':
      return { ...state, transientId: null };
    case 'return_to_last_response': {
      const last = [...state.messages].reverse().find((m) => m.role !== 'user');
      if (!last) return state;
      const base = state.mode === 'focus' ? { ...state, mode: state.restoreMode } : state;
      return { ...base, transientId: base.mode === 'assisted' ? last.id : null, unseen: 0, overlay: base.overlay === 'hidden' ? 'visible' : base.overlay };
    }
    case 'processing':
      return { ...state, processing: action.value };
    case 'notice':
      return { ...state, notices: [...state.notices.filter((n) => n.id !== action.notice.id), action.notice] };
    case 'clear_notice':
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case 'proposal_state':
      return { ...state, messages: state.messages.map((m) => m.id === action.messageId && m.proposal ? { ...m, proposal: { ...m.proposal, state: action.state } } : m) };
    case 'toggle_rail':
      return state.mode === 'focus' ? state : { ...state, railOpen: !state.railOpen };
  }
}

export type Visibility = {
  rail: 'full' | 'hidden';
  composer: 'compact' | 'expanded' | 'restore_only';
  conversation: boolean;
  transient: Message | null;
  /** Labels, measurements and the Digital Hand label. */
  spatialAnnotations: boolean;
  overlayOpacity: number;
  /** Never hidden by focus or overlay settings. */
  critical: Notice[];
  pendingApprovals: Message[];
  unseen: number;
};

export function visibility(state: WorkspaceState): Visibility {
  const focus = state.mode === 'focus';
  const pendingApprovals = state.messages.filter((m) => m.proposal?.state === 'pending');
  const transient = !focus && state.mode === 'assisted' && state.overlay !== 'hidden' && state.transientId
    ? state.messages.find((m) => m.id === state.transientId) ?? null : null;
  return {
    rail: focus ? 'hidden' : 'full',
    composer: focus ? 'restore_only' : state.mode === 'conversation' ? 'expanded' : 'compact',
    conversation: state.mode === 'conversation',
    transient,
    spatialAnnotations: !focus && state.overlay !== 'hidden',
    overlayOpacity: state.overlay === 'visible' ? 1 : state.overlay === 'dimmed' ? 0.38 : 0,
    critical: state.notices.filter((n) => n.severity === 'critical' || n.severity === 'approval'),
    pendingApprovals,
    unseen: state.unseen,
  };
}
