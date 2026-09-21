/**
 * src/socket/teleconsultationSocket.js
 * --------------------------------------
 * All real-time behaviour for the teleconsultation feature lives here:
 *   - Push notifications (new request, accepted, rejected)
 *   - WebRTC signaling relay (offer / answer / ICE candidates)
 *   - Optional speech-translation relay via Bhashini
 *
 * Socket.io NEVER carries actual video/audio — WebRTC handles that peer-to-peer.
 * Socket.io only relays small signaling messages and short translated-audio-chunk
 * payloads.
 *
 * This handler is registered on the shared io instance created in src/index.js.
 * The same io instance is also stored via app.set("io", io) so REST route
 * controllers can emit events (e.g., accepting a request pushes the roomId back
 * to the requester without them having to poll).
 *
 * Client-side events to emit:
 *   register              { userId }             → joins personal room user_<userId>
 *   join-room             { roomId, userId, role }
 *   offer                 { roomId, offer }
 *   answer                { roomId, answer }
 *   ice-candidate         { roomId, candidate }
 *   patient_speech_chunk  { roomId, audioBase64, sourceLanguage, targetLanguage }
 *   end-call              { roomId }
 *
 * Server-side events emitted to clients:
 *   new-teleconsultation-request    → doctor's personal room (from controller)
 *   teleconsultation-accepted       → requester's personal room (from controller)
 *   teleconsultation-rejected       → requester's personal room (from controller)
 *   user-joined                     → rest of the room
 *   offer / answer / ice-candidate  → rest of the room (relay)
 *   translated_audio_response       → entire room
 *   translation-error               → sender only
 *   call-ended                      → rest of the room
 *   user-left                       → rest of the room
 */

const { translateSpeech } = require('../services/bhashiniService');

/**
 * Registers all teleconsultation socket handlers on the given io instance.
 * Call this once in src/index.js after creating the Server.
 *
 * @param {import('socket.io').Server} io
 */
function registerTeleconsultationSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ── Personal room registration ───────────────────────────────────────────
    // Every logged-in client calls this with their userId so the server can
    // push notifications to a specific user regardless of which page they're on.
    // The REST controllers access io via app.get("io") and emit to user_<id>.
    socket.on('register', ({ userId } = {}) => {
      if (!userId) return;
      socket.data.userId = userId;
      socket.join(`user_${userId}`);
      console.log(`[Socket] ${socket.id} registered as user_${userId}`);
    });

    // ── WebRTC room join ─────────────────────────────────────────────────────
    // Both the requester and the doctor join the same roomId returned by the
    // accept endpoint. This starts the SDP offer/answer handshake.
    socket.on('join-room', ({ roomId, userId, role } = {}) => {
      if (!roomId) return;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userId = userId;
      socket.data.role   = role;
      // Let the other participant know someone joined so they can initiate the
      // WebRTC offer/answer.
      socket.to(roomId).emit('user-joined', { userId, role, socketId: socket.id });
      console.log(`[Socket] ${socket.id} (${role}) joined room ${roomId}`);
    });

    // ── WebRTC signaling relay ────────────────────────────────────────────────
    // These are pass-through relays — the server never inspects SDP/ICE content.
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
    // The patient/ASHA side sends ~3s base64 audio chunks. We run them through
    // Bhashini (ASR → NMT → TTS) and push the translated result to everyone
    // else in the room (the doctor/specialist side).
    //
    // With USE_MOCK_BHASHINI=true this works without real Bhashini credentials,
    // returning a canned phrase so the full UI can be demoed end-to-end.
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
          audioContent:    result.audioContent,  // null in mock mode
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
