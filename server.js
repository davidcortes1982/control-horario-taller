const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir la carpeta 'public' para que se vea la página web en el móvil
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a la Base de Datos SQLite
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite de forma segura.');
        inicializarBaseDeDatos();
    }
});

// Inicializar tablas
function inicializarBaseDeDatos() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            rol TEXT CHECK(rol IN ('operario', 'admin')) NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS naves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            codigo_qr TEXT UNIQUE NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS fichajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            nave_id INTEGER NOT NULL,
            tipo TEXT CHECK(tipo IN ('entrada', 'salida')) NOT NULL,
            timestamp DATETIME DEFAULT (datetime('CURRENT_TIMESTAMP', 'localtime')),
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY(nave_id) REFERENCES naves(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS auditoria_cambios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fichaje_id INTEGER,
            admin_id INTEGER,
            motivo TEXT NOT NULL,
            fecha_modificacion DATETIME DEFAULT (datetime('CURRENT_TIMESTAMP', 'localtime')),
            FOREIGN KEY(admin_id) REFERENCES usuarios(id)
        )`);
    });
}

// ==========================================
// RUTA LEGAL DE FICHAJE (Núcleo de la app)
// ==========================================
app.post('/api/fichar', (req, res) => {
    const { email, password, nave_id, tipo } = req.body;

    if (!email || !password || !nave_id || !tipo) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para el fichaje.' });
    }

    // 1. Buscar al usuario en la base de datos
    db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
        if (err || !usuario) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        // 2. Verificar la contraseña cifrada
        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Contraseña incorrecta.' });
        }

        // 3. Registrar el fichaje utilizando la HORA DEL SERVIDOR (Garantía legal)
        const query = `INSERT INTO fichajes (usuario_id, nave_id, tipo) VALUES (?, ?, ?)`;
        db.run(query, [usuario.id, nave_id, tipo], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al guardar el fichaje en el sistema.' });
            }

            // Consultar la hora exacta asignada por el servidor para mostrársela al usuario
            db.get(`SELECT timestamp FROM fichajes WHERE id = ?`, [this.lastID], (err, row) => {
                const horaRegistro = row ? row.timestamp : 'Justo ahora';
                return res.status(200).json({
                    exito: true,
                    mensaje: `Fichaje de ${tipo.toUpperCase()} registrado correctamente`,
                    hora: horaRegistro
                });
            });
        });
    });
});

// Arrancar el servidor
app.listen(PORT, () => {
    console.log(`Servidor de control horario corriendo en http://localhost:${PORT}`);
});