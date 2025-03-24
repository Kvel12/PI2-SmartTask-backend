const sequelize = require('../config/database');
const User = require('./user');
const Project = require('./project');
const Task = require('./task');

// Definir asociaciones
Project.hasMany(Task, { 
  foreignKey: {
    name: 'projectId',
    allowNull: false
  },
  onDelete: 'CASCADE' 
});

Task.belongsTo(Project, { 
  foreignKey: {
    name: 'projectId',
    allowNull: false
  }
});

module.exports = {
  sequelize,
  User,
  Project,
  Task
};