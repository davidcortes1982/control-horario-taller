const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir la carpeta 'public' para que se vea la página web
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

// Inicializar tablas y ubicaciones por defecto
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
            codigo_qr TEXT UNIQUE NOT NULL,
            latitud REAL NOT NULL,
            longitud REAL NOT NULL
        )`, () => {
            // Insertar las ubicaciones automáticamente si la tabla está vacía
            db.get(`SELECT COUNT(*) as count FROM naves`, (err, row) => {
                if (row && row.count === 0) {
                    const stmt = db.prepare(`INSERT INTO naves (nombre, codigo_qr, latitud, longitud) VALUES (?, ?, ?, ?)`);
                    stmt.run('Taller Principal', 'QR_TALLER_001', 36.713519, -4.487414);
                    stmt.run('Cliente Avanza', 'QR_AVANZA_002', 36.696515, -4.490930);
                    stmt.run('Pruebas Casa', 'QR_CASA_003', 36.713756, -4.451451);
                    stmt.finalize();
                    console.log('Ubicaciones iniciales (Taller, Avanza, Casa) añadidas correctamente.');
                }
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS fichajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            nave_id INTEGER NOT NULL,
            tipo TEXT CHECK(tipo IN ('entrada', 'salida')) NOT NULL,
            timestamp DATETIME DEFAULT (datetime('CURRENT_TIMESTAMP', 'localtime')),
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY(nave_id) REFERENCES naves(id)
        )`);
    });
}

// Función para calcular la distancia en metros entre las coordenadas del móvil y el centro de trabajo
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// ==========================================
// RUTA DE FICHAJE CON VALIDACIÓN DE GPS
// ==========================================
app.post('/api/fichar', (req, res) => {
    const { email, password, nave_id, tipo, lat, lon } = req.body;

    if (!email || !password || !nave_id || !tipo || lat === undefined || lon === undefined) {
        return res.status(400).json({ error: 'Faltan datos obligatorios o la ubicación GPS.' });
    }

    // 1. Buscar la nave/centro de trabajo para verificar sus coordenadas
    db.get(`SELECT * FROM naves WHERE id = ?`, [nave_id], (err, nave) => {
        if (err || !nave) {
            return res.status(404).json({ error: 'El centro de trabajo seleccionado no existe.' });
        }

        // 2. Comprobar la distancia (Radio máximo permitido: 150 metros)
        const distancia = calcularDistanciaMetros(lat, lon, nave.latitud, nave.longitud);
        const RADIO_MAXIMO_METROS = 150; 

        if (distancia > RADIO_MAXIMO_METROS) {
            return res.status(403).json({ 
                error: `Estás demasiado lejos del centro de trabajo (${Math.round(distancia)} metros). Acércate para fichar.` 
            });
        }

        // 3. Buscar al usuario en la base de datos
        db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
            if (err || !usuario) {
                return res.status(401).json({ error: 'Credenciales incorrectas.' });
            }

            // 4. Verificar contraseña cifrada
            const passwordMatch = await bcrypt.compare(password, usuario.password);
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Contraseña incorrecta.' });
            }

            // 5. Registrar el fichaje
            const query = `INSERT INTO fichajes (usuario_id, nave_id, tipo) VALUES (?, ?, ?)`;
            db.run(query, [usuario.id, nave_id, tipo], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Error al guardar el fichaje en el sistema.' });
                }

                // Consultar la hora exacta asignada por el servidor
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
});

// Arrancar el servidor
app.listen(PORT, () => {
    console.log(`Servidor de control horario corriendo en el puerto ${PORT}`);
});