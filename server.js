const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

let admin = null;
const users = new Map(); // Using a Map to store user WebSocket connections by ID

console.log(`WebSocket server is running on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Client connected.');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received:', message);
            return;
        }

        switch (data.type) {
            case 'admin-init':
                console.log('Admin has connected.');
                admin = ws;
                // Send the list of currently connected users to the admin
                admin.send(JSON.stringify({ type: 'all-users', users: Array.from(users.keys()) }));
                break;

            case 'user-init':
                const userId = uuidv4();
                ws.id = userId; // Assign a unique ID to the user's connection
                users.set(userId, ws);
                console.log(`User connected with ID: ${userId}`);
                // Notify admin if connected
                if (admin && admin.readyState === admin.OPEN) {
                    admin.send(JSON.stringify({ type: 'user-connected', id: userId }));
                }
                break;
                
            case 'message':
                // Message from admin to a specific user
                if (ws === admin) {
                    const recipient = users.get(data.to);
                    if (recipient && recipient.readyState === recipient.OPEN) {
                        recipient.send(JSON.stringify({ type: 'message', text: data.text }));
                    }
                }
                // Message from a user to the admin
                else if (ws.id && users.has(ws.id)) {
                    if (admin && admin.readyState === admin.OPEN) {
                        admin.send(JSON.stringify({
                            type: 'message',
                            from: ws.id,
                            text: data.text
                        }));
                    }
                }
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    });

    ws.on('close', () => {
        if (ws === admin) {
            console.log('Admin disconnected.');
            admin = null;
        } else if (ws.id && users.has(ws.id)) {
            console.log(`User ${ws.id} disconnected.`);
            users.delete(ws.id);
            // Notify admin if connected
            if (admin && admin.readyState === admin.OPEN) {
                admin.send(JSON.stringify({ type: 'user-disconnected', id: ws.id }));
            }
        } else {
            console.log('An unidentified client disconnected.');
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
