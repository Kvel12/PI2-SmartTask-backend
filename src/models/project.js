// Importación de Sequelize y la configuración de la base de datos
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Represents a Project model in the database.
 *
 * @typedef {Object} Project
 * @property {number} id - The unique identifier for the project. Auto-incremented primary key.
 * @property {string} title - The title of the project. Must be unique and cannot exceed 1000 characters.
 * @property {string|null} description - A detailed description of the project. Optional field.
 * @property {Date} creation_date - The date when the project was created. Defaults to the current date.
 * @property {Date|null} culmination_date - The date when the project is expected to be completed. Optional field.
 * @property {'high'|'medium'|'low'} priority - The priority level of the project. Defaults to 'medium'.
 * @property {Array<Object>} members - Array of project members with name and email.
 * @property {'default'|'architecture'|'systems_engineering'} kanban_template - Kanban template type. Defaults to 'default'.
 * @property {Array<Object>} kanban_columns - Array of column objects for the Kanban board.
 *
 * @see {@link https://sequelize.org/} for more information about Sequelize models.
 */

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
  },

  // Miembros del proyecto (opcional)
  members: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Array of project members with name and email'
  },

  // Plantilla Kanban seleccionada
  kanban_template: {
    type: DataTypes.ENUM('default', 'architecture', 'systems_engineering'),
    allowNull: false,
    defaultValue: 'default',
    comment: 'Template type for the Kanban board'
  },

  // Columnas del Kanban (JSON)
  kanban_columns: {
    type: DataTypes.JSONB, // JSONB para PostgreSQL (más eficiente que JSON)
    allowNull: false,
    defaultValue: [ // Valor por defecto: plantilla estándar
      { id: 'pending', title: 'Pending', color: '#ffc107', icon: '📋' },
      { id: 'in_progress', title: 'In Progress', color: '#007bff', icon: '🔄' },
      { id: 'completed', title: 'Completed', color: '#28a745', icon: '✅' },
      { id: 'cancelled', title: 'Cancelled', color: '#6c757d', icon: '❌' }
    ],
    comment: 'Array of column objects defining the Kanban board structure',
    validate: {
      isValidColumnArray(value) {
        if (!Array.isArray(value)) {
          throw new Error('kanban_columns must be an array');
        }
        if (value.length === 0) {
          throw new Error('kanban_columns must have at least one column');
        }
        value.forEach((col, index) => {
          if (!col.id || typeof col.id !== 'string') {
            throw new Error(`Column ${index}: 'id' is required and must be a string`);
          }
          if (!col.title || typeof col.title !== 'string') {
            throw new Error(`Column ${index}: 'title' is required and must be a string`);
          }
          if (!col.color || !/^#[0-9A-F]{6}$/i.test(col.color)) {
            throw new Error(`Column ${index}: 'color' must be a valid hex color`);
          }
          if (!col.icon || typeof col.icon !== 'string') {
            throw new Error(`Column ${index}: 'icon' is required and must be a string`);
          }
        });
      }
    }
  }
}, {
  timestamps: true // Agrega automáticamente campos createdAt y updatedAt
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = Project;