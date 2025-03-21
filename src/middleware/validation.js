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

const validateTaskCreation= [    // Validar que el título de la tarea no esté vacío
    body('title')
        .notEmpty().withMessage('The task title is required'), // Verifica que el título no esté vacío
    
    // Validar que la fecha de inicio sea obligatoria y tenga un formato válido
    body('creation_date')
        .notEmpty().withMessage('The start date is required') // Verifica que la fecha de inicio no esté vacía
        .isISO8601().withMessage('The start date must be in a valid ISO 8601 format'), // Verifica que la fecha tenga un formato válido
    
    // Validar que la fecha de finalización sea obligatoria, tenga un formato válido y sea mayor que la fecha de inicio
    body('completion_date')
        .notEmpty().withMessage('The completion date is required') // Verifica que la fecha de finalización no esté vacía
        .isISO8601().withMessage('The completion date must be in a valid ISO 8601 format') // Verifica que la fecha tenga un formato válido
        .custom((value, { req }) => {
            if (new Date(value) <= new Date(req.body.creation_date)) {
                throw new Error('The completion date must be later than the start date.'); // Verifica que la fecha de finalización sea mayor que la de inicio
            }
            return true;
        }),
    
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

const validateTaskUpdate = [
    body('title')
        .optional()
        .notEmpty().withMessage('El título no puede estar vacío')
        .isString().withMessage('El título debe ser un texto'),
    body('creation_date')
        .optional()
        .isISO8601().withMessage('La fecha de inicio debe tener un formato válido'),
    body('completion_date')
        .optional()
        .isISO8601().withMessage('La fecha de finalización debe tener un formato válido')
        .custom((value, { req }) => {
            if (req.body.creation_date && new Date(value) <= new Date(req.body.startDate)) {
                throw new Error('La fecha de finalización debe ser mayor a la de inicio.');
            }
            return true;
        }),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = { validateProjectCreation, validateProjectUpdate, validateTaskCreation, validateTaskUpdate };
