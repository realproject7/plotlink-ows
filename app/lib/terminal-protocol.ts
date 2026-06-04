// Shared control signals for the terminal WebSocket relay (#453).
//
// The relay normally carries raw PTY bytes both ways. When the server has to
// SPAWN A FRESH agent process for a story (the previous PTY exited / the server
// restarted) and the user asked to resume, that process reprints its own startup
// banner and conversation. The client, meanwhile, has already restored the prior
// session's scrollback from IndexedDB — so the banner would appear twice.
//
// To avoid that, the server sends FRESH_SPAWN_SIGNAL as the FIRST frame on a
// fresh spawn. The client treats only the first frame of a connection as a
// possible control signal: on FRESH_SPAWN_SIGNAL it drops the restored scrollback
// (so just the fresh reprint shows); a live-PTY RECONNECT sends no signal, so the
// client keeps its scrollback (the only copy of the prior output). It is a plain
// ASCII sentinel (no control bytes) that a real PTY never emits as a standalone
// first frame.
export const FRESH_SPAWN_SIGNAL = "__OWS_FRESH_SESSION__";
