const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const sequelize = require('./config/database');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const authMiddleware = require('./middleware/auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
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
    
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'production' ? {} : err
  });
});

sequelize.sync({ force: false }).then(() => {
  app.listen(PORT, () => {
    
  });
});