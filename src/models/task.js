// Importación de Sequelize y la configuración de la base de datos
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Represents a Task model in the database.
 * 
 * @typedef {Object} Task
 * @property {number} id - The unique identifier for the task. Auto-incremented primary key.
 * @property {string} title - The title of the task. Maximum length of 1000 characters. Cannot be null.
 * @property {string|null} description - A detailed description of the task. Can be null.
 * @property {Date} creation_date - The date when the task was created. Defaults to the current date and time.
 * @property {Date} completion_date - The date when the task is expected to be completed. Cannot be null.
 * @property {'in_progress'|'completed'|'pending'|'cancelled'} status - The current status of the task. Defaults to 'pending'.
 * @property {number} projectId - The ID of the associated project. Cannot be null.
 */

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

  assignee: {
    type: DataTypes.INTEGER,  // ID del usuario asignado
    allowNull: true
  },

  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    allowNull: true,
    defaultValue: 'medium'
  },

  // Estado de la tarea (pendiente, en progreso, completada o cancelada)
  status: {
    type: DataTypes.ENUM('in_progress', 'completed', 'pending', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending'
  },
  projectId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'project_id'
  }
}, {
  timestamps: true,
  underscored: true
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = Task;