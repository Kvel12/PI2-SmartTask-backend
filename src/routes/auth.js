// Importamos Express para manejar las rutas
const express = require("express");

// Importamos las funciones del controlador de autenticación
const { register, login, logout } = require("../controllers/authController");

// Importamos el middleware de autenticación para proteger rutas
const auth = require("../middleware/auth");

// Creamos un enrutador de Express
const router = express.Router();

// Ruta para el registro de usuarios
// No requiere autenticación, ya que un usuario nuevo aún no tiene sesión
router.post("/register", register);

// Ruta para el inicio de sesión de usuarios
// No requiere autenticación, ya que se está validando el acceso
router.post("/login", login);

// Ruta para cerrar sesión
// Se protege con middleware de autenticación para asegurarse de que el usuario está logueado
router.post("/logout", auth, logout);

// Exportamos el enrutador para su uso en la aplicación principal
module.exports = router;
