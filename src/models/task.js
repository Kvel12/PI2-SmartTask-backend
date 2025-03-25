// Importación de Sequelize y la configuración de la base de datos
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Definición del modelo Task (Tarea)
const Task = sequelize.define('Task', {
  // ID único para cada tarea
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true, // Define el campo como clave primaria
    autoIncrement: true // Se incrementa automáticamente en cada nuevo registro
  },
  
  // Título de la tarea
  title: {
    type: DataTypes.STRING(1000), // Cadena de hasta 1000 caracteres
    allowNull: false // No puede ser nulo
  },
  
  // Descripción de la tarea (opcional)
  description: {
    type: DataTypes.TEXT, // Texto de tamaño variable
    allowNull: true // Puede ser nulo
  },
  
  // Fecha de creación de la tarea
  creation_date: {
    type: DataTypes.DATE,
    allowNull: false, // Obligatorio
    defaultValue: DataTypes.NOW // Valor por defecto: fecha y hora actual
  },
  
  // Fecha de finalización de la tarea
  completion_date: {
    type: DataTypes.DATE,
    allowNull: false // Obligatorio (debe completarse en algún momento)
  },
  
  // Estado de la tarea (pendiente, en progreso, completada o cancelada)
  status: {
    type: DataTypes.ENUM('in_progress', 'completed', 'pending', 'cancelled'), // Valores permitidos
    allowNull: false, // Obligatorio
    defaultValue: 'pending' // Valor por defecto: pendiente
  }
}, {
  timestamps: true // Agrega automáticamente campos createdAt y updatedAt
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = Task;