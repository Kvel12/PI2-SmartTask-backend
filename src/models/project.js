// Importación de Sequelize y la configuración de la base de datos
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Definición del modelo Project
const Project = sequelize.define('Project', {
  // ID único para cada proyecto
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true, // Define el campo como clave primaria
    autoIncrement: true // Se incrementa automáticamente en cada nuevo registro
  },
  
  // Título del proyecto
  title: {
    type: DataTypes.STRING(1000), // Cadena de hasta 1000 caracteres
    allowNull: false, // No puede ser nulo
    unique: true // No puede haber proyectos con el mismo título
  },
  
  // Descripción del proyecto (opcional)
  description: {
    type: DataTypes.TEXT, // Texto de tamaño variable
    allowNull: true // Puede ser nulo
  },
  
  // Fecha de creación del proyecto
  creation_date: {
    type: DataTypes.DATE,
    allowNull: false, // Obligatorio
    defaultValue: DataTypes.NOW // Valor por defecto: fecha y hora actual
  },
  
  // Fecha de culminación del proyecto (opcional)
  culmination_date: {
    type: DataTypes.DATE,
    allowNull: true // Puede ser nulo si el proyecto aún no ha terminado
  },
  
  // Prioridad del proyecto (alto, medio, bajo)
  priority: {
    type: DataTypes.ENUM('high', 'medium', 'low'), // Valores permitidos
    allowNull: true, // Puede ser nulo
    defaultValue: 'medium' // Valor por defecto: medio
  }
}, {
  timestamps: true // Agrega automáticamente campos createdAt y updatedAt
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = Project;