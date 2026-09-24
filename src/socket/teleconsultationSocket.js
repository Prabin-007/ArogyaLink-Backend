/**
 * src/socket/teleconsultationSocket.js
 * --------------------------------------
 * All real-time behaviour for the teleconsultation feature:
 *   - WebRTC signaling relay (offer / answer / ICE candidates)
 *   - Room join / leave / disconnect notifications
 *   - Call initiation and termination events
 *   - Optional speech translation relay
 */

const { translateSpeech } = require('../services/bhashiniService');

/**
 * Registers all teleconsultation socket handlers on the given io instance.
 * Call this in src/index.js after creating the HTTP Server.
 *
 * @param {import('socket.io').Server} io
 */
function registerTeleconsultationSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ── Personal room registration ───────────────────────────────────────────
    socket.on('register', ({ userId } = {}) => {
      if (!userId) return;
      socket.data.userId = userId;
      socket.join(`user_${userId}`);
      console.log(`[Socket] ${socket.id} registered as user_${userId}`);
    });

    // ── WebRTC room join ─────────────────────────────────────────────────────
    socket.on('join-room', ({ roomId, userId, role } = {}) => {
      if (!roomId) return;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userId = userId;
      socket.data.role   = role;
      socket.to(roomId).emit('user-joined', { userId, role, socketId: socket.id });

      try {
        const room = io?.sockets?.adapter?.rooms?.get?.(roomId);
        if (room && room.size > 1) {
          socket.emit('peer-already-in-room', { peerCount: room.size });
        }
      } catch (err) {
        // adapter may be absent in test mocks
      }

      console.log(`[Socket] ${socket.id} (${role}) joined room ${roomId}`);
    });

    // ── WebRTC signaling relay ────────────────────────────────────────────────
    socket.on('offer', ({ roomId, offer } = {}) => {
      socket.to(roomId).emit('offer', { offer, from: socket.id });
    });

    socket.on('answer', ({ roomId, answer } = {}) => {
      socket.to(roomId).emit('answer', { answer, from: socket.id });
    });

    socket.on('ice-candidate', ({ roomId, candidate } = {}) => {
      socket.to(roomId).emit('ice-candidate', { candidate, from: socket.id });
    });

    // ── Speech translation relay (optional Bhashini layer) ────────────────────
    socket.on('patient_speech_chunk', async (payload = {}) => {
      const { roomId, audioBase64, sourceLanguage, targetLanguage } = payload;

      if (!roomId || !audioBase64) {
        socket.emit('translation-error', { message: 'Missing roomId or audioBase64' });
        return;
      }

      try {
        const result = await translateSpeech({ audioBase64, sourceLanguage, targetLanguage });

        io.to(roomId).emit('translated_audio_response', {
          recognizedText:  result.recognizedText,
          translatedText:  result.translatedText,
          audioContent:    result.audioContent,
          sourceLanguage,
          targetLanguage,
        });
      } catch (err) {
        console.error('[Socket] Translation pipeline error:', err.message);
        socket.emit('translation-error', { message: 'Translation failed for this audio chunk' });
      }
    });

    // ── Call control ─────────────────────────────────────────────────────────
    socket.on('end-call', ({ roomId } = {}) => {
      if (!roomId) return;
      socket.to(roomId).emit('call-ended', { by: socket.id });
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomId, userId } = socket.data || {};
      if (roomId) {
        socket.to(roomId).emit('user-left', { userId, socketId: socket.id });
      }
      console.log(`[Socket] Disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerTeleconsultationSocket };
