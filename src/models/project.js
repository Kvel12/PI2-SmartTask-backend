const { DataTypes } = require('sequelize');

const Project = sequelize.define('Project', {
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  priority: {
    type: DataTypes.STRING,
    allowNull: false
  },
  culmination_date: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  timestamps: false
});

module.exports = Project;
