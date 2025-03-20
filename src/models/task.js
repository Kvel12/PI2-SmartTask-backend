const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Project = require('./project');  // Importa el modelo de Project

// Definición del modelo "Task"
const Task = sequelize.define('Task', {
  title: {
    type: DataTypes.STRING(1000),  // Título de la tarea, máximo 1000 caracteres
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,  // Descripción larga de la tarea
    allowNull: true
  },
  creation_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW  // Fecha de creación por defecto
  },
  completion_date: {
    type: DataTypes.DATE,  // Fecha en la que se completó la tarea
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('in_progress', 'completed', 'pending', 'cancelled'),  // Estados posibles de la tarea
    allowNull: false,
    defaultValue: 'pending'  // Estado inicial
  },
  projectId: {
    type: DataTypes.INTEGER,  // Clave foránea que asocia la tarea con un proyecto
    allowNull: false,
    references: {
      model: Project,  // Relación con la tabla de proyectos
      key: 'id'
    }
  }
}, {
  timestamps: true  // Sequelize agrega automáticamente createdAt y updatedAt
});

module.exports = Task;  // Exporta el modelo
