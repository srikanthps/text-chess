import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Chess, Move } from 'chess.js';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  RotateCcw, 
  ChevronRight, 
  AlertCircle, 
  History, 
  Keyboard,
  Info,
  Link,
  Copy,
  Check,
  User,
  Users,
  Timer,
  Sliders,
  Settings,
  Share2,
  ArrowRight,
  UserCheck,
  Flag,
  Globe,
  Home,
  RefreshCw,
  Eye,
  Crown
} from 'lucide-react';
import { cn } from './lib/utils';
import { 
  createOnlineGame, 
  joinOnlineGame, 
  updateOnlineMove, 
  listenToGame, 
  resignOnlineGame,
  getOrCreatePlayerId, 
  getOrCreatePlayerName, 
  savePlayerName,
  GameState,
  GameTimeSettings
} from './p2pApi';

// --- Types & Constants ---
type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Color = 'w' | 'b';

interface ChessPieceProps {
  type: PieceType;
  color: Color;
}

// --- Audio Synthesis for Custom Premium Sound Effects ---
function playChessSound(isCapture = false, isCheck = false) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (isCheck) {
      // Sharp alerting high-to-low note
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (isCapture) {
      // Crisp snappier click
      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      // Soft wooden landing thump
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) {
    // browser auto-play policy blocker
  }
}

// --- Piece Icon Component ---
const PieceIcon: React.FC<ChessPieceProps> = ({ type, color }) => {
  const baseUrl = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/merida';
  const pieceMap: Record<PieceType, string> = {
    p: 'P',
    n: 'N',
    b: 'B',
    r: 'R',
    q: 'Q',
    k: 'K'
  };
  const colorPrefix = color === 'w' ? 'w' : 'b';
  const src = `${baseUrl}/${colorPrefix}${pieceMap[type]}.svg`;

  return (
    <img 
      src={src} 
      alt={`${color === 'w' ? 'White' : 'Black'} ${type}`}
      className="w-full h-full select-none pointer-events-none"
      referrerPolicy="no-referrer"
    />
  );
};

// --- Time Formatter Component ---
const ChessTimer: React.FC<{ 
  timeLeft: number | null; 
  active: boolean; 
  label: string; 
  playerName: string;
  isOnlinePlayer: boolean;
}> = ({ timeLeft, active, label, playerName, isOnlinePlayer }) => {
  if (timeLeft === null) return null;

  const secondsTotal = Math.ceil(timeLeft / 1000);
  const minutes = Math.floor(Math.max(0, secondsTotal) / 60);
  const seconds = Math.max(0, secondsTotal) % 60;
  
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const isLowTime = timeLeft < 20000; // < 20 seconds remaining

  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-xl transition-all border",
      active 
        ? isLowTime 
          ? "bg-red-500/15 border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.2)] text-red-400" 
          : "bg-blue-500/10 border-blue-500/35 text-blue-300"
        : "bg-[#1f1d1a]/80 border-white/5 text-zinc-400"
    )}>
      <div className="flex items-center gap-2">
        <Timer className={cn("w-4 h-4", active && "animate-pulse")} />
        <div className="text-sm font-medium truncate max-w-[120px]">
          {playerName} {isOnlinePlayer && <span className="text-[10px] text-blue-400 font-mono">(You)</span>}
        </div>
      </div>
      <div className={cn(
        "font-mono text-lg font-bold tabular-nums",
        active && "scale-105 transition-transform"
      )}>
        {formattedTime}
      </div>
    </div>
  );
};

export default function App() {
  // Game Setup States
  const [viewMode, setViewMode] = useState<'menu' | 'local' | 'online'>('menu');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameIdInput, setGameIdInput] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [pendingJoinGameId, setPendingJoinGameId] = useState<string | null>(null);

  // Preferred Color for Online game creation
  const [preferredColor, setPreferredColor] = useState<'w' | 'b' | 'random'>('random');

  // Time Setup States
  const [timeControl, setTimeControl] = useState<'none' | '5m' | '10m' | 'custom'>('10m');
  const [customMinutes, setCustomMinutes] = useState(15);
  const [customIncrement, setCustomIncrement] = useState(10);

  // Play Logic States (Local & Online)
  const [localGame, setLocalGame] = useState(() => new Chess());
  const [onlineGameData, setOnlineGameData] = useState<GameState | null>(null);
  
  // Game Input and Highlights
  const [moveInput, setMoveInput] = useState('');
  const [previewMove, setPreviewMove] = useState<Move | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local Timers Remaining
  const [localTimes, setLocalTimes] = useState<{ w: number; b: number }>({ w: 600000, b: 600000 });
  const [localLastMoveAt, setLocalLastMoveAt] = useState<number | null>(null);
  const [localStatus, setLocalStatus] = useState<'waiting' | 'active' | 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'resign'>('active');
  const [localWinner, setLocalWinner] = useState<'w' | 'b' | null>(null);

  // Keep track of real-time timer ticking values
  const [tickerTimes, setTickerTimes] = useState<{ w: number | null; b: number | null }>({ w: null, b: null });

  // Refs for tracking active listener subscription
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Parse URL on load for shareable link join capability
  useEffect(() => {
    const id = getOrCreatePlayerId();
    const name = getOrCreatePlayerName();
    setPlayerId(id);
    setPlayerName(name);

    const params = new URLSearchParams(window.location.search);
    const urlGameId = params.get('gameId');
    if (urlGameId) {
      setPendingJoinGameId(urlGameId.toUpperCase());
    }

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  // Compute final configurations for setup
  const timeSettingsObj = useMemo<GameTimeSettings>(() => {
    switch (timeControl) {
      case 'none':
        return { enabled: false, baseMinutes: 0, incrementSeconds: 0 };
      case '5m':
        return { enabled: true, baseMinutes: 5, incrementSeconds: 0 };
      case '10m':
        return { enabled: true, baseMinutes: 10, incrementSeconds: 0 };
      case 'custom':
        return { enabled: true, baseMinutes: Number(customMinutes), incrementSeconds: Number(customIncrement) };
    }
  }, [timeControl, customMinutes, customIncrement]);

  // Determine current player's color orientation in online session
  const playerColor = useMemo<'w' | 'b' | 'spectator'>(() => {
    if (!onlineGameData) return 'w';
    if (onlineGameData.whitePlayerId === playerId) return 'w';
    if (onlineGameData.blackPlayerId === playerId) return 'b';
    return 'spectator';
  }, [onlineGameData, playerId]);

  // Sync Ticker Times from either onlineState or localState
  useEffect(() => {
    if (viewMode === 'online' && onlineGameData) {
      setTickerTimes({
        w: onlineGameData.whiteTimeLeft,
        b: onlineGameData.blackTimeLeft
      });
    } else if (viewMode === 'local') {
      setTickerTimes({
        w: timeSettingsObj.enabled ? localTimes.w : null,
        b: timeSettingsObj.enabled ? localTimes.b : null
      });
    } else {
      setTickerTimes({ w: null, b: null });
    }
  }, [viewMode, onlineGameData, localTimes, timeSettingsObj]);

  // Live Timer Ticker Engine (Interval ticks every 100ms)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const isActive = viewMode === 'online' 
      ? onlineGameData?.status === 'active' && onlineGameData.timeSettings.enabled
      : viewMode === 'local' && localStatus === 'active' && timeSettingsObj.enabled;

    if (isActive) {
      interval = setInterval(() => {
        if (viewMode === 'online' && onlineGameData && onlineGameData.lastMoveAt) {
          const elapsed = Date.now() - onlineGameData.lastMoveAt;
          const currentTurn = onlineGameData.turn;
          
          setTickerTimes(prev => {
            const nextTimes = { ...prev };
            if (currentTurn === 'w' && onlineGameData.whiteTimeLeft !== null) {
              nextTimes.w = Math.max(0, onlineGameData.whiteTimeLeft - elapsed);
            } else if (currentTurn === 'b' && onlineGameData.blackTimeLeft !== null) {
              nextTimes.b = Math.max(0, onlineGameData.blackTimeLeft - elapsed);
            }
            
            // Check for potential timeout
            if (currentTurn === 'w' && nextTimes.w !== null && nextTimes.w <= 0) {
              handleOnlineTimeout('w');
            } else if (currentTurn === 'b' && nextTimes.b !== null && nextTimes.b <= 0) {
              handleOnlineTimeout('b');
            }

            return nextTimes;
          });
        } else if (viewMode === 'local' && localLastMoveAt) {
          const elapsed = Date.now() - localLastMoveAt;
          const currentTurn = localGame.turn();

          setLocalTimes(prev => {
            const nextTimes = { ...prev };
            if (currentTurn === 'w') {
              nextTimes.w = Math.max(0, prev.w - (Date.now() - (localLastMoveAt || Date.now())));
            } else {
              nextTimes.b = Math.max(0, prev.b - (Date.now() - (localLastMoveAt || Date.now())));
            }

            // check timeout
            if (nextTimes.w <= 0) {
              setLocalStatus('timeout');
              setLocalWinner('b');
              playChessSound(false, true);
            } else if (nextTimes.b <= 0) {
              setLocalStatus('timeout');
              setLocalWinner('w');
              playChessSound(false, true);
            }

            return nextTimes;
          });
          setLocalLastMoveAt(Date.now());
        }
      }, 100);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [viewMode, onlineGameData, localStatus, localLastMoveAt, localGame]);

  const handleOnlineTimeout = async (timedOutColor: 'w' | 'b') => {
    if (!onlineGameData) return;
    // Only the player who is active or whose timer is correct should update timeout to avoid double writes
    if (onlineGameData.status === 'active') {
      await updateOnlineMove(onlineGameData.id, {
        fen: onlineGameData.fen,
        history: onlineGameData.history,
        turn: onlineGameData.turn,
        whiteTimeLeft: timedOutColor === 'w' ? 0 : onlineGameData.whiteTimeLeft,
        blackTimeLeft: timedOutColor === 'b' ? 0 : onlineGameData.blackTimeLeft,
        lastMoveAt: Date.now(),
        status: 'timeout',
        winner: timedOutColor === 'w' ? 'b' : 'w'
      });
    }
  };

  // Create Online Session
  const handleCreateOnlineGame = async () => {
    if (!playerName.trim()) {
      setError("Please choose a nickname first.");
      return;
    }
    savePlayerName(playerName);
    setError(null);
    try {
      const gId = await createOnlineGame(playerId, playerName, preferredColor, timeSettingsObj);
      handleJoinGameById(gId, playerId, playerName);
    } catch (e) {
      setError("Failed to create online match.");
    }
  };

  // Join Existing Online Session
  const handleJoinGameById = async (targetId: string, currentId: string, currentName: string): Promise<boolean> => {
    const idToUse = currentId || playerId;
    const nameToUse = currentName || playerName;
    if (!targetId.trim()) {
      setError("Please enter a valid game code.");
      return false;
    }
    if (!nameToUse.trim()) {
      setError("Please enter a name to join.");
      return false;
    }
    savePlayerName(nameToUse);
    setError(null);
    try {
      const activeState = await joinOnlineGame(targetId.trim().toUpperCase(), idToUse, nameToUse);
      if (activeState) {
        // Update URL to make it shareable
        const url = new URL(window.location.href);
        url.searchParams.set('gameId', activeState.id);
        window.history.pushState({}, '', url.toString());

        setViewMode('online');
        setGameIdInput('');

        // Listen for realtime updates
        if (unsubscribeRef.current) unsubscribeRef.current();
        unsubscribeRef.current = listenToGame(activeState.id, (state) => {
          if (state) {
            setOnlineGameData(state);
            // Trigger move click sounds when history grows
            if (onlineGameData && state.history.length > onlineGameData.history.length) {
              const gameObj = new Chess(state.fen);
              const isCheck = gameObj.inCheck();
              const lastMove = state.history[state.history.length - 1];
              const isCapture = lastMove.includes('x');
              playChessSound(isCapture, isCheck);
            }
          } else {
            setError("Online game no longer exists.");
            setViewMode('menu');
          }
        });
        return true;
      } else {
        setError("Match room not found.");
        return false;
      }
    } catch (e) {
      setError("Connection error. Could not join match room.");
      return false;
    }
  };

  // Start Local Match
  const handleStartLocalGame = () => {
    setError(null);
    const newG = new Chess();
    setLocalGame(newG);
    setLocalStatus('active');
    setLocalWinner(null);
    if (timeSettingsObj.enabled) {
      const initialMs = timeSettingsObj.baseMinutes * 60 * 1000;
      setLocalTimes({ w: initialMs, b: initialMs });
      setLocalLastMoveAt(Date.now());
    } else {
      setLocalLastMoveAt(null);
    }
    setViewMode('local');
  };

  // Move Submitter (Local or Online)
  const submitMove = async (moveStr: string) => {
    if (!moveStr.trim()) return;

    if (viewMode === 'online') {
      if (!onlineGameData) return;
      if (onlineGameData.status !== 'active') {
        setError("Match has not started or has ended.");
        return;
      }
      if (onlineGameData.turn !== playerColor) {
        setError("It is not your turn!");
        return;
      }

      try {
        const tempG = new Chess(onlineGameData.fen);
        const result = tempG.move(moveStr);

        if (result) {
          setError(null);
          setMoveInput('');
          setPreviewMove(null);

          // Calculate time spent
          let nextWhiteTime = onlineGameData.whiteTimeLeft;
          let nextBlackTime = onlineGameData.blackTimeLeft;
          const now = Date.now();

          if (onlineGameData.timeSettings.enabled && onlineGameData.lastMoveAt) {
            const elapsed = now - onlineGameData.lastMoveAt;
            const inc = onlineGameData.timeSettings.incrementSeconds * 1000;

            if (onlineGameData.turn === 'w' && nextWhiteTime !== null) {
              nextWhiteTime = Math.max(0, nextWhiteTime - elapsed) + inc;
            } else if (onlineGameData.turn === 'b' && nextBlackTime !== null) {
              nextBlackTime = Math.max(0, nextBlackTime - elapsed) + inc;
            }
          }

          // Determine game status
          let status: GameState['status'] = 'active';
          let winner: GameState['winner'] = null;

          if (tempG.isCheckmate()) {
            status = 'checkmate';
            winner = onlineGameData.turn;
          } else if (tempG.isStalemate()) {
            status = 'stalemate';
          } else if (tempG.isDraw()) {
            status = 'draw';
          }

          await updateOnlineMove(onlineGameData.id, {
            fen: tempG.fen(),
            history: tempG.history(),
            turn: tempG.turn(),
            whiteTimeLeft: nextWhiteTime,
            blackTimeLeft: nextBlackTime,
            lastMoveAt: now,
            status,
            winner
          });

          playChessSound(result.captured !== undefined, tempG.inCheck());
        } else {
          setError("Invalid move.");
        }
      } catch (err) {
        setError("Invalid move or notation notation.");
      }
    } else {
      // Local Mode Move Execution
      try {
        const tempG = new Chess(localGame.fen());
        const result = tempG.move(moveStr);

        if (result) {
          setError(null);
          setMoveInput('');
          setPreviewMove(null);

          // Apply local time increment
          if (timeSettingsObj.enabled && localLastMoveAt) {
            const inc = timeSettingsObj.incrementSeconds * 1000;
            setLocalTimes(prev => {
              const currentTurn = localGame.turn();
              if (currentTurn === 'w') {
                return { ...prev, w: prev.w + inc };
              } else {
                return { ...prev, b: prev.b + inc };
              }
            });
          }

          setLocalLastMoveAt(Date.now());
          setLocalGame(tempG);

          if (tempG.isCheckmate()) {
            setLocalStatus('checkmate');
            setLocalWinner(localGame.turn());
          } else if (tempG.isStalemate()) {
            setLocalStatus('stalemate');
          } else if (tempG.isDraw()) {
            setLocalStatus('draw');
          }

          playChessSound(result.captured !== undefined, tempG.inCheck());
        } else {
          setError("Invalid chess move.");
        }
      } catch (err) {
        setError("Invalid notation format.");
      }
    }
  };

  // Notation Input Handler for previews
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMoveInput(val);
    setError(null);

    const activeFen = viewMode === 'online' ? onlineGameData?.fen : localGame.fen();
    if (!activeFen) return;

    if (val.trim().length >= 2) {
      try {
        const tempG = new Chess(activeFen);
        const moves = tempG.moves({ verbose: true });
        const match = moves.find(m => 
          m.san.toLowerCase() === val.toLowerCase() || 
          m.from + m.to === val.toLowerCase()
        );
        setPreviewMove(match || null);
      } catch (e) {
        setPreviewMove(null);
      }
    } else {
      setPreviewMove(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitMove(moveInput);
    }
  };

  const handleResign = async () => {
    if (viewMode === 'online' && onlineGameData) {
      if (confirm("Are you sure you want to resign?")) {
        await resignOnlineGame(onlineGameData.id, playerColor === 'spectator' ? 'w' : playerColor);
      }
    } else {
      if (confirm("Resign match?")) {
        setLocalStatus('resign');
        setLocalWinner(localGame.turn() === 'w' ? 'b' : 'w');
      }
    }
  };

  const handleLeaveGame = () => {
    if (confirm("Return to main lobby?")) {
      if (unsubscribeRef.current) unsubscribeRef.current();
      setViewMode('menu');
      setOnlineGameData(null);
      // clean URL params
      const url = new URL(window.location.href);
      url.searchParams.delete('gameId');
      window.history.pushState({}, '', url.toString());
    }
  };

  const copyShareLink = () => {
    if (!onlineGameData) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?gameId=${onlineGameData.id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Render Chessboard Cells with piece flip rotation for black player orientation
  const renderChessboard = () => {
    const activeFen = viewMode === 'online' ? onlineGameData?.fen : localGame.fen();
    const activeHistory = viewMode === 'online' ? onlineGameData?.history : localGame.history();
    if (!activeFen) return null;

    const gameObj = new Chess(activeFen);
    const boardData = gameObj.board();
    const rows = [];

    // Reverse visual perspective for Black online players
    const isFlipped = viewMode === 'online' && playerColor === 'b';

    for (let index = 0; index < 8; index++) {
      const i = isFlipped ? 7 - index : index;
      const row = [];

      for (let jndex = 0; jndex < 8; jndex++) {
        const j = isFlipped ? 7 - jndex : jndex;
        const squareName = String.fromCharCode(97 + j) + (8 - i);
        const piece = boardData[i][j];

        const isDark = (i + j) % 2 === 1;
        const isPreviewSource = previewMove?.from === squareName;
        const isPreviewDest = previewMove?.to === squareName;

        // Last move highlight
        const lastMove = activeHistory && activeHistory.length > 0 
          ? new Chess(viewMode === 'online' ? undefined : undefined) // we extract verbose
          : null;
        
        // Custom lightweight validation for last move source/destination highlights
        let isLastSource = false;
        let isLastDest = false;
        if (viewMode === 'online' && onlineGameData && onlineGameData.history.length > 0) {
          // In online mode we can use temporary chess to find last squares
          try {
            const histGame = new Chess();
            for (let mIdx = 0; mIdx < onlineGameData.history.length - 1; mIdx++) {
              histGame.move(onlineGameData.history[mIdx]);
            }
            const m = histGame.move(onlineGameData.history[onlineGameData.history.length - 1]);
            isLastSource = m?.from === squareName;
            isLastDest = m?.to === squareName;
          } catch(e){}
        } else if (viewMode === 'local' && localGame.history().length > 0) {
          const historyVerbose = localGame.history({ verbose: true }) as any[];
          const lastM = historyVerbose[historyVerbose.length - 1];
          isLastSource = lastM?.from === squareName;
          isLastDest = lastM?.to === squareName;
        }

        row.push(
          <div 
            key={squareName}
            className={cn(
              "relative aspect-square flex items-center justify-center text-[10px] font-mono transition-all duration-150",
              isDark ? "bg-[#B58863]" : "bg-[#F0D9B5]",
              (isLastSource || isLastDest) && "bg-yellow-500/20 shadow-inner",
              isPreviewSource && "ring-4 ring-inset ring-blue-400/60",
              isPreviewDest && "ring-4 ring-inset ring-green-400/80"
            )}
          >
            {/* Square Coordinate Ranks */}
            {((!isFlipped && j === 0) || (isFlipped && j === 7)) && (
              <span className={cn(
                "absolute top-0.5 left-0.5 font-bold pointer-events-none select-none",
                isDark ? "text-[#F0D9B5]/45" : "text-[#B58863]/65"
              )}>
                {8 - i}
              </span>
            )}
            
            {/* Square Coordinate Files */}
            {((!isFlipped && i === 7) || (isFlipped && i === 0)) && (
              <span className={cn(
                "absolute bottom-0.5 right-0.5 font-bold pointer-events-none select-none",
                isDark ? "text-[#F0D9B5]/45" : "text-[#B58863]/65"
              )}>
                {String.fromCharCode(97 + j)}
              </span>
            )}

            {/* Piece Wrapper with smooth visual feedback */}
            {piece && (
              <motion.div 
                layoutId={`${viewMode}-${piece.type}-${piece.color}-${squareName}`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-[85%] h-[85%] z-10"
              >
                <PieceIcon type={piece.type} color={piece.color} />
              </motion.div>
            )}

            {/* Preview destination circle */}
            {isPreviewDest && !piece && (
              <div className="w-4 h-4 rounded-full bg-green-500/55 animate-ping absolute" />
            )}
            {isPreviewDest && !piece && (
              <div className="w-4 h-4 rounded-full bg-green-400/80 absolute" />
            )}
          </div>
        );
      }
      rows.push(row);
    }
    return rows;
  };

  // Active state variables
  const activeTurn = viewMode === 'online' ? onlineGameData?.turn : localGame.turn();
  const isCheck = viewMode === 'online' ? new Chess(onlineGameData?.fen).inCheck() : localGame.inCheck();
  const isGameOver = viewMode === 'online' 
    ? onlineGameData?.status !== 'waiting' && onlineGameData?.status !== 'active'
    : localStatus !== 'active';

  const gameOverMessage = useMemo(() => {
    if (viewMode === 'online' && onlineGameData) {
      if (onlineGameData.status === 'checkmate') return `Checkmate! ${onlineGameData.winner === 'w' ? 'White' : 'Black'} wins.`;
      if (onlineGameData.status === 'stalemate') return "Stalemate! Game is drawn.";
      if (onlineGameData.status === 'timeout') return `Time out! ${onlineGameData.winner === 'w' ? 'White' : 'Black'} wins.`;
      if (onlineGameData.status === 'resign') return `${onlineGameData.winner === 'b' ? 'White' : 'Black'} resigned. Opponent wins!`;
      if (onlineGameData.status === 'draw') return "Match ended in a draw.";
    } else {
      if (localStatus === 'checkmate') return `Checkmate! ${localWinner === 'w' ? 'White' : 'Black'} wins.`;
      if (localStatus === 'stalemate') return "Stalemate! Game is drawn.";
      if (localStatus === 'timeout') return `Time out! ${localWinner === 'w' ? 'White' : 'Black'} wins.`;
      if (localStatus === 'resign') return `${localWinner === 'b' ? 'White' : 'Black'} resigned. Opponent wins!`;
      if (localStatus === 'draw') return "Match ended in a draw.";
    }
    return "Game Over";
  }, [viewMode, onlineGameData, localStatus, localWinner]);

  return (
    <div className="min-h-screen bg-[#161512] text-[#BABABA] font-sans selection:bg-blue-500/30 overflow-x-hidden">
      
      {/* Header Bar */}
      <nav className="border-b border-white/5 bg-[#1f1d1a]/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2 rounded-xl text-white shadow-md">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white font-display tracking-tight">Grandmaster Text Chess</h1>
              <p className="text-[10px] text-zinc-500 tracking-wider uppercase">Enforced Rules • Realtime multiplayer</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-[#262421] px-3 py-1.5 rounded-xl border border-white/5">
              <User className="w-4 h-4 text-blue-400" />
              <input 
                type="text" 
                value={playerName} 
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  savePlayerName(e.target.value);
                }}
                placeholder="Your Name"
                className="bg-transparent border-none text-xs text-white focus:outline-none w-24 font-medium"
              />
            </div>
            {viewMode !== 'menu' && (
              <button 
                onClick={handleLeaveGame}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-750 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
              >
                <Home className="w-3.5 h-3.5" />
                Lobby
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          
          {/* Main Selection Menu & Lobby */}
          {viewMode === 'menu' && (
            <motion.div 
              key="menu"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start py-6"
            >
              
              {/* Left Column: Create Online Game or Setup Local Game */}
              <div className="space-y-6">
                <div className="bg-[#262421] p-6 rounded-2xl border border-white/5 shadow-xl space-y-6">
                  <div className="flex items-center gap-2.5 text-white font-display border-b border-white/5 pb-3">
                    <Sliders className="w-5 h-5 text-blue-400" />
                    <h2 className="text-xl font-bold">1. Select Game Timing</h2>
                  </div>

                  {/* Pre-defined Timers */}
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setTimeControl('10m')}
                      className={cn(
                        "p-4 rounded-xl border transition-all text-left space-y-1.5",
                        timeControl === '10m' 
                          ? "bg-blue-600/10 border-blue-500 text-blue-300" 
                          : "bg-[#1c1a18] border-white/5 hover:border-white/10 text-zinc-400"
                      )}
                    >
                      <div className="font-bold text-white text-sm">Rapid</div>
                      <div className="text-xs text-zinc-500">10 Minutes (No Inc)</div>
                    </button>

                    <button 
                      onClick={() => setTimeControl('5m')}
                      className={cn(
                        "p-4 rounded-xl border transition-all text-left space-y-1.5",
                        timeControl === '5m' 
                          ? "bg-blue-600/10 border-blue-500 text-blue-300" 
                          : "bg-[#1c1a18] border-white/5 hover:border-white/10 text-zinc-400"
                      )}
                    >
                      <div className="font-bold text-white text-sm">Blitz</div>
                      <div className="text-xs text-zinc-500">5 Minutes (No Inc)</div>
                    </button>

                    <button 
                      onClick={() => setTimeControl('none')}
                      className={cn(
                        "p-4 rounded-xl border transition-all text-left space-y-1.5",
                        timeControl === 'none' 
                          ? "bg-blue-600/10 border-blue-500 text-blue-300" 
                          : "bg-[#1c1a18] border-white/5 hover:border-white/10 text-zinc-400"
                      )}
                    >
                      <div className="font-bold text-white text-sm">Untimed</div>
                      <div className="text-xs text-zinc-500">Casual Pass & Play</div>
                    </button>

                    <button 
                      onClick={() => setTimeControl('custom')}
                      className={cn(
                        "p-4 rounded-xl border transition-all text-left space-y-1.5",
                        timeControl === 'custom' 
                          ? "bg-blue-600/10 border-blue-500 text-blue-300" 
                          : "bg-[#1c1a18] border-white/5 hover:border-white/10 text-zinc-400"
                      )}
                    >
                      <div className="font-bold text-white text-sm">Custom</div>
                      <div className="text-xs text-zinc-500">Manual min/increment</div>
                    </button>
                  </div>

                  {/* Custom Form Display */}
                  <AnimatePresence>
                    {timeControl === 'custom' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-[#1c1a18] p-4 rounded-xl border border-white/5 space-y-4"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs text-zinc-400 font-medium">Minutes per Side</label>
                            <input 
                              type="number" 
                              min="1" 
                              max="180"
                              value={customMinutes}
                              onChange={(e) => setCustomMinutes(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-[#161512] border border-white/5 rounded-lg p-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-zinc-400 font-medium">Increment (seconds)</label>
                            <input 
                              type="number" 
                              min="0" 
                              max="60"
                              value={customIncrement}
                              onChange={(e) => setCustomIncrement(Math.max(0, Number(e.target.value)))}
                              className="w-full bg-[#161512] border border-white/5 rounded-lg p-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Local Action */}
                <button 
                  onClick={handleStartLocalGame}
                  className="w-full bg-[#262421] border border-white/5 hover:border-white/10 p-5 rounded-2xl flex items-center justify-between text-left group transition-all"
                >
                  <div className="space-y-1">
                    <h3 className="font-bold text-white text-base group-hover:text-blue-400 transition-colors">Local Practice Match</h3>
                    <p className="text-xs text-zinc-500">Play local pass-and-play with active checkmate/stalemate validation.</p>
                  </div>
                  <div className="bg-[#1c1a18] p-3 rounded-xl border border-white/5 group-hover:bg-blue-600 transition-all">
                    <ArrowRight className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                  </div>
                </button>
              </div>

              {/* Right Column: Online Remote Play */}
              <div className="space-y-6 bg-[#262421] p-6 rounded-2xl border border-white/5 shadow-xl">
                <div className="flex items-center gap-2.5 text-white font-display border-b border-white/5 pb-3">
                  <Globe className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-xl font-bold">2. Play Online with Friends</h2>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 font-medium">Choose Color Preference</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button 
                        onClick={() => setPreferredColor('w')}
                        className={cn(
                          "py-2 px-3 text-xs rounded-lg border transition-all font-medium",
                          preferredColor === 'w' 
                            ? "bg-white text-black border-white" 
                            : "bg-[#1c1a18] border-white/5 text-zinc-400 hover:border-white/10"
                        )}
                      >
                        White
                      </button>
                      <button 
                        onClick={() => setPreferredColor('random')}
                        className={cn(
                          "py-2 px-3 text-xs rounded-lg border transition-all font-medium",
                          preferredColor === 'random' 
                            ? "bg-indigo-600/15 border-indigo-500 text-indigo-300" 
                            : "bg-[#1c1a18] border-white/5 text-zinc-400 hover:border-white/10"
                        )}
                      >
                        Random
                      </button>
                      <button 
                        onClick={() => setPreferredColor('b')}
                        className={cn(
                          "py-2 px-3 text-xs rounded-lg border transition-all font-medium",
                          preferredColor === 'b' 
                            ? "bg-zinc-800 border-zinc-700 text-zinc-300" 
                            : "bg-[#1c1a18] border-white/5 text-zinc-400 hover:border-white/10"
                        )}
                      >
                        Black
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={handleCreateOnlineGame}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <Users className="w-4 h-4" />
                    Create Shareable Game Room
                  </button>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-white/5"></div>
                    <span className="flex-shrink mx-4 text-[10px] text-zinc-600 uppercase font-bold tracking-wider">or join existing</span>
                    <div className="flex-grow border-t border-white/5"></div>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <input 
                        type="text" 
                        value={gameIdInput}
                        onChange={(e) => setGameIdInput(e.target.value)}
                        placeholder="Enter Game Code (e.g. 7XJKF)"
                        className="w-full bg-[#161512] border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all placeholder:text-zinc-600 uppercase font-mono tracking-wider"
                      />
                    </div>
                    <button 
                      onClick={() => handleJoinGameById(gameIdInput, playerId, playerName)}
                      className="w-full bg-[#1c1a18] hover:bg-[#201d1b] border border-white/5 text-white font-medium py-3 px-4 rounded-xl transition-all text-sm flex items-center justify-center gap-1.5"
                    >
                      <UserCheck className="w-4 h-4 text-zinc-400" />
                      Join Match Room
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/25 p-3.5 rounded-xl flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-400 leading-relaxed font-medium">{error}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Active Gameplay Panel */}
          {viewMode !== 'menu' && (
            <motion.div 
              key="gameplay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 items-start"
            >
              {/* Left Column: Chessboard Board Display */}
              <div className="space-y-6">
                
                {/* Active Match Player Status Bar */}
                <div className="bg-[#262421] p-4 rounded-2xl border border-white/5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      activeTurn === 'w' ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)] animate-pulse" : "bg-zinc-700"
                    )} />
                    <span className={cn("text-xs font-semibold uppercase tracking-wider", activeTurn === 'w' ? "text-white" : "text-zinc-500")}>
                      {viewMode === 'online' ? (onlineGameData?.whitePlayerName || 'Waiting player...') : 'White'}
                    </span>
                    
                    <span className="text-zinc-700">/</span>

                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      activeTurn === 'b' ? "bg-zinc-400 shadow-[0_0_8px_rgba(255,255,255,0.4)] animate-pulse" : "bg-zinc-800"
                    )} />
                    <span className={cn("text-xs font-semibold uppercase tracking-wider", activeTurn === 'b' ? "text-white" : "text-zinc-500")}>
                      {viewMode === 'online' ? (onlineGameData?.blackPlayerName || 'Waiting player...') : 'Black'}
                    </span>
                  </div>

                  {/* Room share action if online and waiting */}
                  {viewMode === 'online' && onlineGameData && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/15">
                        Code: {onlineGameData.id}
                      </span>
                      <button 
                        onClick={copyShareLink}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {isCopied ? 'Copied' : 'Invite Friend'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Main Visual Board Wrapper */}
                <div className="relative aspect-square w-full max-w-[580px] mx-auto shadow-2xl rounded-2xl overflow-hidden border-4 border-[#262421]">
                  <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
                    {renderChessboard()}
                  </div>

                  {/* GameOver Screen Overlay */}
                  <AnimatePresence>
                    {isGameOver && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-30 bg-black/75 backdrop-blur-sm flex items-center justify-center p-8"
                      >
                        <motion.div 
                          initial={{ scale: 0.9, y: 15 }}
                          animate={{ scale: 1, y: 0 }}
                          className="bg-[#262421] p-8 rounded-2xl border border-white/10 text-center max-w-sm w-full shadow-2xl space-y-6"
                        >
                          <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto border border-yellow-500/25">
                            <Trophy className="w-8 h-8 text-yellow-500" />
                          </div>
                          <div className="space-y-2">
                            <h2 className="text-xl font-bold text-white font-display">Match Finished</h2>
                            <p className="text-sm text-zinc-400 leading-relaxed">
                              {gameOverMessage}
                            </p>
                          </div>
                          
                          <div className="space-y-2.5">
                            {viewMode === 'local' ? (
                              <button 
                                onClick={handleStartLocalGame}
                                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all"
                              >
                                Rematch (Local)
                              </button>
                            ) : null}
                            <button 
                              onClick={handleLeaveGame}
                              className="w-full py-2.5 bg-[#1c1a18] hover:bg-[#22201e] text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/5"
                            >
                              Return to Lobby
                            </button>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Bottom status alert alerts */}
                <div className="flex gap-4">
                  {isCheck && !isGameOver && (
                    <div className="flex-1 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3 animate-bounce">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-bold uppercase tracking-wider text-xs">Check! Protect your King</span>
                    </div>
                  )}
                  {viewMode === 'online' && onlineGameData?.status === 'waiting' && (
                    <div className="flex-1 bg-yellow-500/5 border border-yellow-500/15 text-yellow-400 px-4 py-3.5 rounded-xl flex items-center gap-3">
                      <RefreshCw className="w-4 h-4 animate-spin text-yellow-500" />
                      <span className="text-xs font-medium">Waiting for opponent to join using share link...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Active Match Timers, Move Submission Console */}
              <div className="flex flex-col gap-6">
                
                {/* Visual Chess Timers */}
                {((viewMode === 'online' && onlineGameData?.timeSettings.enabled) || 
                  (viewMode === 'local' && timeSettingsObj.enabled)) && (
                  <div className="bg-[#262421] p-4 rounded-2xl border border-white/5 shadow-xl space-y-3">
                    <div className="flex items-center gap-2 text-white/90 text-xs font-bold border-b border-white/5 pb-2">
                      <Timer className="w-3.5 h-3.5 text-blue-400" />
                      <span>Clock Timers</span>
                    </div>

                    <div className="space-y-2.5">
                      {/* Opponent clock (renders black for white, white for black) */}
                      {playerColor === 'b' ? (
                        <ChessTimer 
                          timeLeft={tickerTimes.w} 
                          active={activeTurn === 'w'} 
                          label="White" 
                          playerName={viewMode === 'online' ? (onlineGameData?.whitePlayerName || 'Opponent') : 'White'}
                          isOnlinePlayer={playerColor === 'w'}
                        />
                      ) : (
                        <ChessTimer 
                          timeLeft={tickerTimes.b} 
                          active={activeTurn === 'b'} 
                          label="Black" 
                          playerName={viewMode === 'online' ? (onlineGameData?.blackPlayerName || 'Opponent') : 'Black'}
                          isOnlinePlayer={playerColor === 'b'}
                        />
                      )}

                      {/* Your clock (renders white for white, black for black) */}
                      {playerColor === 'b' ? (
                        <ChessTimer 
                          timeLeft={tickerTimes.b} 
                          active={activeTurn === 'b'} 
                          label="Black" 
                          playerName={viewMode === 'online' ? (onlineGameData?.blackPlayerName || 'You') : 'Black'}
                          isOnlinePlayer={playerColor === 'b'}
                        />
                      ) : (
                        <ChessTimer 
                          timeLeft={tickerTimes.w} 
                          active={activeTurn === 'w'} 
                          label="White" 
                          playerName={viewMode === 'online' ? (onlineGameData?.whitePlayerName || 'You') : 'White'}
                          isOnlinePlayer={playerColor === 'w'}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Move Submission Field */}
                <div className="bg-[#262421] p-5 rounded-2xl border border-white/5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold">
                      <Keyboard className="w-4 h-4 text-blue-400" />
                      <h3 className="text-sm">Submit Text Move</h3>
                    </div>
                    {viewMode === 'online' && (
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded uppercase border",
                        playerColor === 'spectator' 
                          ? "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
                          : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                      )}>
                        {playerColor === 'spectator' ? 'Spectating' : `Playing as ${playerColor === 'w' ? 'White' : 'Black'}`}
                      </span>
                    )}
                  </div>

                  {playerColor === 'spectator' ? (
                    <div className="bg-[#1c1a18] p-3 rounded-xl border border-white/5 text-xs text-zinc-500 flex items-center gap-2">
                      <Eye className="w-4 h-4 text-zinc-400" />
                      <span>You are a spectator. Moves are locked.</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <input 
                        type="text"
                        value={moveInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        disabled={isGameOver || (viewMode === 'online' && onlineGameData?.status === 'waiting')}
                        placeholder="e.g. e4, Nf3, O-O"
                        className={cn(
                          "w-full bg-[#161512] border-2 border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed",
                          error && "border-red-500/40 focus:border-red-500/40",
                          previewMove && "border-green-500/40 focus:border-green-500/40"
                        )}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        {previewMove && (
                          <span className="text-[9px] font-mono font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/15 uppercase">
                            Preview
                          </span>
                        )}
                        <button 
                          onClick={() => submitMove(moveInput)}
                          disabled={isGameOver || (viewMode === 'online' && onlineGameData?.status === 'waiting')}
                          className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors disabled:opacity-50"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {error && (
                    <p className="text-red-400 text-xs flex items-center gap-1.5 px-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {error}
                    </p>
                  )}

                  {/* Resign Action Control */}
                  {!isGameOver && playerColor !== 'spectator' && (
                    <button 
                      onClick={handleResign}
                      className="w-full bg-red-500/5 hover:bg-red-500/10 text-red-400/90 text-xs font-semibold py-2 rounded-xl transition-all border border-red-500/10 flex items-center justify-center gap-1.5"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      Resign Game
                    </button>
                  )}
                </div>

                {/* Move history panel */}
                <div className="bg-[#262421] rounded-2xl border border-white/5 flex flex-col overflow-hidden shadow-xl max-h-[300px]">
                  <div className="p-4 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold">
                      <History className="w-4 h-4 text-zinc-400" />
                      <h3 className="text-sm">Notation Log</h3>
                    </div>
                    <span className="text-xs text-zinc-500 font-mono">
                      {Math.ceil((viewMode === 'online' ? (onlineGameData?.history.length || 0) : localGame.history().length) / 2)} Rounds
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#1c1a18]">
                    {((viewMode === 'online' ? onlineGameData?.history.length : localGame.history().length) || 0) === 0 ? (
                      <div className="h-28 flex flex-col items-center justify-center text-zinc-600 gap-2 opacity-50">
                        <History className="w-6 h-6" />
                        <p className="text-xs">Waiting first move...</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {Array.from({ length: Math.ceil(((viewMode === 'online' ? onlineGameData?.history.length : localGame.history().length) || 0) / 2) }).map((_, i) => {
                          const wMove = viewMode === 'online' ? onlineGameData?.history[i * 2] : localGame.history()[i * 2];
                          const bMove = viewMode === 'online' ? onlineGameData?.history[i * 2 + 1] : localGame.history()[i * 2 + 1];

                          return (
                            <React.Fragment key={i}>
                              <div className="flex items-center gap-2 bg-[#161512] px-3 py-1.5 rounded-lg border border-white/5">
                                <span className="text-[9px] font-bold text-zinc-600 w-4">{i + 1}.</span>
                                <span className="text-xs font-semibold text-white font-mono">{wMove}</span>
                              </div>
                              {bMove && (
                                <div className="flex items-center gap-2 bg-[#161512] px-3 py-1.5 rounded-lg border border-white/5">
                                  <span className="text-[9px] font-bold text-zinc-600 w-4"></span>
                                  <span className="text-xs font-semibold text-white font-mono">{bMove}</span>
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <AnimatePresence>
        {pendingJoinGameId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#262421] max-w-md w-full rounded-2xl border border-white/10 p-6 shadow-2xl space-y-6"
            >
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="bg-indigo-600/10 p-3.5 rounded-2xl border border-indigo-500/20 text-indigo-400">
                  <Globe className="w-8 h-8 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white font-display">Join Online Match</h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    You've been invited to play in room <span className="font-mono font-bold text-indigo-400">{pendingJoinGameId}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400 font-semibold flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                    Enter Your Display Name
                  </label>
                  <input 
                    type="text" 
                    value={playerName}
                    onChange={(e) => {
                      setPlayerName(e.target.value);
                      savePlayerName(e.target.value);
                    }}
                    placeholder="e.g. Magnus, Beth Harmon"
                    className="w-full bg-[#161512] border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all font-medium"
                    autoFocus
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        if (playerName.trim() && pendingJoinGameId) {
                          const success = await handleJoinGameById(pendingJoinGameId, playerId, playerName);
                          if (success) {
                            setPendingJoinGameId(null);
                          }
                        }
                      }
                    }}
                  />
                </div>

                <div className="flex flex-col gap-2.5 pt-2">
                  <button 
                    onClick={async () => {
                      if (!playerName.trim()) {
                        setError("Please enter a display name.");
                        return;
                      }
                      if (pendingJoinGameId) {
                        const success = await handleJoinGameById(pendingJoinGameId, playerId, playerName);
                        if (success) {
                          setPendingJoinGameId(null);
                        }
                      }
                    }}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 rounded-xl transition-all text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4" />
                    Join Match Now
                  </button>

                  <button 
                    onClick={() => {
                      setPendingJoinGameId(null);
                      const url = new URL(window.location.href);
                      url.searchParams.delete('gameId');
                      window.history.pushState({}, '', url.toString());
                    }}
                    className="w-full bg-[#1c1a18] hover:bg-[#22201e] border border-white/5 text-zinc-400 hover:text-zinc-300 font-semibold py-2.5 rounded-xl transition-all text-xs cursor-pointer"
                  >
                    Decline & Go to Menu
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/25 p-3.5 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-400 leading-relaxed font-medium">{error}</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #363430;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #45433f;
        }
      `}</style>
    </div>
  );
}
