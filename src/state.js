const rooms = new Map();
const lockedRooms = new Set();
const waitingRooms = new Set();
const waitingSockets = new Map();
const slideControllers = new Map();
const handRaiseQueues = new Map();
const chatPermissions = new Map();
const screenShareControllers = new Map();
const spotlightQueue = new Map();
const hostKeys = new Map();
const muteOnEntry = new Map();

// Helper to cleanup room maps if empty
function cleanupRoomIfEmpty(roomId, logger) {
  const room = rooms.get(roomId);
  if (!room || room.size > 0) return;
  
  // Aggressively clean up all state maps associated with this room
  rooms.delete(roomId);
  lockedRooms.delete(roomId);
  waitingRooms.delete(roomId);
  slideControllers.delete(roomId);
  handRaiseQueues.delete(roomId);
  chatPermissions.delete(roomId);
  screenShareControllers.delete(roomId);
  spotlightQueue.delete(roomId);
  hostKeys.delete(roomId);
  muteOnEntry.delete(roomId);
  if (logger) logger.info({ roomId }, 'Room cleaned up from memory');
}

function hasModPowers(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const participant = room.get(socketId);
  return participant && (participant.role === 'host' || participant.role === 'cohost');
}

module.exports = {
  rooms,
  lockedRooms,
  waitingRooms,
  waitingSockets,
  slideControllers,
  handRaiseQueues,
  chatPermissions,
  screenShareControllers,
  spotlightQueue,
  hostKeys,
  muteOnEntry,
  cleanupRoomIfEmpty,
  hasModPowers
};
