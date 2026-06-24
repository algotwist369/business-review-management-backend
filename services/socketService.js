const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../model/user');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Map of userId -> array of socket ids (to support multiple tabs/connections)
const userConnections = new Map();
let ioInstance = null;

const initSocket = (server) => {
    ioInstance = new Server(server, {
        cors: {
            origin: '*', // Adjust to specific frontend domain in production if needed
            methods: ['GET', 'POST'],
        }
    });

    // Connection authentication middleware
    ioInstance.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token || socket.handshake.query?.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.id).select('_id username role is_active is_deleted');
            
            if (!user || user.is_deleted || !user.is_active) {
                return next(new Error('Authentication failed: User deactivated or deleted'));
            }

            socket.user = user;
            next();
        } catch (error) {
            console.error('Socket Auth Error:', error.message);
            return next(new Error('Invalid token'));
        }
    });

    ioInstance.on('connection', (socket) => {
        const userId = socket.user._id.toString();
        
        // Add connection
        if (!userConnections.has(userId)) {
            userConnections.set(userId, []);
        }
        userConnections.get(userId).push(socket.id);
        console.log(`[Socket] User ${userId} connected. Active sockets:`, userConnections.get(userId).length);

        // Forward real-time typing events
        socket.on('typing', ({ recipientId, isTyping }) => {
            if (!recipientId) return;
            const recipientIdStr = recipientId.toString();
            const activeSockets = userConnections.get(recipientIdStr);
            if (activeSockets && activeSockets.length > 0) {
                activeSockets.forEach(socketId => {
                    ioInstance.to(socketId).emit('typing', {
                        senderId: userId,
                        isTyping: !!isTyping
                    });
                });
            }
        });

        // Forward real-time group typing events
        socket.on('group_typing', ({ groupId, isTyping, memberIds }) => {
            if (!groupId || !Array.isArray(memberIds)) return;
            memberIds.forEach(memberId => {
                const memberIdStr = memberId.toString();
                if (memberIdStr === userId) return; // Skip self
                const activeSockets = userConnections.get(memberIdStr);
                if (activeSockets && activeSockets.length > 0) {
                    activeSockets.forEach(socketId => {
                        ioInstance.to(socketId).emit('group_typing', {
                            groupId,
                            senderId: userId,
                            senderName: socket.user.username || 'Someone',
                            isTyping: !!isTyping
                        });
                    });
                }
            });
        });

        socket.on('disconnect', () => {
            if (userConnections.has(userId)) {
                const sockets = userConnections.get(userId).filter(id => id !== socket.id);
                if (sockets.length > 0) {
                    userConnections.set(userId, sockets);
                } else {
                    userConnections.delete(userId);
                }
            }
            console.log(`[Socket] User ${userId} disconnected.`);
        });
    });

    return ioInstance;
};

// Emit real-time notification to a specific user
const sendNotification = (userId, notification) => {
    if (!ioInstance) {
        console.warn('[Socket Warning] socketService not initialized yet');
        return;
    }

    const userIdStr = userId.toString();
    const activeSockets = userConnections.get(userIdStr);

    if (activeSockets && activeSockets.length > 0) {
        activeSockets.forEach(socketId => {
            ioInstance.to(socketId).emit('notification', notification);
        });
        console.log(`[Socket] Sent real-time notification to user: ${userIdStr}`);
    } else {
        console.log(`[Socket] User ${userIdStr} is offline. Notification saved in DB.`);
    }
};

// Emit real-time notification to multiple users
const sendToMultipleUsers = (userIds, notification) => {
    userIds.forEach(userId => {
        if (userId) sendNotification(userId, notification);
    });
};

// Emit real-time chat message to a specific user
const sendChatMessage = (recipientId, chatMessage) => {
    if (!ioInstance) {
        console.warn('[Socket Warning] socketService not initialized yet');
        return;
    }

    const recipientIdStr = recipientId.toString();
    const activeSockets = userConnections.get(recipientIdStr);

    if (activeSockets && activeSockets.length > 0) {
        activeSockets.forEach(socketId => {
            ioInstance.to(socketId).emit('chat_message', chatMessage);
        });
        console.log(`[Socket] Sent real-time chat message to recipient: ${recipientIdStr}`);
    } else {
        console.log(`[Socket] Recipient ${recipientIdStr} is offline.`);
    }
};

// Emit real-time group message to all group members
const sendGroupChatMessage = (memberIds, groupMessage) => {
    if (!ioInstance) {
        console.warn('[Socket Warning] socketService not initialized yet');
        return;
    }

    memberIds.forEach(memberId => {
        const memberIdStr = memberId.toString();
        const activeSockets = userConnections.get(memberIdStr);
        if (activeSockets && activeSockets.length > 0) {
            activeSockets.forEach(socketId => {
                ioInstance.to(socketId).emit('group_message', groupMessage);
            });
        }
    });
};

// Emit real-time group created event to all members
const sendGroupCreated = (memberIds, group) => {
    if (!ioInstance) return;
    memberIds.forEach(memberId => {
        const memberIdStr = memberId.toString();
        const activeSockets = userConnections.get(memberIdStr);
        if (activeSockets && activeSockets.length > 0) {
            activeSockets.forEach(socketId => {
                ioInstance.to(socketId).emit('group_created', group);
            });
        }
    });
};

// Emit real-time group updated event to all members
const sendGroupUpdated = (memberIds, group) => {
    if (!ioInstance) return;
    memberIds.forEach(memberId => {
        const memberIdStr = memberId.toString();
        const activeSockets = userConnections.get(memberIdStr);
        if (activeSockets && activeSockets.length > 0) {
            activeSockets.forEach(socketId => {
                ioInstance.to(socketId).emit('group_updated', group);
            });
        }
    });
};

// Emit real-time group deleted event to all members
const sendGroupDeleted = (memberIds, groupId) => {
    if (!ioInstance) return;
    memberIds.forEach(memberId => {
        const memberIdStr = memberId.toString();
        const activeSockets = userConnections.get(memberIdStr);
        if (activeSockets && activeSockets.length > 0) {
            activeSockets.forEach(socketId => {
                ioInstance.to(socketId).emit('group_deleted', { groupId });
            });
        }
    });
};

module.exports = {
    initSocket,
    sendNotification,
    sendToMultipleUsers,
    sendChatMessage,
    sendGroupChatMessage,
    sendGroupCreated,
    sendGroupUpdated,
    sendGroupDeleted,
};
