const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para leer JSON y servir archivos estáticos de la carpeta "public"
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la Base de Datos SQLite
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error("Error al conectar con la base de datos:", err.message);
    } else {
        console.log("Conectado a la base de datos SQLite.");
    }
});

// Crear tablas si no existen (Usuarios y Fichajes)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        rol TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS fichajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        ubicacion TEXT,
        tipo TEXT,
        latitud REAL,
        longitud REAL,
        fecha TEXT
    )`);
});

// Coordenadas de ejemplo para los centros (puedes ajustarlas según tus necesidades)
const centros = {
    taller: { lat: 36.7213, lon: -4.4214, radio: 0.2 }, // Coordenadas de ejemplo (en km)
    avanza: { lat: 36.7000, lon: -4.4000, radio: 0.2 },
    casa: { lat: 36.7200, lon: -4.4100, radio: 5.0 }   // Radio más amplio para pruebas en casa
};

// ==========================================
// RUTA 1: REGISTRO DE NUEVOS USUARIOS
// ==========================================
app.post('/api/registro', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run("INSERT INTO usuarios (email, password, rol) VALUES (?, ?, ?)", [email, hashedPassword, 'operario'], function(err) {
            if (err) {
                return res.status(400).json({ error: "Este correo ya está registrado." });
            }
            res.json({ success: true, message: "Usuario registrado correctamente." });
        });
    } catch (error) {
        res.status(500).json({ error: "Error interno en el servidor al registrar." });
    }
});

// ==========================================
// RUTA 2: FICHAJE CON GPS Y VALIDACIÓN
// ==========================================
app.post('/api/fichar', (req, res) => {
    const { email, password, ubicacion, tipo, latitud, longitud } = req.body;

    if (!email || !password || !ubicacion || !tipo) {
        return res.status(400).json({ error: "Faltan datos para realizar el fichaje." });
    }

    // Verificar si el usuario existe en la base de datos
    db.get("SELECT * FROM usuarios WHERE email = ?", [email], async (err, usuario) => {
        if (err || !usuario) {
            return res.status(401).json({ error: "Credenciales incorrectas (Usuario no encontrado)." });
        }

        // Comprobar la contraseña
        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Credenciales incorrectas (Contraseña errónea)." });
        }

        // Guardar el fichaje en la base de datos
        const fechaActual = new Date().toISOString();
        db.run(
            "INSERT INTO fichajes (email, ubicacion, tipo, latitud, longitud, fecha) VALUES (?, ?, ?, ?, ?, ?)",
            [email, ubicacion, tipo, latitud, longitud, fechaActual],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: "Error al guardar el fichaje en la base de datos." });
                }
                res.json({ 
                    success: true, 
                    message: `¡Fichaje de ${tipo} registrado con éxito en ${ubicacion} a las ${new Date().toLocaleTimeString()}!`
            }
        );
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});