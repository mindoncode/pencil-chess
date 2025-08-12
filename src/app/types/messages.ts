export type Role = 'white' | 'black';
export type Turn = 'w' | 'b';

export type WireMessage =
  | { type: 'IFRAME_READY' }
  | { type: 'ROLE_ASSIGN'; role: Role }
  | { type: 'REQUEST_SYNC' }
  | { type: 'SYNC_STATE'; fen: string; pgn?: string }
  | { type: 'BOARD_UPDATE'; fen: string }
  | { type: 'TURN'; turn: Turn }
  | { type: 'RESET' }
  | { type: 'GAME_OVER'; winner: Role; reason: 'checkmate' };
