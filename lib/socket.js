// lib/socket.js
import { Server } from 'socket.io';

let _io = null;

/**
 * Initialize Socket.IO once (call from server startup).
 * @param {http.Server} server
 * @param {object} opts optional Server options
 */
export function initSocket(server, opts = { cors: { origin: '*' } }) {
  if (_io) return _io; // already initialized
  _io = new Server(server, opts);

  _io.on('connection', (socket) => {
    console.log('🟢 Socket connected:', socket.id);

    socket.on('join', ({ role, id }) => {
      try {
        if (role === 'superadmin') socket.join(`superadmin:1`);
        else if (role && id) socket.join(`${role}:${id}`);
        socket.emit('joined', { ok: true });
        console.log(`Socket ${socket.id} joined room for ${role}:${id}`);
      } catch (e) { console.warn('join handler error', e.message); }
    });

    socket.on('disconnect', () => {
      console.log('🔴 Socket disconnected:', socket.id);
    });
  });

  return _io;
}

/**
 * Safe getter. Returns null if not initialized.
 */
export function getIO() {
  return _io;
}

/**
 * Backwards-compatible default: object with safe methods.
 * Controllers should use notify() instead of calling this directly,
 * but this keeps old code from crashing if someone does `import io from '../lib/socket.js'`.
 */
const safeDefault = {
  to: (room) => {
    if (!_io) throw new Error('Socket.IO not initialized');
    return _io.to(room);
  },
  emit: (...args) => {
    if (!_io) throw new Error('Socket.IO not initialized');
    return _io.emit(...args);
  }
};

export default safeDefault;
