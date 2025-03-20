const { body, validationResult } = require('express-validator');

/**
 * Middleware para validar los datos de entrada al crear o actualizar un proyecto.
 * 
 * @constant
 * @type {Array}
 * @description Este middleware valida los campos `name` y `description` en el cuerpo de la solicitud.
 * - Verifica que `tittle` no esté vacío y sea una cadena de texto.
 * - Verifica que `description` no esté vacío y sea una cadena de texto.
 * - Si la validación falla, devuelve un estado 400 con los errores de validación.
 */
const validateProjectCreation = [
    // Validar el campo 'tittle'
    body('tittle')
        .notEmpty().withMessage('The project tittle is required') // Verifica que el nombre no esté vacío
        .isString().withMessage('The project tittle must be a string'), // Verifica que el nombre sea una cadena de texto

    // Validar el campo 'description'
    body('description')
        .notEmpty().withMessage('The project description is required') // Verifica que la descripción no esté vacía
        .isString().withMessage('The project description must be a string'), // Verifica que la descripción sea una cadena de texto

    // Middleware para manejar errores de validación
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Si hay errores de validación, devuelve un estado 400 con los errores
            return res.status(400).json({ errors: errors.array() });
        }
        next(); // Continúa con el siguiente middleware o controlador de ruta si la validación pasa
    }
];

const validateProjectUpdate = [
    // Validar el campo 'tittle'
    body('tittle')
        .optional() // El campo es opcional
        .notEmpty().withMessage('The project tittle is required') // Verifica que el nombre no esté vacío
        .isString().withMessage('The project tittle must be a string'), // Verifica que el nombre sea una cadena de texto

    // Validar el campo 'description'
    body('description')
        .optional() // El campo es opcional
        .notEmpty().withMessage('The project description is required') // Verifica que la descripción no esté vacía
        .isString().withMessage('The project description must be a string'), // Verifica que la descripción sea una cadena de texto

    // Middleware para manejar errores de validación
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Si hay errores de validación, devuelve un estado 400 con los errores
            return res.status(400).json({ errors: errors.array() });
        }
        next(); // Continúa con el siguiente middleware o controlador de ruta si la validación pasa
    }
];

module.exports = { validateProjectCreation, validateProjectUpdate };
