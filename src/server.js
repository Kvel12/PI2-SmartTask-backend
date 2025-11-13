// Importación de módulos necesarios
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const winston = require('winston');
const path = require('path');
const models = require(path.join(__dirname, 'models'));
const sequelize = models.sequelize;

// Importación de rutas y middleware de autenticación
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const speechRoutes = require('./routes/speech'); // Nueva importación para rutas de reconocimiento de voz
const authMiddleware = require('./middleware/auth');
const assistantRoutes = require('./routes/assistant');

// Carga variables de entorno desde un archivo .env
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000; // Puerto en el que correrá el servidor

// Configuración de middleware
app.use(bodyParser.json()); // Habilita el parsing de JSON en las solicitudes

// Configuración de CORS mejorada que acepta el dominio con y sin barra final
app.use(cors({
  origin: function(origin, callback) {
    // Permitir solicitudes sin origen (como Postman, desarrollo local)
    if (!origin) return callback(null, true);
    
    // Lista de dominios permitidos
    const allowedOrigins = [
      'https://pi2-smarttask-frontend.onrender.com',  // Frontend en Render
      'https://pi2-smarttask-frontend.vercel.app',    // Frontend en Vercel
      process.env.FRONTEND_URL || '*'                 // De las variables de entorno
    ];
    
    // Verificar si el origen está permitido
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token', 'Authorization']
}));

app.get('/api/debug', (req, res) => {
  res.json({
    message: 'API está funcionando',
    environment: process.env.NODE_ENV,
    frontendUrl: process.env.FRONTEND_URL,
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/speech', authMiddleware, speechRoutes);
app.use('/api/assistant', authMiddleware, assistantRoutes);

// Servir archivos estáticos desde la carpeta build
app.use(express.static(path.join(__dirname, '..', 'build')));

// Cualquier otra ruta no definida, enviar el archivo HTML de React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'build', 'index.html'));
});

app.use((err, req, res, next) => {
  winston.error(err.message, err);
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'production' ? {} : err // No expone detalles del error en producción
  });
});

// Conexión a la base de datos y sincronización
sequelize.authenticate()
  .then(() => {
    winston.info('Database connection has been established successfully.');
    return sequelize.sync({ alter: process.env.NODE_ENV === 'production' ? false : true }); // Sincroniza modelos con la base de datos
  })
  .then(async () => {
    winston.info('Database synchronized');
    
    // Muestra en logs las tablas creadas
    try {
      const tableNames = await sequelize.getQueryInterface().showAllTables();
      winston.info('Tablas creadas:', tableNames);
    } catch (error) {
      winston.error('Error listando tablas:', error);
    }
    
    // Inicia el servidor en el puerto definido
    app.listen(PORT, () => {
      winston.info(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    winston.error('Unable to connect to the database:', err);
  });