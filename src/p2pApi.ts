import { Peer, DataConnection } from 'peerjs';

// --- Local Storage Helpers ---
export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem('chess_player_id');
  if (!id) {
    id = 'player_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('chess_player_id', id);
  }
  return id;
}

export function getOrCreatePlayerName(): string {
  let name = localStorage.getItem('chess_player_name');
  if (!name) {
    name = 'Player ' + Math.random().toString(36).substring(2, 6).toUpperCase();
    localStorage.setItem('chess_player_name', name);
  }
  return name;
}

export function savePlayerName(name: string) {
  localStorage.setItem('chess_player_name', name);
}

// --- Interfaces ---
export interface GameTimeSettings {
  enabled: boolean;
  baseMinutes: number;
  incrementSeconds: number;
}

export interface GameState {
  id: string;
  fen: string;
  history: string[];
  turn: 'w' | 'b';
  whitePlayerId: string | null;
  whitePlayerName: string | null;
  blackPlayerId: string | null;
  blackPlayerName: string | null;
  timeSettings: GameTimeSettings;
  whiteTimeLeft: number | null; // in ms
  blackTimeLeft: number | null; // in ms
  lastMoveAt: number | null; // Timestamp in milliseconds
  status: 'waiting' | 'active' | 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'resign';
  winner: 'w' | 'b' | null;
  createdAt: number;
}

// --- P2P Orchestration State ---
let activePeer: Peer | null = null;
let activeConnections: DataConnection[] = [];
let activeGameState: GameState | null = null;
let isHost = false;
const listeners = new Set<(state: GameState | null) => void>();

// Helper to notify local listeners
function notifyListeners() {
  const state = activeGameState ? { ...activeGameState } : null;
  listeners.forEach(cb => cb(state));
}

// Helper to broadcast host state to all clients
function broadcastState() {
  if (!isHost || !activeGameState) return;
  const msg = { type: 'STATE', state: activeGameState };
  activeConnections.forEach(conn => {
    if (conn.open) {
      conn.send(msg);
    }
  });
}

// Helper to clean up any old connection state
function cleanupP2P() {
  if (activePeer) {
    try {
      activePeer.destroy();
    } catch (e) {
      console.error(e);
    }
    activePeer = null;
  }
  activeConnections.forEach(conn => {
    try {
      conn.close();
    } catch (e) {
      console.error(e);
    }
  });
  activeConnections = [];
  activeGameState = null;
  isHost = false;
}

// Host connection data receiver handler
function handleHostReceivedData(conn: DataConnection, data: any) {
  if (!activeGameState) return;

  if (data.type === 'JOIN') {
    const { playerId, playerName } = data;

    // Assign to roles
    if (activeGameState.whitePlayerId === playerId) {
      activeGameState.whitePlayerName = playerName;
    } else if (activeGameState.blackPlayerId === playerId) {
      activeGameState.blackPlayerName = playerName;
    } else if (!activeGameState.whitePlayerId) {
      activeGameState.whitePlayerId = playerId;
      activeGameState.whitePlayerName = playerName;
      if (activeGameState.blackPlayerId) {
        activeGameState.status = 'active';
        activeGameState.lastMoveAt = Date.now();
      }
    } else if (!activeGameState.blackPlayerId) {
      activeGameState.blackPlayerId = playerId;
      activeGameState.blackPlayerName = playerName;
      if (activeGameState.whitePlayerId) {
        activeGameState.status = 'active';
        activeGameState.lastMoveAt = Date.now();
      }
    }

    localStorage.setItem(`chess_game_${activeGameState.id}`, JSON.stringify(activeGameState));
    notifyListeners();
    broadcastState();
  } else if (data.type === 'MOVE') {
    const { updates } = data;
    Object.assign(activeGameState, updates);
    localStorage.setItem(`chess_game_${activeGameState.id}`, JSON.stringify(activeGameState));
    notifyListeners();
    broadcastState();
  } else if (data.type === 'RESIGN') {
    const { resigningColor } = data;
    activeGameState.status = 'resign';
    activeGameState.winner = resigningColor === 'w' ? 'b' : 'w';
    localStorage.setItem(`chess_game_${activeGameState.id}`, JSON.stringify(activeGameState));
    notifyListeners();
    broadcastState();
  }
}

// --- Public API Functions ---

export async function createOnlineGame(
  playerId: string, 
  playerName: string,
  preferredColor: 'w' | 'b' | 'random',
  timeSettings: GameTimeSettings
): Promise<string> {
  cleanupP2P();
  isHost = true;

  // Create a clean random 6-character host ID
  const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();

  return new Promise<string>((resolve, reject) => {
    // Connect to the public PeerJS broker server
    const peer = new Peer(gameId, { debug: 1 });
    activePeer = peer;

    peer.on('open', (id) => {
      const assignedColor = preferredColor === 'random' 
        ? (Math.random() > 0.5 ? 'w' : 'b') 
        : preferredColor;

      const isWhite = assignedColor === 'w';
      const baseMs = timeSettings.enabled ? timeSettings.baseMinutes * 60 * 1000 : null;

      activeGameState = {
        id: id,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        history: [],
        turn: 'w',
        whitePlayerId: isWhite ? playerId : null,
        whitePlayerName: isWhite ? playerName : null,
        blackPlayerId: !isWhite ? playerId : null,
        blackPlayerName: !isWhite ? playerName : null,
        timeSettings,
        whiteTimeLeft: baseMs,
        blackTimeLeft: baseMs,
        lastMoveAt: null,
        status: 'waiting',
        winner: null,
        createdAt: Date.now()
      };

      localStorage.setItem(`chess_game_${id}`, JSON.stringify(activeGameState));
      notifyListeners();
      resolve(id);
    });

    peer.on('connection', (conn) => {
      activeConnections.push(conn);
      
      conn.on('data', (data: any) => {
        handleHostReceivedData(conn, data);
      });

      conn.on('close', () => {
        activeConnections = activeConnections.filter(c => c.peer !== conn.peer);
      });
    });

    peer.on('error', (err) => {
      console.error("PeerJS Host Error:", err);
      // Fallback to auto-assigned ID if gameId is unavailable/taken
      if (err.type === 'unavailable-id') {
        const fallbackPeer = new Peer({ debug: 1 });
        activePeer = fallbackPeer;
        
        fallbackPeer.on('open', (id) => {
          const assignedColor = preferredColor === 'random' 
            ? (Math.random() > 0.5 ? 'w' : 'b') 
            : preferredColor;

          const isWhite = assignedColor === 'w';
          const baseMs = timeSettings.enabled ? timeSettings.baseMinutes * 60 * 1000 : null;

          activeGameState = {
            id,
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            history: [],
            turn: 'w',
            whitePlayerId: isWhite ? playerId : null,
            whitePlayerName: isWhite ? playerName : null,
            blackPlayerId: !isWhite ? playerId : null,
            blackPlayerName: !isWhite ? playerName : null,
            timeSettings,
            whiteTimeLeft: baseMs,
            blackTimeLeft: baseMs,
            lastMoveAt: null,
            status: 'waiting',
            winner: null,
            createdAt: Date.now()
          };

          localStorage.setItem(`chess_game_${id}`, JSON.stringify(activeGameState));
          notifyListeners();
          resolve(id);
        });

        fallbackPeer.on('connection', (conn) => {
          activeConnections.push(conn);
          conn.on('data', (data: any) => {
            handleHostReceivedData(conn, data);
          });
          conn.on('close', () => {
            activeConnections = activeConnections.filter(c => c.peer !== conn.peer);
          });
        });

        fallbackPeer.on('error', (fallbackErr) => {
          reject(fallbackErr);
        });
      } else {
        reject(err);
      }
    });
  });
}

export async function joinOnlineGame(
  gameId: string, 
  playerId: string, 
  playerName: string
): Promise<GameState | null> {
  cleanupP2P();
  isHost = false;

  const cleanGameId = gameId.trim().toUpperCase();

  return new Promise<GameState | null>((resolve) => {
    // Check if we already have a saved game state locally that we are the host of (to recover on reload)
    const cachedStateStr = localStorage.getItem(`chess_game_${cleanGameId}`);
    if (cachedStateStr) {
      try {
        const cachedState = JSON.parse(cachedStateStr) as GameState;
        if (cachedState.whitePlayerId === playerId || cachedState.blackPlayerId === playerId) {
          isHost = true;
          activeGameState = cachedState;
          
          const peer = new Peer(cleanGameId, { debug: 1 });
          activePeer = peer;

          peer.on('open', () => {
            notifyListeners();
            resolve(cachedState);
          });

          peer.on('connection', (conn) => {
            activeConnections.push(conn);
            conn.on('data', (data: any) => {
              handleHostReceivedData(conn, data);
            });
            conn.on('close', () => {
              activeConnections = activeConnections.filter(c => c.peer !== conn.peer);
            });
          });
          return;
        }
      } catch (e) {
        console.error("Failed to parse cached game state:", e);
      }
    }

    const peer = new Peer({ debug: 1 });
    activePeer = peer;

    peer.on('open', () => {
      const conn = peer.connect(cleanGameId);
      activeConnections = [conn];

      // Safeguard timeout
      const timeoutId = setTimeout(() => {
        if (!activeGameState) {
          resolve(null);
          cleanupP2P();
        }
      }, 10000);

      conn.on('open', () => {
        conn.send({ type: 'JOIN', playerId, playerName });
      });

      conn.on('data', (data: any) => {
        if (data.type === 'STATE') {
          clearTimeout(timeoutId);
          activeGameState = data.state;
          notifyListeners();
          resolve(activeGameState);
        }
      });

      conn.on('close', () => {
        console.log("P2P Connection closed");
      });

      conn.on('error', (err) => {
        console.error("P2P connection error:", err);
        clearTimeout(timeoutId);
        resolve(null);
      });
    });

    peer.on('error', (err) => {
      console.error("P2P Peer error:", err);
      resolve(null);
    });
  });
}

export async function updateOnlineMove(
  gameId: string,
  updates: {
    fen: string;
    history: string[];
    turn: 'w' | 'b';
    whiteTimeLeft: number | null;
    blackTimeLeft: number | null;
    lastMoveAt: number | null;
    status: GameState['status'];
    winner: 'w' | 'b' | null;
  }
) {
  if (isHost && activeGameState) {
    Object.assign(activeGameState, updates);
    localStorage.setItem(`chess_game_${activeGameState.id}`, JSON.stringify(activeGameState));
    notifyListeners();
    broadcastState();
  } else {
    const conn = activeConnections[0];
    if (conn && conn.open) {
      conn.send({ type: 'MOVE', updates });
    }
  }
}

export async function resignOnlineGame(gameId: string, resigningColor: 'w' | 'b') {
  if (isHost && activeGameState) {
    activeGameState.status = 'resign';
    activeGameState.winner = resigningColor === 'w' ? 'b' : 'w';
    localStorage.setItem(`chess_game_${activeGameState.id}`, JSON.stringify(activeGameState));
    notifyListeners();
    broadcastState();
  } else {
    const conn = activeConnections[0];
    if (conn && conn.open) {
      conn.send({ type: 'RESIGN', resigningColor });
    }
  }
}

export function listenToGame(gameId: string, onUpdate: (state: GameState | null) => void) {
  listeners.add(onUpdate);
  if (activeGameState) {
    onUpdate({ ...activeGameState });
  }

  return () => {
    listeners.delete(onUpdate);
  };
}
