const express = require('express');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc, getDoc } = require('firebase/firestore');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Firebase usando las variables de entorno de Render
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
    appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
console.log("Conectado correctamente a Firebase Firestore en la nube.");

// Coordenadas de tus centros y radios en kilómetros
const centros = {
    taller: { lat: 36.7213, lon: -4.4214, radioKm: 0.2 }, 
    avanza: { lat: 36.7000, lon: -4.4000, radioKm: 0.2 }, 
    casa:   { lat: 36.7200, lon: -4.4100, radioKm: 3.0 }   
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

app.post('/api/registro', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    try {
        const userRef = doc(db, 'usuarios', email);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            return res.status(400).json({ error: "Este correo ya está registrado." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        await setDoc(userRef, {
            email: email,
            password: hashedPassword,
            rol: 'operario'
        });

        res.json({ success: true, message: "Usuario registrado correctamente." });
    } catch (error) {
        console.error("Error al registrar usuario:", error);
        res.status(500).json({ error: "Error interno en el servidor al registrar." });
    }
});

app.post('/api/fichar', async (req, res) => {
    const { email, password, ubicacion, tipo, latitud, longitud } = req.body;

    if (!email || !password || !ubicacion || !tipo || latitud === undefined || longitud === undefined) {
        return res.status(400).json({ error: "Faltan datos o coordenadas GPS para realizar el fichaje." });
    }

    const centroPermitido = centros[ubicacion];
    if (!centroPermitido) {
        return res.status(400).json({ error: "Centro de trabajo no válido." });
    }

    const distanciaCalculadaKm = calcularDistanciaKm(latitud, longitud, centroPermitido.lat, centroPermitido.lon);
    if (distanciaCalculadaKm > centroPermitido.radioKm) {
        const distanciaMetros = Math.round(distanciaCalculadaKm * 1000);
        return res.status(403).json({ 
            error: `Fichaje rechazado. Estás demasiado lejos de ${ubicacion.toUpperCase()} (a unos ${distanciaMetros} metros). Acércate a la zona permitida.` 
        });
    }

    try {
        const userRef = doc(db, 'usuarios', email);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            return res.status(401).json({ error: "Credenciales incorrectas (Usuario no encontrado)." });
        }

        const usuario = userSnap.data();
        const passwordMatch = await bcrypt.compare(password, usuario.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ error: "Credenciales incorrectas (Contraseña errónea)." });
        }

        const fechaActual = new Date().toISOString();
        const fichajeRef = doc(collection(db, 'fichajes'));
        
        await setDoc(fichajeRef, {
            email: email,
            ubicacion: ubicacion,
            tipo: tipo,
            latitud: latitud,
            longitud: longitud,
            fecha: fechaActual
        });

        const horaEspana = new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' });

        res.json({ 
            success: true, 
            message: `¡Fichaje de ${tipo} registrado con éxito en ${ubicacion} a las ${horaEspana}!` 
        });

    } catch (error) {
        console.error("Error al procesar el fichaje:", error);
        res.status(500).json({ error: "Error al guardar el fichaje en la base de datos." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});