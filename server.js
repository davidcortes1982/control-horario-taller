const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Cargar credenciales de Firebase desde variables de entorno (Render) o archivo local (desarrollo)
let serviceAccount;
if (process.env.FIREBASE_CREDENTIALS) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
} else {
    serviceAccount = require('./serviceAccountKey.json');
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
// RUTA: REALIZAR FICHAJE (CON COORDENADAS GPS)
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

        const nombreUsuario = userDoc.data().nombre;

        // Guardar fichaje incluyendo las coordenadas GPS que llegan del navegador
        await db.collection('fichajes').add({
            dni,
            nombre: nombreUsuario,
            ubicacion,
            tipo,
            latitud: latitud || null,
            longitud: longitud || null,
            fecha: new Date().toISOString()
        });

        res.json({ success: true, message: `Fichaje de ${tipo} registrado correctamente.` });
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

        // Ordenar por fecha descendiente
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
        let { dni, password, fichajetargetId, nuevaFechaHora, motivo } = req.body;
        if (!dni || !password || !fichajetargetId || !nuevaFechaHora || !motivo) {
            return res.status(400).json({ error: "Todos los campos de la solicitud son obligatorios." });
        }
        dni = dni.trim().toUpperCase();

        const userDoc = await db.collection('usuarios').doc(dni).get();
        if (!userDoc.exists || userDoc.data().password !== password) {
            return res.status(401).json({ error: "Credenciales incorrectas." });
        }

        // Guardar solicitud de corrección pendiente
        await db.collection('solicitudes_correccion').add({
            fichajeId: fichajetargetId,
            dni,
            nombre: userDoc.data().nombre,
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

        // Ordenar por fecha descendiente
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
// RUTA: PANEL EMPRESARIO - RESOLVER (APROBAR/RECHAZAR) SOLICITUD
// ==========================================
app.post('/api/empresario/resolver-solicitud', async (req, res) => {
    try {
        const { password, solicitudId, accion } = req.body; // accion: 'aprobar' o 'rechazar'
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
            // Actualizar el fichaje original con la nueva fecha hora y dejar rastro de trazabilidad
            const fichajeRef = db.collection('fichajes').doc(data.fichajeId);
            await fichajeRef.update({
                fecha: data.nuevaFechaHora,
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