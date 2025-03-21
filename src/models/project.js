const { DataTypes } = require('sequelize');  // Importa los tipos de datos de Sequelize
const sequelize = require('../config/database');  // Importa la conexión a la base de datos
const Task = require('./task'); //Importar el modelo task


// Definición del modelo "Project"
const Project = sequelize.define('Project', {
  title: {
    type: DataTypes.STRING(1000),  // Campo de tipo STRING con máximo 1000 caracteres
    allowNull: false,  // No puede ser nulo
    unique: true // Asegura que nombre del proyecto sea único
  },
  description: {
    type: DataTypes.TEXT,  // Campo de tipo texto largo
    allowNull: true  // Puede ser nulo
  },
  creation_date: {
    type: DataTypes.DATE,  // Tipo de dato fecha
    allowNull: false,
    defaultValue: DataTypes.NOW  // Se asigna la fecha actual por defecto
  },
  culmination_date: {
    type: DataTypes.DATE,  // Fecha opcional de culminación del proyecto
    allowNull: true
  },
  priority: {
    type: DataTypes.ENUM('high', 'medium', 'low'),  // Define prioridad con valores predefinidos
    allowNull: true,
    defaultValue: 'medium'  // Valor por defecto
  }
}, {
  timestamps: true  // Agrega automáticamente createdAt y updatedAt
});

// Relación: Un proyecto tiene muchas tareas
Project.hasMany(Task, {
  foreignKey: 'projectId',
  onDelete: 'CASCADE' // Eliminar tareas en cascada al eliminar un proyecto
});
Task.belongsTo(Project, { foreignKey: 'projectId' });

module.exports = Project;  // Exporta el modelo
