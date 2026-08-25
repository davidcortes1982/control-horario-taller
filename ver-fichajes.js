const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Error al conectar:', err.message);
        return;
    }
    
    // Consultar todos los fichajes cruzándolos con los usuarios y las naves
    const query = `
        SELECT fichajes.id, usuarios.nombre AS empleado, naves.nombre AS ubicacion, fichajes.tipo, fichajes.timestamp 
        FROM fichajes 
        JOIN usuarios ON fichajes.usuario_id = usuarios.id 
        JOIN naves ON fichajes.nave_id = naves.id
        ORDER BY fichajes.timestamp DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error al leer los fichajes:', err.message);
            return;
        }
        console.log('--- REGISTRO DE FICHAJES ACTUALES ---');
        console.table(rows);
    });
});