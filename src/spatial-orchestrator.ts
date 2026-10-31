import type { SpatialAction } from './spatial-command';

export type OrchestratorState = 'IDLE' | 'EXECUTING' | 'PENDING' | 'CANCELLED' | 'ERROR';

export interface SpatialActionPorts {
  focus(componentId: Extract<SpatialAction, { kind: 'focus' }>['componentId']): void;
  fit(): void;
  home(): void;
  explode(): void;
  reassemble(): void;
  updateLength(action: Extract<SpatialAction, { kind: 'update_length' }>): Promise<boolean>;
  cancelPending(): void;
  onStateChange?(state: OrchestratorState): void;
}

export class SpatialActionOrchestrator {
  private sequence = 0;
  private stateValue: OrchestratorState = 'IDLE';

  constructor(private readonly ports: SpatialActionPorts) {}

  get state(): OrchestratorState {
    return this.stateValue;
  }

  dispatch(action: SpatialAction): Promise<boolean> {
    this.terminateCurrent();
    const sequence = ++this.sequence;
    this.setState(action.kind === 'update_length' ? 'PENDING' : 'EXECUTING');

    if (action.kind === 'update_length') {
      return this.ports.updateLength(action).then((success) => {
        if (sequence !== this.sequence) return false;
        this.setState(success ? 'IDLE' : 'ERROR');
        return success;
      }).catch(() => {
        if (sequence === this.sequence) this.setState('ERROR');
        return false;
      });
    }

    switch (action.kind) {
      case 'focus': this.ports.focus(action.componentId); break;
      case 'fit': this.ports.fit(); break;
      case 'home': this.ports.home(); break;
      case 'explode': this.ports.explode(); break;
      case 'reassemble': this.ports.reassemble(); break;
    }
    if (sequence === this.sequence) this.setState('IDLE');
    return Promise.resolve(true);
  }

  cancel(): void {
    this.terminateCurrent();
    this.sequence += 1;
    this.setState('CANCELLED');
  }

  private terminateCurrent(): void {
    if (this.stateValue === 'PENDING') this.ports.cancelPending();
  }

  private setState(state: OrchestratorState): void {
    this.stateValue = state;
    this.ports.onStateChange?.(state);
  }
}
