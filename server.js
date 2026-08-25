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

// ==========================================
// CONFIGURACIÓN DE CENTROS Y RADIOS (en kilómetros)
// IMPORTANTE: Cambia lat y lon por las coordenadas reales de cada sitio
// ==========================================
const centros = {
    taller: { lat: 36.7213, lon: -4.4214, radioKm: 0.2 }, // 200 metros de radio para el taller
    avanza: { lat: 36.7000, lon: -4.4000, radioKm: 0.2 }, // 200 metros de radio para Avanza
    casa:   { lat: 36.7200, lon: -4.4100, radioKm: 3.0 }  // 3 kilómetros de radio para pruebas en casa (puedes moverte por el barrio)
};

// Función matemática (Haversine) para calcular la distancia en kilómetros entre dos coordenadas GPS
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distancia en kilómetros
}

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
// RUTA 2: FICHAJE CON GPS Y VALIDACIÓN DE DISTANCIA
// ==========================================
app.post('/api/fichar', (req, res) => {
    const { email, password, ubicacion, tipo, latitud, longitud } = req.body;

    if (!email || !password || !ubicacion || !tipo || latitud === undefined || longitud === undefined) {
        return res.status(400).json({ error: "Faltan datos o coordenadas GPS para realizar el fichaje." });
    }

    // 1. Validar si el centro seleccionado existe en nuestra lista
    const centroPermitido = centros[ubicacion];
    if (!centroPermitido) {
        return res.status(400).json({ error: "Centro de trabajo no válido." });
    }

    // 2. Calcular la distancia real entre el móvil y el centro seleccionado
    const distanciaCalculadaKm = calcularDistanciaKm(latitud, longitud, centroPermitido.lat, centroPermitido.lon);

    // 3. Comprobar si está fuera del radio permitido
    if (distanciaCalculadaKm > centroPermitido.radioKm) {
        const distanciaMetros = Math.round(distanciaCalculadaKm * 1000);
        return res.status(403).json({ 
            error: `Fichaje rechazado. Estás demasiado lejos de ${ubicacion.toUpperCase()} (a unos ${distanciaMetros} metros). Acércate a la zona permitida.` 
        });
    }

    // 4. Verificar usuario y contraseña en la base de datos
    db.get("SELECT * FROM usuarios WHERE email = ?", [email], async (err, usuario) => {
        if (err || !usuario) {
            return res.status(401).json({ error: "Credenciales incorrectas (Usuario no encontrado)." });
        }

        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Credenciales incorrectas (Contraseña errónea)." });
        }

        // 5. Si todo es correcto, guardar el fichaje
        const fechaActual = new Date().toISOString();
        db.run(
            "INSERT INTO fichajes (email, ubicacion, tipo, latitud, longitud, fecha) VALUES (?, ?, ?, ?, ?, ?)",
            [email, ubicacion, tipo, latitud, longitud, fechaActual],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: "Error al guardar el fichaje en la base de datos." });
                }
                
                const horaEspana = new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' });

                res.json({ 
                    success: true, 
                    message: `¡Fichaje de ${tipo} registrado con éxito en ${ubicacion} a las ${horaEspana}!` 
                });
            }
        );
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});