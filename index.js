import { Server } from "socket.io";
import http from "http";
import express from "express";
import axios from "axios"; // Para guardar en Laravel

const app = express();
const API_URL = process.env.API_URL || "http://localhost:8000";
const PORT = process.env.PORT || 3001;

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://rifaneon.netlify.app",
        methods: ["GET", "POST"],
    }
});

// Almacén temporal de mensajes (solo memoria, opcional)
let messages = [];





io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No autorizado"));

    try {
        const res = await axios.get(`${API_URL}/api/user`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        socket.user = res.data; // Guardas datos del usuario
        next();
    } catch {
        next(new Error("Token inválido"));
    }
});




// Configuración de seguridad
const userMessageCount = {};
const forbiddenWords = ["mierda", "estafa", "casinoXXX"]; // ⚡ añade más
const allowedDomains = ["rifaneon.netlify.app", "rifaneon.alwaysdata.net"];

function sanitizeMessage(text) {
    let clean = text;
    forbiddenWords.forEach(word => {
        const regex = new RegExp(word, "gi");
        clean = clean.replace(regex, "***");
    });
    return clean;
}

io.on('connection', (socket) => {
    console.log('Cliente conectado', socket.id);

    // Enviar historial de mensajes
    socket.emit('chat:init', messages);

    socket.on('chat:message', async (msg) => {
        const userId = socket.user?.id || socket.id;
        const now = Date.now();

        // 1. Anti-flood: registrar timestamps
        if (!userMessageCount[userId]) {
            userMessageCount[userId] = [];
        }
        userMessageCount[userId] = userMessageCount[userId].filter(ts => now - ts < 30000);
        userMessageCount[userId].push(now);

        if (userMessageCount[userId].length > 5) {
            if (!socket.user) {
                console.warn('⚠️ socket.user no está definido');
            }
            console.log('V')
            io.emit('chat:warning', "🚫 C.");
            return;
        }

        // 2. Filtrar texto ofensivo
        msg.text = sanitizeMessage(msg.text);

        // 3. Bloqueo de links externos
        if (/https?:\/\//i.test(msg.text)) {
            let permitido = allowedDomains.some(domain => msg.text.includes(domain));
            if (!permitido) {
                socket.emit('chat:warning', "🚫 No puedes enviar enlaces externos.");
                return;
            }
        }

        // 4. Guardar mensaje en memoria
        messages.push(msg);
        if (messages.length > 50) messages.shift();

        // 5. Difundir mensaje limpio a todos
        io.emit('chat:message', msg);
        console.log('Mensaje emitido a todos los clientes', msg);

        // 6. Guardar en Laravel
        try {
            await axios.post(`${API_URL}/api/chat/messages`, msg, {
                headers: {
                    Authorization: `Bearer ${msg.token}` // si usas auth
                }
            });
        } catch (error) {
            console.error('Error guardando mensaje en Laravel:', error.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado', socket.id);
    });
});


// Endpoint para que Laravel envíe eventos
app.post('/emit', (req, res) => {
    const { event, data } = req.body;
    console.log(`Evento recibido de Laravel: ${event}`, data);
    io.emit(event, data);
    res.send({ success: true });
});


// Mostrar estado en la raíz "/"
app.get("/", (req, res) => {
    const connectedClients = Array.from(io.sockets.sockets.values());

    let html = `
      <html>
        <head>
          <title>Estado del Servidor</title>
          <meta http-equiv="refresh" content="5"> <!-- refrescar cada 5s -->
          <style>
            body { font-family: Arial; background: #111; color: #eee; padding: 20px; }
            h1 { color: #0ff; }
            table { border-collapse: collapse; width: 100%; margin-top: 20px; }
            td, th { border: 1px solid #444; padding: 8px; text-align: left; }
            tr:nth-child(even) { background: #222; }
          </style>
        </head>
        <body>
          <h1>📡 Estado del Servidor Socket.IO</h1>
          <p><strong>Uptime:</strong> ${process.uptime().toFixed(0)} segundos</p>
          <p><strong>Clientes conectados:</strong> ${io.engine.clientsCount}</p>
          <p><strong>Mensajes en buffer:</strong> ${messages.length}</p>
          <h2>Clientes</h2>
          <table>
            <tr><th>ID</th><th>Usuario</th></tr>
            ${connectedClients.map(c =>
        `<tr><td>${c.id}</td><td>${c.user ? JSON.stringify(c.user) : 'Anónimo'}</td></tr>`
    ).join("")}
          </table>
        </body>
      </html>
    `;
    res.send(html);
});



server.listen(PORT, () => {
    console.log(`Servidor Socket.IO corriendo en http://localhost:${PORT}`);
});