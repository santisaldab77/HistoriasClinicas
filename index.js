const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Configurar captura de archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Inicializar cliente de Supabase para Storage
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

// ROUTE 2: Registrar Paciente Nuevo (Actualizado con todos los campos)
app.post('/api/pacientes', async (req, res) => {
  const { 
    nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, correo, password, rol,
    sexo, telefono_residencia, celular, direccion, lugar_residencia, acompanante,
    telefono_acompanante, responsable, telefono_responsable, parentesco, ocupacion,
    vinculacion, estado_civil
  } = req.body;
  
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password || '123456', salt);

    const newPatient = await pool.query(
      `INSERT INTO "PACIENTES" (
        nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, "CORREO", password_hash, rol,
        sexo, telefono_residencia, celular, direccion, lugar_residencia, acompanante,
        telefono_acompanante, responsable, telefono_responsable, parentesco, ocupacion,
        vinculacion, estado_civil
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
      [
        nombre, documento, fecha_nacimiento, entidad_salud, antecedentes, correo, password_hash, rol || 'paciente',
        sexo, telefono_residencia, celular, direccion, lugar_residencia, acompanante,
        telefono_acompanante, responsable, telefono_responsable, parentesco, ocupacion,
        vinculacion, estado_civil
      ]
    );
    res.status(201).json(newPatient.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 3: Agregar Historia Clínica con Archivo Adjunto
app.post('/api/historias', upload.single('archivo'), async (req, res) => {
  const { 
    paciente_id, motivo_consulta, enfermedad_actual, ant_pers_fam, exploracion_fisica,
    revision_sistemas, ayudas_diagnosticas, diagnostico_evolucion, evolucion_clinica, anexos_consentimiento
  } = req.body;
  
  try {
    let archivo_url = null;

    // Si el médico adjuntó un archivo, lo subimos a Supabase Storage
    if (req.file) {
      const nombreArchivo = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
      
      const { data, error } = await supabase.storage
        .from('adjuntos')
        .upload(nombreArchivo, req.file.buffer, {
          contentType: req.file.mimetype
        });

      if (error) throw error;

      // Generar el enlace público del archivo recién subido
      const publicUrl = supabase.storage.from('adjuntos').getPublicUrl(nombreArchivo);
      archivo_url = publicUrl.data.publicUrl;
    }

    const newEntry = await pool.query(
      `INSERT INTO "HISTORIAS_CLINICAS" (
        paciente_id, fecha_elaboracion, motivo_consulta, enfermedad_actual, ant_pers_fam, 
        exploracion_fisica, revision_sistemas, ayudas_diagnosticas, diagnostico_evolucion, 
        evolucion_clinica, anexos_consentimiento, archivo_url
      )
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        paciente_id, motivo_consulta, enfermedad_actual, ant_pers_fam, exploracion_fisica,
        revision_sistemas, ayudas_diagnosticas, diagnostico_evolucion, evolucion_clinica, anexos_consentimiento, archivo_url
      ]
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
  const { 
    nombre, sexo, fecha_nacimiento, telefono_residencia, celular, 
    entidad_salud, direccion, lugar_residencia, acompanante, telefono_acompanante, 
    responsable, telefono_responsable, parentesco, ocupacion, vinculacion, 
    estado_civil, correo, antecedentes 
  } = req.body;
  
  try {
    const updatePatient = await pool.query(
      `UPDATE "PACIENTES" 
       SET nombre = COALESCE($1, nombre), sexo = COALESCE($2, sexo), 
           fecha_nacimiento = COALESCE($3, fecha_nacimiento), telefono_residencia = COALESCE($4, telefono_residencia), 
           celular = COALESCE($5, celular), entidad_salud = COALESCE($6, entidad_salud), 
           direccion = COALESCE($7, direccion), lugar_residencia = COALESCE($8, lugar_residencia), 
           acompanante = COALESCE($9, acompanante), telefono_acompanante = COALESCE($10, telefono_acompanante), 
           responsable = COALESCE($11, responsable), telefono_responsable = COALESCE($12, telefono_responsable), 
           parentesco = COALESCE($13, parentesco), ocupacion = COALESCE($14, ocupacion), 
           vinculacion = COALESCE($15, vinculacion), estado_civil = COALESCE($16, estado_civil), 
           "CORREO" = COALESCE($17, "CORREO"), antecedentes = COALESCE($18, antecedentes)
       WHERE id = $19 RETURNING *`,
      [nombre, sexo, fecha_nacimiento, telefono_residencia, celular, entidad_salud, direccion, lugar_residencia, acompanante, telefono_acompanante, responsable, telefono_responsable, parentesco, ocupacion, vinculacion, estado_civil, correo, antecedentes, id]
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

// ROUTE 8: Solicitar recuperación de contraseña
app.post('/api/auth/recuperar', async (req, res) => {
  const { documento } = req.body;
  try {
    const userQuery = await pool.query('SELECT * FROM "PACIENTES" WHERE documento = $1 AND rol = $2', [documento, 'paciente']);
    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró un paciente con este documento' });
    }

    console.log(`Simulación: Correo de recuperación enviado a ${userQuery.rows[0].CORREO}`);
    res.json({ mensaje: 'Si el documento existe, se ha enviado un enlace a tu correo registrado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;


// ROUTE 9: Buscar paciente por documento o nombre (Panel Médico)
app.get('/api/pacientes/buscar/:termino', async (req, res) => {
  const { termino } = req.params;
  try {
    // Busca coincidencia exacta en documento O coincidencia parcial en el nombre
    const result = await pool.query(
      'SELECT * FROM "PACIENTES" WHERE (documento = $1 OR nombre ILIKE $2) AND rol = $3', 
      [termino, `%${termino}%`, 'paciente']
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paciente no encontrado' });
    
    // Ahora devolvemos TODOS los resultados encontrados (un array), no solo el primero
    res.json(result.rows); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));


// ROUTE 10: Subir documento general (Dietas, Recomendaciones, etc.)
app.post('/api/documentos', upload.single('archivo'), async (req, res) => {
  const { nombre_archivo, observacion } = req.body;
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });

    // Guardar en la carpeta "plantillas" dentro del mismo bucket de adjuntos
    const nombreStorage = `plantillas/${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
    
    const { data, error } = await supabase.storage
      .from('adjuntos')
      .upload(nombreStorage, req.file.buffer, { contentType: req.file.mimetype });

    if (error) throw error;

    const publicUrl = supabase.storage.from('adjuntos').getPublicUrl(nombreStorage).data.publicUrl;

    const newDoc = await pool.query(
      `INSERT INTO "DOCUMENTOS_MEDICOS" (nombre_archivo, observacion, archivo_url)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre_archivo, observacion, publicUrl]
    );
    res.status(201).json(newDoc.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ROUTE 11: Consultar la lista de documentos generales
app.get('/api/documentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "DOCUMENTOS_MEDICOS" ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



