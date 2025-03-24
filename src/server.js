const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const winston = require('winston');
const path = require('path');
const sequelize = require(path.join(__dirname, 'config', 'database'));
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const authMiddleware = require('./middleware/auth');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // Usa * para permitir cualquier origen en desarrollo
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-auth-token']
}));

app.use('/api/auth', authRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);

// Sirve los archivos estáticos de React
app.use(express.static(path.join(__dirname, 'build')));

// Maneja cualquier solicitud que no coincida con las rutas anteriores
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.use((err, req, res, next) => {
  winston.error(err.message, err);  
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'production' ? {} : err
  });
});

// Inicia la secuencia: conectar a DB, inicializar si es necesario, iniciar servidor
sequelize.authenticate()
  .then(() => {
    winston.info('Database connection has been established successfully.');
    return sequelize.sync({ alter: process.env.NODE_ENV === 'production' ? false : true });
  })
  .then(() => {
    winston.info('Database synchronized');
    app.listen(PORT, () => {
      winston.info(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    winston.error('Unable to connect to the database:', err);
  });