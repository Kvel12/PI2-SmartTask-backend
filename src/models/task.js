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
  id: {  // Agrega explícitamente el campo de ID
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING(1000),
    allowNull: false
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
  completion_date: {
    type: DataTypes.DATE,
    allowNull: false
  },
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

module.exports = Task;