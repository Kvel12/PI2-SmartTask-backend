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
    // Corregir 'tittle' a 'title'
    body('title')
        .notEmpty().withMessage('The project title is required')
        .isString().withMessage('The project title must be a string'),

    body('description')
        .notEmpty().withMessage('The project description is required')
        .isString().withMessage('The project description must be a string'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

/**
 * Middleware array to validate and handle errors for project update requests.
 * 
 * Validation rules:
 * - `title` (optional):
 *   - Must not be empty if provided.
 *   - Must be a string.
 * - `description` (optional):
 *   - Must not be empty if provided.
 *   - Must be a string.
 * 
 * If validation fails, a 400 status response is sent with the validation errors.
 * Otherwise, the request proceeds to the next middleware or route handler.
 * 
 * @type {Array<import('express').RequestHandler>}
 */
const validateProjectUpdate = [
    // Validar el campo 'tittle'
    body('title')
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

/**
 * Middleware array for validating task creation requests.
 * 
 * This middleware performs the following validations:
 * 1. Ensures the task title (`title`) is not empty.
 * 2. Ensures the creation date (`creation_date`) is not empty and follows the ISO 8601 format.
 * 3. Ensures the completion date (`completion_date`) is not empty, follows the ISO 8601 format, 
 *    and is later than the creation date.
 * 4. Handles validation errors by returning a 400 status code with the list of errors if any validation fails.
 * 
 * @type {Array<import('express').RequestHandler>}
 * 
 * @throws {Error} If the `completion_date` is earlier than or equal to the `creation_date`.
 * 
 * @example
 * // Example usage in an Express route
 * const express = require('express');
 * const { validateTaskCreation } = require('./middleware/validation');
 * 
 * const app = express();
 * 
 * app.post('/tasks', validateTaskCreation, (req, res) => {
 *     res.status(201).send('Task created successfully');
 * });
 */
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

/**
 * Middleware array to validate and handle errors for task update requests.
 * 
 * Validations:
 * - `title` (optional): Must be a non-empty string if provided.
 * - `creation_date` (optional): Must be in a valid ISO 8601 date format if provided.
 * - `completion_date` (optional): Must be in a valid ISO 8601 date format and later than `creation_date` if both are provided.
 * 
 * If validation fails, a 400 status code is returned with the validation errors.
 * 
 * @type {Array<import('express').RequestHandler>}
 */
const validateTaskUpdate = [
    // Validar que el título, si está presente, no esté vacío y sea una cadena de texto
    body('title')
        .optional() // El campo es opcional
        .notEmpty().withMessage('The task title cannot be empty') // Verifica que el título no esté vacío
        .isString().withMessage('The task title must be a string'), // Verifica que el título sea una cadena de texto

    // Validar que la fecha de inicio, si está presente, tenga un formato válido
    body('creation_date')
        .optional() // El campo es opcional
        .isISO8601().withMessage('The start date must be in a valid ISO 8601 format'), // Verifica que la fecha tenga un formato válido

   // Validar que la fecha de finalización, si está presente, tenga un formato válido y sea mayor que la fecha de inicio
    body('completion_date')
        .optional() // El campo es opcional
        .isISO8601().withMessage('The completion date must be in a valid ISO 8601 format') // Verifica que la fecha tenga un formato válido
        .custom((value, { req }) => {
            if (req.body.creation_date && new Date(value) <= new Date(req.body.creation_date)) {
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

module.exports = { validateProjectCreation, validateProjectUpdate, validateTaskCreation, validateTaskUpdate };
