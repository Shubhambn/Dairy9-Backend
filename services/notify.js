// utils/notify.js
import { getIO } from '../lib/socket.js';

/**
 * notify(reqOrIoOrNull, room, event, payload)
 * - Accepts either `req` (to pull app.get('io')) or `io` instance or null.
 * - If no io available -> logs a fallback message (no throw).
 */
export default function notify(reqOrIo, room, event, payload) {
  let io = null;
  // if they passed req
  try {
    if (reqOrIo && reqOrIo.app && typeof reqOrIo.app.get === 'function') {
      io = reqOrIo.app.get('io') || getIO();
    } else if (reqOrIo && typeof reqOrIo.to === 'function') {
      // they passed io directly
      io = reqOrIo;
    } else {
      io = getIO();
    }
  } catch (e) {
    io = getIO();
  }

  if (!io) {
    console.log(`[NOTIFY - fallback] room=${room} event=${event}`, payload);
    return;
  }

  try {
    io.to(room).emit(event, payload);
  } catch (err) {
    console.warn('notify emit failed', err.message);
  }
}
