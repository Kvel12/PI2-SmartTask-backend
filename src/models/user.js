const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');


// Definición del modelo "User"
const User = sequelize.define('User', {
  username: {
    type: DataTypes.STRING,  // Nombre de usuario único
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,  // Contraseña del usuario (debe estar encriptada en una implementación real)
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,  // Nombre real del usuario
    allowNull: false
  },
  createdAt: {
    type: DataTypes.DATE,  // Fecha de creación
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,  // Fecha de última actualización
    defaultValue: DataTypes.NOW
  }
 }, {
    timestamps: true,
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    }
});

module.exports = User;  // Exporta el modelo
