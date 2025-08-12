import { Component, ViewChild, OnDestroy, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgxChessBoardModule, NgxChessBoardView } from 'ngx-chess-board';
import { Chess } from 'chess.js';
import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  get,
  Unsubscribe,
} from 'firebase/database';
import { environment } from '../../../environments/environment';
import { StorageService, STORAGE_KEY } from '../../services/storage.service';

type Turn = 'w' | 'b';
type Role = 'white' | 'black';

interface PlayersDoc {
  white?: { id: string } | null;
  black?: { id: string } | null;
}
interface GameDoc {
  fen: string;
  pgn?: string;
  turn: Turn;
  status?: 'waiting' | 'live' | 'ended';
  winner?: Role;
  players?: PlayersDoc;
}

interface OnlineLocalState {
  code: string; // game code (room id)
  role: Role; // my assigned side
  clientId: string; // tab identity
}

@Component({
  selector: 'app-online-game',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxChessBoardModule],
  templateUrl: './online-game.component.html',
  styleUrls: ['./online-game.component.scss'],
  providers: [
    { provide: STORAGE_KEY, useValue: 'online-game-state' },
    { provide: StorageService, useClass: StorageService<OnlineLocalState> },
  ],
})
export class OnlineGameComponent implements OnDestroy {
  @ViewChild('board', { static: true }) board!: NgxChessBoardView;

  // UI state
  code = '';
  statusText = 'Create a game or join one.';
  overlayVisible = false;
  overlayText = '';
  copied = false;
  private copyTimer: number | null = null;

  // Game state
  private chess = new Chess(); // single source of truth for position/turn
  role: Role | null = null; // assigned role on create/join
  private applyingRemote = false; // true while applying remote updates
  private bothJoined = false; // both player slots filled
  moveDisabled = true; // disables local drags when not allowed

  // Orientation
  private isReversed = false; // track if the board is flipped for black

  // Firebase handles
  private app = initializeApp(environment.firebase);
  private db = getDatabase(this.app);
  private gameRef: ReturnType<typeof ref> | null = null;
  private unsub: Unsubscribe | null = null;

  // Identity
  private clientId = this.ensureClientId();

  // Color-based drag disable
  get darkDisabled(): boolean {
    return this.role === 'white' || this.moveDisabled || this.applyingRemote;
  }
  get lightDisabled(): boolean {
    return this.role === 'black' || this.moveDisabled || this.applyingRemote;
  }

  constructor(
    @Inject(StorageService) private storage: StorageService<OnlineLocalState>,
  ) {
    // Try resuming an unfinished online session from localStorage
    const saved = this.storage.load();
    if (saved?.code && saved?.role && saved?.clientId) {
      this.clientId = saved.clientId;
      this.role = saved.role;
      this.code = saved.code;
      this.attachToGame(saved.code, true);
    }
  }

  ngOnDestroy(): void {
    if (this.unsub) this.unsub(); // stop RTDB listener
  }

  // Host creates a room as White, writes initial game doc, waits for opponent
  async createGame(): Promise<void> {
    if (this.role) return; // already in a game
    this.role = 'white';
    this.code = this.makeCode();
    this.storage.save({
      code: this.code,
      role: this.role,
      clientId: this.clientId,
    });

    this.chess = new Chess(); // fresh start
    this.gameRef = ref(this.db, `games/${this.code}`);

    const fen = this.chess.fen();
    const pgn = this.chess.pgn();

    await set(this.gameRef, <GameDoc>{
      fen,
      pgn,
      turn: 'w',
      status: 'waiting',
      players: { white: { id: this.clientId }, black: null }, // reserve white slot
    });

    this.listenForUpdates(); // start realtime sync
    this.statusText = `Game code: ${this.code} — share it with your friend`;
    this.moveDisabled = true; // block until both joined
    this.isReversed = false; // reset visual state
    this.orientForRole(); // white: no flip
  }

  // Guest joins an existing room, claims an open slot, starts listening
  async joinGame(): Promise<void> {
    if (this.role) return;
    if (!this.code) {
      this.statusText = 'Enter a game code first.';
      return;
    }

    this.gameRef = ref(this.db, `games/${this.code}`);
    const snap = await get(this.gameRef);
    if (!snap.exists()) {
      this.statusText = 'Game not found.';
      this.gameRef = null;
      return;
    }

    const val = snap.val() as GameDoc;
    const players = val.players || {};
    const whiteTaken = !!players.white?.id;
    const blackTaken = !!players.black?.id;

    // Enforce 2-player limit
    if (whiteTaken && blackTaken) {
      this.statusText = 'This game already has two players.';
      this.gameRef = null;
      return;
    }

    // Prefer black when white is already taken
    if (whiteTaken && !blackTaken) {
      this.role = 'black';
      await update(this.gameRef, {
        status: 'live',
        players: { ...players, black: { id: this.clientId } },
      });
    } else if (!whiteTaken) {
      // If white slot is free (host left), allow taking white
      this.role = 'white';
      await update(this.gameRef, {
        status: 'waiting',
        players: { ...players, white: { id: this.clientId } },
      });
    } else {
      this.statusText = 'Unable to join right now.';
      this.gameRef = null;
      return;
    }

    // Persist session locally for refresh-resume
    this.storage.save({
      code: this.code,
      role: this.role,
      clientId: this.clientId,
    });

    this.listenForUpdates();
    this.statusText = `Joined game: ${this.code}`;
    this.moveDisabled = true; // wait for both joined + my turn
    this.isReversed = false;
    this.orientForRole(); // black flips visually
  }

  // Leave the room: free our slot server-side and reset local UI
  async leaveGame(): Promise<void> {
    if (!this.role || !this.gameRef) {
      this.resetLocalUI();
      return;
    }

    const snap = await get(this.gameRef);
    if (snap.exists()) {
      const val = snap.val() as GameDoc;
      const players = val.players || {};
      if (this.role === 'white' && players.white?.id === this.clientId) {
        await update(this.gameRef, {
          players: { ...players, white: null },
          status: 'waiting',
        });
      } else if (this.role === 'black' && players.black?.id === this.clientId) {
        await update(this.gameRef, {
          players: { ...players, black: null },
          status: 'waiting',
        });
      }
    }

    this.resetLocalUI();
  }

  // User dragged a piece: trust board FEN, validate, then write to RTDB
  async onUserMove(): Promise<void> {
    if (this.applyingRemote || !this.gameRef || !this.role) return;
    if (!this.bothJoined || this.moveDisabled) return; // only when both present & my turn

    const fenAfter = this.board.getFEN();

    // Validate position
    try {
      this.chess.load(fenAfter);
    } catch {
      // Revert view to valid state if invalid
      this.applyingRemote = true;
      try {
        this.board.setFEN(this.chess.fen());
        this.isReversed = false;
        this.orientForRole();
      } finally {
        this.applyingRemote = false;
      }
      return;
    }

    const pgn = this.chess.pgn();
    const nextTurn: Turn = this.chess.turn(); // side to move after this move

    // Checkmate: persist winner, freeze boards, show overlay
    if (this.chess.isCheckmate()) {
      const winner: Role = nextTurn === 'w' ? 'black' : 'white';
      await update(this.gameRef, <GameDoc>{
        fen: fenAfter,
        pgn,
        turn: nextTurn,
        status: 'ended',
        winner,
      });
      this.handleGameOver(winner); // also clears local storage
      return;
    }

    // Normal move: write new state
    await update(this.gameRef, <GameDoc>{
      fen: fenAfter,
      pgn,
      turn: nextTurn,
      status: 'live',
    });

    // Optimistic gating until server echo updates myTurn
    this.moveDisabled = true;
  }

  // Subscribe to changes under games/{code} and keep UI in sync
  private listenForUpdates(): void {
    if (!this.gameRef) return;
    if (this.unsub) this.unsub();

    this.unsub = onValue(this.gameRef, (snap) => {
      const val = snap.val() as GameDoc | null;
      if (!val) return;

      // Track presence of both players to enable play
      const players = val.players || {};
      const whitePresent = !!players.white?.id;
      const blackPresent = !!players.black?.id;
      this.bothJoined = whitePresent && blackPresent;

      // Sync board from server; re-apply black orientation if setFEN reset it
      if (val.fen) {
        this.applyingRemote = true;
        try {
          this.board.setFEN(val.fen);
          this.isReversed = false;
          this.orientForRole();
        } finally {
          this.applyingRemote = false;
        }
        try {
          this.chess.load(val.fen);
        } catch {}
      }

      // Turn gating: can move only if both joined and it's my side
      if (this.role) {
        const myTurn =
          (this.role === 'white' && val.turn === 'w') ||
          (this.role === 'black' && val.turn === 'b');
        this.moveDisabled = !this.bothJoined || !myTurn;
      } else {
        this.moveDisabled = true;
      }

      if (val.status === 'ended' && val.winner) {
        this.handleGameOver(val.winner); // also clears storage
      } else if (!this.bothJoined) {
        this.statusText =
          this.role === 'white'
            ? `Game code: ${this.code} — share it with your friend`
            : `Waiting for the host…`;
      } else {
        this.statusText = `Game: ${this.code} — ${val.turn === 'w' ? 'White' : 'Black'} to move`;
      }
    });
  }

  // Attach to an existing game and start listening
  private attachToGame(code: string, resume = false): void {
    this.gameRef = ref(this.db, `games/${code}`);
    if (!resume) return;
    this.listenForUpdates();
    this.isReversed = false;
    this.orientForRole();
    this.statusText = `Resumed game: ${code}`;
  }

  // Keep black facing the player; white stays default
  private orientForRole(): void {
    const shouldBeReversed = this.role === 'black';
    if (shouldBeReversed !== this.isReversed) {
      this.board.reverse();
      this.isReversed = shouldBeReversed;
    }
  }

  // Show winner, freeze UI, and clear local session so refresh returns to default
  private handleGameOver(winner: Role): void {
    this.moveDisabled = true;
    this.overlayText = `${winner.toUpperCase()} wins by checkmate`;
    this.overlayVisible = true;
    this.storage.clear(); // important: drop code/role on game end
  }

  // 6-char shareable room code
  private makeCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  // Generate or reuse a stable client id for this browser tab
  private ensureClientId(): string {
    const existing = (this.storage.load() as OnlineLocalState | null)?.clientId;
    if (existing) return existing;
    const id =
      crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    return id;
  }

  // Reset local UI to the pre-game state (does not delete remote doc)
  private resetLocalUI(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.gameRef = null;
    this.storage.clear();
    this.role = null;
    this.code = '';
    this.statusText = 'Create a game or join one.';
    this.overlayVisible = false;
    this.overlayText = '';
    this.bothJoined = false;
    this.moveDisabled = true;
    this.isReversed = false;
    this.chess = new Chess();
    this.applyingRemote = true;
    try {
      this.board.reset();
    } finally {
      this.applyingRemote = false;
    }
  }

  // Click-to-copy game code
  async copyCode(): Promise<void> {
    if (!this.code) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = this.code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.copied = true;
      if (this.copyTimer) window.clearTimeout(this.copyTimer);
      this.copyTimer = window.setTimeout(() => (this.copied = false), 1200);
    } catch {}
  }
}
