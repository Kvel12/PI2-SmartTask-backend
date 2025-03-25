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
 * 
 * @see {@link https://sequelize.org/} for more information about Sequelize models.
 */

const Project = sequelize.define('Project', {
  id: {  // Agrega explícitamente el campo de ID
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING(1000),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  creation_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  culmination_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  priority: {
    type: DataTypes.ENUM('high', 'medium', 'low'),
    allowNull: true,
    defaultValue: 'medium'
  }
}, {
  timestamps: true
});

module.exports = Project;