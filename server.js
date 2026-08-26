const express = require('express');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const bcrypt = require('bcrypt');
const path = require('path');

let serviceAccount;

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim());
    } else {
        serviceAccount = require('./serviceAccountKey.json');
    }
} catch (error) {
    console.error("❌ ERROR CRÍTICO AL LEER LAS CREDENCIALES:", error.message);
    process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
console.log("🔥 ¡Conectado correctamente a Firebase Firestore mediante Admin SDK!");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Coordenadas de tus centros y radios en kilómetros
const centros = {
    taller: { lat: 36.713519, lon: -4.487414, radioKm: 0.2 }, 
    avanza: { lat: 36.696515, lon: -4.490930, radioKm: 0.2 }, 
    casa:   { lat: 36.713756, lon: -4.451451, radioKm: 3.0 }   
};

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// Ruta de registro de operarios con DNI y Nombre
app.post('/api/registro', async (req, res) => {
    const { dni, nombre, password } = req.body;
    if (!dni || !nombre || !password) return res.status(400).json({ error: "Faltan datos obligatorios (DNI, Nombre o Contraseña)." });

    try {
        const safeDni = dni.trim().toUpperCase();
        const userRef = db.collection('usuarios').doc(safeDni);
        const userSnap = await userRef.get();

        if (userSnap.exists) return res.status(400).json({ error: "Este DNI ya está registrado." });

        const hashedPassword = await bcrypt.hash(password, 10);
        await userRef.set({ 
            dni: safeDni, 
            nombre: nombre.trim(), 
            password: hashedPassword, 
            rol: 'operario' 
        });

        res.json({ success: true, message: "Usuario registrado correctamente." });
    } catch (error) {
        res.status(500).json({ error: "Error interno al registrar: " + error.message });
    }
});

// Ruta de fichaje validando DNI, GPS y con la hora exacta de España
app.post('/api/fichar', async (req, res) => {
    const { dni, password, ubicacion, tipo, latitud, longitud } = req.body;

    if (!dni || !password || !ubicacion || !tipo || latitud === undefined || longitud === undefined) {
        return res.status(400).json({ error: "Faltan datos o coordenadas GPS." });
    }

    const centroPermitido = centros[ubicacion];
    if (!centroPermitido) return res.status(400).json({ error: "Centro de trabajo no válido." });

    const distanciaCalculadaKm = calcularDistanciaKm(latitud, longitud, centroPermitido.lat, centroPermitido.lon);
    if (distanciaCalculadaKm > centroPermitido.radioKm) {
        const distanciaMetros = Math.round(distanciaCalculadaKm * 1000);
        return res.status(403).json({ error: `Fichaje rechazado. Estás a unos ${distanciaMetros} metros del centro.` });
    }

    try {
        const safeDni = dni.trim().toUpperCase();
        const userRef = db.collection('usuarios').doc(safeDni);
        const userSnap = await userRef.get();

        if (!userSnap.exists) return res.status(401).json({ error: "DNI no encontrado o incorrecto." });

        const usuario = userSnap.data();
        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) return res.status(401).json({ error: "Contraseña errónea." });

        // Generamos la fecha exacta adaptada a la hora de España
        const fechaActual = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T');

        await db.collection('fichajes').add({
            dni: safeDni,
            nombre: usuario.nombre,
            ubicacion,
            tipo,
            latitud,
            longitud,
            fecha: fechaActual
        });

        const horaEspana = new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' });
        res.json({ success: true, message: `¡Fichaje de ${tipo} registrado con éxito a las ${horaEspana}!` });
    } catch (error) {
        res.status(500).json({ error: "Error al guardar el fichaje: " + error.message });
    }
});

// RUTA: Historial personal del operario por DNI
app.post('/api/operario/historial', async (req, res) => {
    const { dni, password } = req.body;
    if (!dni || !password) return res.status(400).json({ error: "Introduce tu DNI y contraseña." });

    try {
        const safeDni = dni.trim().toUpperCase();
        const userRef = db.collection('usuarios').doc(safeDni);
        const userSnap = await userRef.get();

        if (!userSnap.exists) return res.status(401).json({ error: "Usuario no encontrado." });

        const passwordMatch = await bcrypt.compare(password, userSnap.data().password);
        if (!passwordMatch) return res.status(401).json({ error: "Contraseña incorrecta." });

        const snapshot = await db.collection('fichajes').where('dni', '==', safeDni).get();
        const fichajes = [];
        snapshot.forEach(doc => fichajes.push({ id: doc.id, ...doc.data() }));

        fichajes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        res.json({ success: true, fichajes });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener tu historial: " + error.message });
    }
});

// RUTA: Historial global para el empresario (Inspección de Trabajo)
app.post('/api/empresario/fichajes', async (req, res) => {
    const { password } = req.body;
    const PASSWORD_EMPRESARIO = "AdminTaller2026*"; 

    if (password !== PASSWORD_EMPRESARIO) {
        return res.status(401).json({ error: "Contraseña de empresario incorrecta." });
    }

    try {
        const snapshot = await db.collection('fichajes').orderBy('fecha', 'desc').get();
        const fichajes = [];
        snapshot.forEach(doc => fichajes.push({ id: doc.id, ...doc.data() }));

        res.json({ success: true, fichajes });
    } catch (error) {
        res.status(500).json({ error: "Error al recuperar los datos: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});