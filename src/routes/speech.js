// routes/speech.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { Anthropic } = require('@anthropic-ai/sdk');
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

// Configurar el cliente de Claude (Anthropic)
let claude;
try {
  if (process.env.CLAUDE_API_KEY) {
    claude = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });
    logger.info('Cliente Claude API inicializado correctamente');
  } else {
    logger.error('Variable de entorno CLAUDE_API_KEY no configurada');
  }
} catch (error) {
  logger.error(`Error al configurar Claude API: ${error.message}`);
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
    
    // Si Claude no está disponible, usar enfoque basado en palabras clave
    if (!claude) {
      logger.warn('Claude no está configurado. Usando enfoque basado en palabras clave');
      return processWithKeywords(transcription, commandType, projectId, res);
    }

    // Preprocesar la transcripción para detectar el tipo de comando
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // Si no se especificó un tipo de comando, intentar detectarlo automáticamente
      try {
        detectedCommandType = await detectCommandType(transcription);
        logger.info(`Tipo de comando detectado: ${detectedCommandType}`);
      } catch (error) {
        logger.error(`Error al detectar tipo de comando: ${error.message}`);
        detectedCommandType = 'assistance';
      }
    }
    
    // Generar respuesta según el tipo de comando detectado
    let response;
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId);
        break;
      case 'createProject':
        response = await processCreateProjectCommand(transcription);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription);
        break;
      case 'assistance':
      default:
        response = await processAssistanceCommand(transcription);
        break;
    }
    
    logger.info(`Respuesta generada para comando de voz`);
    res.json(response);
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
      
      // Obtener información de proyectos y tareas para enviar como contexto al LLM
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
        logger.warn(`Error al obtener contexto para LLM: ${error.message}`);
        // Continuamos sin contexto si hay un error
      }
      
      // Preprocesar la transcripción para detectar el tipo de comando
      let detectedCommandType = commandType;
      
      if (!detectedCommandType) {
        // Detección por palabras clave primero (más confiable)
        const normalizedText = transcription.toLowerCase();
        
        if (normalizedText.includes('crear tarea') || normalizedText.includes('nueva tarea')) {
          detectedCommandType = 'createTask';
          logger.info('Tipo de comando detectado mediante palabras clave: createTask');
        } else if (normalizedText.includes('crear proyecto') || normalizedText.includes('nuevo proyecto')) {
          detectedCommandType = 'createProject';
          logger.info('Tipo de comando detectado mediante palabras clave: createProject');
        } else if (normalizedText.includes('buscar') || normalizedText.includes('encontrar')) {
          detectedCommandType = 'searchTask';
          logger.info('Tipo de comando detectado mediante palabras clave: searchTask');
        } else if (normalizedText.includes('actualizar') || normalizedText.includes('modificar')) {
          detectedCommandType = 'updateTask';
          logger.info('Tipo de comando detectado mediante palabras clave: updateTask');
        } else {
          // Solo usar Claude si es necesario
          try {
            detectedCommandType = await detectCommandType(transcription);
            logger.info(`Tipo de comando detectado por Claude: ${detectedCommandType}`);
          } catch (error) {
            logger.error(`Error al detectar tipo de comando: ${error.message}`);
            detectedCommandType = 'assistance';
          }
        }
      }
      
      // Generar respuesta según el tipo de comando detectado
      let response;
      
      switch (detectedCommandType) {
        case 'createTask':
          response = await processCreateTaskCommand(transcription, projectId, projectsContext);
          break;
        case 'createProject':
          response = await processCreateProjectCommand(transcription, projectsContext);
          break;
        case 'searchTask':
          response = await processSearchTaskCommand(transcription, projectsContext, tasksContext);
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


// Función para procesar comandos mediante palabras clave (alternativa cuando Claude no está disponible)
async function processWithKeywords(transcription, commandType, projectId, res) {
  const lowercaseTranscription = transcription.toLowerCase();
  let detectedType = commandType || 'assistance';
  
  // Detectar tipo por palabras clave si no se especificó
  if (!commandType) {
    if (lowercaseTranscription.includes('crear tarea') || lowercaseTranscription.includes('nueva tarea')) {
      detectedType = 'createTask';
    } else if (lowercaseTranscription.includes('crear proyecto') || lowercaseTranscription.includes('nuevo proyecto')) {
      detectedType = 'createProject';
    } else if (lowercaseTranscription.includes('buscar') || lowercaseTranscription.includes('encontrar')) {
      detectedType = 'searchTask';
    } else if (lowercaseTranscription.includes('actualizar') || lowercaseTranscription.includes('modificar')) {
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
      }
      
      // Si no se proporciona un projectId, intentar encontrar uno mencionado
      let targetProjectId = projectId;
      
      if (!targetProjectId) {
        try {
          const projects = await Project.findAll();
          
          // Buscar un proyecto mencionado en el texto
          for (const project of projects) {
            if (lowercaseTranscription.includes(project.title.toLowerCase())) {
              targetProjectId = project.id;
              break;
            }
          }
          
          // Si no se encuentra ninguna coincidencia, usar el primer proyecto
          if (!targetProjectId && projects.length > 0) {
            targetProjectId = projects[0].id;
          }
        } catch (error) {
          logger.error(`Error al buscar proyectos: ${error.message}`);
        }
      }
      
      if (!targetProjectId) {
        return res.json({
          success: false,
          error: 'No se ha podido determinar a qué proyecto asignar la tarea'
        });
      }
      
      // Crear la tarea en la base de datos
      try {
        const newTask = await Task.create({
          title: title,
          description: 'Tarea creada por comando de voz',
          status: status,
          completion_date: completionDate.toISOString().split('T')[0],
          projectId: targetProjectId,
          creation_date: new Date()
        });
        
        return res.json({
          success: true,
          action: 'createTask',
          taskDetails: newTask.dataValues,
          message: `He creado una nueva tarea: "${title}"`
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
      
      return res.json({
        success: true,
        action: 'createProject',
        projectDetails: {
          title: title,
          description: 'Proyecto creado por comando de voz',
          priority: priority,
          culmination_date: null,
          creation_date: new Date().toISOString()
        }
      });
    }
    
    case 'searchTask': {
      // Extraer término de búsqueda básico
      const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
      const searchTerm = searchMatch ? searchMatch[1].trim() : "";
      
      return res.json({
        success: true,
        action: 'searchTasks',
        searchParams: {
          searchTerm: searchTerm,
          status: null,
          dateRange: null,
          projectId: projectId
        }
      });
    }
    
    case 'assistance':
    default:
      return res.json({
        success: true,
        response: '¿En qué puedo ayudarte? Puedes pedirme crear tareas o proyectos, buscar información o ayudarte con la gestión de tus actividades.'
      });
  }
}

// Detectar automáticamente el tipo de comando basado en la transcripción
async function detectCommandType(transcription) {
    try {
      if (!claude) {
        throw new Error('Cliente Claude no inicializado');
      }
  
      // Términos clave para distintos tipos de comandos
      const createTaskTerms = ['crear tarea', 'nueva tarea', 'añadir tarea', 'agregar tarea', 'hacer tarea'];
      const createProjectTerms = ['crear proyecto', 'nuevo proyecto', 'añadir proyecto', 'agregar proyecto'];
      const searchTerms = ['buscar', 'encontrar', 'mostrar', 'listar', 'ver'];
  
      // Versión normalizada del texto (minúsculas sin acentos)
      const normalizedText = transcription.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
  
      // Detección rápida basada en palabras clave
      for (const term of createTaskTerms) {
        if (normalizedText.includes(term)) {
          logger.info(`Comando detectado por palabra clave: createTask`);
          return 'createTask';
        }
      }
  
      for (const term of createProjectTerms) {
        if (normalizedText.includes(term)) {
          logger.info(`Comando detectado por palabra clave: createProject`);
          return 'createProject';
        }
      }
  
      for (const term of searchTerms) {
        if (normalizedText.includes(term)) {
          logger.info(`Comando detectado por palabra clave: searchTask`);
          return 'searchTask';
        }
      }
  
      // Si no se detecta por palabras clave, usar Claude
      try {
        const message = await claude.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 20,
          temperature: 0.3,
          system: "Eres un asistente especializado en detectar tipos de comandos de voz para un sistema de gestión de tareas. Tu función es analizar la transcripción y determinar de qué tipo es.",
          messages: [
            { 
              role: "user", 
              content: `Analiza esta transcripción: "${transcription}" y clasifícala en una de estas categorías: "createTask" (si está solicitando crear una tarea), "createProject" (si está solicitando crear un proyecto), "searchTask" (si está buscando tareas), "updateTask" (si está actualizando una tarea existente), "assistance" (si está pidiendo ayuda o información general). Responde solo con el tipo, sin explicación.` 
            }
          ]
        });
    
        const detectedType = message.content[0].text.trim().toLowerCase();
        
        // Validar que el tipo sea uno de los aceptados
        const validTypes = ['createtask', 'createproject', 'searchtask', 'updatetask', 'assistance'];
        for (const validType of validTypes) {
          if (detectedType.includes(validType)) {
            return validType;
          }
        }
      } catch (claudeError) {
        logger.error(`Error al usar Claude para detectar comando: ${claudeError.message}`);
        // Fallar silenciosamente y usar asistencia por defecto
      }
      
      return 'assistance';
    } catch (error) {
      logger.error(`Error al detectar tipo de comando: ${error.message}`);
      return 'assistance';
    }
  }
  

async function processCreateTaskCommand(transcription, projectId, projectsContext = []) {
  try {
    // Si no se proporcionó un ID de proyecto, intentar determinar el proyecto
    // basándose en el contexto y la transcripción
    let targetProjectId = projectId;
    let targetProjectName = "";
    
    if (!targetProjectId && projectsContext && projectsContext.length > 0) {
      // Primero intentar identificar directamente el proyecto mencionado en la transcripción
      const normalizedTranscription = transcription.toLowerCase();
      
      // Intentar coincidir directamente con los títulos de los proyectos
      const mentionedProject = projectsContext.find(project => 
        normalizedTranscription.includes(project.title.toLowerCase())
      );
      
      if (mentionedProject) {
        targetProjectId = mentionedProject.id;
        targetProjectName = mentionedProject.title;
        logger.info(`Proyecto identificado directamente en transcripción: ${targetProjectName} (${targetProjectId})`);
      } else {
        // Si no se encuentra una coincidencia directa, usar el primer proyecto
        targetProjectId = projectsContext[0].id;
        targetProjectName = projectsContext[0].title;
        logger.info(`No se identificó proyecto en transcripción, usando el primero: ${targetProjectName} (${targetProjectId})`);
      }
    }
    
    // Si después de todo sigue sin haber un ID de proyecto, reportar error
    if (!targetProjectId) {
      return {
        success: false,
        error: 'No se pudo determinar a qué proyecto asignar la tarea'
      };
    }
  
    // Extraer detalles de la tarea 
    // Si Claude no está disponible, usar procesamiento básico
    if (!claude) {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : transcription.substring(0, 50);
      
      // Intentar extraer estado
      let status = 'pending';
      const normalizedTranscription = transcription.toLowerCase();
      if (normalizedTranscription.includes('en progreso')) status = 'in_progress';
      else if (normalizedTranscription.includes('completada')) status = 'completed';
      else if (normalizedTranscription.includes('cancelada')) status = 'cancelled';
      
      // Crear la tarea en la base de datos
      try {
        const newTask = await Task.create({
          title: title,
          description: 'Tarea creada por comando de voz',
          status: status,
          completion_date: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0], // 1 semana desde hoy
          projectId: targetProjectId,
          creation_date: new Date()
        });
        
        return {
          success: true,
          action: 'createTask',
          taskDetails: newTask.dataValues,
          message: `He creado una nueva tarea: "${title}" en el proyecto "${targetProjectName}".`
        };
      } catch (dbError) {
        logger.error(`Error al crear tarea: ${dbError.message}`);
        return {
          success: false,
          error: `Error al crear la tarea: ${dbError.message}`
        };
      }
    }
  
    // Si Claude está disponible, usarlo para extraer detalles más precisos
    try {
      const message = await claude.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        temperature: 0.3,
        system: `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos. 
        Estructura de una tarea:
        - title: Título de la tarea (obligatorio)
        - description: Descripción de la tarea (opcional)
        - status: Estado de la tarea (in_progress, completed, pending, cancelled)
        - completion_date: Fecha límite de la tarea en formato YYYY-MM-DD`,
        messages: [
          { 
            role: "user", 
            content: `Analiza esta transcripción: "${transcription}" 
            Extrae los detalles de la tarea que se está solicitando crear. 
            Devuelve SOLO un objeto JSON con los campos title, description, status y completion_date.
            Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
            Para completion_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para mañana" o "en una semana"), calcula la fecha correspondiente.
            Para status, si no se especifica, usa "pending" como valor por defecto.` 
          }
        ]
      });
    
      // Extraer y analizar la respuesta
      const responseContent = message.content[0].text;
      
      // Intentar extraer el JSON de la respuesta
      let taskDetails;
      try {
        // Buscar el objeto JSON en la respuesta
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          taskDetails = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No se pudo encontrar un objeto JSON en la respuesta');
        }
      } catch (jsonError) {
        logger.error(`Error al parsear JSON de la respuesta de Claude: ${jsonError.message}`);
        // Crear un objeto básico como fallback
        const titleMatch = transcription.match(/(?:crear|nueva) tarea (?:llamada|titulada|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
        const title = titleMatch ? titleMatch[1].trim() : transcription.substring(0, 50);
        
        taskDetails = {
          title: title,
          description: transcription,
          status: "pending",
          completion_date: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0] // 1 semana desde hoy
        };
      }
      
      // Validar que al menos tengamos un título
      if (!taskDetails.title) {
        taskDetails.title = "Nueva tarea";
      }
    
      // Asegurar que tengamos valores para todos los campos
      const formattedTaskDetails = {
        title: taskDetails.title,
        description: taskDetails.description || '',
        status: taskDetails.status || 'pending',
        completion_date: taskDetails.completion_date || new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
        projectId: targetProjectId,
        creation_date: new Date()
      };
    
      // Crear la tarea en la base de datos
      try {
        const newTask = await Task.create(formattedTaskDetails);
        
        // Devolver confirmación con detalles
        return {
          success: true,
          action: 'createTask',
          taskDetails: {
            ...newTask.dataValues,
            projectName: targetProjectName
          },
          message: `He creado una nueva tarea: "${taskDetails.title}" en el proyecto "${targetProjectName}".`
        };
      } catch (dbError) {
        logger.error(`Error al crear tarea en base de datos: ${dbError.message}`);
        
        return {
          success: false,
          error: `Error al crear la tarea: ${dbError.message}`
        };
      }
    } catch (claudeError) {
      logger.error(`Error al usar Claude para procesar la tarea: ${claudeError.message}`);
      
      // Fallback en caso de error de Claude
      const title = transcription.substring(0, 50);
      
      try {
        const newTask = await Task.create({
          title: title,
          description: 'Tarea creada por comando de voz',
          status: 'pending',
          completion_date: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
          projectId: targetProjectId,
          creation_date: new Date()
        });
        
        return {
          success: true,
          action: 'createTask',
          taskDetails: newTask.dataValues,
          message: `He creado una nueva tarea en el proyecto "${targetProjectName}".`
        };
      } catch (dbError) {
        return {
          success: false,
          error: `Error al crear la tarea: ${dbError.message}`
        };
      }
    }
  } catch (error) {
    logger.error(`Error al procesar comando de creación de tarea: ${error.message}`);
    
    // Implementar fallback para cuando hay un error
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
    // Si Claude no está disponible, usar procesamiento básico
    if (!claude) {
      // Extraer título básico
      const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
      
      // Verificar si ya existe un proyecto con ese título
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
      
      // Devolver los detalles para que el usuario confirme
      return {
        success: true,
        action: 'createProject',
        projectDetails: {
          title: title,
          description: 'Proyecto creado por comando de voz',
          priority: 'medium',
          culmination_date: null,
          creation_date: new Date().toISOString()
        }
      };
    }

    // Usar Claude para extraer detalles del proyecto desde la transcripción
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.3,
      system: `Eres un asistente especializado en extraer detalles de proyectos para un sistema de gestión.
      Estructura de un proyecto:
      - title: Título del proyecto (obligatorio)
      - description: Descripción del proyecto (opcional)
      - culmination_date: Fecha de culminación del proyecto en formato YYYY-MM-DD (opcional)
      - priority: Prioridad del proyecto (high, medium, low)`,
      messages: [
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles del proyecto que se está solicitando crear. 
          Devuelve SOLO un objeto JSON con los campos title, description, culmination_date y priority.
          Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
          Para culmination_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para fin de año"), calcula la fecha correspondiente.
          Para priority, si no se especifica, usa "medium" como valor por defecto.` 
        }
      ]
    });

    // Extraer y analizar la respuesta
    const responseContent = message.content[0].text;
    
    // Intentar extraer el JSON de la respuesta
    let projectDetails;
    try {
      // Buscar el objeto JSON en la respuesta
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        projectDetails = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No se pudo encontrar un objeto JSON en la respuesta');
      }
    } catch (jsonError) {
      logger.error(`Error al parsear JSON de la respuesta de Claude: ${jsonError.message}`);
      // Crear un objeto básico como fallback
      const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
      const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
      
      projectDetails = {
        title: title,
        description: transcription,
        priority: "medium",
        culmination_date: null
      };
    }
    
    // Validar que al menos tengamos un título
    if (!projectDetails.title) {
      projectDetails.title = "Nuevo proyecto";
    }

    // Verificar si ya existe un proyecto con ese título (deben ser únicos)
    const existingProject = await Project.findOne({
      where: {
        title: projectDetails.title
      }
    });

    if (existingProject) {
      return {
        success: false,
        error: 'Ya existe un proyecto con ese título'
      };
    }

    // Asegurar que tengamos valores para todos los campos
    const formattedProjectDetails = {
      title: projectDetails.title,
      description: projectDetails.description || '',
      priority: projectDetails.priority || 'medium',
      culmination_date: projectDetails.culmination_date || null,
      creation_date: new Date().toISOString()
    };

    // No creamos el proyecto automáticamente para permitir confirmación del usuario
    return {
      success: true,
      action: 'createProject',
      projectDetails: formattedProjectDetails
    };
  } catch (error) {
    logger.error(`Error al procesar comando de creación de proyecto: ${error.message}`);
    
    // Implementar fallback para cuando hay un error
    const titleMatch = transcription.match(/(?:crear|nuevo) proyecto (?:llamado|titulado|con nombre|con título)? ?["']?([^"'.,]+)["']?/i);
    const title = titleMatch ? titleMatch[1].trim() : "Nuevo proyecto";
    
    return {
      success: true,
      action: 'createProject',
      projectDetails: {
        title: title,
        description: 'Proyecto creado por comando de voz',
        priority: 'medium',
        culmination_date: null,
        creation_date: new Date().toISOString()
      }
    };
  }
}

// Procesar un comando para buscar tareas
async function processSearchTaskCommand(transcription, projectsContext = [], tasksContext = []) {
  try {
    // Si Claude no está disponible, usar procesamiento básico
    if (!claude) {
      // Extraer término de búsqueda básico
      const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
      const searchTerm = searchMatch ? searchMatch[1].trim() : "";
      
      return {
        success: true,
        action: 'searchTasks',
        searchParams: {
          searchTerm: searchTerm,
          status: null,
          dateRange: null
        }
      };
    }

    // Usar Claude para extraer criterios de búsqueda desde la transcripción
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.3,
      system: `Eres un asistente especializado en extraer criterios de búsqueda para un sistema de gestión de tareas.`,
      messages: [
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los criterios de búsqueda para tareas, que pueden incluir:
          - searchTerm: palabras clave para buscar en el título o descripción
          - status: estado de las tareas (in_progress, completed, pending, cancelled)
          - dateRange: rango de fechas en formato {from: "YYYY-MM-DD", to: "YYYY-MM-DD"}
          
          Devuelve SOLO un objeto JSON con estos campos. Si algún criterio no está presente, omítelo del objeto.` 
        }
      ]
    });

    // Extraer y analizar la respuesta
    const responseContent = message.content[0].text;
    
    // Intentar extraer el JSON de la respuesta
    let searchParams;
    try {
      // Buscar el objeto JSON en la respuesta
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        searchParams = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No se pudo encontrar un objeto JSON en la respuesta');
      }
    } catch (jsonError) {
      logger.error(`Error al parsear JSON de la respuesta de Claude: ${jsonError.message}`);
      // Crear un objeto básico como fallback
      const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
      const searchTerm = searchMatch ? searchMatch[1].trim() : "";
      searchParams = { searchTerm };
    }
    
    // Buscar tareas según los parámetros
    let tasks = [];
    try {
      // Construir where clause para la búsqueda
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
      
      // Buscar tareas
      tasks = await Task.findAll({
        where: whereClause,
        include: [
          {
            model: Project,
            attributes: ['id', 'title']
          }
        ]
      });
      
      // Formatear resultados
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
        searchParams,
        searchResults: formattedTasks,
        message: `He encontrado ${formattedTasks.length} tareas que coinciden con tu búsqueda.`
      };
    } catch (searchError) {
      logger.error(`Error al buscar tareas: ${searchError.message}`);
      
      // Construir la respuesta
      return {
        success: true,
        action: 'searchTasks',
        searchParams,
        error: `Error al buscar tareas: ${searchError.message}`
      };
    }
  } catch (error) {
    logger.error(`Error al procesar comando de búsqueda: ${error.message}`);
    
    // Implementar fallback para cuando hay un error
    const searchMatch = transcription.match(/(?:buscar|encontrar|mostrar) (?:tareas? (?:sobre|de|con))? ?["']?([^"'.,]+)["']?/i);
    const searchTerm = searchMatch ? searchMatch[1].trim() : "";
    
    return {
      success: true,
      action: 'searchTasks',
      searchParams: {
        searchTerm: searchTerm
      }
    };
  }
}

// Procesar un comando para actualizar una tarea
async function processUpdateTaskCommand(transcription, projectsContext = [], tasksContext = []) {
  try {
    // Si Claude no está disponible, devolver error
    if (!claude) {
      return {
        success: false,
        error: 'La funcionalidad de actualización requiere procesamiento de lenguaje natural. Por favor configura Claude API para usar esta función.'
      };
    }

    // Usar Claude para extraer detalles de la actualización
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.3,
      system: `Eres un asistente especializado en extraer detalles para actualizar tareas en un sistema de gestión de proyectos.`,
      messages: [
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles de la actualización de tarea, incluyendo:
          - taskIdentifier: Palabras exactas o número que identifique la tarea a actualizar
          - updates: Objeto con los campos a actualizar, que pueden incluir:
            - title: Nuevo título
            - description: Nueva descripción
            - status: Nuevo estado (in_progress, completed, pending, cancelled)
            - completion_date: Nueva fecha límite en formato YYYY-MM-DD
          
          Devuelve SOLO un objeto JSON con estos campos. Incluye en 'updates' solo los campos que realmente se van a actualizar.` 
        }
      ]
    });

    // Extraer y analizar la respuesta
    const responseContent = message.content[0].text;
    
    // Intentar extraer el JSON de la respuesta
    let updateDetails;
    try {
      // Buscar el objeto JSON en la respuesta
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        updateDetails = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No se pudo encontrar un objeto JSON en la respuesta');
      }
    } catch (jsonError) {
      logger.error(`Error al parsear JSON de la respuesta de Claude: ${jsonError.message}`);
      
      // Fallback simple
      return {
        success: false,
        error: 'No se pudo procesar la solicitud de actualización de tarea'
      };
    }
    
    // Validar que tengamos un identificador y al menos un campo a actualizar
    if (!updateDetails.taskIdentifier || !updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      return {
        success: false,
        error: 'No se pudo identificar la tarea o los campos a actualizar'
      };
    }
    
    // Buscar la tarea por su identificador
    let task;
    
    // Si es un número, buscar por ID
    if (!isNaN(updateDetails.taskIdentifier)) {
      task = await Task.findByPk(parseInt(updateDetails.taskIdentifier));
    } else {
      // Si es texto, buscar por título
      task = await Task.findOne({
        where: {
          title: {
            [Op.iLike]: `%${updateDetails.taskIdentifier}%`
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
    
    // Actualizar la tarea
    try {
      await task.update(updateDetails.updates);
      
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
    
    // Fallback simple
    return {
      success: false,
      error: 'No se pudo procesar la solicitud de actualización de tarea'
    };
  }
}

// Procesar un comando de asistencia general con información contextual
async function processAssistanceCommand(transcription, projectsContext = [], tasksContext = []) {
  try {
    if (!claude) {
      logger.warn('Cliente Claude no disponible, usando respuesta predeterminada');
      return {
        success: true,
        response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
      };
    }

    // Crear un prompt con contexto
    let contextPrompt = '';
    
    if (projectsContext.length > 0) {
      contextPrompt += `\nInformación de proyectos disponibles:
${JSON.stringify(projectsContext, null, 2)}`;
    }
    
    if (tasksContext.length > 0) {
      contextPrompt += `\nInformación de tareas:
${JSON.stringify(tasksContext, null, 2)}`;
    }

    // Usar Claude para generar una respuesta de asistencia
    const message = await claude.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 350,
      temperature: 0.7,
      system: `Eres un asistente virtual para un sistema de gestión de tareas llamado SmartTask. 
      Puedes ayudar con información sobre cómo usar la aplicación, responder preguntas sobre gestión de proyectos y tareas, 
      y ofrecer consejos para mejorar la productividad.
      
      Características de SmartTask:
      - Creación y gestión de proyectos con títulos, descripciones, fechas y prioridades
      - Creación y gestión de tareas dentro de cada proyecto
      - Las tareas tienen título, descripción, estado y fecha límite
      - Estados de tarea: pendiente, en progreso, completada, cancelada
      - Visualización de estadísticas en un dashboard
      
      ${contextPrompt}
      
      Mantén tus respuestas concisas, útiles y enfocadas en ayudar al usuario con su sistema de gestión de tareas.`,
      messages: [
        { 
          role: "user", 
          content: `El usuario ha dicho: "${transcription}"
          Proporciona una respuesta útil y concisa. No uses más de 3-4 oraciones.` 
        }
      ]
    });

    // Extraer la respuesta
    const assistantResponse = message.content[0].text.trim();
    
    return {
      success: true,
      response: assistantResponse
    };
  } catch (error) {
    logger.error(`Error al procesar comando de asistencia: ${error.message}`);
    
    // Proveer una respuesta predeterminada en caso de error
    return {
      success: true,
      response: '¿En qué puedo ayudarte? Puedo asistirte con la creación de tareas y proyectos, o ayudarte a buscar información en tu sistema de gestión de tareas.'
    };
  }
}

module.exports = router;