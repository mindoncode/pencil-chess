import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chess } from 'chess.js';
import { StorageService, STORAGE_KEY } from '../../services/storage.service';
import { Role, Turn, WireMessage } from '../../types/messages';

type SavedState = { fen: string };

@Component({
  selector: 'app-game-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './game-host.component.html',
  styleUrls: ['./game-host.component.scss'],
  providers: [
    { provide: STORAGE_KEY, useValue: 'offline-game-state' },
    { provide: StorageService, useClass: StorageService },
  ],
})
export class GameHostComponent implements AfterViewInit {
  @ViewChild('frame1', { static: true }) frame1!: ElementRef<HTMLIFrameElement>;
  @ViewChild('frame2', { static: true }) frame2!: ElementRef<HTMLIFrameElement>;

  private chess = new Chess(); // single source of truth for the game
  currentTurnText = '';
  overlayVisible = false;
  overlayText = '';

  private readonly boardSrc = '/embed-board'; // both iframes load same URL
  private readonly origin = window.location.origin; // same-origin postMessage guard

  constructor(private storage: StorageService<SavedState>) {}

  ngAfterViewInit(): void {
    // Load both boards
    this.frame1.nativeElement.src = this.boardSrc;
    this.frame2.nativeElement.src = this.boardSrc;

    // Restore last unfinished game
    const saved = this.storage.load();
    if (saved?.fen) {
      try {
        this.chess.load(saved.fen);
      } catch {}
    }
  }

  // Parent listens for all inter-frame messages
  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent<WireMessage>) {
    if (event.origin !== this.origin) return; // security: ignore cross-origin
    const srcWin = (event.source as Window) ?? null;
    if (!srcWin) return;

    const data = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;

    switch (data.type) {
      case 'IFRAME_READY': {
        // Assign roles to iframe slot
        const role: Role = srcWin === this.window1 ? 'white' : 'black';
        this.postTo(srcWin, { type: 'ROLE_ASSIGN', role }); // tell child its role
        this.syncStateTo(srcWin); // push current FEN
        this.broadcastTurn(); // tell both whose turn
        break;
      }

      case 'REQUEST_SYNC': {
        // Child asked to sync (e.g., on reload)
        this.syncStateTo(srcWin);
        this.broadcastTurn();
        break;
      }

      case 'BOARD_UPDATE': {
        // Only accept moves from the side to move
        const isFromCurrentTurn = srcWin === this.currentTurnWindow();
        if (!isFromCurrentTurn) return;

        // Update state from reported FEN
        try {
          this.chess.load(data.fen);
        } catch {
          return; // ignore invalid positions
        }

        // Persist latest position for refresh-resume
        this.storage.save({ fen: data.fen });

        // Checkmate handling
        if (this.chess.isCheckmate()) {
          const winner: Role = this.chess.turn() === 'w' ? 'black' : 'white';
          const msg: WireMessage = {
            type: 'GAME_OVER',
            winner,
            reason: 'checkmate',
          };
          this.postToBoth(msg);
          this.overlayText = `${winner.toUpperCase()} wins by checkmate`;
          this.overlayVisible = true;
          return;
        }

        // Mirror the move into the other iframe
        this.postTo(this.otherWindow(srcWin), {
          type: 'SYNC_STATE',
          fen: data.fen,
        });

        // Announce next turn to both children
        this.broadcastTurn();
        break;
      }
    }
  }

  // Reset to a fresh game and notify both boards
  newGame(): void {
    this.chess = new Chess();
    this.storage.clear();
    this.overlayVisible = false;
    this.overlayText = '';

    const fen = this.chess.fen();
    this.postToBoth({ type: 'RESET' });
    this.postToBoth({ type: 'SYNC_STATE', fen });
    this.broadcastTurn();
  }

  // Open confirmation overlay
  openOverlay(): void {
    this.overlayText = 'Do you want to reset the game?';
    this.overlayVisible = true;
  }

  // helpers to map iframe elements to windows
  private get window1(): Window | null {
    return this.frame1?.nativeElement?.contentWindow ?? null;
  }
  private get window2(): Window | null {
    return this.frame2?.nativeElement?.contentWindow ?? null;
  }
  private otherWindow(src: Window): Window | null {
    return src === this.window1 ? this.window2 : this.window1;
  }
  private currentTurnWindow(): Window | null {
    return this.chess.turn() === 'w' ? this.window1 : this.window2;
  }

  // Post a message to a specific child
  private postTo(target: Window | null, msg: WireMessage): void {
    if (target) target.postMessage(msg, this.origin);
  }

  // Broadcast to both children
  private postToBoth(msg: WireMessage): void {
    this.postTo(this.window1, msg);
    this.postTo(this.window2, msg);
  }

  // Push current FEN down to a child
  private syncStateTo(target: Window): void {
    this.postTo(target, { type: 'SYNC_STATE', fen: this.chess.fen() });
  }

  // Tell children whose turn it is and update host UI text
  private broadcastTurn(): void {
    const turn: Turn = this.chess.turn();
    this.currentTurnText = turn === 'w' ? 'White to move' : 'Black to move';
    this.postToBoth({ type: 'TURN', turn });
  }
}
