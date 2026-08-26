const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Cargar credenciales de Firebase de forma totalmente segura para Render
let serviceAccount;
if (process.env.FIREBASE_CREDENTIALS) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    } catch (e) {
        console.error("Error al parsear FIREBASE_CREDENTIALS:", e);
    }
} else {
    // Si estás en desarrollo local y tienes el archivo, lo lee. Si no, avisa.
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (e) {
        console.error("No se encontró el archivo serviceAccountKey.json ni la variable FIREBASE_CREDENTIALS.");
    }
}

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Contraseña de empresario fija
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

// ==========================================
// COORDENADAS FIJAS DE LOS CENTROS (Radio en metros)
// ==========================================
const CENTROS = {
    taller: [
        { lat: 36.713519, lon: -4.487414, radio: 150 }
    ],
    avanza: [
        { lat: 36.696515, lon: -4.490930, radio: 150 }
    ],
    casa: [
        { lat: 36.713756, lon: -4.451451, radio: 150 } // Prueba / Casa con coordenadas activadas
    ]
};

// Función para calcular distancia en metros entre dos coordenadas GPS (Fórmula Haversine)
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
// RUTA: REGISTRAR NUEVO USUARIO / OPERARIO
// ==========================================
app.post('/api/registro', async (req, res) => {
    try {
        let { dni, nombre, password } = req.body;
        if (!dni || !nombre || !password) {
            return res.status(400).json({ error: "Todos los campos son obligatorios." });
        }
        dni = dni.trim().toUpperCase();

        const userRef = db.collection('usuarios').doc(dni);
        const doc = await userRef.get();
        if (doc.exists) {
            return res.status(400).json({ error: "Este DNI ya está registrado." });
        }

        await userRef.set({ nombre, password });
        res.json({ success: true, message: "Registro completado con éxito." });
    } catch (error) {
        res.status(500).json({ error: "Error en el servidor al registrar." });
    }
});

// ==========================================
// RUTA: REALIZAR FICHAJE (CON VALIDACIÓN DE GPS Y ZONAS)
// ==========================================
app.post('/api/fichar', async (req, res) => {
    try {
        let { dni, password, ubicacion, tipo, latitud, longitud } = req.body;
        if (!dni || !password || !ubicacion || !tipo) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }
        dni = dni.trim().toUpperCase();

        // Validar usuario y contraseña
        const userDoc = await db.collection('usuarios').doc(dni).get();
        if (!userDoc.exists || userDoc.data().password !== password) {
            return res.status(401).json({ error: "DNI o contraseña incorrectos." });
        }

        // VALIDACIÓN RIGUROSA DE GEOLOCALIZACIÓN
        if (latitud === undefined || longitud === undefined || latitud === null || longitud === null) {
            return res.status(400).json({ error: "Se requiere geolocalización activa para realizar cualquier fichaje." });
        }

        const puntosCentro = CENTROS[ubicacion];
        if (puntosCentro) {
            let dentroDeRango = false;
            let menorDistancia = Infinity;

            for (const punto of puntosCentro) {
                const distancia = calcularDistanciaMetros(latitud, longitud, punto.lat, punto.lon);
                if (distancia < menorDistancia) {
                    menorDistancia = distancia;
                }
                if (distancia <= punto.radio) {
                    dentroDeRango = true;
                    break;
                }
            }

            if (!dentroDeRango) {
                return res.status(400).json({ 
                    error: `Estás fuera de rango para fichar en ${ubicacion.toUpperCase()}. Te encuentras a ${Math.round(menorDistancia)} metros del punto autorizado.` 
                });
            }
        }

        const nombreUsuario = userDoc.data().nombre;

        // Guardar fichaje con coordenadas y validación exitosa
        await db.collection('fichajes').add({
            dni,
            nombre: nombreUsuario,
            ubicacion,
            tipo,
            latitud,
            longitud,
            fecha: new Date().toISOString()
        });

        res.json({ success: true, message: `Fichaje de ${tipo} registrado correctamente en ${ubicacion}.` });
    } catch (error) {
        res.status(500).json({ error: "Error en el servidor al fichar." });
    }
});

// ==========================================
// RUTA: HISTORIAL PERSONAL DEL OPERARIO
// ==========================================
app.post('/api/operario/historial', async (req, res) => {
    try {
        let { dni, password } = req.body;
        if (!dni || !password) {
            return res.status(400).json({ error: "Credenciales incompletas." });
        }
        dni = dni.trim().toUpperCase();

        const userDoc = await db.collection('usuarios').doc(dni).get();
        if (!userDoc.exists || userDoc.data().password !== password) {
            return res.status(401).json({ error: "Credenciales incorrectas." });
        }

        const snapshot = await db.collection('fichajes').where('dni', '==', dni).get();
        let fichajes = [];
        snapshot.forEach(doc => {
            fichajes.push({ id: doc.id, ...doc.data() });
        });

        fichajes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        res.json({ success: true, fichajes });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener el historial." });
    }
});

// ==========================================
// RUTA: SOLICITAR CORRECCIÓN DE FICHAJE (OPERARIO)
// ==========================================
app.post('/api/operario/solicitar-correccion', async (req, res) => {
    try {
        let { dni, password, fichajetargetId, nuevoTipo, nuevaFechaHora, motivo } = req.body;
        if (!dni || !password || !fichajetargetId || !nuevoTipo || !nuevaFechaHora || !motivo) {
            return res.status(400).json({ error: "Todos los campos de la solicitud son obligatorios." });
        }
        dni = dni.trim().toUpperCase();

        const userDoc = await db.collection('usuarios').doc(dni).get();
        if (!userDoc.exists || userDoc.data().password !== password) {
            return res.status(401).json({ error: "Credenciales incorrectas." });
        }

        await db.collection('solicitudes_correccion').add({
            fichajeId: fichajetargetId,
            dni,
            nombre: userDoc.data().nombre,
            nuevoTipo, // <--- Guardamos el nuevo tipo solicitado
            nuevaFechaHora,
            motivo,
            estado: 'pendiente',
            fechaSolicitud: new Date().toISOString()
        });

        res.json({ success: true, message: "Solicitud enviada al empresario correctamente." });
    } catch (error) {
        res.status(500).json({ error: "Error al registrar la solicitud de corrección." });
    }
});

// ==========================================
// RUTA: PANEL EMPRESARIO - VER TODOS LOS FICHAJES
// ==========================================
app.post('/api/empresario/fichajes', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Contraseña de empresario incorrecta." });
        }

        const snapshot = await db.collection('fichajes').get();
        let fichajes = [];
        snapshot.forEach(doc => {
            fichajes.push({ id: doc.id, ...doc.data() });
        });

        fichajes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        res.json({ success: true, fichajes });
    } catch (error) {
        res.status(500).json({ error: "Error al cargar los fichajes." });
    }
});

// ==========================================
// RUTA: PANEL EMPRESARIO - VER SOLICITUDES PENDIENTES
// ==========================================
app.post('/api/empresario/solicitudes', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Contraseña de empresario incorrecta." });
        }

        const snapshot = await db.collection('solicitudes_correccion').where('estado', '==', 'pendiente').get();
        let solicitudes = [];
        snapshot.forEach(doc => {
            solicitudes.push({ id: doc.id, ...doc.data() });
        });

        res.json({ success: true, solicitudes });
    } catch (error) {
        res.status(500).json({ error: "Error al cargar las solicitudes." });
    }
});

// ==========================================
// RUTA: PANEL EMPRESARIO - RESOLVER SOLICITUD
// ==========================================
app.post('/api/empresario/resolver-solicitud', async (req, res) => {
    try {
        const { password, solicitudId, accion } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Contraseña de empresario incorrecta." });
        }

        const solicitudRef = db.collection('solicitudes_correccion').doc(solicitudId);
        const solicitudDoc = await solicitudRef.get();

        if (!solicitudDoc.exists) {
            return res.status(404).json({ error: "La solicitud no existe." });
        }

        const data = solicitudDoc.data();

        if (accion === 'aprobar') {
            const fichajeRef = db.collection('fichajes').doc(data.fichajeId);
            await fichajeRef.update({
                fecha: data.nuevaFechaHora,
                tipo: data.nuevoTipo, // <--- Actualiza también el tipo (entrada/salida) en Firestore
                modificadoPorEmpresario: true,
                motivoModificacion: data.motivo,
                fechaModificacion: new Date().toISOString()
            });

            await solicitudRef.update({ estado: 'aprobado' });
            res.json({ success: true, message: "Corrección aprobada y aplicada con trazabilidad legal." });
        } else if (accion === 'rechazar') {
            await solicitudRef.update({ estado: 'rechazado' });
            res.json({ success: true, message: "Solicitud rechazada." });
        } else {
            res.status(400).json({ error: "Acción no válida." });
        }
    } catch (error) {
        res.status(500).json({ error: "Error al procesar la solicitud." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});