const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;

// Basic HTTP server for health checks and serving static files
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/healthz') {
        console.log(`[${new Date().toISOString()}] Received keep-alive ping`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
    }

    const fileMap = {
        '/admin': 'admin.html',
        '/user': 'user.html',
    };

    const fileName = fileMap[req.url] || req.url.slice(1);
    if (fileName) {
        const filePath = path.join(__dirname, fileName);
        return fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end('Not found');
            }
            res.writeHead(200);
            res.end(data);
        });
    }

    res.writeHead(404);
    res.end();
});

// WebSocket server mounted on the HTTP server
const wss = new WebSocketServer({ server, path: '/live-chat' });

let admin = null;
const users = new Map(); // id -> { ws, name, ip }

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    console.log('Client connected.', ip);

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
                admin.send(
                    JSON.stringify({
                        type: 'all-users',
                        users: Array.from(users.entries()).map(([id, info]) => ({
                            id,
                            name: info.name,
                            ip: info.ip,
                        })),
                    })
                );
                break;

            case 'user-init':
                const userId = uuidv4();
                ws.id = userId;
                ws.name = data.name || `User-${userId.substring(0, 8)}`;
                ws.ip = ip;
                users.set(userId, { ws, name: ws.name, ip });
                console.log(`User connected with ID: ${userId} (${ws.name}) from ${ip}`);
                if (admin && admin.readyState === admin.OPEN) {
                    admin.send(
                        JSON.stringify({
                            type: 'user-connected',
                            id: userId,
                            name: ws.name,
                            ip,
                        })
                    );
                }
                ws.send(JSON.stringify({ type: 'user-id', id: userId }));
                break;

            case 'rename':
                if (ws.id && users.has(ws.id)) {
                    ws.name = data.name || ws.name;
                    const info = users.get(ws.id);
                    info.name = ws.name;
                    if (admin && admin.readyState === admin.OPEN) {
                        admin.send(
                            JSON.stringify({
                                type: 'user-renamed',
                                id: ws.id,
                                name: ws.name,
                            })
                        );
                    }
                }
                break;

            case 'message':
                if (ws === admin) {
                    const recipient = users.get(data.to)?.ws;
                    if (recipient && recipient.readyState === recipient.OPEN) {
                        recipient.send(
                            JSON.stringify({ type: 'message', text: data.text })
                        );
                    }
                } else if (ws.id && users.has(ws.id)) {
                    if (admin && admin.readyState === admin.OPEN) {
                        admin.send(
                            JSON.stringify({
                                type: 'message',
                                from: ws.id,
                                text: data.text,
                            })
                        );
                    }
                }
                break;

            case 'file':
                if (ws === admin) {
                    const recipient = users.get(data.to)?.ws;
                    if (recipient && recipient.readyState === recipient.OPEN) {
                        recipient.send(
                            JSON.stringify({
                                type: 'file',
                                name: data.name,
                                mime: data.mime,
                                data: data.data,
                            })
                        );
                    }
                } else if (ws.id && users.has(ws.id)) {
                    if (admin && admin.readyState === admin.OPEN) {
                        admin.send(
                            JSON.stringify({
                                type: 'file',
                                from: ws.id,
                                name: data.name,
                                mime: data.mime,
                                data: data.data,
                            })
                        );
                    }
                }
                break;

            case 'ping':
                console.log('Received ping');
                ws.send(JSON.stringify({ type: 'pong' }));
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
            if (admin && admin.readyState === admin.OPEN) {
                admin.send(
                    JSON.stringify({ type: 'user-disconnected', id: ws.id })
                );
            }
        } else {
            console.log('An unidentified client disconnected.');
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Heartbeat to keep connections alive
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
        console.log('Sent ping to client');
    });
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
    console.log(`HTTP/WebSocket server listening on port ${PORT}`);
});

