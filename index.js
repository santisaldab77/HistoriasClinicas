const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a Supabase mediante PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ROUTE 1: Iniciar Sesión (Pacientes y Médicos)
app.post('/api/auth/login', async (req, res) => {
  const { documento, password } = req.body;
  try {
    const userQuery = await pool.query('SELECT * FROM "PACIENTES" WHERE documento = $1', [documento]);
    if (userQuery.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const usuario = userQuery.rows[0];
    const validPassword = await bcrypt.compare(password, usuario.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 2: Registrar Paciente Nuevo
app.post('/api/pacientes', async (req, res) => {
  const { nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, correo, password, rol } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password || '123456', salt);

    const newPatient = await pool.query(
      `INSERT INTO "PACIENTES" (nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, "CORREO", password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, correo, password_hash, rol || 'paciente']
    );
    res.status(201).json(newPatient.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 3: Agregar Historia Clínica
app.post('/api/historias', async (req, res) => {
  const { paciente_id, historia_clinica } = req.body;
  try {
    const newEntry = await pool.query(
      `INSERT INTO "HISTORIAS_CLINICAS" (paciente_id, historia_clinica, fecha_elaboracion)
       VALUES ($1, $2, CURRENT_DATE) RETURNING *`,
      [paciente_id, historia_clinica]
    );
    res.status(201).json(newEntry.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 4: Consultar Historias del Paciente
app.get('/api/historias/:paciente_id', async (req, res) => {
  const { paciente_id } = req.params;
  try {
    const historia = await pool.query(
      `SELECT * FROM "HISTORIAS_CLINICAS" WHERE paciente_id = $1 ORDER BY fecha_elaboracion DESC`,
      [paciente_id]
    );
    res.json(historia.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 5: Actualizar información del Paciente
app.put('/api/pacientes/:id', async (req, res) => {
  const { id } = req.params;
  const { entidad_salud, correo, antecedentes } = req.body;
  try {
    // COALESCE mantiene el valor anterior si no se envía uno nuevo en el JSON
    const updatePatient = await pool.query(
      `UPDATE "PACIENTES" 
       SET entidad_salud = COALESCE($1, entidad_salud), 
           "CORREO" = COALESCE($2, "CORREO"), 
           antecedentes = COALESCE($3, antecedentes)
       WHERE id = $4 RETURNING *`,
      [entidad_salud, correo, antecedentes, id]
    );
    
    if (updatePatient.rows.length === 0) return res.status(404).json({ error: 'Paciente no encontrado' });
    res.json(updatePatient.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 6: Eliminar Paciente
app.delete('/api/pacientes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM "PACIENTES" WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paciente no encontrado' });
    res.json({ mensaje: 'Paciente eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 7: Eliminar una Historia Clínica específica
app.delete('/api/historias/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM "HISTORIAS_CLINICAS" WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    res.json({ mensaje: 'Registro clínico eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
