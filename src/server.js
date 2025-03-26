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
const authMiddleware = require('./middleware/auth');

// Carga variables de entorno desde un archivo .env
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000; // Puerto en el que correrá el servidor

// Configuración de middleware
app.use(bodyParser.json()); // Habilita el parsing de JSON en las solicitudes

// Configuración de CORS mejorada que acepta el dominio con y sin barra final
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://pi2-smarttask-frontend.vercel.app',
      'https://pi2-smarttask-frontend.vercel.app/'
    ];
    
    // Permitir solicitudes sin origen (como las de Postman o desarrollo local)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-auth-token']
}));

// Definición de rutas de la API
app.use('/api/auth', authRoutes); // Rutas de autenticación
app.use('/api/projects', authMiddleware, projectRoutes); // Rutas protegidas de proyectos
app.use('/api/tasks', authMiddleware, taskRoutes); // Rutas protegidas de tareas

// Sirve archivos estáticos de React (para el frontend en producción)
app.use(express.static(path.join(__dirname, 'build')));

// Manejo de rutas desconocidas: devuelve el archivo index.html del frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Middleware para manejar errores y registrar logs con Winston
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
