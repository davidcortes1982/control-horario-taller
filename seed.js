const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, async (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
        return;
    }
    console.log('Insertando datos iniciales de prueba...');

    const hashedPassword = await bcrypt.hash('123456', 10);

    db.serialize(() => {
        db.run(`INSERT OR IGNORE INTO naves (id, nombre, codigo_qr) VALUES (1, 'Nave Principal - Chapa', 'QR_NAVE_CHAPA_01')`);
        db.run(`INSERT OR IGNORE INTO naves (id, nombre, codigo_qr) VALUES (2, 'Instalaciones Cliente Externo', 'QR_CLIENTE_EXT_02')`);

        db.run(`INSERT OR IGNORE INTO usuarios (nombre, email, password, rol) VALUES ('David Admin', 'admin@taller.com', ?, 'admin')`, [hashedPassword]);
        
        db.run(`INSERT OR IGNORE INTO usuarios (nombre, email, password, rol) VALUES ('Juan Operario', 'juan@taller.com', ?, 'operario')`, [hashedPassword], (err) => {
            if (!err) {
                console.log('¡Usuarios y naves creados con éxito!');
            }
        });
    });
});