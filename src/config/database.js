const { Sequelize } = require('sequelize');
require('dotenv').config();
const logger = require('../logger');

let sequelize;

if (process.env.DATABASE_URL) {
  // Usar la URL de conexión completa proporcionada por Render
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Importante para conexiones SSL en Render
      }
    },
    logging: (msg) => logger.info(msg),
    define: {
      timestamps: true,
      underscored: true
    }
  });
} else {
  // Configuración de respaldo para desarrollo local
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      dialect: 'postgres',
      logging: (msg) => logger.info(msg),
      define: {
        timestamps: true,
        underscored: true
      }
    }
  );
}
module.exports = sequelize;