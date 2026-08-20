import express from 'express';
import { processSingleContactFromWebhook, processContactPipeline } from './distribute_contacts.js';
import { GHL_CONFIG, PAGE_TAG_MAP, PALACIOS_USERS } from './config.js';
import { auditAdAttribution } from './ad_attribution_engine.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const { apiKey, locationId } = GHL_CONFIG;



async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const res = await fetch(url, options);
    if (res.status === 429) {
      await sleep(250 * Math.pow(2, attempt));
      if (attempt < 3) return fetchWithRetry(url, options, attempt + 1);
    }
    return res;
  } catch (e) {
    if (attempt < 3) {
      await sleep(500);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw e;
  }
}

const HEADERS_CONTACTS = {
  'Authorization': `Bearer ${apiKey}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

const HEADERS_CONV = {
  'Authorization': `Bearer ${apiKey}`,
  'Version': '2021-04-15',
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let isSyncRunning = false;
let lastSyncTime = null;
let stats = {
  totalRuns: 0,
  tagsInjected: 0,
  opportunitiesCreated: 0,
  oppsPrecalificado: 0,
  oppsCalificado: 0,
  palaciosAssigned: 0,
  benavidesAssigned: 0,
  rooseveltAssigned: 0,
  piuraAssigned: 0,
  webhooksReceived: 0
};

// ==========================================
// BACKGROUND SYNCHRONIZATION ENGINE
// ==========================================
async function runFullSync() {
  if (isSyncRunning) return;
  isSyncRunning = true;
  stats.totalRuns++;

  const runId = new Date().toISOString();
  console.log(`[${runId}] Starting automated synchronization cycle...`);

  try {
    const url = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`;
    const res = await fetchWithRetry(url, { headers: HEADERS_CONTACTS });
    if (res.status === 429) {
      console.log(`[${runId}] Rate limit hit. Pausing...`);
      return;
    }
    const data = await res.json();
    const contacts = data.contacts || [];

    for (const c of contacts) {
      await auditContact(c, 'Auto Sync');
    }

    lastSyncTime = new Date().toISOString();
    console.log(`[${runId}] Synchronization cycle completed successfully.`);

  } catch (e) {
    console.error("[Error] Synchronization failure:", e.message);
  } finally {
    isSyncRunning = false;
  }
}

// ==========================================
// UNIVERSAL CONTACT AUDITOR (The Single Brain)
// ==========================================
async function auditContact(c, context) {
  let currentTags = (c.tags || []).map(t => typeof t === 'string' ? t.toLowerCase() : '');

  // 0. Radar de Duplicados Automático
  const first = (c.firstName || '').trim();
  const last = (c.lastName || '').trim();
  const fullName = `${first} ${last}`.trim();
  
  if (fullName && !currentTags.includes('alerta-duplicado-clic')) {
    try {
      const searchUrl = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${encodeURIComponent(fullName)}`;
      const searchRes = await fetchWithRetry(searchUrl, { headers: HEADERS_CONTACTS });
      
      if (searchRes.status === 200) {
        const searchData = await searchRes.json();
        const duplicates = (searchData.contacts || []).filter(existing => 
          existing.id !== c.id && 
          (existing.firstName || '').trim().toLowerCase() === first.toLowerCase() &&
          (existing.lastName || '').trim().toLowerCase() === last.toLowerCase()
        );

        if (duplicates.length > 0) {
          // Etiquetar
          await fetchWithRetry(`https://services.leadconnectorhq.com/contacts/${c.id}/tags`, {
            method: 'POST',
            headers: HEADERS_CONTACTS,
            body: JSON.stringify({ tags: [...new Set([...currentTags, 'alerta-duplicado-clic'])] })
          });
          currentTags.push('alerta-duplicado-clic');
          console.log(`  [Radar] Contact: ${fullName} es un posible DUPLICADO. Etiquetado.`);

          // Inyectar Nota Anti-Refutaciones
          const noteBody = `🚨 ALERTA DE SISTEMA: POSIBLE DUPLICADO / CLIC MÚLTIPLE\nEste lead tiene exactamente el mismo nombre que otro contacto previo.\n\nPara validar si es un Homónimo (Personas distintas):\n1. Pídale su número de teléfono.\n2. Si al guardar el teléfono el CRM advierte que ya existe, es la misma persona haciendo clics múltiples (Descuento de comisión).\n3. Si al guardar el teléfono el CRM lo acepta sin errores, es un HOMÓNIMO real. (Queda autorizado a borrar la etiqueta alerta-duplicado-clic).`;
          
          await fetchWithRetry(`https://services.leadconnectorhq.com/contacts/${c.id}/notes`, {
            method: 'POST',
            headers: HEADERS_CONTACTS,
            body: JSON.stringify({ body: noteBody })
          });
        }
      }
    } catch(e) {
      console.error(`  [Radar Error] Fallo al buscar duplicados para ${fullName}: ${e.message}`);
    }
  }
  
  let hasPage = false;
  let detectedPage = null;
  for (const [pageName, tag] of Object.entries(PAGE_TAG_MAP)) {
    if (currentTags.includes(tag)) {
      hasPage = true;
      detectedPage = pageName;
      break;
    }
  }

  // 1. Tagging Audit
  if (!hasPage) {
    try {
      const convUrl = `https://services.leadconnectorhq.com/conversations/search?locationId=${locationId}&contactId=${c.id}`;
      const convRes = await fetchWithRetry(convUrl, { headers: HEADERS_CONV });
      const convData = await convRes.json();

      if (convData.conversations && convData.conversations.length > 0) {
        const msgUrl = `https://services.leadconnectorhq.com/conversations/${convData.conversations[0].id}/messages?locationId=${locationId}`;
        const msgRes = await fetchWithRetry(msgUrl, { headers: HEADERS_CONV });
        const msgData = await msgRes.json();
        const messages = msgData.messages?.messages || [];

        for (const m of messages) {
          if (m.meta?.fb?.pageName && PAGE_TAG_MAP[m.meta.fb.pageName]) {
            detectedPage = m.meta.fb.pageName;
            const pageTag = PAGE_TAG_MAP[detectedPage];
            
            await fetchWithRetry(`https://services.leadconnectorhq.com/contacts/${c.id}/tags`, {
              method: 'POST',
              headers: HEADERS_CONTACTS,
              body: JSON.stringify({ tags: [pageTag, 'meta-ads', 'facebook-messenger'] })
            });
            stats.tagsInjected++;
            console.log(`  [Tagging Action] Contact: ${c.firstName || ''} ${c.lastName || ''} -> Assigned Tag: ${pageTag}`);
            // Update local state to proceed with assignment
            currentTags.push(pageTag);
            hasPage = true;
            break;
          }
        }
      }
    } catch (err) {
      console.error(`  [Tagging Error] ${err.message}`);
    }
  }

  // 2. Assignment Audit
  let wasAssigned = false;
  if (detectedPage === 'Naturales BioNatural' && c.assignedTo !== PALACIOS_USERS['naturales bionatural'].id) {
    c.assignedTo = PALACIOS_USERS['naturales bionatural'].id;
    wasAssigned = true;
    stats.palaciosAssigned++;
    console.log(`  [Assignment Action] Assigned to Palacios: ${c.firstName || ''}`);
  } else if (detectedPage === 'BioNatural - Ultra' && c.assignedTo !== PALACIOS_USERS['bionatural ultra'].id) {
    c.assignedTo = PALACIOS_USERS['bionatural ultra'].id;
    wasAssigned = true;
    stats.palaciosAssigned++;
    console.log(`  [Assignment Action] Assigned to Palacios Ultra: ${c.firstName || ''}`);
  } else if (detectedPage === 'Naturales Bio Corp' && c.assignedTo !== PALACIOS_USERS['redes benavides 1'].id) {
    c.assignedTo = PALACIOS_USERS['redes benavides 1'].id;
    wasAssigned = true;
    stats.benavidesAssigned++;
    console.log(`  [Assignment Action] Assigned to Benavides 1: ${c.firstName || ''}`);
  } else if ((detectedPage === 'Bio Natural' || detectedPage === 'BioNatural Fuerza') && c.assignedTo !== PALACIOS_USERS['redes benavides 2'].id) {
    c.assignedTo = PALACIOS_USERS['redes benavides 2'].id;
    wasAssigned = true;
    stats.benavidesAssigned++;
    console.log(`  [Assignment Action] Assigned to Benavides 2: ${c.firstName || ''}`);
  } else if ((detectedPage === 'Bio Naturales' || detectedPage === 'BioNatural Plus' || detectedPage === 'Bio Naturales Plus') && c.assignedTo !== PALACIOS_USERS['redes roosevelt'].id) {
    c.assignedTo = PALACIOS_USERS['redes roosevelt'].id;
    wasAssigned = true;
    stats.rooseveltAssigned = (stats.rooseveltAssigned || 0) + 1;
    console.log(`  [Assignment Action] Assigned to Roosevelt: ${c.firstName || ''}`);
  } else if ((detectedPage === 'BioNatural' || detectedPage === 'Natural Bio' || detectedPage === 'BIO Naturales Laboratorio') && c.assignedTo !== PALACIOS_USERS['redes piura'].id) {
    c.assignedTo = PALACIOS_USERS['redes piura'].id;
    wasAssigned = true;
    stats.piuraAssigned = (stats.piuraAssigned || 0) + 1;
    console.log(`  [Assignment Action] Assigned to Piura: ${c.firstName || ''}`);
  }

  if (wasAssigned) {
    try {
      await fetchWithRetry(`https://services.leadconnectorhq.com/contacts/${c.id}`, {
        method: 'PUT',
        headers: HEADERS_CONTACTS,
        body: JSON.stringify({ assignedTo: c.assignedTo })
      });
    } catch (e) {
      console.error(`  [Assignment Error] ${e.message}`);
    }
  }

  // 3. Pipeline Audit (Pipeline Maestro)
  const result = await processContactPipeline(c, context);
  if (result && result.success) {
    if (result.action === 'created_calificado') {
      stats.opportunitiesCreated++;
      stats.oppsCalificado++;
    } else if (result.action === 'created_precalificado') {
      stats.opportunitiesCreated++;
      stats.oppsPrecalificado++;
    } else if (result.action === 'moved_to_calificado') {
      stats.oppsCalificado++;
    }
  }

  // 4. Auditoría de Pauta y Reingresos (Asíncrono en segundo plano)
  auditAdAttribution(c.id, { silent: true }).catch(err => {
    console.error(`  [Ad Attribution Error] ${err.message}`);
  });
}

// Execute every 2 minutes (120,000 ms) 24/7
setInterval(runFullSync, 120000);

// ==========================================
// BACKGROUND HISTORICAL SWEEP (MICROMOTOR)
// ==========================================
let isDeepSweepRunning = false;
let sweepNextPageUrl = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`;
let sweepCount = 0;

async function runDeepSweep() {
  if (isDeepSweepRunning) return;
  isDeepSweepRunning = true;

  console.log(`\n[Micromotor] Iniciando barrido histórico de 100 contactos...`);

  try {
    if (!sweepNextPageUrl) {
      sweepNextPageUrl = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`;
      console.log(`[Micromotor] Reiniciando ciclo de peinado desde el principio.`);
    }

    const res = await fetchWithRetry(sweepNextPageUrl, { headers: HEADERS_CONTACTS });
    if (res.status === 429) {
      console.log(`[Micromotor] Rate limit alcanzado. Pausando hasta el siguiente ciclo.`);
      return;
    }
    const data = await res.json();
    const contacts = data.contacts || [];

    let sweepProcessed = 0;
    for (const c of contacts) {
      sweepProcessed++;
      await auditContact(c, 'Micromotor Sweep');
    }
    
    sweepCount += sweepProcessed;
    sweepNextPageUrl = data.meta?.nextPageUrl || null;
    
    console.log(`[Micromotor] Barrido completado. Procesados en esta página: ${sweepProcessed}. Total acumulado del ciclo: ${sweepCount}.`);
    if (!sweepNextPageUrl) {
        console.log(`[Micromotor] ¡Ciclo de peinado de toda la base de datos COMPLETADO! Volverá a empezar en la siguiente iteración.\n`);
        sweepCount = 0;
    }
  } catch (e) {
    console.error("[Micromotor Error] Fallo en el barrido:", e.message);
  } finally {
    isDeepSweepRunning = false;
  }
}

// Ejecutar el micromotor cada 5 minutos (300,000 ms)
setInterval(runDeepSweep, 300000);
// Iniciar la primera página a los 30 segundos de encender el servidor
setTimeout(runDeepSweep, 30000);

// ==========================================
// HTTP ENDPOINTS (API & Webhooks)
// ==========================================

// 1. Unified Dashboard / Health Check
app.get('/health', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GHL Laboratorios Naturales System Pipeline</title>
        <style>
          :root {
            --blanco: #ffffff;
            --azul: #003366;
            --rojo: #cc0000;
            --verde: #008000;
            --gris-claro: #f0f0f0;
            --gris-oscuro: #333333;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            background-color: var(--gris-claro);
            color: var(--gris-oscuro);
            margin: 0;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
          }
          .container {
            max-width: 900px;
            width: 100%;
            background-color: var(--blanco);
            border: 2px solid var(--azul);
            border-radius: 0;
            padding: 30px;
            box-shadow: 5px 5px 0px rgba(0,0,0,0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px solid var(--rojo);
            padding-bottom: 20px;
          }
          .header h1 {
            font-size: 26px;
            font-weight: bold;
            color: var(--azul);
            text-transform: uppercase;
            margin-top: 0;
            margin-bottom: 10px;
          }
          .status-indicator {
            display: inline-block;
            background-color: var(--verde);
            color: var(--blanco);
            padding: 5px 15px;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 14px;
            border: 1px solid var(--gris-oscuro);
            transition: opacity 0.5s ease-in-out;
          }
          .status-indicator.updating {
            opacity: 0.5;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .card {
            background-color: var(--blanco);
            border: 2px solid var(--azul);
            padding: 20px;
          }
          .card-header {
            font-size: 15px;
            font-weight: bold;
            color: var(--blanco);
            background-color: var(--azul);
            padding: 10px;
            margin: -20px -20px 20px -20px;
            text-align: center;
            text-transform: uppercase;
            line-height: 1.4;
          }
          .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--gris-claro);
            padding: 10px 0;
            font-size: 14px;
          }
          .metric:last-child {
            border-bottom: none;
          }
          .metric-label {
            color: var(--gris-oscuro);
            font-weight: bold;
          }
          .metric-value {
            font-weight: bold;
            color: var(--azul);
            transition: color 0.3s;
          }
          .metric-value.highlight {
            color: var(--verde);
          }
          .metric-value.changed {
            color: var(--rojo) !important;
          }
          .footer {
            margin-top: auto;
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid var(--gris-claro);
            font-size: 12px;
            color: var(--gris-oscuro);
          }
          .footer strong {
            color: var(--azul);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>GHL Laboratorios Naturales - System Pipeline</h1>
            <div class="status-indicator" id="status-badge">
              Sistema Activo y en Línea
            </div>
          </div>
          
          <div class="grid">
            <!-- Background Sync Module -->
            <div class="card">
              <div class="card-header">
                HERRAMIENTA 1<br>
                <small>Etiquetador Automático (Facebook Messenger)</small>
              </div>
              <div class="metric">
                <span class="metric-label">Búsquedas Realizadas</span>
                <span class="metric-value" id="val-totalRuns">${stats.totalRuns}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Etiquetas "Páginas/Adid/etc" Añadidas</span>
                <span class="metric-value" id="val-tagsInjected">${stats.tagsInjected}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Asignados a Oficina Palacios</span>
                <span class="metric-value" id="val-palaciosAssigned">${stats.palaciosAssigned}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Asignados a Oficina Benavides</span>
                <span class="metric-value" id="val-benavidesAssigned">${stats.benavidesAssigned}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Asignados a Oficina Roosevelt</span>
                <span class="metric-value" id="val-rooseveltAssigned" style="color: var(--gris-oscuro);">${stats.rooseveltAssigned}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Asignados a Oficina Piura</span>
                <span class="metric-value" id="val-piuraAssigned" style="color: var(--gris-oscuro);">${stats.piuraAssigned}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Última Revisión</span>
                <span class="metric-value" id="val-lastSyncTime" style="color: var(--rojo);">${lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('es-ES') : 'Iniciando...'}</span>
              </div>
            </div>

            <!-- Webhook Module -->
            <div class="card">
              <div class="card-header">
                HERRAMIENTA 2<br>
                <small>Envíos al Embudo (Pipeline) de GHL</small>
              </div>
              <div class="metric">
                <span class="metric-label">Alertas de GoHighLevel Recibidas</span>
                <span class="metric-value" id="val-webhooksReceived">${stats.webhooksReceived}</span>
              </div>
              <div class="metric">
                <span class="metric-label">A Etapa: Precalificado (Sin Teléfono)</span>
                <span class="metric-value highlight" id="val-oppsPrecalificado">${stats.oppsPrecalificado}</span>
              </div>
              <div class="metric">
                <span class="metric-label">A Etapa: Lead Calificado (Con Teléfono)</span>
                <span class="metric-value highlight" id="val-oppsCalificado">${stats.oppsCalificado}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Total Ingresados al Pipeline</span>
                <span class="metric-value highlight" id="val-opportunitiesCreated">${stats.opportunitiesCreated}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Estado de la Conexión</span>
                <span class="metric-value" style="color: var(--verde);">Activo y Escuchando</span>
              </div>
            </div>
          </div>

          <div class="footer">
            Infraestructura de Sistemas & Automatización de Pipeline<br>
            Desarrollado por <strong>Gabriel Loayza Dev & Marketing</strong>
          </div>
        </div>

        <script>
          // Script para actualizar los números EN VIVO cada 2 segundos
          async function fetchLiveStats() {
            try {
              const badge = document.getElementById('status-badge');
              badge.classList.add('updating');
              
              const res = await fetch('/api/stats');
              const data = await res.json();
              
              const fields = ['totalRuns', 'tagsInjected', 'palaciosAssigned', 'benavidesAssigned', 'rooseveltAssigned', 'piuraAssigned', 'webhooksReceived', 'oppsPrecalificado', 'oppsCalificado', 'opportunitiesCreated'];
              
              fields.forEach(field => {
                const el = document.getElementById('val-' + field);
                if (el && el.innerText !== String(data.stats[field])) {
                  el.innerText = data.stats[field];
                  el.classList.add('changed');
                  setTimeout(() => el.classList.remove('changed'), 500);
                }
              });

              const timeEl = document.getElementById('val-lastSyncTime');
              if (data.lastSyncTime) {
                const newTime = new Date(data.lastSyncTime).toLocaleTimeString('es-ES');
                if (timeEl.innerText !== newTime) timeEl.innerText = newTime;
              }

              setTimeout(() => badge.classList.remove('updating'), 200);
            } catch (err) {
              console.error('Error actualizando en vivo:', err);
            }
          }

          // Polling cada 2.5 segundos
          setInterval(fetchLiveStats, 2500);
        </script>
      </body>
    </html>
  `);
});

// Endpoint JSON para la actualización en vivo
app.get('/api/stats', (req, res) => {
  res.json({ stats, lastSyncTime });
});

// Alias for root path
app.get('/', (req, res) => res.redirect('/health'));

// 2. Real-time Webhook for Pipeline Maestro
app.post('/webhook/ghl-contact', async (req, res) => {
  try {
    const contactPayload = req.body;
    const contactData = contactPayload.contact || contactPayload;
    
    if (!contactData || !contactData.id) {
      return res.status(400).send({ error: 'Missing contact data or ID' });
    }

    stats.webhooksReceived++;
    res.status(200).send({ success: true, message: 'Webhook payload received' });

    console.log(`[Webhook Event] Processing contact distribution for ID: ${contactData.id}`);
    const result = await processSingleContactFromWebhook(contactData);
    if (result && result.success) {
      stats.opportunitiesCreated++;
      if (result.stage === 'calificado') {
        stats.oppsCalificado++;
      } else {
        stats.oppsPrecalificado++;
      }
    }

    // Auditoría de Pauta y Reingresos en tiempo real (Asíncrono)
    auditAdAttribution(contactData.id).catch(err => {
      console.error(`[Webhook Ad Attribution Error] ${err.message}`);
    });
    
  } catch (error) {
    console.error("[Webhook Error] Failure during request processing:", error.message);
  }
});

// 3. Manual Sync Trigger for Autopilot
app.post('/webhook', async (req, res) => {
  console.log("[System Event] Manual synchronization triggered via endpoint.");
  runFullSync();
  res.json({ success: true, message: "Synchronization initiated" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`SYSTEM PIPELINE SERVER INITIALIZED`);
  console.log(`Listening on Port: ${PORT}`);
  console.log(`Dashboard Access: http://localhost:${PORT}/health`);
  console.log(`=================================================`);
  runFullSync(); // Initial execution on startup
});
