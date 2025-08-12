import { AfterViewInit, Component, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxChessBoardModule, NgxChessBoardView } from 'ngx-chess-board';
import { Role, WireMessage } from '../../types/messages';

@Component({
  selector: 'app-board-embed',
  standalone: true,
  imports: [CommonModule, NgxChessBoardModule],
  templateUrl: './board-embed.component.html',
  styleUrls: ['./board-embed.component.scss'],
})
export class BoardEmbedComponent implements AfterViewInit, OnDestroy {
  @ViewChild('board', { static: true }) board!: NgxChessBoardView;

  role: Role | null = null; // white or black, assigned by parent
  moveDisabled = true; // true when it's not this side's turn
  private applyingRemote = false; // true while applying SYNC/RESET to avoid echoing
  private isReversed = false; // tracks visual rotation for black

  // Disable drags per side
  get darkDisabled(): boolean {
    return this.role === 'white' || this.moveDisabled || this.applyingRemote;
  }
  get lightDisabled(): boolean {
    return this.role === 'black' || this.moveDisabled || this.applyingRemote;
  }

  ngAfterViewInit(): void {
    // Tell parent we're ready and ask for the current state
    window.parent.postMessage(
      { type: 'IFRAME_READY' } as WireMessage,
      window.location.origin,
    );
    window.parent.postMessage(
      { type: 'REQUEST_SYNC' } as WireMessage,
      window.location.origin,
    );

    // Listen to parent-only messages (role, sync, turn, reset, game over)
    window.addEventListener('message', this.onMessage);
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.onMessage);
  }

  // A local drag finished: report the new FEN to the parent
  onUserMove(): void {
    if (this.applyingRemote) return;
    const fen = this.board.getFEN();
    const msg: WireMessage = { type: 'BOARD_UPDATE', fen };
    window.parent.postMessage(msg, window.location.origin);
  }

  // Handle commands from the parent window
  private onMessage = (event: MessageEvent<WireMessage>) => {
    if (event.origin !== window.location.origin) return; // same-origin guard
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    switch (msg.type) {
      case 'ROLE_ASSIGN':
        // Set my side and orient the board if black
        this.role = msg.role;
        this.ensureOrientation();
        break;

      case 'SYNC_STATE':
        // Mirror the exact board state sent by the parent
        this.applyingRemote = true;
        try {
          this.board.setFEN(msg.fen);
          // setFEN may reset orientation; re-apply if needed
          this.isReversed = false;
          this.ensureOrientation();
        } finally {
          this.applyingRemote = false;
        }
        break;

      case 'TURN':
        // Enable moves only when it's my side to move
        if (!this.role) return;
        const isMyTurn: boolean =
          (this.role === 'white' && msg.turn === 'w') ||
          (this.role === 'black' && msg.turn === 'b');
        this.moveDisabled = !isMyTurn;
        break;

      case 'RESET':
        // Fresh board; keep black orientation after reset
        this.applyingRemote = true;
        try {
          this.board.reset();
        } finally {
          this.applyingRemote = false;
        }
        this.isReversed = false;
        this.ensureOrientation();
        // White starts enabled
        this.moveDisabled = this.role !== 'white';
        break;

      case 'GAME_OVER':
        // Freeze interaction on game end
        this.moveDisabled = true;
        break;
    }
  };

  // Rotate board exactly once if I'm black; no-op for white
  private ensureOrientation(): void {
    const shouldBeReversed = this.role === 'black';
    if (shouldBeReversed !== this.isReversed) {
      this.board.reverse();
      this.isReversed = shouldBeReversed;
    }
  }
}
