// routes/speech.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
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

// Configurar el cliente de Google Speech-to-Text
let speechClient;
try {
  // Asegurarse de que la variable de entorno contiene un JSON válido
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

// Endpoint para convertir audio a texto
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
    try {
    logger.info('Iniciando procesamiento de audio a texto');
    logger.info(`Headers recibidos: ${JSON.stringify(req.headers)}`);
        
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
      logger.info(`Archivo temporal eliminado: ${req.file.path}`);
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

// Endpoint para procesar comandos de voz con un LLM o una versión simplificada
router.post('/process-voice-command', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  try {
    logger.info(`Procesando comando de voz: "${transcription}"`);
    
    // Usar enfoque basado en palabras clave
    return processWithKeywords(transcription, commandType, projectId, req, res);
  } catch (error) {
    logger.error(`Error al procesar comando de voz: ${error.message}`, error);
    res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// Endpoint para procesar texto transcrito directamente (sin audio)
router.post('/process-voice-text', auth, async (req, res) => {
    const { transcription, commandType, projectId } = req.body;
    
    if (!transcription) {
      return res.status(400).json({ error: 'La transcripción es requerida' });
    }
  
    try {
      logger.info(`Procesando transcripción de voz: "${transcription}"`);
      
      // Obtener información de proyectos y tareas para tener contexto
      let projectsContext = [];
      let tasksContext = [];
      
      try {
        // Obtener todos los proyectos (sin filtrar por usuario)
        const projects = await Project.findAll();
        
        projectsContext = projects.map(p => ({
          id: p.id,
          title: p.title,
          priority: p.priority,
          culmination_date: p.culmination_date
        }));
        
        // Si hay un proyecto específico, obtener sus tareas
        if (projectId) {
          const tasks = await Task.findAll({ where: { projectId } });
          tasksContext = tasks.map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            completion_date: t.completion_date
          }));
        }
      } catch (error) {
        logger.warn(`Error al obtener contexto para procesamiento: ${error.message}`);
        // Continuamos sin contexto si hay un error
      }
      
      // Preprocesar la transcripción para detectar el tipo de comando
      let detectedCommandType = commandType;
      
      if (!detectedCommandType) {
        // Detección por palabras clave (más simple y confiable)
        const normalizedText = transcription.toLowerCase();
        
        if (normalizedText.includes('crear tarea') || normalizedText.includes('nueva tarea')) {
          detectedCommandType = 'createTask';
          logger.info('Tipo de comando detectado mediante palabras clave: createTask');
        } else if (normalizedText.includes('crear proyecto') || normalizedText.includes('nuevo proyecto')) {
          detectedCommandType = 'createProject';
          logger.info('Tipo de comando detectado mediante palabras clave: createProject');
        } else if (normalizedText.includes('buscar') || normalizedText.includes('encontrar') || 
                   normalizedText.includes('mostrar') || normalizedText.includes('listar')) {
          detectedCommandType = 'searchTask';
          logger.info('Tipo de comando detectado mediante palabras clave: searchTask');
        } else if (normalizedText.includes('actualizar') || normalizedText.includes('modificar') ||
                  normalizedText.includes('cambiar')) {
          detectedCommandType = 'updateTask';
          logger.info('Tipo de comando detectado mediante palabras clave: updateTask');
        } else {
          detectedCommandType = 'assistance';
          logger.info('No se detectó un comando específico, usando asistencia por defecto');
        }
      }
      
      // Generar respuesta según el tipo de comando detectado
      let response;
      
      switch (detectedCommandType) {
        case 'createTask':
          response = await processCreateTaskCommand(transcription, projectId, projectsContext, req);
          break;
        case 'createProject':
          response = await processCreateProjectCommand(transcription, projectsContext);
          break;
        case 'searchTask':
          response = await processSearchTaskCommand(transcription, projectId, projectsContext, tasksContext);
          break;
        case 'updateTask':
          response = await processUpdateTaskCommand(transcription, projectsContext, tasksContext);
          break;
        case 'assistance':
        default:
          response = await processAssistanceCommand(transcription, projectsContext, tasksContext);
          break;
      }
      
      logger.info(`Respuesta generada para comando de voz`);
      res.json(response);
    } catch (error) {
      logger.error(`Error al procesar texto de voz: ${error.message}`, error);
      res.status(500).json({ 
        success: false,
        error: 'Error al procesar el texto de voz',
        details: error.message 
      });
    }
  });


// Función para procesar comandos mediante palabras clave
async function processWithKeywords(transcription, commandType, projectId, req, res) {
  const lowercaseTranscription = transcription.toLowerCase();
  let detectedType = commandType || 'assistance';
  
  // Detectar tipo por palabras clave si no se especificó
  if (!commandType) {
    if (lowercaseTranscription.includes('crear tarea') || lowercaseTranscription.includes('nueva tarea')) {
      detectedType = 'createTask';
    } else if (lowercaseTranscription.includes('crear proyecto') || lowercaseTranscription.includes('nuevo proyecto')) {
      detectedType = 'createProject';
    } else if (lowercaseTranscription.includes('buscar') || lowercaseTranscription.includes('encontrar') || 
               lowercaseTranscription.includes('mostrar') || lowercaseTranscription.includes('listar')) {
      detectedType = 'searchTask';
    } else if (lowercaseTranscription.includes('actualizar') || lowercaseTranscription.includes('modificar') ||
               lowercaseTranscription.includes('cambiar')) {
      detectedType = 'updateTask';
    }
  }
  
  // Generar respuesta basada en palabras clave
  switch (detectedType) {
    case 'createTask': {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nueva tarea";
      
      // Intentar extraer estado
      let status = 'pending';
      if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
      else if (lowercaseTranscription.includes('completada')) status = 'completed';
      else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
      
      // Intentar extraer fecha límite básica
      let completionDate = new Date();
      if (lowercaseTranscription.includes('mañana')) {
        completionDate.setDate(completionDate.getDate() + 1);
      } else if (lowercaseTranscription.includes('próxima semana')) {
        completionDate.setDate(completionDate.getDate() + 7);
      } else if (lowercaseTranscription.includes('próximo mes')) {
        completionDate.setMonth(completionDate.getMonth() + 1);
      } else {
        // Por defecto, una semana desde hoy
        completionDate.setDate(completionDate.getDate() + 7);
      }
      
      // Si no se proporciona un projectId, intentar encontrar uno mencionado
      let targetProjectId = projectId;
      let targetProjectName = "";
      
      if (!targetProjectId) {
        try {
          const projects = await Project.findAll();
          
          // Buscar un proyecto mencionado en el texto
          for (const project of projects) {
            if (lowercaseTranscription.includes(project.title.toLowerCase())) {
              targetProjectId = project.id;
              targetProjectName = project.title;
              break;
            }
          }
          
          // Si no se encuentra ninguna coincidencia, usar el primer proyecto
          if (!targetProjectId && projects.length > 0) {
            targetProjectId = projects[0].id;
            targetProjectName = projects[0].title;
          }
        } catch (error) {
          logger.error(`Error al buscar proyectos: ${error.message}`);
        }
      } else {
        // Si se proporcionó un projectId, obtenemos su título
        try {
          const project = await Project.findByPk(projectId);
          if (project) {
            targetProjectName = project.title;
          }
        } catch (error) {
          logger.error(`Error al obtener detalles del proyecto: ${error.message}`);
        }
      }
      
      if (!targetProjectId) {
        return res.json({
          success: false,
          error: 'No se ha podido determinar a qué proyecto asignar la tarea'
        });
      }
      
      // Extraer descripción, si está disponible
      let description = 'Tarea creada por comando de voz';
      if (lowercaseTranscription.includes('para')) {
        const descriptionMatch = transcription.match(/para (.+)$/i);
        if (descriptionMatch) {
          description = descriptionMatch[1].trim();
        }
      }
      
      // Crear la tarea en la base de datos
      try {
        const newTask = await Task.create({
          title: title,
          description: description,
          status: status,
          completion_date: completionDate.toISOString().split('T')[0],
          projectId: targetProjectId,
          creation_date: new Date()
        });
        
        return res.json({
          success: true,
          action: 'createTask',
          taskDetails: newTask.dataValues,
          message: `He creado una nueva tarea: "${title}" en el proyecto "${targetProjectName}".`
        });
      } catch (dbError) {
        logger.error(`Error al crear tarea: ${dbError.message}`);
        
        return res.json({
          success: false,
          error: `Error al crear la tarea: ${dbError.message}`
        });
      }
    }
    
    case 'createProject': {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
      
      // Intentar extraer prioridad
      let priority = 'medium';
      if (lowercaseTranscription.includes('alta') || lowercaseTranscription.includes('urgente')) {
        priority = 'high';
      } else if (lowercaseTranscription.includes('baja')) {
        priority = 'low';
      }
      
      // Extraer descripción, si está disponible
      let description = 'Proyecto creado por comando de voz';
      if (lowercaseTranscription.includes('para')) {
        const descriptionMatch = transcription.match(/para (.+)$/i);
        if (descriptionMatch) {
          description = descriptionMatch[1].trim();
        }
      }
      
      // Verificar si ya existe un proyecto con ese título
      try {
        const existingProject = await Project.findOne({
          where: {
            title: title
          }
        });
        
        if (existingProject) {
          return res.json({
            success: false,
            error: 'Ya existe un proyecto con ese título'
          });
        }
        
        // Crear el proyecto en la base de datos
        const newProject = await Project.create({
          title: title,
          description: description,
          priority: priority,
          culmination_date: null,
          creation_date: new Date()
        });
        
        return res.json({
          success: true,
          action: 'createProject',
          projectDetails: newProject.dataValues,
          message: `He creado un nuevo proyecto: "${title}".`
        });
      } catch (dbError) {
        logger.error(`Error al crear proyecto: ${dbError.message}`);
        
        return res.json({
          success: false,
          error: `Error al crear el proyecto: ${dbError.message}`
        });
      }
    }
    
    case 'searchTask': {
      // Extraer término de búsqueda básico
      const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar|listar) (?:tareas? (?:sobre|de|con|relacionadas))? ?["']?([^"'.,]+)["']?/i);
      const searchTerm = searchMatch ? searchMatch[1].trim() : "";
      
      // Determinar el estado si está especificado
      let status = null;
      if (lowercaseTranscription.includes('pendiente')) status = 'pending';
      else if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
      else if (lowercaseTranscription.includes('completada')) status = 'completed';
      else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
      
      // Buscar tareas según los criterios
      try {
        // Construir la cláusula WHERE para la búsqueda
        const whereClause = {};
        
        if (searchTerm) {
          whereClause[Op.or] = [
            { title: { [Op.iLike]: `%${searchTerm}%` } },
            { description: { [Op.iLike]: `%${searchTerm}%` } }
          ];
        }
        
        if (status) {
          whereClause.status = status;
        }
        
        // Si hay un proyecto específico, filtrar por él
        if (projectId) {
          whereClause.projectId = projectId;
        }
        
        // Realizar la búsqueda
        const tasks = await Task.findAll({
          where: whereClause,
          include: [
            {
              model: Project,
              attributes: ['id', 'title']
            }
          ]
        });
        
        // Formatear los resultados para la respuesta
        const formattedTasks = tasks.map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          completion_date: task.completion_date,
          projectName: task.Project ? task.Project.title : 'Desconocido'
        }));
        
        return res.json({
          success: true,
          action: 'searchTasks',
          searchParams: {
            searchTerm,
            status
          },
          searchResults: formattedTasks,
          message: `He encontrado ${formattedTasks.length} tareas que coinciden con tu búsqueda.`
        });
      } catch (searchError) {
        logger.error(`Error al buscar tareas: ${searchError.message}`);
        
        return res.json({
          success: false,
          error: `Error al buscar tareas: ${searchError.message}`
        });
      }
    }
    
    case 'updateTask': {
      // Extraer identificador de la tarea
      const taskIdentifierMatch = transcription.match(/(?:actualizar|modificar|cambiar) (?:la )?tarea (?:llamada |titulada |con nombre |con título )?["']?([^"'.,]+)["']?/i);
      const taskIdentifier = taskIdentifierMatch ? taskIdentifierMatch[1].trim() : null;
      
      if (!taskIdentifier) {
        return res.json({
          success: false,
          error: 'No se pudo identificar qué tarea deseas actualizar'
        });
      }
      
      // Buscar la tarea por su identificador
      let task;
      
      try {
        // Si es un número, buscar por ID
        if (!isNaN(taskIdentifier)) {
          task = await Task.findByPk(parseInt(taskIdentifier));
        } else {
          // Si es texto, buscar por título
          task = await Task.findOne({
            where: {
              title: {
                [Op.iLike]: `%${taskIdentifier}%`
              }
            }
          });
        }
        
        if (!task) {
          return res.json({
            success: false,
            error: 'No se encontró la tarea a actualizar'
          });
        }
        
        // Determinar qué campos actualizar
        const updates = {};
        
        // Actualizar título si está especificado
        const titleMatch = transcription.match(/cambiar (?:el )?título (?:a|por) ["']?([^"'.,]+)["']?/i);
        if (titleMatch) {
          updates.title = titleMatch[1].trim();
        }
        
        // Actualizar estado si está especificado
        if (lowercaseTranscription.includes('estado')) {
          if (lowercaseTranscription.includes('pendiente')) updates.status = 'pending';
          else if (lowercaseTranscription.includes('en progreso')) updates.status = 'in_progress';
          else if (lowercaseTranscription.includes('completada')) updates.status = 'completed';
          else if (lowercaseTranscription.includes('cancelada')) updates.status = 'cancelled';
        }
        
        // Actualizar fecha si está especificada
        if (lowercaseTranscription.includes('fecha')) {
          let newDate = new Date();
          
          if (lowercaseTranscription.includes('mañana')) {
            newDate.setDate(newDate.getDate() + 1);
          } else if (lowercaseTranscription.includes('próxima semana')) {
            newDate.setDate(newDate.getDate() + 7);
          } else if (lowercaseTranscription.includes('próximo mes')) {
            newDate.setMonth(newDate.getMonth() + 1);
          }
          
          updates.completion_date = newDate.toISOString().split('T')[0];
        }
        
        // Si no hay campos para actualizar, informar al usuario
        if (Object.keys(updates).length === 0) {
          return res.json({
            success: false,
            error: 'No se identificaron campos para actualizar'
          });
        }
        
        // Actualizar la tarea
        await task.update(updates);
        
        return res.json({
          success: true,
          action: 'updateTask',
          taskDetails: task.dataValues,
          message: `He actualizado la tarea "${task.title}" correctamente.`
        });
      } catch (updateError) {
        logger.error(`Error al actualizar tarea: ${updateError.message}`);
        
        return res.json({
          success: false,
          error: `Error al actualizar la tarea: ${updateError.message}`
        });
      }
    }
    
    case 'assistance':
    default:
      return res.json({
        success: true,
        response: '¿En qué puedo ayudarte? Puedes pedirme crear tareas o proyectos, buscar información o ayudarte con la gestión de tus actividades.'
      });
  }
}

// Función para procesar comandos de creación de tareas
async function processCreateTaskCommand(transcription, projectId, projectsContext = [], req) {
  try {
    // Versión simplificada para crear tareas basado en palabras clave
    const lowercaseTranscription = transcription.toLowerCase();
    
    // Extraer título básico
    const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    let title = titleMatch ? titleMatch[1].trim() : "Nueva tarea";
    
    // Si no hay un título específico, tratar de usar la parte después de "crear tarea"
    if (title === "Nueva tarea" && lowercaseTranscription.includes("crear tarea")) {
      const fullTextMatch = transcription.match(/crear tarea (.+)/i);
      if (fullTextMatch) {
        // Limitar a las primeras palabras para que no sea demasiado largo
        const fullText = fullTextMatch[1].trim();
        const words = fullText.split(' ');
        if (words.length > 3) {
          title = words.slice(0, 3).join(' ');
        } else {
          title = fullText;
        }
      }
    }
    
    // Intentar extraer estado
    let status = 'pending';
    if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
    else if (lowercaseTranscription.includes('completada')) status = 'completed';
    else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
    
    // Intentar extraer fecha límite básica
    let completionDate = new Date();
    if (lowercaseTranscription.includes('mañana')) {
      completionDate.setDate(completionDate.getDate() + 1);
    } else if (lowercaseTranscription.includes('próxima semana')) {
      completionDate.setDate(completionDate.getDate() + 7);
    } else if (lowercaseTranscription.includes('próximo mes')) {
      completionDate.setMonth(completionDate.getMonth() + 1);
    } else {
      // Por defecto, una semana desde hoy
      completionDate.setDate(completionDate.getDate() + 7);
    }
    
    // Si no se proporciona un projectId, intentar encontrar uno mencionado
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId) {
      try {
        // Si tenemos contexto de proyectos, usarlo
        if (projectsContext && projectsContext.length > 0) {
          // Buscar un proyecto mencionado en el texto
          for (const project of projectsContext) {
            if (lowercaseTranscription.includes(project.title.toLowerCase())) {
              targetProjectId = project.id;
              targetProjectName = project.title;
              logger.info(`Proyecto identificado en transcripción: ${targetProjectName} (ID: ${targetProjectId})`);
              break;
            }
          }
          
          // Si no se encuentra ninguna coincidencia, usar el primer proyecto
          if (!targetProjectId) {
            targetProjectId = projectsContext[0].id;
            targetProjectName = projectsContext[0].title;
            logger.info(`No se identificó proyecto en transcripción, usando el primero: ${targetProjectName} (ID: ${targetProjectId})`);
          }
        } else {
          // Obtener proyectos de la base de datos
          const projects = await Project.findAll();
          
          if (projects.length > 0) {
            // Buscar un proyecto mencionado en el texto
            for (const project of projects) {
              if (lowercaseTranscription.includes(project.title.toLowerCase())) {
                targetProjectId = project.id;
                targetProjectName = project.title;
                logger.info(`Proyecto identificado en transcripción: ${targetProjectName} (ID: ${targetProjectId})`);
                break;
              }
            }
            
            // Si no se encuentra ninguna coincidencia, usar el primer proyecto
            if (!targetProjectId) {
              targetProjectId = projects[0].id;
              targetProjectName = projects[0].title;
              logger.info(`No se identificó proyecto en transcripción, usando el primero: ${targetProjectName} (ID: ${targetProjectId})`);
            }
          }
        }
      } catch (error) {
        logger.error(`Error al buscar proyectos: ${error.message}`);
      }
    } else {
      // Si se proporcionó un projectId, obtenemos su título
      try {
        const project = await Project.findByPk(projectId);
        if (project) {
          targetProjectName = project.title;
        }
      } catch (error) {
        logger.error(`Error al obtener detalles del proyecto: ${error.message}`);
      }
    }
    
    if (!targetProjectId) {
      return {
        success: false,
        error: 'No se ha podido determinar a qué proyecto asignar la tarea'
      };
    }
    
    // Extraer descripción, si está disponible
    let description = 'Tarea creada por comando de voz';
    if (lowercaseTranscription.includes('para')) {
      const descriptionMatch = transcription.match(/para (.+)$/i);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }
    }
    
    // Crear la tarea en la base de datos
    try {
      logger.info(`Creando tarea: "${title}" en proyecto ID: ${targetProjectId}`);
      
      const newTask = await Task.create({
        title: title,
        description: description,
        status: status,
        completion_date: completionDate.toISOString().split('T')[0],
        projectId: targetProjectId,
        creation_date: new Date()
      });
      
      logger.info(`Tarea creada con éxito: ID ${newTask.id}`);
      
      return {
        success: true,
        action: 'createTask',
        taskDetails: newTask.dataValues,
        message: `He creado una nueva tarea: "${title}" en el proyecto "${targetProjectName}".`
      };
    } catch (dbError) {
      logger.error(`Error al crear tarea en base de datos: ${dbError.message}`);
      
      return {
        success: false,
        error: `Error al crear la tarea: ${dbError.message}`
      };
    }
  } catch (error) {
    logger.error(`Error al procesar comando de creación de tarea: ${error.message}`);
    
    return {
      success: false,
      action: 'error',
      error: `Error al procesar la solicitud: ${error.message}`
    };
  }
}

// Procesar un comando para crear un proyecto
async function processCreateProjectCommand(transcription, projectsContext = []) {
  try {
    // Versión simplificada basada en palabras clave
    const lowercaseTranscription = transcription.toLowerCase();
    
    // Extraer título básico
    const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    let title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
    
    // Si no hay un título específico, tratar de usar la parte después de "crear proyecto"
    if (title === "Nuevo proyecto" && lowercaseTranscription.includes("crear proyecto")) {
      const fullTextMatch = transcription.match(/crear proyecto (.+)/i);
      if (fullTextMatch) {
        // Limitar a las primeras palabras para que no sea demasiado largo
        const fullText = fullTextMatch[1].trim();
        const words = fullText.split(' ');
        if (words.length > 3) {
          title = words.slice(0, 3).join(' ');
        } else {
          title = fullText;
        }
      }
    }
    
    // Intentar extraer prioridad
    let priority = 'medium';
    if (lowercaseTranscription.includes('alta') || lowercaseTranscription.includes('urgente')) {
      priority = 'high';
    } else if (lowercaseTranscription.includes('baja')) {
      priority = 'low';
    }
    
    // Extraer descripción, si está disponible
    let description = 'Proyecto creado por comando de voz';
    if (lowercaseTranscription.includes('para')) {
      const descriptionMatch = transcription.match(/para (.+)$/i);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }
    }
    
    // Verificar si ya existe un proyecto con ese título
    try {
      const existingProject = await Project.findOne({
        where: {
          title: title
        }
      });
      
      if (existingProject) {
        return {
          success: false,
          error: 'Ya existe un proyecto con ese título'
        };
      }
      
      // Crear el proyecto en la base de datos
      logger.info(`Creando proyecto: "${title}"`);
      
      const newProject = await Project.create({
        title: title,
        description: description,
        priority: priority,
        culmination_date: null,
        creation_date: new Date()
      });
      
      logger.info(`Proyecto creado con éxito: ID ${newProject.id}`);
      
      return {
        success: true,
        action: 'createProject',
        projectDetails: newProject.dataValues,
        message: `He creado un nuevo proyecto: "${title}".`
      };
    } catch (dbError) {
      logger.error(`Error al crear proyecto en base de datos: ${dbError.message}`);
      
      return {
        success: false,
        error: `Error al crear el proyecto: ${dbError.message}`
      };
    }
  } catch (error) {
    logger.error(`Error al procesar comando de creación de proyecto: ${error.message}`);
    
    return {
      success: false,
      error: `Error al procesar la solicitud: ${error.message}`
    };
  }
}

// Procesar un comando para buscar tareas
async function processSearchTaskCommand(transcription, projectId, projectsContext = [], tasksContext = []) {
  try {
    // Versión simplificada basada en palabras clave
    const lowercaseTranscription = transcription.toLowerCase();
    
    // Extraer término de búsqueda básico
    const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar|listar) (?:tareas? (?:sobre|de|con|relacionadas))? ?["']?([^"'.,]+)["']?/i);
    const searchTerm = searchMatch ? searchMatch[1].trim() : "";
    
    // Determinar el estado si está especificado
    let status = null;
    if (lowercaseTranscription.includes('pendiente')) status = 'pending';
    else if (lowercaseTranscription.includes('en progreso')) status = 'in_progress';
    else if (lowercaseTranscription.includes('completada')) status = 'completed';
    else if (lowercaseTranscription.includes('cancelada')) status = 'cancelled';
    
    // Verificar si se menciona un proyecto específico
    let searchProjectId = projectId;
    
    if (!searchProjectId) {
      // Buscar menciones de proyectos en el texto
      if (projectsContext && projectsContext.length > 0) {
        for (const project of projectsContext) {
          if (lowercaseTranscription.includes(project.title.toLowerCase())) {
            searchProjectId = project.id;
            break;
          }
        }
      } else {
        // Obtener proyectos de la base de datos
        const projects = await Project.findAll();
        
        for (const project of projects) {
          if (lowercaseTranscription.includes(project.title.toLowerCase())) {
            searchProjectId = project.id;
            break;
          }
        }
      }
    }
    
    // Buscar tareas según los criterios
    try {
      // Construir la cláusula WHERE para la búsqueda
      const whereClause = {};
      
      if (searchTerm) {
        whereClause[Op.or] = [
          { title: { [Op.iLike]: `%${searchTerm}%` } },
          { description: { [Op.iLike]: `%${searchTerm}%` } }
        ];
      }
      
      if (status) {
        whereClause.status = status;
      }
      
      // Si hay un proyecto específico, filtrar por él
      if (searchProjectId) {
        whereClause.projectId = searchProjectId;
      }
      
      logger.info(`Buscando tareas con criterios: ${JSON.stringify(whereClause)}`);
      
      // Realizar la búsqueda
      const tasks = await Task.findAll({
        where: whereClause,
        include: [
          {
            model: Project,
            attributes: ['id', 'title']
          }
        ]
      });
      
      logger.info(`Se encontraron ${tasks.length} tareas`);
      
      // Formatear los resultados para la respuesta
      const formattedTasks = tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        completion_date: task.completion_date,
        projectName: task.Project ? task.Project.title : 'Desconocido'
      }));
      
      return {
        success: true,
        action: 'searchTasks',
        searchParams: {
          searchTerm,
          status
        },
        searchResults: formattedTasks,
        message: `He encontrado ${formattedTasks.length} tareas que coinciden con tu búsqueda.`
      };
    } catch (searchError) {
      logger.error(`Error al buscar tareas: ${searchError.message}`);
      
      return {
        success: false,
        error: `Error al buscar tareas: ${searchError.message}`
      };
    }
  } catch (error) {
    logger.error(`Error al procesar comando de búsqueda: ${error.message}`);
    
    return {
      success: false,
      error: `Error al procesar la solicitud: ${error.message}`
    };
  }
}

// Procesar un comando para actualizar una tarea
async function processUpdateTaskCommand(transcription, projectsContext = [], tasksContext = []) {
  try {
    // Versión simplificada basada en palabras clave
    const lowercaseTranscription = transcription.toLowerCase();
    
    // Extraer identificador de la tarea
    const taskIdentifierMatch = transcription.match(/(?:actualizar|modificar|cambiar) (?:la )?tarea (?:llamada |titulada |con nombre |con título )?["']?([^"'.,]+)["']?/i);
    const taskIdentifier = taskIdentifierMatch ? taskIdentifierMatch[1].trim() : null;
    
    if (!taskIdentifier) {
      return {
        success: false,
        error: 'No se pudo identificar qué tarea deseas actualizar'
      };
    }
    
    // Buscar la tarea por su identificador
    let task;
    
    try {
      // Si es un número, buscar por ID
      if (!isNaN(taskIdentifier)) {
        task = await Task.findByPk(parseInt(taskIdentifier));
      } else {
        // Si es texto, buscar por título
        task = await Task.findOne({
          where: {
            title: {
              [Op.iLike]: `%${taskIdentifier}%`
            }
          }
        });
      }
      
      if (!task) {
        return {
          success: false,
          error: 'No se encontró la tarea a actualizar'
        };
      }
      
      // Determinar qué campos actualizar
      const updates = {};
      
      // Actualizar título si está especificado
      const titleMatch = transcription.match(/cambiar (?:el )?título (?:a|por) ["']?([^"'.,]+)["']?/i);
      if (titleMatch) {
        updates.title = titleMatch[1].trim();
      }
      
      // Actualizar estado si está especificado
      if (lowercaseTranscription.includes('estado')) {
        if (lowercaseTranscription.includes('pendiente')) updates.status = 'pending';
        else if (lowercaseTranscription.includes('en progreso')) updates.status = 'in_progress';
        else if (lowercaseTranscription.includes('completada')) updates.status = 'completed';
        else if (lowercaseTranscription.includes('cancelada')) updates.status = 'cancelled';
      } else {
        // También detectar si se menciona directamente el estado sin la palabra "estado"
        if (lowercaseTranscription.includes('a pendiente')) updates.status = 'pending';
        else if (lowercaseTranscription.includes('a en progreso')) updates.status = 'in_progress';
        else if (lowercaseTranscription.includes('a completada')) updates.status = 'completed';
        else if (lowercaseTranscription.includes('a cancelada')) updates.status = 'cancelled';
      }
      
      // Actualizar fecha si está especificada
      if (lowercaseTranscription.includes('fecha')) {
        let newDate = new Date();
        
        if (lowercaseTranscription.includes('mañana')) {
          newDate.setDate(newDate.getDate() + 1);
        } else if (lowercaseTranscription.includes('próxima semana')) {
          newDate.setDate(newDate.getDate() + 7);
        } else if (lowercaseTranscription.includes('próximo mes')) {
          newDate.setMonth(newDate.getMonth() + 1);
        }
        
        updates.completion_date = newDate.toISOString().split('T')[0];
      }
      
      // Si no hay campos para actualizar, inferir del contexto
      if (Object.keys(updates).length === 0) {
        // Si se menciona "completada" o "completar", marcar como completada
        if (lowercaseTranscription.includes('completada') || lowercaseTranscription.includes('completar')) {
          updates.status = 'completed';
        }
        // Si se menciona "en progreso", cambiar estado
        else if (lowercaseTranscription.includes('en progreso')) {
          updates.status = 'in_progress';
        }
      }
      
      // Si sigue sin haber campos para actualizar, informar al usuario
      if (Object.keys(updates).length === 0) {
        return {
          success: false,
          error: 'No se identificaron campos para actualizar'
        };
      }
      
      logger.info(`Actualizando tarea ID ${task.id} con: ${JSON.stringify(updates)}`);
      
      // Actualizar la tarea
      await task.update(updates);
      
      return {
        success: true,
        action: 'updateTask',
        taskDetails: task.dataValues,
        message: `He actualizado la tarea "${task.title}" correctamente.`
      };
    } catch (updateError) {
      logger.error(`Error al actualizar tarea: ${updateError.message}`);
      
      return {
        success: false,
        error: `Error al actualizar la tarea: ${updateError.message}`
      };
    }
  } catch (error) {
    logger.error(`Error al procesar comando de actualización: ${error.message}`);
    
    return {
      success: false,
      error: `Error al procesar la solicitud: ${error.message}`
    };
  }
}

// Procesar un comando de asistencia general con información contextual
async function processAssistanceCommand(transcription, projectsContext = [], tasksContext = []) {
  // Respuestas predefinidas para preguntas comunes
  const lowercaseTranscription = transcription.toLowerCase();
  
  // Respuestas específicas basadas en palabras clave
  if (lowercaseTranscription.includes('hola') || lowercaseTranscription.includes('buenos días') || 
      lowercaseTranscription.includes('buenas tardes') || lowercaseTranscription.includes('qué tal')) {
    return {
      success: true,
      response: '¡Hola! Soy tu asistente virtual de SmartTask. ¿En qué puedo ayudarte hoy? Puedo crear tareas, buscar información o ayudarte a gestionar tus proyectos.'
    };
  }
  
  if (lowercaseTranscription.includes('ayuda') || lowercaseTranscription.includes('qué puedes hacer')) {
    return {
      success: true,
      response: 'Puedo ayudarte a gestionar tus tareas y proyectos. Algunos comandos que puedes usar son: "crear tarea", "crear proyecto", "buscar tareas", "actualizar tarea". También puedes preguntarme sobre el estado de tus proyectos.'
    };
  }
  
  if (lowercaseTranscription.includes('cómo crear') && lowercaseTranscription.includes('tarea')) {
    return {
      success: true,
      response: 'Para crear una tarea, puedes decir: "Crear tarea [título] en el proyecto [nombre del proyecto]". También puedes especificar detalles como estado ("en progreso") y fecha límite.'
    };
  }
  
  if (lowercaseTranscription.includes('cómo crear') && lowercaseTranscription.includes('proyecto')) {
    return {
      success: true,
      response: 'Para crear un proyecto, puedes decir: "Crear proyecto [título]". Opcionalmente puedes especificar la prioridad como "alta", "media" o "baja", y añadir una descripción.'
    };
  }
  
  if (lowercaseTranscription.includes('cuántas tareas') || lowercaseTranscription.includes('número de tareas')) {
    try {
      const taskCount = await Task.count();
      return {
        success: true,
        response: `Actualmente tienes ${taskCount} tareas en total en el sistema.`
      };
    } catch (error) {
      logger.error(`Error al contar tareas: ${error.message}`);
    }
  }
  
  if (lowercaseTranscription.includes('cuántos proyectos') || lowercaseTranscription.includes('número de proyectos')) {
    try {
      const projectCount = await Project.count();
      return {
        success: true,
        response: `Actualmente tienes ${projectCount} proyectos en el sistema.`
      };
    } catch (error) {
      logger.error(`Error al contar proyectos: ${error.message}`);
    }
  }
  
  // Respuesta general por defecto
  return {
    success: true,
    response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
  };
}

module.exports = router;