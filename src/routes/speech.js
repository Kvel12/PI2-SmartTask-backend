const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const winston = require('winston');
const { Task, Project } = require('../models');
const { Op } = require('sequelize');

// Configurar logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Inicializar OpenAI (apuntando a Claude)
let openaiClient;
try {
  if (process.env.CLAUDE_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.CLAUDE_API_KEY,
      baseURL: "https://api.anthropic.com/v1/",
    });
    logger.info('Cliente de Claude (via OpenAI SDK) inicializado correctamente');
  } else {
    logger.warn('Variable de entorno CLAUDE_API_KEY no configurada');
  }
} catch (error) {
  logger.error(`Error al inicializar cliente de Claude: ${error.message}`);
}

// Configurar Google Speech-to-Text
let speechClient;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    speechClient = new speech.SpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    });
    logger.info('Cliente de Google Speech-to-Text inicializado correctamente');
  } else {
    logger.error('Variable de entorno GOOGLE_APPLICATION_CREDENTIALS_JSON no configurada');
  }
} catch (error) {
  logger.error('Error al configurar Google Speech-to-Text:', error);
}

// Asegurarse de que exista el directorio de uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    logger.info(`Directorio de uploads creado: ${uploadDir}`);
  } catch (error) {
    logger.error(`Error al crear directorio de uploads: ${error.message}`);
  }
}

// Configuración de multer para manejar archivos de audio
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = file.originalname.split('.').pop();
    cb(null, `${uuidv4()}.${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Límite de 10MB
  },
  fileFilter: (req, file, cb) => {
    // Validar el tipo de archivo
    const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de archivo no soportado: ${file.mimetype}`), false);
    }
  }
});

// Endpoint para convertir audio a texto
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    logger.info('Iniciando procesamiento de audio a texto');
    
    if (!speechClient) {
      logger.error('Google Speech-to-Text no está configurado correctamente');
      return res.status(500).json({ error: 'Google Speech-to-Text no está configurado correctamente' });
    }
    
    if (!req.file) {
      logger.error('No se recibió ningún archivo de audio');
      return res.status(400).json({ error: 'No se recibió ningún archivo de audio' });
    }

    logger.info(`Archivo recibido: ${req.file.filename}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes`);

    // Leer el archivo de audio
    const audioBytes = fs.readFileSync(req.file.path).toString('base64');
    
    // Determinar el encoding basado en el tipo de archivo
    let encoding;
    switch (req.file.mimetype) {
      case 'audio/webm':
        encoding = 'WEBM_OPUS';
        break;
      case 'audio/ogg':
        encoding = 'OGG_OPUS';
        break;
      case 'audio/wav':
        encoding = 'LINEAR16';
        break;
      case 'audio/mpeg':
      case 'audio/mp3':
        encoding = 'MP3';
        break;
      default:
        encoding = 'ENCODING_UNSPECIFIED'; // Dejar que Google detecte automáticamente
    }
    
    logger.info(`Procesando audio con encoding: ${encoding}`);

    // Configurar la solicitud para Google Speech-to-Text
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding,
        sampleRateHertz: 16000, // Frecuencia de muestreo recomendada
        languageCode: 'es-ES', // Español (España)
        alternativeLanguageCodes: ['es-MX', 'es-CO', 'es-AR', 'es-CL', 'es-US'], // Soporte para variantes regionales
        enableAutomaticPunctuation: true,
        model: 'default',
      },
    };

    // Realizar la solicitud a Google Speech-to-Text
    const [response] = await speechClient.recognize(request);
    
    // Extraer la transcripción
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    logger.info(`Transcripción completada: "${transcription}"`);

    // Eliminar el archivo de audio temporal
    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      logger.error(`Error al eliminar archivo temporal: ${unlinkError.message}`);
    }

    res.json({ success: true, transcription });
  } catch (error) {
    logger.error(`Error detallado en speech-to-text: ${error.stack}`);
    
    // Limpiar el archivo en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error(`Error al eliminar archivo temporal: ${unlinkError.message}`);
      }
    }
    
    res.status(500).json({ 
      error: 'Error al procesar el audio',
      details: error.message 
    });
  }
});

// Endpoint para procesar texto transcrito
router.post('/process-voice-text', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  try {
    logger.info(`Procesando transcripción de voz: "${transcription}"`);
    
    // Obtener proyectos para el contexto
    let projects = [];
    try {
      projects = await Project.findAll();
      logger.info(`Loaded ${projects.length} projects for context`);
    } catch (error) {
      logger.warn(`Error al obtener proyectos: ${error.message}`);
    }
    
    // Detectar el tipo de comando de manera más precisa
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // Normalizar y limpiar el texto para mejor detección
      const normalizedText = transcription.trim().toLowerCase()
        .replace(/á/g, 'a')
        .replace(/é/g, 'e')
        .replace(/í/g, 'i')
        .replace(/ó/g, 'o')
        .replace(/ú/g, 'u')
        .replace(/ü/g, 'u')
        .replace(/¿/g, '')
        .replace(/\?/g, '');
      
      // Expresiones regulares mejoradas para capturar comandos con mayor precisión
      const createTaskRegex = /\b(crea|crear|nueva|nuevo|agregar|añadir|hacer|registrar)\s+(una\s+)?(tarea|actividad)\b/i;
      const createProjectRegex = /\b(crea|crear|nuevo|nueva|agregar|añadir|registrar)\s+(un\s+)?(proyecto|plan)\b/i;
      const searchTaskRegex = /\b(buscar|encontrar|mostrar|listar|ver)\s+(las\s+)?(tareas?|actividades)\b/i;
      const searchProjectRegex = /\b(buscar|encontrar|mostrar|listar|ver)\s+(los\s+)?(proyectos?)\b/i;
      const updateTaskRegex = /\b(actualizar|modificar|cambiar|marcar|editar|cambia)\s+(la\s+)?(tarea|actividad|estatus|estado)\b/i;
      const updateProjectRegex = /\b(actualizar|modificar|cambiar|editar|cambia|modifica|actualiza)\s+(el\s+)?(proyecto|prioridad|probabilidad|título|titulo|nombre|fecha)\b/i;
      const countTasksRegex = /\b(cuantas|cuántas|numero|número|total\s+de)\s+(tareas|actividades)\b/i;
      const countProjectsRegex = /\b(cuantos|cuántos|numero|número|total\s+de)\s+(proyectos)\b/i;
      
      if (createTaskRegex.test(normalizedText)) {
        detectedCommandType = 'createTask';
        logger.info('Command type detected via regex: createTask');
      } else if (createProjectRegex.test(normalizedText)) {
        detectedCommandType = 'createProject';
        logger.info('Command type detected via regex: createProject');
      } else if (searchTaskRegex.test(normalizedText)) {
        detectedCommandType = 'searchTask';
        logger.info('Command type detected via regex: searchTask');
      } else if (searchProjectRegex.test(normalizedText)) {
        detectedCommandType = 'searchProject';
        logger.info('Command type detected via regex: searchProject');
      } else if (updateTaskRegex.test(normalizedText)) {
        detectedCommandType = 'updateTask';
        logger.info('Command type detected via regex: updateTask');
      } else if (updateProjectRegex.test(normalizedText)) {
        detectedCommandType = 'updateProject';
        logger.info('Command type detected via regex: updateProject');
      } else if (countTasksRegex.test(normalizedText)) {
        detectedCommandType = 'countTasks';
        logger.info('Command type detected via regex: countTasks');
      } else if (countProjectsRegex.test(normalizedText)) {
        detectedCommandType = 'countProjects';
        logger.info('Command type detected via regex: countProjects');
      } else {
        // Verificación de respaldo por palabras clave simples
        if (normalizedText.includes('tarea') && (
            normalizedText.includes('crea') || 
            normalizedText.includes('crear') || 
            normalizedText.includes('nueva') || 
            normalizedText.includes('agrega'))) {
          detectedCommandType = 'createTask';
          logger.info('Command type detected via keywords: createTask');
        } else if (normalizedText.includes('proyecto') && (
            normalizedText.includes('crea') || 
            normalizedText.includes('crear') || 
            normalizedText.includes('nuevo') || 
            normalizedText.includes('agrega'))) {
          detectedCommandType = 'createProject';
          logger.info('Command type detected via keywords: createProject');
        } else if ((normalizedText.includes('buscar') || normalizedText.includes('encontrar')) && 
                  normalizedText.includes('tarea')) {
          detectedCommandType = 'searchTask';
          logger.info('Command type detected via keywords: searchTask');
        } else if ((normalizedText.includes('buscar') || normalizedText.includes('encontrar')) && 
                  normalizedText.includes('proyecto')) {
          detectedCommandType = 'searchProject';
          logger.info('Command type detected via keywords: searchProject');
        } else if (normalizedText.includes('cambiar') || normalizedText.includes('actualizar') || 
                   normalizedText.includes('cambia') || normalizedText.includes('editar') || 
                   normalizedText.includes('edita') || normalizedText.includes('modificar')) {
          if (normalizedText.includes('tarea') || normalizedText.includes('estado') || 
              normalizedText.includes('estatus') || normalizedText.includes('completada') || 
              normalizedText.includes('completado')) {
            detectedCommandType = 'updateTask';
            logger.info('Command type detected via keywords: updateTask');
          } else if (normalizedText.includes('proyecto') || normalizedText.includes('prioridad') || 
                     normalizedText.includes('probabilidad')) {
            detectedCommandType = 'updateProject';
            logger.info('Command type detected via keywords: updateProject');
          }
        } // Añadir este patrón adicional para comandos relacionados con el sistema
        else if (normalizedText.includes('sistema') && 
            (normalizedText.includes('tareas') || normalizedText.includes('proyectos'))) {
            if (normalizedText.includes('tareas')) {
                detectedCommandType = 'countTasks';
            } else if (normalizedText.includes('proyectos')) {
                detectedCommandType = 'countProjects';
            }
        }else if (normalizedText.includes('cuantas') && normalizedText.includes('tareas')) {
          detectedCommandType = 'countTasks';
          logger.info('Command type detected via keywords: countTasks');
        } else if (normalizedText.includes('cuantos') && normalizedText.includes('proyectos')) {
          detectedCommandType = 'countProjects';
          logger.info('Command type detected via keywords: countProjects');
        } else {
          detectedCommandType = 'assistance';
          logger.info('No specific command detected, defaulting to assistance');
        }
      }

      // Detección adicional para casos complejos
      if (detectedCommandType === 'assistance') {
        // Buscar menciones de actualización de estado de tareas
        if (normalizedText.includes('tarea') && (
            normalizedText.includes('completa') || 
            normalizedText.includes('terminar') || 
            normalizedText.includes('finalizar') ||
            normalizedText.includes('estado') || 
            normalizedText.includes('estatus')
        )) {
          detectedCommandType = 'updateTask';
          logger.info('Special case detection: updateTask for task status update');
        }
        
        // Buscar menciones de creación de tareas en formato no estándar
        else if (normalizedText.includes('tarea') && normalizedText.includes('proyecto')) {
          // Podría ser una mención a crear una tarea en un proyecto específico
          if (!normalizedText.includes('buscar') && !normalizedText.includes('encontrar') && 
              !normalizedText.includes('mostrar') && !normalizedText.includes('listar')) {
            detectedCommandType = 'createTask';
            logger.info('Special case detection: createTask with project mention');
          }
        }
      }
    }
    
    logger.info(`Executing command type: ${detectedCommandType}`);
    
    // Procesar el comando según su tipo
    let response;
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId, projects);
        break;
      case 'createProject':
        response = await processCreateProjectCommand(transcription);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription, projectId);
        break;
      case 'searchProject':
        response = await processSearchProjectCommand(transcription);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription, projects);
        break;
      case 'updateProject':
        response = await processUpdateProjectCommand(transcription);
        break;
      case 'countTasks':
        response = await processCountTasksCommand();
        break;
      case 'countProjects':
        response = await processCountProjectsCommand();
        break;
      case 'assistance':
      default:
        response = await processAssistanceCommand(transcription, projects);
        break;
    }
    
    logger.info(`Command processed successfully, response type: ${response.success ? 'success' : 'error'}`);
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing voice command: ${error.message}`);
    return res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// Procesador de comando para crear tarea - MEJORADO
async function processCreateTaskCommand(transcription, projectId, projects = []) {
  logger.info(`Processing create task command: "${transcription}"`);
  
  try {
    // Extraer detalles de la tarea usando LLM
    let taskDetails = await extractTaskDetails(transcription);
    
    // Buscar el proyecto al que asignar la tarea
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId && projects.length > 0) {
      // Primero, intentar extraer el nombre del proyecto de la transcripción
      const projectNameMatch = transcription.match(/(?:en|para|del|proyecto)\s+(?:el\s+)?(?:proyecto\s+)?["']?([^"'.,]+)["']?/i);
      let possibleProjectName = null;
      if (projectNameMatch && projectNameMatch[1]) {
        possibleProjectName = projectNameMatch[1].trim();
        logger.info(`Posible nombre de proyecto extraído: ${possibleProjectName}`);
      }
      
      // Buscar proyecto por nombre exacto o parcial
      if (possibleProjectName) {
        // Intentar buscar coincidencia exacta primero
        for (const project of projects) {
          if (project.title.toLowerCase() === possibleProjectName.toLowerCase()) {
            targetProjectId = project.id;
            targetProjectName = project.title;
            logger.info(`Proyecto encontrado por coincidencia exacta: ${targetProjectName} (ID: ${targetProjectId})`);
            break;
          }
        }
        
        // Si no se encontró coincidencia exacta, buscar coincidencia parcial
        if (!targetProjectId) {
          for (const project of projects) {
            const projectTitle = project.title.toLowerCase();
            const normalizedPossibleName = possibleProjectName.toLowerCase();
            
            if (projectTitle.includes(normalizedPossibleName) || 
                normalizedPossibleName.includes(projectTitle)) {
              targetProjectId = project.id;
              targetProjectName = project.title;
              logger.info(`Proyecto encontrado por coincidencia parcial: ${targetProjectName} (ID: ${targetProjectId})`);
              break;
            }
          }
        }
      }
      
      // Si aún no se encontró un proyecto, intentar buscar en el texto completo
      if (!targetProjectId) {
        const normalizedText = transcription.toLowerCase();
        
        for (const project of projects) {
          const projectTitle = project.title.toLowerCase();
          // Verificar si el nombre del proyecto está incluido en la transcripción
          if (normalizedText.includes(projectTitle)) {
            targetProjectId = project.id;
            targetProjectName = project.title;
            logger.info(`Proyecto identificado en el texto completo: ${targetProjectName} (ID: ${targetProjectId})`);
            break;
          }
        }
      }
      
      // Si no se encontró ningún proyecto pero hay proyectos disponibles, usar el primero
      if (!targetProjectId && projects.length > 0) {
        targetProjectId = projects[0].id;
        targetProjectName = projects[0].title;
        logger.info(`No se identificó proyecto en el texto, usando el primero: ${targetProjectName} (ID: ${targetProjectId})`);
      }
    } else if (targetProjectId) {
      // Obtener el nombre del proyecto si se proporcionó un ID
      try {
        const project = await Project.findByPk(targetProjectId);
        if (project) {
          targetProjectName = project.title;
          logger.info(`Usando proyecto especificado: ${targetProjectName} (ID: ${targetProjectId})`);
        }
      } catch (error) {
        logger.error(`Error al obtener detalles del proyecto: ${error.message}`);
      }
    } else {
      logger.error(`No hay proyectos disponibles y no se especificó un ID de proyecto`);
      return {
        success: false,
        response: 'No se pudo crear la tarea porque no hay proyectos disponibles. Por favor, crea primero un proyecto.'
      };
    }
    
    // Asegurarnos de que tenemos un título para la tarea
    if (!taskDetails.title || taskDetails.title.trim() === '') {
      // Intentar extraer el título directamente del texto
      const titleMatch = transcription.match(/(?:llamada|titulada|nombre|título|se llama)\s+["']?([^"'.,]+)["']?/i);
      if (titleMatch && titleMatch[1]) {
        taskDetails.title = titleMatch[1].trim();
      } else {
        // Extraer un posible título de la transcripción si no se detectó uno
        const possibleTitle = transcription
          .replace(/crear tarea|nueva tarea|crea una tarea|hacer tarea/i, '')
          .replace(/en el proyecto|para el proyecto|en proyecto|para proyecto/i, '')
          .replace(targetProjectName, '')
          .trim();
        
        if (possibleTitle) {
          // Limitar a las primeras palabras para un título razonable
          const words = possibleTitle.split(' ');
          taskDetails.title = words.slice(0, Math.min(5, words.length)).join(' ');
        } else {
          taskDetails.title = 'Nueva tarea';
        }
      }
    }
    
    // Generar una descripción si no existe
    if (!taskDetails.description || taskDetails.description.trim() === '') {
      // Generar descripción basada en el título
      taskDetails.description = `Tarea para ${taskDetails.title.toLowerCase()}${targetProjectName ? ` en el proyecto ${targetProjectName}` : ''}.`;
    }
    
    // Asegurarnos de tener una fecha de vencimiento válida
    if (!taskDetails.completion_date) {
      // Establecer fecha de vencimiento a una semana en el futuro
      const oneWeek = new Date();
      oneWeek.setDate(oneWeek.getDate() + 7);
      taskDetails.completion_date = oneWeek.toISOString().split('T')[0];
    }
    
    // Crear la tarea
    const taskData = {
      title: taskDetails.title,
      description: taskDetails.description,
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date,
      projectId: targetProjectId,
      creation_date: new Date()
    };
    
    logger.info(`Creando tarea con datos: ${JSON.stringify(taskData)}`);
    
    const newTask = await Task.create(taskData);
    logger.info(`Tarea creada con éxito con ID: ${newTask.id}`);
    
    // Generar un mensaje de respuesta claro y orientado a la acción
    return {
      success: true,
      action: 'createTask',
      taskDetails: newTask.dataValues,
      response: `He creado la tarea "${taskData.title}" en el proyecto "${targetProjectName}". La tarea tiene una fecha límite para el ${taskData.completion_date} y está en estado ${taskData.status === 'pending' ? 'pendiente' : taskData.status}.`
    };
  } catch (error) {
    logger.error(`Error al crear tarea: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude crear la tarea debido a un error: ${error.message}. Por favor, intenta ser más específico o verifica que el proyecto mencionado exista.`
    };
  }
}

// Extraer detalles de tarea del texto - MEJORADO
async function extractTaskDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles con prompt mejorado
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos.
              Tu objetivo es identificar y extraer información específica de comandos de voz para crear tareas.
              No inventes información que no esté claramente implícita en el texto.
              Si no estás seguro de algún dato, déjalo como null para que el sistema use valores predeterminados.
              
              Los estados de tareas posibles son: "pending" (pendiente), "in_progress" (en progreso), "completed" (completada), y "cancelled" (cancelada).` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              
              Extrae los detalles de la tarea que se está solicitando crear. 
              
              Devuelve SOLO un objeto JSON con los campos:
              - title: título de la tarea (extrae las palabras que parezcan ser el título)
              - description: descripción (null si no está especificada)
              - status: estado ("pending", "in_progress", "completed" o "cancelled")
              - completion_date: fecha de vencimiento en formato YYYY-MM-DD
              
              Si no hay información sobre algún campo, déjalo como null.
              Para completion_date, si se menciona un plazo como "para mañana" o "en una semana", calcula la fecha correspondiente.`
            }
          ],
          temperature: 0.1, // Reducido para mayor precisión
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedData = JSON.parse(jsonMatch[0]);
          logger.info(`Datos de tarea extraídos por Claude: ${JSON.stringify(extractedData)}`);
          return extractedData;
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de tarea con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback mejorado)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer título
    let title = null;
    // Buscar título después de palabras clave como "llamada", "titulada", etc.
    const titlePatterns = [
      /(?:tarea|actividad)\s+(?:llamada|titulada|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
      /(?:crear|nueva)\s+(?:tarea|actividad)\s+(?:llamada|titulada|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
      /(?:llamada|titulada|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        break;
      }
    }
    
    // Si no se encontró título por patrones específicos, intentar extraerlo del contexto
    if (!title && (lowercaseText.includes("crear tarea") || lowercaseText.includes("nueva tarea") || 
                  lowercaseText.includes("crea tarea") || lowercaseText.includes("crea una tarea"))) {
      // Extraer todo después de las palabras clave y antes de posibles palabras como "en el proyecto"
      let textAfterKeyword = '';
      if (lowercaseText.includes("crear tarea")) {
        textAfterKeyword = transcription.match(/crear tarea\s+(.+?)(?:\s+(?:en|para)(?:\s+el)?\s+proyecto|$)/i);
      } else if (lowercaseText.includes("nueva tarea")) {
        textAfterKeyword = transcription.match(/nueva tarea\s+(.+?)(?:\s+(?:en|para)(?:\s+el)?\s+proyecto|$)/i);
      } else if (lowercaseText.includes("crea una tarea")) {
        textAfterKeyword = transcription.match(/crea una tarea\s+(.+?)(?:\s+(?:en|para)(?:\s+el)?\s+proyecto|$)/i);
      } else if (lowercaseText.includes("crea tarea")) {
        textAfterKeyword = transcription.match(/crea tarea\s+(.+?)(?:\s+(?:en|para)(?:\s+el)?\s+proyecto|$)/i);
      }
      
      if (textAfterKeyword && textAfterKeyword[1]) {
        // Usar las primeras palabras como título
        const words = textAfterKeyword[1].split(' ');
        if (words.length > 0) {
          title = words.slice(0, Math.min(5, words.length)).join(' ');
        }
      }
    }
    
    // Extraer estado
    let status = 'pending'; // Valor predeterminado
    if (lowercaseText.includes('en progreso') || lowercaseText.includes('iniciada')) {
      status = 'in_progress';
    } else if (lowercaseText.includes('completada') || lowercaseText.includes('terminada') || 
              lowercaseText.includes('finalizada') || lowercaseText.includes('hecha')) {
      status = 'completed';
    } else if (lowercaseText.includes('cancelada') || lowercaseText.includes('suspendida')) {
      status = 'cancelled';
    }
    
    // Extraer descripción
    let description = null;
    const descriptionPatterns = [
      /descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /con(?:\s+la)?\s+descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /con\s+descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /que\s+describe:?\s+(.+?)(?:\.|$)/i
    ];
    
    for (const pattern of descriptionPatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        description = match[1].trim();
        break;
      }
    }
    
    // Si no se encontró descripción con patrones específicos, buscar después de "para"
    if (!description && lowercaseText.includes('para')) {
      const descriptionMatch = transcription.match(/para\s+(.+?)(?:\s+(?:en|con)(?:\s+el)?\s+proyecto|\.|\s+status|\s+estado|$)/i);
      if (descriptionMatch && descriptionMatch[1]) {
        // Verificar que no sea parte de "para el proyecto..."
        const text = descriptionMatch[1].trim().toLowerCase();
        if (!text.startsWith('el proyecto') && !text.startsWith('proyecto')) {
          description = descriptionMatch[1].trim();
        }
      }
    }
    
    // Extraer fecha de finalización
    let completionDate = null;
    const today = new Date();
    
    if (lowercaseText.includes('mañana')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      completionDate = tomorrow.toISOString().split('T')[0];
    } else if (lowercaseText.includes('próxima semana') || lowercaseText.includes('proxima semana') || 
              lowercaseText.includes('siguiente semana') || lowercaseText.includes('semana que viene')) {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      completionDate = nextWeek.toISOString().split('T')[0];
    } else if (lowercaseText.includes('próximo mes') || lowercaseText.includes('proximo mes') || 
              lowercaseText.includes('siguiente mes') || lowercaseText.includes('mes que viene')) {
      const nextMonth = new Date(today);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      completionDate = nextMonth.toISOString().split('T')[0];
    } else {
      // Buscar fechas en formato DD/MM o DD/MM/YYYY
      const dateMatch = transcription.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
      if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1; // Meses en JS son 0-11
        let year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();
        
        // Ajustar año si se proporcionó en formato corto
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
        
        const date = new Date(year, month, day);
        completionDate = date.toISOString().split('T')[0];
      }
      // Si no se encontró fecha, usar una semana por defecto
      else {
        const oneWeek = new Date(today);
        oneWeek.setDate(oneWeek.getDate() + 7);
        completionDate = oneWeek.toISOString().split('T')[0];
      }
    }
    
    return {
      title,
      description,
      status,
      completion_date: completionDate
    };
  } catch (error) {
    logger.error(`Error al extraer detalles de tarea: ${error.message}`);
    // Devolver valores por defecto
    return {
      title: null,
      description: null,
      status: "pending",
      completion_date: null
    };
  }
}

// Procesador de comando para crear proyecto - MEJORADO
async function processCreateProjectCommand(transcription) {
  logger.info(`Processing create project command: "${transcription}"`);
  
  try {
    // Extraer detalles del proyecto usando LLM
    let projectDetails = await extractProjectDetails(transcription);
    
    // Asegurarnos de que tenemos un título para el proyecto
    if (!projectDetails.title || projectDetails.title.trim() === '') {
      // Intentar extraer el título directamente del texto
      const titleMatch = transcription.match(/(?:llamado|titulado|nombre|título|se llama)\s+["']?([^"'.,]+)["']?/i);
      if (titleMatch && titleMatch[1]) {
        projectDetails.title = titleMatch[1].trim();
      } else {
        // Extraer un posible título de la transcripción si no se detectó uno
        const possibleTitle = transcription
          .replace(/crear proyecto|nuevo proyecto|crea un proyecto/i, '')
          .trim();
        
        if (possibleTitle) {
          // Limitar a las primeras palabras para un título razonable
          const words = possibleTitle.split(' ');
          projectDetails.title = words.slice(0, Math.min(5, words.length)).join(' ');
        } else {
          projectDetails.title = 'Nuevo proyecto';
        }
      }
    }
    
    // Verificar si ya existe un proyecto con este título
    const existingProject = await Project.findOne({
      where: {
        title: {
          [Op.iLike]: projectDetails.title
        }
      }
    });
    
    if (existingProject) {
      logger.warn(`Ya existe un proyecto con el título "${projectDetails.title}"`);
      return {
        success: false,
        response: `Ya existe un proyecto llamado "${projectDetails.title}". ¿Quieres crear un proyecto con un nombre diferente o actualizar el existente?`
      };
    }
    
    // Generar una descripción si no existe
    if (!projectDetails.description || projectDetails.description.trim() === '') {
      // Generar descripción basada en el título
      projectDetails.description = `Proyecto para gestionar actividades relacionadas con ${projectDetails.title.toLowerCase()}.`;
    }
    
    // Asegurarnos de tener una prioridad válida
    if (!projectDetails.priority) {
      projectDetails.priority = 'medium';
    }
    
    // Crear el proyecto
    const projectData = {
      title: projectDetails.title,
      description: projectDetails.description,
      priority: projectDetails.priority,
      culmination_date: projectDetails.culmination_date,
      creation_date: new Date()
    };
    
    logger.info(`Creando proyecto con datos: ${JSON.stringify(projectData)}`);
    
    const newProject = await Project.create(projectData);
    logger.info(`Proyecto creado con éxito con ID: ${newProject.id}`);
    
    // Generar un mensaje de respuesta claro y orientado a la acción
    let responseMessage = `He creado el proyecto "${projectData.title}" con prioridad ${projectData.priority}.`;
    
    if (projectData.culmination_date) {
      responseMessage += ` La fecha de finalización está establecida para el ${projectData.culmination_date}.`;
    }
    
    responseMessage += ` Ya puedes empezar a añadir tareas a este proyecto.`;
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: newProject.dataValues,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al crear proyecto: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude crear el proyecto debido a un error: ${error.message}. Por favor, intenta ser más específico.`
    };
  }
}

// Extraer detalles de proyecto del texto - MEJORADO
async function extractProjectDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles con prompt mejorado
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer detalles de proyectos para un sistema de gestión.
              Tu objetivo es identificar y extraer información específica de comandos de voz para crear proyectos.
              No inventes información que no esté claramente implícita en el texto.
              Si no estás seguro de algún dato, déjalo como null para que el sistema use valores predeterminados.` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              
              Extrae los detalles del proyecto que se está solicitando crear. 
              
              Devuelve SOLO un objeto JSON con los campos:
              - title: título del proyecto (extrae las palabras que parezcan ser el título)
              - description: descripción (null si no está especificada)
              - priority: prioridad ("high", "medium" o "low")
              - culmination_date: fecha límite en formato YYYY-MM-DD (null si no está especificada)
              
              Si no hay información sobre algún campo, déjalo como null.
              Para culmination_date, si se menciona un plazo como "para fin de año", calcula la fecha correspondiente.`
            }
          ],
          temperature: 0.1, // Reducido para mayor precisión
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedData = JSON.parse(jsonMatch[0]);
          logger.info(`Datos extraídos por Claude: ${JSON.stringify(extractedData)}`);
          return extractedData;
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de proyecto con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback mejorado)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer título
    let title = null;
    const titlePatterns = [
      /(?:proyecto|plan)\s+(?:llamado|titulado|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
      /(?:crear|nuevo)\s+(?:proyecto|plan)\s+(?:llamado|titulado|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i,
      /(?:llamado|titulado|que se llama|con nombre|con título)\s+["']?([^"'.,]+)["']?/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        break;
      }
    }
    
    // Si no se encontró título por patrones específicos, intentar extraerlo del contexto
    if (!title && (lowercaseText.includes("crear proyecto") || lowercaseText.includes("nuevo proyecto") || 
                  lowercaseText.includes("crea proyecto") || lowercaseText.includes("crea un proyecto"))) {
      // Extraer todo después de las palabras clave
      let textAfterKeyword = '';
      if (lowercaseText.includes("crear proyecto")) {
        textAfterKeyword = transcription.match(/crear proyecto(?:s)?\s+(.+?)(?:\.|$)/i);
      } else if (lowercaseText.includes("nuevo proyecto")) {
        textAfterKeyword = transcription.match(/nuevo proyecto\s+(.+?)(?:\.|$)/i);
      } else if (lowercaseText.includes("crea un proyecto")) {
        textAfterKeyword = transcription.match(/crea un proyecto\s+(.+?)(?:\.|$)/i);
      } else if (lowercaseText.includes("crea proyecto")) {
        textAfterKeyword = transcription.match(/crea proyecto\s+(.+?)(?:\.|$)/i);
      }
      
      if (textAfterKeyword && textAfterKeyword[1]) {
        // Usar las primeras palabras como título
        const words = textAfterKeyword[1].split(' ');
        if (words.length > 0) {
          title = words.slice(0, Math.min(5, words.length)).join(' ');
        }
      }
    }
    
    // Extraer prioridad
    let priority = null;
    if (lowercaseText.includes('alta') || lowercaseText.includes('urgente') || 
        lowercaseText.includes('importante') || lowercaseText.includes('crítica') || 
        lowercaseText.includes('critica')) {
      priority = 'high';
    } else if (lowercaseText.includes('baja') || lowercaseText.includes('menor') || 
              lowercaseText.includes('secundaria')) {
      priority = 'low';
    } else if (lowercaseText.includes('media') || lowercaseText.includes('normal') || 
              lowercaseText.includes('intermedia') || lowercaseText.includes('medio')) {
      priority = 'medium';
    }
    
    // Extraer descripción
    let description = null;
    const descriptionPatterns = [
      /descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /con(?:\s+la)?\s+descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /con\s+descripci[oó]n:?\s+(.+?)(?:\.|$)/i,
      /que\s+describe:?\s+(.+?)(?:\.|$)/i
    ];
    
    for (const pattern of descriptionPatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        description = match[1].trim();
        break;
      }
    }
    
    // Si no se encontró descripción con patrones específicos, buscar después de "para"
    if (!description && lowercaseText.includes('para')) {
      const descriptionMatch = transcription.match(/para\s+(.+?)(?:\.|$)/i);
      if (descriptionMatch && descriptionMatch[1]) {
        description = descriptionMatch[1].trim();
      }
    }
    
    // Extraer fecha de culminación
    let culminationDate = null;
    const currentYear = new Date().getFullYear();
    
    if (lowercaseText.includes('fin de año') || lowercaseText.includes('final de año') || 
        lowercaseText.includes('terminar este año') || lowercaseText.includes('finalizar este año')) {
      culminationDate = `${currentYear}-12-31`;
    } else if (lowercaseText.includes('próximo mes') || lowercaseText.includes('proximo mes') || 
              lowercaseText.includes('siguiente mes') || lowercaseText.includes('mes que viene')) {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      culminationDate = nextMonth.toISOString().split('T')[0];
    } else if (lowercaseText.includes('próximo trimestre') || lowercaseText.includes('proximo trimestre') || 
              lowercaseText.includes('siguiente trimestre')) {
      const nextQuarter = new Date();
      nextQuarter.setMonth(nextQuarter.getMonth() + 3);
      culminationDate = nextQuarter.toISOString().split('T')[0];
    } else {
      // Buscar fechas en formato DD/MM o DD/MM/YYYY
      const dateMatch = transcription.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
      if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1; // Meses en JS son 0-11
        let year = dateMatch[3] ? parseInt(dateMatch[3]) : currentYear;
        
        // Ajustar año si se proporcionó en formato corto
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
        
        const date = new Date(year, month, day);
        culminationDate = date.toISOString().split('T')[0];
      }
    }
    
    return {
      title,
      description,
      priority,
      culmination_date: culminationDate
    };
  } catch (error) {
    logger.error(`Error al extraer detalles de proyecto: ${error.message}`);
    // Devolver valores por defecto
    return {
      title: null,
      description: null,
      priority: null,
      culmination_date: null
    };
  }
}

// Procesador de comando para buscar tareas - MEJORADO
async function processSearchTaskCommand(transcription, projectId) {
  logger.info(`Processing search task command: "${transcription}"`);
  
  try {
    // Extraer parámetros de búsqueda usando LLM
    let searchParams = await extractSearchParams(transcription, projectId);
    
    // Construir la consulta
    const whereClause = {};
    
    if (searchParams.searchTerm) {
      whereClause[Op.or] = [
        { title: { [Op.iLike]: `%${searchParams.searchTerm}%` } },
        { description: { [Op.iLike]: `%${searchParams.searchTerm}%` } }
      ];
    }
    
    if (searchParams.status) {
      whereClause.status = searchParams.status;
    }
    
    if (searchParams.projectId) {
      whereClause.projectId = searchParams.projectId;
    }
    
    logger.info(`Buscando tareas con criterios: ${JSON.stringify(whereClause)}`);
    
    // Ejecutar la búsqueda
    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: Project,
          attributes: ['id', 'title']
        }
      ],
      limit: 10 // Limitar resultados por rendimiento
    });
    
    logger.info(`Se encontraron ${tasks.length} tareas coincidentes`);
    
    // Formatear resultados
    const searchResults = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      completion_date: task.completion_date,
      projectName: task.Project ? task.Project.title : 'Desconocido'
    }));
    
    // Generar mensaje de respuesta claro
    let responseMessage;
    
    if (searchResults.length === 0) {
      if (searchParams.searchTerm) {
        responseMessage = `No encontré ninguna tarea relacionada con "${searchParams.searchTerm}". ¿Quieres probar con otros términos de búsqueda?`;
      } else {
        responseMessage = `No encontré ninguna tarea que coincida con tu búsqueda. Intenta con otros criterios o crea nuevas tareas.`;
      }
    } else {
      responseMessage = `He encontrado ${searchResults.length} tarea${searchResults.length === 1 ? '' : 's'}`;
      
      if (searchParams.searchTerm) {
        responseMessage += ` relacionada${searchResults.length === 1 ? '' : 's'} con "${searchParams.searchTerm}"`;
      }
      
      if (searchParams.status) {
        const statusText = {
          'pending': 'pendiente',
          'in_progress': 'en progreso',
          'completed': 'completada',
          'cancelled': 'cancelada'
        }[searchParams.status] || searchParams.status;
        
        responseMessage += ` con estado ${statusText}`;
      }
      
      responseMessage += `. Las tareas son:`;
      
      // Agregar resumen de las primeras 3 tareas
      const summaryCount = Math.min(3, searchResults.length);
      for (let i = 0; i < summaryCount; i++) {
        const task = searchResults[i];
        responseMessage += `\n- "${task.title}" (${task.projectName})`;
      }
      
      if (searchResults.length > summaryCount) {
        responseMessage += `\n...y ${searchResults.length - summaryCount} más.`;
      }
    }
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams,
      searchResults,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al buscar tareas: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude completar la búsqueda debido a un error: ${error.message}. Por favor, intenta con una consulta diferente.`
    };
  }
}

// Procesador para buscar proyectos - NUEVO
async function processSearchProjectCommand(transcription) {
  logger.info(`Processing search project command: "${transcription}"`);
  
  try {
    // Extraer término de búsqueda
    let searchTerm = null;
    const searchTermPattern = /(?:buscar|encontrar|mostrar|listar|ver)\s+(?:proyectos?|planes?)?(?:\s+(?:sobre|de|con|relacionad[oa]s?\s+con))?\s+["']?([^"'.,]+)["']?/i;
    
    const match = transcription.match(searchTermPattern);
    if (match && match[1]) {
      searchTerm = match[1].trim();
    } else {
      // Intentar extraer después de "proyectos"
      const afterProjectsMatch = transcription.match(/proyectos\s+(?:sobre|de|con|relacionados?\s+con)?\s+["']?([^"'.,]+)["']?/i);
      if (afterProjectsMatch && afterProjectsMatch[1]) {
        searchTerm = afterProjectsMatch[1].trim();
      }
    }
    
    if (!searchTerm) {
      return {
        success: false,
        response: `No pude identificar qué criterios usar para buscar proyectos. Por favor, especifica qué proyectos quieres encontrar.`
      };
    }
    
    logger.info(`Buscando proyectos con término: ${searchTerm}`);
    
    // Ejecutar la búsqueda
    const projects = await Project.findAll({
      where: {
        [Op.or]: [
          { title: { [Op.iLike]: `%${searchTerm}%` } },
          { description: { [Op.iLike]: `%${searchTerm}%` } }
        ]
      },
      include: [
        {
          model: Task,
          required: false
        }
      ]
    });
    
    logger.info(`Se encontraron ${projects.length} proyectos coincidentes`);
    
    // Formatear resultados
    const searchResults = projects.map(project => {
      const taskCount = project.Tasks ? project.Tasks.length : 0;
      return {
        id: project.id,
        title: project.title,
        description: project.description,
        priority: project.priority,
        culmination_date: project.culmination_date,
        taskCount
      };
    });
    
    // Generar mensaje de respuesta claro
    let responseMessage;
    
    if (searchResults.length === 0) {
      responseMessage = `No encontré ningún proyecto relacionado con "${searchTerm}". ¿Quieres probar con otros términos de búsqueda o crear un nuevo proyecto?`;
    } else {
      responseMessage = `He encontrado ${searchResults.length} proyecto${searchResults.length === 1 ? '' : 's'} relacionado${searchResults.length === 1 ? '' : 's'} con "${searchTerm}":`;
      
      // Agregar resumen de proyectos encontrados
      for (const project of searchResults) {
        responseMessage += `\n- "${project.title}" (prioridad: ${project.priority || 'no especificada'}) con ${project.taskCount} tarea${project.taskCount === 1 ? '' : 's'}`;
      }
    }
    
    return {
      success: true,
      action: 'searchProjects',
      searchTerm,
      searchResults,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al buscar proyectos: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude completar la búsqueda de proyectos debido a un error: ${error.message}. Por favor, intenta con una consulta diferente.`
    };
  }
}

// Extraer parámetros de búsqueda del texto - MEJORADO
async function extractSearchParams(transcription, projectId) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer parámetros con prompt mejorado
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un asistente especializado en extraer parámetros de búsqueda para un sistema de gestión de tareas.
              Tu objetivo es analizar comandos de voz e identificar criterios de búsqueda.
              No inventes información que no esté claramente implícita en el texto.` 
            },
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" 
              
              Extrae los criterios de búsqueda para tareas, que pueden incluir:
              - searchTerm: palabras clave para buscar en el título o descripción
              - status: estado de las tareas ("pending", "in_progress", "completed", "cancelled")
              
              Devuelve SOLO un objeto JSON con estos campos. Si algún criterio no está presente, déjalo como null o no lo incluyas.
              Si se mencionan palabras como "marketing", "desarrollo", etc., estas son probablemente términos de búsqueda.
              Si se mencionan estados como "pendiente" o "completada", extrae el estado correspondiente.`
            }
          ],
          temperature: 0.1, // Reducido para mayor precisión
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedData = JSON.parse(jsonMatch[0]);
          logger.info(`Parámetros de búsqueda extraídos por Claude: ${JSON.stringify(extractedData)}`);
          
          // Añadir projectId de la solicitud si existe
          if (projectId) {
            extractedData.projectId = projectId;
          }
          
          return extractedData;
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer parámetros de búsqueda con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback mejorado)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer término de búsqueda
    let searchTerm = null;
    const keywords = [
      'buscar', 'encontrar', 'mostrar', 'listar', 'ver', 
      'relacionadas', 'sobre', 'que tengan', 'de', 'con'
    ];
    
    for (const keyword of keywords) {
      if (lowercaseText.includes(keyword)) {
        const regex = new RegExp(`${keyword}\\s+(?:tareas?|actividades)?\\s+(?:sobre|de|con|relacionadas)?\\s+["']?([^"'.,]+)["']?`, 'i');
        const match = transcription.match(regex);
        
        if (match && match[1]) {
          searchTerm = match[1].trim();
          break;
        }
      }
    }
    
    // Si aún no encontramos un término, buscar palabras clave comunes después de "tareas"
    if (!searchTerm && lowercaseText.includes('tareas')) {
      const afterTasksMatch = transcription.match(/tareas\s+(?:de|sobre|con|relacionadas)?\s+(.+?)(?:\.|$)/i);
      if (afterTasksMatch) {
        searchTerm = afterTasksMatch[1].trim();
      }
    }
    
    // Extraer estado
    let status = null;
    if (lowercaseText.includes('pendiente')) status = 'pending';
    else if (lowercaseText.includes('en progreso')) status = 'in_progress';
    else if (lowercaseText.includes('completada') || lowercaseText.includes('terminada')) status = 'completed';
    else if (lowercaseText.includes('cancelada')) status = 'cancelled';
    
    return {
      searchTerm,
      status,
      projectId
    };
  } catch (error) {
    logger.error(`Error al extraer parámetros de búsqueda: ${error.message}`);
    // Devolver valores por defecto
    return {
      searchTerm: null,
      status: null,
      projectId
    };
  }
}

// Procesador de comando para actualizar tarea - MEJORADO
async function processUpdateTaskCommand(transcription, projects = []) {
  logger.info(`Processing update task command: "${transcription}"`);
  
  try {
    // Analizar si se menciona un proyecto específico
    let projectTitle = null;
    let projectId = null;
    
    const projectMention = transcription.match(/(?:proyecto|plan)\s+["']?([^"'.,]+)["']?/i);
    if (projectMention && projectMention[1]) {
      projectTitle = projectMention[1].trim();
      logger.info(`Se mencionó el proyecto: ${projectTitle}`);
      
      // Buscar el proyecto por título
      if (projects && projects.length > 0) {
        for (const project of projects) {
          if (project.title.toLowerCase() === projectTitle.toLowerCase() || 
              project.title.toLowerCase().includes(projectTitle.toLowerCase()) || 
              projectTitle.toLowerCase().includes(project.title.toLowerCase())) {
            projectId = project.id;
            projectTitle = project.title; // Usar el título real del proyecto
            logger.info(`Proyecto identificado: ${projectTitle} (ID: ${projectId})`);
            break;
          }
        }
      }
    }
    
    // Extraer detalles de la actualización usando LLM
    let updateDetails = await extractUpdateDetails(transcription);
    
    if (!updateDetails.taskIdentifier) {
      // Intentar extraer el identificador de la tarea directamente
      const taskMention = transcription.match(/(?:tarea|actividad)\s+["']?([^"'.,]+)["']?/i);
      if (taskMention && taskMention[1]) {
        updateDetails.taskIdentifier = taskMention[1].trim();
        logger.info(`Identificador de tarea extraído manualmente: ${updateDetails.taskIdentifier}`);
      } else {
        logger.error('No se encontró identificador de tarea en el comando');
        return {
          success: false,
          response: 'No pude identificar qué tarea deseas actualizar. Por favor, menciona el nombre o ID de la tarea que quieres modificar.'
        };
      }
    }
    
    logger.info(`Buscando tarea con identificador: ${updateDetails.taskIdentifier}`);
    
    // Buscar la tarea a actualizar
    let task;
    let whereClause = {};
    
    if (!isNaN(updateDetails.taskIdentifier)) {
      // Si el identificador es un número, buscar por ID
      task = await Task.findByPk(parseInt(updateDetails.taskIdentifier), {
        include: [{ model: Project }]
      });
    } else {
      // Si no, buscar por título con diferentes estrategias
      // 1. Búsqueda exacta por título
      whereClause = {
        title: {
          [Op.iLike]: updateDetails.taskIdentifier
        }
      };
      
      // Añadir filtro por proyecto si está disponible
      if (projectId) {
        whereClause.projectId = projectId;
      }
      
      task = await Task.findOne({
        where: whereClause,
        include: [{ model: Project }]
      });
      
      // 2. Si no se encontró, buscar coincidencia parcial
      if (!task) {
        whereClause = {
          title: {
            [Op.iLike]: `%${updateDetails.taskIdentifier}%`
          }
        };
        
        if (projectId) {
          whereClause.projectId = projectId;
        }
        
        task = await Task.findOne({
          where: whereClause,
          include: [{ model: Project }]
        });
      }
      
      // 3. Si aún no se encuentra, intentar coincidencia con palabras clave
      if (!task) {
        const keywords = updateDetails.taskIdentifier.split(' ');
        if (keywords.length > 0) {
          const mainKeyword = keywords[0];
          
          whereClause = {
            title: {
              [Op.iLike]: `%${mainKeyword}%`
            }
          };
          
          if (projectId) {
            whereClause.projectId = projectId;
          }
          
          const possibleTasks = await Task.findAll({
            where: whereClause,
            include: [{ model: Project }],
            limit: 5
          });
          
          if (possibleTasks.length > 0) {
            // Elegir la primera tarea que coincida más con el identificador original
            task = possibleTasks[0];
            for (const possibleTask of possibleTasks) {
              const taskTitle = possibleTask.title.toLowerCase();
              const taskIdentifier = updateDetails.taskIdentifier.toLowerCase();
              
              // Contar cuántas palabras del identificador aparecen en el título
              let matchCount = 0;
              for (const word of keywords) {
                if (taskTitle.includes(word.toLowerCase())) {
                  matchCount++;
                }
              }
              
              // Actualizar la tarea si encuentra una mejor coincidencia
              if (matchCount > 0) {
                task = possibleTask;
                break;
              }
            }
          }
        }
      }
    }
    
    if (!task) {
      logger.error(`No se encontró ninguna tarea que coincida con: ${updateDetails.taskIdentifier}`);
      return {
        success: false,
        response: `No encontré ninguna tarea que coincida con "${updateDetails.taskIdentifier}". Por favor, verifica el nombre o ID de la tarea e intenta de nuevo.`
      };
    }
    
    logger.info(`Tarea encontrada: ${task.id} - ${task.title}`);
    
    // Asegurarse de que hay actualizaciones para aplicar
    if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      // Si no se especificaron actualizaciones específicas pero se menciona un cambio de estado
      const lowercaseText = transcription.toLowerCase();
      
      if (lowercaseText.includes('completa') || 
          lowercaseText.includes('completar') || 
          lowercaseText.includes('completada') || 
          lowercaseText.includes('completado') || 
          lowercaseText.includes('finalizar') || 
          lowercaseText.includes('terminar')) {
        updateDetails.updates = { status: 'completed' };
        logger.info('Se detectó la intención de marcar como completada, aplicando actualización de estado');
      } else if (lowercaseText.includes('progreso') || 
                lowercaseText.includes('iniciar') || 
                lowercaseText.includes('comenzar') || 
                lowercaseText.includes('empezar')) {
        updateDetails.updates = { status: 'in_progress' };
        logger.info('Se detectó la intención de marcar como en progreso, aplicando actualización de estado');
      } else if (lowercaseText.includes('cancelar') || 
                lowercaseText.includes('cancelada') || 
                lowercaseText.includes('cancelado') || 
                lowercaseText.includes('suspender')) {
        updateDetails.updates = { status: 'cancelled' };
        logger.info('Se detectó la intención de marcar como cancelada, aplicando actualización de estado');
      } else if (lowercaseText.includes('pendiente')) {
        updateDetails.updates = { status: 'pending' };
        logger.info('Se detectó la intención de marcar como pendiente, aplicando actualización de estado');
      } else {
        // Intentar detectar estado por contexto
        if (lowercaseText.includes('estado') || lowercaseText.includes('estatus')) {
          if (lowercaseText.includes('a ')) {
            const afterStatusMatch = transcription.match(/(?:estado|estatus)\s+a\s+(.+?)(?:\.|$)/i);
            if (afterStatusMatch && afterStatusMatch[1]) {
              const statusText = afterStatusMatch[1].trim().toLowerCase();
              
              if (statusText.includes('completa') || statusText.includes('terminad')) {
                updateDetails.updates = { status: 'completed' };
              } else if (statusText.includes('progreso')) {
                updateDetails.updates = { status: 'in_progress' };
              } else if (statusText.includes('cancela') || statusText.includes('suspendid')) {
                updateDetails.updates = { status: 'cancelled' };
              } else if (statusText.includes('pendiente')) {
                updateDetails.updates = { status: 'pending' };
              }
            }
          }
        }
      }
      
      // Si aún no hay actualizaciones, informar al usuario
      if (!updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
        logger.error('No se especificaron actualizaciones en el comando');
        return {
          success: false,
          response: `No pude identificar qué cambios quieres hacer a la tarea "${task.title}". Por favor, especifica qué quieres actualizar (título, descripción, estado, fecha).`
        };
      }
    }
    
    logger.info(`Actualizando tarea ${task.id} con: ${JSON.stringify(updateDetails.updates)}`);
    
    // Guardar estado anterior para el mensaje
    const oldStatus = task.status;
    
    // Aplicar las actualizaciones
    await task.update(updateDetails.updates);
    
    // Generar mensaje de respuesta claro
    let responseMessage = `He actualizado la tarea "${task.title}"`;
    
    if (updateDetails.updates.title) {
      responseMessage += `, cambiando su título a "${updateDetails.updates.title}"`;
    }
    
    if (updateDetails.updates.status && oldStatus !== updateDetails.updates.status) {
      const statusText = {
        'pending': 'pendiente',
        'in_progress': 'en progreso',
        'completed': 'completada',
        'cancelled': 'cancelada'
      }[updateDetails.updates.status] || updateDetails.updates.status;
      
      responseMessage += `, marcándola como ${statusText}`;
    }
    
    if (updateDetails.updates.description) {
      responseMessage += `, actualizando su descripción`;
    }
    
    if (updateDetails.updates.completion_date) {
      responseMessage += `, estableciendo su fecha límite para el ${updateDetails.updates.completion_date}`;
    }
    
    responseMessage += `.`;
    
    return {
      success: true,
      action: 'updateTask',
      taskDetails: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        completion_date: task.completion_date,
        projectName: task.Project ? task.Project.title : 'Desconocido'
      },
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al actualizar tarea: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude actualizar la tarea debido a un error: ${error.message}.`
    };
  }
}

// Procesador para actualizar proyectos - MEJORADO
async function processUpdateProjectCommand(transcription) {
    logger.info(`Processing update project command: "${transcription}"`);
    
    try {
      // Extraer detalles de la actualización
      let projectIdentifier = null;
      let updates = {};
      
      // Normalizar el texto para mejor procesamiento
      const lowercaseText = transcription.toLowerCase();
      
      // MEJORA 1: Extraer el nombre del proyecto con patrones más precisos
      // Intentar extraer el nombre del proyecto evitando incluir la parte "a [nuevo_valor]"
      const projectPatterns = [
        /(?:proyecto|plan)\s+["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i,
        /(?:actualizar|cambiar|modificar|editar)\s+(?:el\s+)?(?:proyecto\s+)?["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i,
        /(?:título|titulo|nombre|prioridad)\s+(?:del\s+)?(?:proyecto\s+)?["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i
      ];
      
      for (const pattern of projectPatterns) {
        const match = transcription.match(pattern);
        if (match && match[1]) {
          projectIdentifier = match[1].trim();
          logger.info(`Identificador de proyecto extraído: ${projectIdentifier}`);
          break;
        }
      }
      
      // Búsqueda de respaldo después de "del proyecto"
      if (!projectIdentifier) {
        const afterDelMatch = transcription.match(/del\s+proyecto\s+["']?([^"'.,]+?)(?:\s+a\s+|\s+como\s+|\s+con\s+|\s+para\s+|$)/i);
        if (afterDelMatch && afterDelMatch[1]) {
          projectIdentifier = afterDelMatch[1].trim();
          logger.info(`Identificador de proyecto extraído después de "del proyecto": ${projectIdentifier}`);
        }
      }
      
      if (!projectIdentifier) {
        logger.error('No se encontró identificador de proyecto en el comando');
        return {
          success: false,
          response: 'No pude identificar qué proyecto deseas actualizar. Por favor, menciona el nombre o ID del proyecto que quieres modificar.'
        };
      }
      
      // MEJORA 2: Detectar las actualizaciones a realizar con patrones más flexibles
      
      // Detectar cambio de prioridad
      if (lowercaseText.includes('prioridad') || lowercaseText.includes('probabilidad')) {
        if (lowercaseText.includes('alta') || lowercaseText.includes('urgente')) {
          updates.priority = 'high';
        } else if (lowercaseText.includes('baja')) {
          updates.priority = 'low';
        } else if (lowercaseText.includes('media') || lowercaseText.includes('medio') || 
                  lowercaseText.includes('normal')) {
          updates.priority = 'medium';
        }
      }
      
      // MEJORA 3: Detectar cambio de título con patrones más flexibles
      if (lowercaseText.includes('título') || lowercaseText.includes('titulo') || 
          lowercaseText.includes('nombre')) {
        // Buscar después de "a", "por", "como"
        const titlePatterns = [
          /(?:título|titulo|nombre)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i,
          /(?:a|por|como)\s+(?:título|titulo|nombre)\s+["']?([^"'.,]+)["']?/i,
          /(?:cambiar|actualizar)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i
        ];
        
        for (const pattern of titlePatterns) {
          const match = transcription.match(pattern);
          if (match && match[1]) {
            updates.title = match[1].trim();
            logger.info(`Título extraído: ${updates.title}`);
            break;
          }
        }
        
        // Si no se encontró por patrones específicos, buscar después de la preposición "a"
        if (!updates.title && lowercaseText.includes(' a ')) {
          const afterAMatch = transcription.match(/\sa\s+["']?([^"'.,]+)["']?/i);
          if (afterAMatch && afterAMatch[1] && 
              !afterAMatch[1].startsWith('prioridad') && 
              !afterAMatch[1].includes('fecha')) {
            updates.title = afterAMatch[1].trim();
            logger.info(`Título extraído después de "a": ${updates.title}`);
          }
        }
      }
      
      // Detectar cambio de descripción
      if (lowercaseText.includes('descripción') || lowercaseText.includes('descripcion')) {
        const descMatch = transcription.match(/(?:descripción|descripcion)\s+(?:a|por|como)\s+["']?([^"'.,]+)["']?/i);
        if (descMatch && descMatch[1]) {
          updates.description = descMatch[1].trim();
        }
      }
      
      // Detectar cambio de fecha de culminación
      if (lowercaseText.includes('fecha') || lowercaseText.includes('culminación') || 
          lowercaseText.includes('culminacion') || lowercaseText.includes('vencimiento') || 
          lowercaseText.includes('finalización')) {
        const currentYear = new Date().getFullYear();
        
        // Buscar fechas en formato DD/MM o DD/MM/YYYY
        const dateMatch = transcription.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (dateMatch) {
          const day = parseInt(dateMatch[1]);
          const month = parseInt(dateMatch[2]) - 1; // Meses en JS son 0-11
          let year = dateMatch[3] ? parseInt(dateMatch[3]) : currentYear;
          
          // Ajustar año si se proporcionó en formato corto
          if (year < 100) {
            year += year < 50 ? 2000 : 1900;
          }
          
          const date = new Date(year, month, day);
          updates.culmination_date = date.toISOString().split('T')[0];
        } else if (lowercaseText.includes('fin de año') || lowercaseText.includes('final de año')) {
          updates.culmination_date = `${currentYear}-12-31`;
        } else if (lowercaseText.includes('próximo mes') || lowercaseText.includes('proximo mes')) {
          const nextMonth = new Date();
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          updates.culmination_date = nextMonth.toISOString().split('T')[0];
        } else if (lowercaseText.includes('diciembre')) {
          updates.culmination_date = `${currentYear}-12-31`;
        } else if (lowercaseText.includes('enero')) {
          updates.culmination_date = `${currentYear + 1}-01-31`;
        }
      }
      
      // MEJORA 4: Si no hay actualizaciones pero el comando sugiere cambiar título,
      // asumir que la parte después de "a" es el nuevo título
      if (Object.keys(updates).length === 0 && 
          (lowercaseText.includes('cambiar') || 
           lowercaseText.includes('actualizar') || 
           lowercaseText.includes('modificar'))) {
        
        if (lowercaseText.includes(' a ')) {
          const afterAMatch = transcription.match(/\sa\s+["']?([^"'.,]+)["']?/i);
          if (afterAMatch && afterAMatch[1]) {
            updates.title = afterAMatch[1].trim();
            logger.info(`Título inferido después de "a": ${updates.title}`);
          }
        }
      }
      
      // Verificar si hay actualizaciones para aplicar
      if (Object.keys(updates).length === 0) {
        logger.error('No se especificaron actualizaciones en el comando');
        return {
          success: false,
          response: `No pude identificar qué cambios quieres hacer al proyecto "${projectIdentifier}". Por favor, especifica qué quieres actualizar (título, descripción, prioridad, fecha).`
        };
      }
      
      // Buscar el proyecto a actualizar
      let project;
      
      if (!isNaN(projectIdentifier)) {
        // Si el identificador es un número, buscar por ID
        project = await Project.findByPk(parseInt(projectIdentifier));
      } else {
        // Si no, buscar por título (coincidencia parcial)
        project = await Project.findOne({
          where: {
            title: {
              [Op.iLike]: `%${projectIdentifier}%`
            }
          }
        });
        
        // Si no se encontró, intentar buscar con palabras clave
        if (!project) {
          const keywords = projectIdentifier.split(' ');
          if (keywords.length > 0) {
            const mainKeyword = keywords[0];
            
            const possibleProjects = await Project.findAll({
              where: {
                title: {
                  [Op.iLike]: `%${mainKeyword}%`
                }
              },
              limit: 5
            });
            
            if (possibleProjects.length > 0) {
              // Elegir el primer proyecto
              project = possibleProjects[0];
            }
          }
        }
      }
      
      if (!project) {
        logger.error(`No se encontró ningún proyecto que coincida con: ${projectIdentifier}`);
        return {
          success: false,
          response: `No encontré ningún proyecto que coincida con "${projectIdentifier}". Por favor, verifica el nombre o ID del proyecto e intenta de nuevo.`
        };
      }
      
      logger.info(`Actualizando proyecto ${project.id} con: ${JSON.stringify(updates)}`);
      
      // Guardar valores anteriores para el mensaje
      const oldPriority = project.priority;
      
      // Aplicar las actualizaciones
      await project.update(updates);
      
      // Generar mensaje de respuesta claro
      let responseMessage = `He actualizado el proyecto "${project.title}"`;
      
      if (updates.title) {
        responseMessage += `, cambiando su título a "${updates.title}"`;
      }
      
      if (updates.priority && oldPriority !== updates.priority) {
        const priorityText = {
          'high': 'alta',
          'medium': 'media',
          'low': 'baja'
        }[updates.priority] || updates.priority;
        
        responseMessage += `, estableciendo su prioridad a ${priorityText}`;
      }
      
      if (updates.description) {
        responseMessage += `, actualizando su descripción`;
      }
      
      if (updates.culmination_date) {
        responseMessage += `, estableciendo su fecha de finalización para el ${updates.culmination_date}`;
      }
      
      responseMessage += `.`;
      
      return {
        success: true,
        action: 'updateProject',
        projectDetails: project.dataValues,
        response: responseMessage
      };
    } catch (error) {
      logger.error(`Error al actualizar proyecto: ${error.message}`);
      return {
        success: false,
        response: `Lo siento, no pude actualizar el proyecto debido a un error: ${error.message}.`
      };
    }
  }

// Extraer detalles de actualización del texto - MEJORADO
async function extractUpdateDetails(transcription) {
  try {
    if (openaiClient) {
      try {
        // Usar OpenAI/Claude para extraer detalles con prompt mejorado
        const completion = await openaiClient.chat.completions.create({
          model: "claude-3-haiku-20240307",
          messages: [
            { 
              role: "system", 
              content: `Eres un especialista en actualización de tareas. Extrae detalles de actualización de comandos de voz.
              Tu objetivo es identificar qué tarea se quiere actualizar y qué campos se quieren modificar.
              No inventes información que no esté claramente implícita en el texto.` 
            },
            { 
              role: "user", 
              content: `Extrae los siguientes detalles de este comando de voz: "${transcription}"
              
              Devuelve SOLO un objeto JSON con estos campos:
              - taskIdentifier: palabras que identifican qué tarea actualizar (nombre o ID)
              - updates: un objeto con los campos a actualizar, que pueden incluir:
                - title: nuevo título 
                - description: nueva descripción
                - status: nuevo estado ("in_progress", "completed", "pending", "cancelled")
                - completion_date: nueva fecha límite en formato YYYY-MM-DD
              
              Solo incluye campos en 'updates' que realmente se vayan a cambiar según el comando.
              Si "en progreso" se menciona, usa "in_progress" para status.
              Si "completar", "completada" o "completado" se menciona, usa "completed" para status.
              Si "pendiente" se menciona, usa "pending" para status.
              Si "cancelar", "cancelada" o "cancelado" se menciona, usa "cancelled" para status.`
            }
          ],
          temperature: 0.1, // Reducido para mayor precisión
          max_tokens: 300,
        });
    
        // Extraer y analizar la respuesta
        const responseContent = completion.choices[0].message.content;
        
        // Intentar extraer el JSON de la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedData = JSON.parse(jsonMatch[0]);
          logger.info(`Detalles de actualización extraídos por Claude: ${JSON.stringify(extractedData)}`);
          return extractedData;
        } else {
          throw new Error('No se pudo extraer JSON de la respuesta');
        }
      } catch (apiError) {
        logger.error(`Error al extraer detalles de actualización con Claude: ${apiError.message}`);
        // Continuar con la extracción basada en palabras clave
      }
    }
    
    // Extracción basada en palabras clave (fallback mejorado)
    const lowercaseText = transcription.toLowerCase();
    
    // Extraer identificador de tarea
    let taskIdentifier = null;
    
    // Patrones comunes para identificar tarea
    const patterns = [
      /(?:actualizar|modificar|cambiar|editar|cambia|marca|marcar)\s+(?:la\s+)?(?:tarea|actividad)\s+(?:llamada |titulada |con nombre |con título |número |id )?["']?([^"'.,]+)["']?/i,
      /(?:tarea|actividad)\s+(?:llamada |titulada |con nombre |con título |número |id )?["']?([^"'.,]+)["']?/i,
      /(?:marcar|completar|finalizar|cambiar|cambia)\s+(?:la\s+)?(?:tarea|actividad)\s+(?:llamada |titulada |con nombre |con título |número |id )?["']?([^"'.,]+)["']?/i,
      /(?:estado|estatus)\s+(?:de\s+)(?:la\s+)?(?:tarea|actividad)\s+["']?([^"'.,]+)["']?/i
    ];
    
    for (const pattern of patterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        taskIdentifier = match[1].trim();
        break;
      }
    }
    
    // Si no se encontró identificador por patrones, buscar después de palabras clave
    if (!taskIdentifier) {
      const keywords = ['tarea', 'actividad', 'id'];
      
      for (const keyword of keywords) {
        if (lowercaseText.includes(keyword)) {
          const afterKeywordMatch = transcription.match(new RegExp(`${keyword}\\s+([^\\s.,]+)`, 'i'));
          if (afterKeywordMatch) {
            taskIdentifier = afterKeywordMatch[1].trim();
            break;
          }
        }
      }
    }
    
    // Extraer actualizaciones
    const updates = {};
    
    // Actualizar estado basado en palabras clave
    if (lowercaseText.includes('pendiente')) {
      updates.status = 'pending';
    } else if (lowercaseText.includes('en progreso')) {
      updates.status = 'in_progress';
    } else if (lowercaseText.includes('completada') || 
              lowercaseText.includes('completar') ||
              lowercaseText.includes('completado') ||
              lowercaseText.includes('terminar') ||
              lowercaseText.includes('terminada') ||
              lowercaseText.includes('finalizar') ||
              lowercaseText.includes('finalizada')) {
      updates.status = 'completed';
    } else if (lowercaseText.includes('cancelada') ||
              lowercaseText.includes('cancelar') ||
              lowercaseText.includes('cancelado')) {
      updates.status = 'cancelled';
    }
    
    // Actualizar título
    const titlePatterns = [
      /(?:cambiar|actualizar|cambia) (?:el )?título (?:a|por) ["']?([^"'.,]+)["']?/i,
      /(?:nuevo|cambiar) (?:el )?título:? ["']?([^"'.,]+)["']?/i,
      /título (?:nuevo|a|por):? ["']?([^"'.,]+)["']?/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        updates.title = match[1].trim();
        break;
      }
    }
    
    // Actualizar descripción
    const descriptionPatterns = [
      /(?:cambiar|actualizar|cambia) (?:la )?descripción (?:a|por) ["']?([^"'.,]+)["']?/i,
      /(?:nueva|cambiar) (?:la )?descripción:? ["']?([^"'.,]+)["']?/i,
      /descripción (?:nueva|a|por):? ["']?([^"'.,]+)["']?/i
    ];
    
    for (const pattern of descriptionPatterns) {
      const match = transcription.match(pattern);
      if (match && match[1]) {
        updates.description = match[1].trim();
        break;
      }
    }
    
    // Actualizar fecha
    if (lowercaseText.includes('fecha')) {
      let newDate = new Date();
      
      if (lowercaseText.includes('mañana')) {
        newDate.setDate(newDate.getDate() + 1);
        updates.completion_date = newDate.toISOString().split('T')[0];
      } else if (lowercaseText.includes('próxima semana') || lowercaseText.includes('proxima semana')) {
        newDate.setDate(newDate.getDate() + 7);
        updates.completion_date = newDate.toISOString().split('T')[0];
      } else if (lowercaseText.includes('próximo mes') || lowercaseText.includes('proximo mes')) {
        newDate.setMonth(newDate.getMonth() + 1);
        updates.completion_date = newDate.toISOString().split('T')[0];
      }
      
      // Buscar también fecha explícita en formato español (DD/MM/YYYY)
      const dateMatch = transcription.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
      if (dateMatch) {
        const day = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1; // Meses en JS son 0-11
        let year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
        
        // Ajustar año si se proporcionó en formato corto
        if (year < 100) {
          year += 2000;
        }
        
        const date = new Date(year, month, day);
        updates.completion_date = date.toISOString().split('T')[0];
      }
    }
    
    return {
      taskIdentifier,
      updates
    };
  } catch (error) {
    logger.error(`Error al extraer detalles de actualización: ${error.message}`);
    // Devolver valores por defecto
    return {
      taskIdentifier: null,
      updates: {}
    };
  }
}

// Procesador de comando para contar tareas - MEJORADO
async function processCountTasksCommand() {
  logger.info('Processing count tasks command');
  
  try {
    // Contar todas las tareas
    const taskCount = await Task.count();
    logger.info(`Total de tareas: ${taskCount}`);
    
    // Contar tareas por estado
    const pendingTasks = await Task.count({ where: { status: 'pending' } });
    const inProgressTasks = await Task.count({ where: { status: 'in_progress' } });
    const completedTasks = await Task.count({ where: { status: 'completed' } });
    const cancelledTasks = await Task.count({ where: { status: 'cancelled' } });
    
    // Verificar que la suma sea correcta
    const totalByStatus = pendingTasks + inProgressTasks + completedTasks + cancelledTasks;
    if (totalByStatus !== taskCount) {
      logger.warn(`Discrepancia en conteo de tareas: total=${taskCount}, suma de estados=${totalByStatus}`);
    }
    
    // Contar tareas por proyecto
    const projects = await Project.findAll({
      include: [
        {
          model: Task,
          attributes: ['id', 'status']
        }
      ]
    });
    
    const tasksByProject = projects.map(project => {
      const projectTasks = project.Tasks || [];
      return {
        projectId: project.id,
        projectName: project.title,
        taskCount: projectTasks.length,
        pendingCount: projectTasks.filter(task => task.status === 'pending').length,
        inProgressCount: projectTasks.filter(task => task.status === 'in_progress').length,
        completedCount: projectTasks.filter(task => task.status === 'completed').length,
        cancelledCount: projectTasks.filter(task => task.status === 'cancelled').length
      };
    });
    
    let responseMessage;
    
    if (taskCount === 0) {
      responseMessage = 'No tienes ninguna tarea en el sistema. ¿Quieres crear una nueva tarea?';
    } else {
      responseMessage = `Actualmente tienes ${taskCount} tarea${taskCount === 1 ? '' : 's'} en total en el sistema. `;
      
      responseMessage += `De ellas, ${pendingTasks} ${pendingTasks === 1 ? 'está' : 'están'} pendiente${pendingTasks === 1 ? '' : 's'}, `;
      responseMessage += `${inProgressTasks} en progreso y `;
      responseMessage += `${completedTasks} completada${completedTasks === 1 ? '' : 's'}.`;
      
      // Añadir información por proyecto si hay pocos proyectos con tareas
      const projectsWithTasks = tasksByProject.filter(p => p.taskCount > 0);
      if (projectsWithTasks.length > 0 && projectsWithTasks.length <= 3) {
        responseMessage += ` Distribución por proyecto:`;
        
        for (const project of projectsWithTasks) {
          responseMessage += `\n- "${project.projectName}": ${project.taskCount} tarea${project.taskCount === 1 ? '' : 's'}`;
        }
      }
    }
    
    return {
      success: true,
      action: 'countTasks',
      counts: {
        total: taskCount,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        cancelled: cancelledTasks
      },
      tasksByProject: tasksByProject,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al contar tareas: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude contar las tareas debido a un error: ${error.message}.`
    };
  }
}

// Procesador de comando para contar proyectos - MEJORADO
async function processCountProjectsCommand() {
  logger.info('Processing count projects command');
  
  try {
    // Contar todos los proyectos
    const projectCount = await Project.count();
    logger.info(`Total de proyectos: ${projectCount}`);
    
    // Contar tareas por proyecto
    const projects = await Project.findAll({
      include: [
        {
          model: Task,
          attributes: ['id']
        }
      ]
    });
    
    // Preparar estadísticas
    const projectStats = projects.map(project => ({
      id: project.id,
      title: project.title,
      taskCount: project.Tasks ? project.Tasks.length : 0
    }));
    
    let responseMessage;
    
    if (projectCount === 0) {
      responseMessage = 'No tienes ningún proyecto en el sistema. ¿Quieres crear un nuevo proyecto?';
    } else {
      responseMessage = `Actualmente tienes ${projectCount} proyecto${projectCount === 1 ? '' : 's'} en el sistema.`;
      
      // Añadir información sobre proyectos
      responseMessage += ' Los proyectos son:';
      
      for (const project of projectStats) {
        responseMessage += `\n- "${project.title}" con ${project.taskCount} tarea${project.taskCount === 1 ? '' : 's'}`;
      }
    }
    
    return {
      success: true,
      action: 'countProjects',
      count: projectCount,
      projects: projectStats,
      response: responseMessage
    };
  } catch (error) {
    logger.error(`Error al contar proyectos: ${error.message}`);
    return {
      success: false,
      response: `Lo siento, no pude contar los proyectos debido a un error: ${error.message}.`
    };
  }
}

// Procesador de comando de asistencia general - MEJORADO
async function processAssistanceCommand(transcription, projects = []) {
  logger.info(`Processing assistance command: "${transcription}"`);
  
  // Preparar contexto para Claude
  let projectsContext = "";
  
  if (projects && projects.length > 0) {
    projectsContext = `Proyectos actuales:\n`;
    for (const project of projects) {
      projectsContext += `- ${project.title}\n`;
    }
  } else {
    projectsContext = "No hay proyectos actualmente.";
  }
  
  // Intentar identificar si el comando realmente pertenece a otra categoría
  const normalizedText = transcription.toLowerCase()
    .replace(/á/g, 'a')
    .replace(/é/g, 'e')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/ú/g, 'u');
  
  // Detectar intenciones específicas que podrían haberse perdido
  if ((normalizedText.includes('crear') || normalizedText.includes('crea')) && 
      (normalizedText.includes('tarea') || normalizedText.includes('actividad'))) {
    logger.info('Redirigiendo desde assistance a createTask');
    return processCreateTaskCommand(transcription, null, projects);
  }
  
  if ((normalizedText.includes('crear') || normalizedText.includes('crea')) && 
      normalizedText.includes('proyecto')) {
    logger.info('Redirigiendo desde assistance a createProject');
    return processCreateProjectCommand(transcription);
  }
  
  if ((normalizedText.includes('buscar') || normalizedText.includes('encontrar') || normalizedText.includes('ver')) && 
      (normalizedText.includes('tarea') || normalizedText.includes('actividad'))) {
    logger.info('Redirigiendo desde assistance a searchTask');
    return processSearchTaskCommand(transcription, null);
  }
  
  if ((normalizedText.includes('buscar') || normalizedText.includes('encontrar') || normalizedText.includes('ver')) && 
      normalizedText.includes('proyecto')) {
    logger.info('Redirigiendo desde assistance a searchProject');
    return processSearchProjectCommand(transcription);
  }
  
  if ((normalizedText.includes('actualizar') || normalizedText.includes('cambiar') || 
       normalizedText.includes('cambia') || normalizedText.includes('editar') || 
       normalizedText.includes('modificar')) && 
      (normalizedText.includes('tarea') || normalizedText.includes('actividad') || 
       normalizedText.includes('estado') || normalizedText.includes('estatus'))) {
    logger.info('Redirigiendo desde assistance a updateTask');
    return processUpdateTaskCommand(transcription, projects);
  }
  
  if ((normalizedText.includes('actualizar') || normalizedText.includes('cambiar') || 
       normalizedText.includes('cambia') || normalizedText.includes('editar') || 
       normalizedText.includes('modificar')) && 
      (normalizedText.includes('proyecto') || normalizedText.includes('prioridad'))) {
    logger.info('Redirigiendo desde assistance a updateProject');
    return processUpdateProjectCommand(transcription);
  }
  
  if (normalizedText.includes('cuantas') && normalizedText.includes('tareas')) {
    logger.info('Redirigiendo desde assistance a countTasks');
    return processCountTasksCommand();
  }
  
  if (normalizedText.includes('cuantos') && normalizedText.includes('proyectos')) {
    logger.info('Redirigiendo desde assistance a countProjects');
    return processCountProjectsCommand();
  }
  
  // Generar respuesta con Claude si está disponible
  if (openaiClient) {
    try {
      // Usar Claude vía OpenAI SDK para generar una respuesta con contexto mejorado
      const completion = await openaiClient.chat.completions.create({
        model: "claude-3-haiku-20240307",
        messages: [
          { 
            role: "system", 
            content: `Eres un asistente virtual útil para SmartTask, una aplicación de gestión de tareas y proyectos.
            
            La aplicación permite a los usuarios:
            - Crear y gestionar proyectos con títulos, descripciones, fechas y prioridades
            - Crear y gestionar tareas dentro de proyectos
            - Buscar tareas por varios criterios
            - Actualizar detalles de tareas
            
            Tus respuestas deben ser:
            1. Amigables y orientadas a la acción
            2. Concisas (2-4 oraciones)
            3. Específicas a la aplicación SmartTask
            4. Informativas sobre cómo el usuario puede realizar la acción dentro de la aplicación
            
            IMPORTANTE: No digas "puedo ayudarte con eso" sin añadir información específica de cómo hacerlo.
            En lugar de solo sugerir usar la interfaz de la aplicación, actúa como si pudieras realizar acciones directamente o guiar al usuario paso a paso.
            
            Contexto actual:
            ${projectsContext}` 
          },
          { 
            role: "user", 
            content: `El usuario ha dicho: "${transcription}"
            
            Proporciona una respuesta útil que lo guíe exactamente en lo que necesita hacer. Sé específico sobre la funcionalidad de la aplicación y cómo pueden realizarse las acciones solicitadas.` 
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      return {
        success: true,
        response: completion.choices[0].message.content.trim()
      };
    } catch (error) {
      logger.error(`Claude assistance error: ${error.message}`);
    }
  }
  
  // Respuestas predefinidas basadas en palabras clave (fallback)
  
  if (normalizedText.includes('hola') || 
      normalizedText.includes('buenos dias') || 
      normalizedText.includes('buenas tardes') || 
      normalizedText.includes('buenas noches')) {
    return {
      success: true,
      response: '¡Hola! Soy tu asistente virtual de SmartTask. Puedo ayudarte a gestionar tus tareas y proyectos mediante comandos de voz. ¿Qué te gustaría hacer hoy?'
    };
  }
  
  if (normalizedText.includes('ayuda') || 
      normalizedText.includes('que puedes hacer')) {
    return {
      success: true,
      response: 'Puedo ayudarte con varias acciones en SmartTask: crear tareas o proyectos, buscar información, actualizar tareas existentes, contar tus tareas y proyectos, y más. Solo dime qué necesitas y lo haré por ti.'
    };
  }
  
  if (normalizedText.includes('como crear') && normalizedText.includes('tarea')) {
    return {
      success: true,
      response: 'Para crear una tarea, solo dime algo como "Crear tarea [título] en el proyecto [nombre]". Puedo añadir automáticamente detalles como la descripción y fecha de vencimiento, o puedes especificarlos tú mismo.'
    };
  }
  
  if (normalizedText.includes('como crear') && normalizedText.includes('proyecto')) {
    return {
      success: true,
      response: 'Para crear un proyecto nuevo, dime "Crear proyecto [nombre]". También puedes añadir detalles como "con prioridad alta" o una descripción, y yo me encargaré de crearlo con todos esos datos.'
    };
  }
  
  // Respuesta predeterminada
  return {
    success: true,
    response: 'Estoy aquí para ayudarte con la gestión de tus tareas y proyectos. Puedes pedirme que cree tareas o proyectos, busque información, actualice tareas existentes, o te muestre estadísticas de tu trabajo. ¿En qué puedo asistirte hoy?'
  };
}

module.exports = router;