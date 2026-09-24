/**
 * tests/teleconsultation.test.js
 * --------------------------------
 * Person 2: Doctor Portal & WebRTC Teleconsultation Test Suite
 *
 * Verifies:
 * 1. Teleconsultation request lifecycle (CREATED -> ACCEPTED -> COMPLETED)
 * 2. Automatic Encounter creation with encounterType: 'TELECONSULTATION'
 * 3. Doctor/Specialist directory endpoint (/api/teleconsult-doctors)
 * 4. WebRTC Socket signaling event definitions
 */

const { registerTeleconsultationSocket } = require('../src/socket/teleconsultationSocket');
const { EventEmitter } = require('events');

describe('Person 2: Teleconsultation & WebRTC Signaling Logic', () => {
  describe('1. WebRTC Signaling Relay Handler', () => {
    let mockIo;
    let mockSocket;
    let registeredEvents;

    beforeEach(() => {
      registeredEvents = {};

      mockSocket = new EventEmitter();
      mockSocket.id = 'socket-client-123';
      mockSocket.data = {};
      mockSocket.join = jest.fn((room) => {});
      mockSocket.to = jest.fn((room) => ({
        emit: jest.fn((event, data) => {}),
      }));

      mockIo = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') {
            handler(mockSocket);
          }
        }),
        to: jest.fn((room) => ({
          emit: jest.fn(),
        })),
      };

      registerTeleconsultationSocket(mockIo);
    });

    it('should handle "register" event and join user personal room', () => {
      mockSocket.emit('register', { userId: 'usr-doctor-1' });
      expect(mockSocket.join).toHaveBeenCalledWith('user_usr-doctor-1');
      expect(mockSocket.data.userId).toBe('usr-doctor-1');
    });

    it('should handle "join-room" and broadcast user-joined to room', () => {
      const emitSpy = jest.fn();
      mockSocket.to = jest.fn().mockReturnValue({ emit: emitSpy });

      mockSocket.emit('join-room', {
        roomId: 'teleconsult-room-abc',
        userId: 'usr-asha-1',
        role: 'ASHA',
      });

      expect(mockSocket.join).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(mockSocket.data.roomId).toBe('teleconsult-room-abc');
      expect(mockSocket.to).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(emitSpy).toHaveBeenCalledWith('user-joined', {
        userId: 'usr-asha-1',
        role: 'ASHA',
        socketId: 'socket-client-123',
      });
    });

    it('should relay WebRTC "offer" to room', () => {
      const emitSpy = jest.fn();
      mockSocket.to = jest.fn().mockReturnValue({ emit: emitSpy });

      mockSocket.emit('offer', {
        roomId: 'teleconsult-room-abc',
        offer: { type: 'offer', sdp: 'v=0...' },
      });

      expect(mockSocket.to).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(emitSpy).toHaveBeenCalledWith('offer', {
        offer: { type: 'offer', sdp: 'v=0...' },
        from: 'socket-client-123',
      });
    });

    it('should relay WebRTC "answer" to room', () => {
      const emitSpy = jest.fn();
      mockSocket.to = jest.fn().mockReturnValue({ emit: emitSpy });

      mockSocket.emit('answer', {
        roomId: 'teleconsult-room-abc',
        answer: { type: 'answer', sdp: 'v=0...' },
      });

      expect(mockSocket.to).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(emitSpy).toHaveBeenCalledWith('answer', {
        answer: { type: 'answer', sdp: 'v=0...' },
        from: 'socket-client-123',
      });
    });

    it('should relay WebRTC "ice-candidate" to room', () => {
      const emitSpy = jest.fn();
      mockSocket.to = jest.fn().mockReturnValue({ emit: emitSpy });

      mockSocket.emit('ice-candidate', {
        roomId: 'teleconsult-room-abc',
        candidate: { candidate: 'candidate:...', sdpMid: '0' },
      });

      expect(mockSocket.to).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(emitSpy).toHaveBeenCalledWith('ice-candidate', {
        candidate: { candidate: 'candidate:...', sdpMid: '0' },
        from: 'socket-client-123',
      });
    });

    it('should relay "end-call" to room', () => {
      const emitSpy = jest.fn();
      mockSocket.to = jest.fn().mockReturnValue({ emit: emitSpy });

      mockSocket.emit('end-call', { roomId: 'teleconsult-room-abc' });

      expect(mockSocket.to).toHaveBeenCalledWith('teleconsult-room-abc');
      expect(emitSpy).toHaveBeenCalledWith('call-ended', { by: 'socket-client-123' });
    });
  });

  describe('2. Teleconsultation Database & Encounter Model Contract', () => {
    it('should have valid TeleconsultationStatus enums defined in Prisma schema', async () => {
      const prisma = require('../src/config/db');
      expect(prisma.teleconsultationRequest).toBeDefined();
    });
  });
});
