import { GHL_CONFIG, PAGE_TAG_MAP } from './config.js';

const { apiKey, locationId } = GHL_CONFIG;

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

/**
 * Audita los mensajes de una conversación de Messenger para un contacto en GHL.
 * Identifica todos los clics de anuncios de Meta, contabiliza reingresos y genera notas de auditoría.
 * 
 * @param {string} contactId - ID del contacto en GoHighLevel
 * @param {object} options - Opciones adicionales (silent, forceTag, etc.)
 * @returns {Promise<object>} Resultado de la auditoría de pauta
 */
export async function auditAdAttribution(contactId, options = {}) {
  const isSilent = options.silent || false;
  if (!isSilent) console.log(`\n🔍 [Ad Attribution Engine] Auditando pauta para contacto ID: ${contactId}...`);

  try {
    // 1. Obtener detalles del contacto
    const contactRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      headers: HEADERS_CONTACTS
    });

    if (contactRes.status !== 200) {
      throw new Error(`No se pudo obtener el contacto (Status: ${contactRes.status})`);
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;
    const currentTags = (contact.tags || []).map(t => typeof t === 'string' ? t.toLowerCase() : '');
    const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Sin Nombre';

    // 2. Buscar conversaciones activas del contacto
    const convSearchUrl = `https://services.leadconnectorhq.com/conversations/search?locationId=${locationId}&contactId=${contactId}`;
    const convRes = await fetch(convSearchUrl, { headers: HEADERS_CONV });
    const convData = await convRes.json();

    const conversations = convData.conversations || [];
    if (conversations.length === 0) {
      if (!isSilent) console.log(`  ℹ️ El contacto ${fullName} no tiene conversaciones registradas.`);
      return { success: true, totalAdClicks: 0, reason: 'no_conversations' };
    }

    // 3. Extraer todos los mensajes de todas las conversaciones para buscar metadatos de pauta (Meta FB/IG)
    const adInteractions = [];

    for (const conv of conversations) {
      const msgUrl = `https://services.leadconnectorhq.com/conversations/${conv.id}/messages?locationId=${locationId}`;
      const msgRes = await fetch(msgUrl, { headers: HEADERS_CONV });
      const msgData = await msgRes.json();
      const messages = msgData.messages?.messages || [];

      for (const m of messages) {
        // Metadatos de Facebook / Meta Ads en el mensaje
        const fbMeta = m.meta?.fb || {};
        const isFromAd = Boolean(
          fbMeta.adId ||
          fbMeta.adTitle ||
          fbMeta.pageName ||
          m.meta?.email?.adId ||
          (m.source === 'facebook' && m.direction === 'inbound')
        );

        if (isFromAd) {
          const interactionDate = m.dateAdded ? new Date(m.dateAdded) : new Date();
          adInteractions.push({
            messageId: m.id,
            date: interactionDate,
            pageName: fbMeta.pageName || 'Página Meta',
            adId: fbMeta.adId || 'N/A',
            adTitle: fbMeta.adTitle || 'Anuncio Directo Messenger',
            body: (m.body || '').substring(0, 80)
          });
        }
      }
    }

    // Ordenar cronológicamente (del más antiguo al más reciente)
    adInteractions.sort((a, b) => a.date - b.date);

    // Contabilizar clics únicos por timestamp aproximado / mensaje de entrada
    const totalAdClicks = Math.max(adInteractions.length, 1);
    const isMultipleClick = totalAdClicks > 1;
    const clicksToDiscount = Math.max(0, totalAdClicks - 1);

    const latestInteraction = adInteractions[adInteractions.length - 1] || {
      pageName: 'Desconocida',
      adTitle: 'Campaña Estándar',
      date: new Date()
    };

    if (!isSilent) {
      console.log(`  📊 Contacto: ${fullName}`);
      console.log(`  🎯 Total Clics de Pauta Detectados: ${totalAdClicks}`);
      console.log(`  📅 Última Interacción: ${latestInteraction.date.toLocaleString('es-ES')}`);
      console.log(`  🖼️ Anuncio/Página: ${latestInteraction.pageName} | ${latestInteraction.adTitle}`);
    }

    // 4. Determinar etiquetas a aplicar
    const newTags = [];
    const targetTag = totalAdClicks === 1 ? 'pauta-clic-x1' : `pauta-reingreso-x${totalAdClicks}`;

    if (!currentTags.includes(targetTag)) {
      newTags.push(targetTag);
    }

    if (isMultipleClick && !currentTags.includes('alerta-reingreso-pauta')) {
      newTags.push('alerta-reingreso-pauta');
    }

    if (newTags.length > 0) {
      await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: HEADERS_CONTACTS,
        body: JSON.stringify({ tags: newTags })
      });
      if (!isSilent) console.log(`  🏷️ Nuevas etiquetas aplicadas: ${newTags.join(', ')}`);
    }

    // 5. Inyectar Nota de Auditoría Financiera en GHL (Si es reingreso)
    if (isMultipleClick && !currentTags.includes('alerta-reingreso-pauta')) {
      const breakdownText = adInteractions.map((inter, idx) => {
        return `  • Clic #${idx + 1}: ${inter.date.toLocaleDateString('es-ES')} ${inter.date.toLocaleTimeString('es-ES')} | Pág: ${inter.pageName} | Anuncio: ${inter.adTitle}`;
      }).join('\n');

      const noteContent = `📊 AUDITORÍA DE PAUTA & REINGRESOS (CONTROL DE AGENCIAS)
==================================================
👤 Cliente: ${fullName}
🔢 Total de Clics de Anuncios Registrados: ${totalAdClicks}
💰 DESCUENTO APLICABLE A LA AGENCIA: ${clicksToDiscount} LEAD(S) REPETIDO(S)

Historial de Interacciones:
${breakdownText}

👉 Diagnóstico: 1 Cliente Real Adquirido. No pagar comisiones duplicadas por los clics posteriores.`;

      await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: HEADERS_CONTACTS,
        body: JSON.stringify({ body: noteContent })
      });

      if (!isSilent) console.log(`  📝 Nota de auditoría financiera inyectada en GHL.`);
    }

    return {
      success: true,
      contactId,
      fullName,
      totalAdClicks,
      clicksToDiscount,
      isMultipleClick,
      latestPage: latestInteraction.pageName,
      latestAd: latestInteraction.adTitle
    };

  } catch (error) {
    console.error(`  ❌ Error en auditoría de pauta para contacto ${contactId}:`, error.message);
    return { success: false, error: error.message };
  }
}

// ==========================================
// PEINADOR HISTÓRICO MASIVO (Sweep Completo)
// ==========================================
/**
 * Barre toda la base de datos de GHL (página por página) auditando clics de pauta y reingresos históricos.
 */
export async function runHistoricalAdAttributionSweep() {
  console.log("\n=================================================");
  console.log("🎯 PEINADO HISTÓRICO DE PAUTA Y REINGRESOS (BATCH)");
  console.log("Auditoría completa para deducción a agencias de marketing");
  console.log("=================================================\n");

  let url = `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`;
  const allContacts = [];

  console.log("📥 Extrayendo lista completa de contactos desde GHL...");
  while (url) {
    try {
      const res = await fetch(url, { headers: HEADERS_CONTACTS });
      if (res.status === 429) {
        console.log("Rate limit alcanzado. Pausando 5 segundos...");
        await sleep(5000);
        continue;
      }
      const data = await res.json();
      const contacts = data.contacts || [];
      if (contacts.length === 0) break;

      allContacts.push(...contacts);
      process.stdout.write(`\rDescargados: ${allContacts.length} contactos...`);
      url = data.meta?.nextPageUrl || null;
      await sleep(150);
    } catch (e) {
      console.error("\nError obteniendo contactos:", e.message);
      break;
    }
  }

  console.log(`\n\n📊 Total de contactos a peinar: ${allContacts.length}\n`);

  let totalAudited = 0;
  let singleClicks = 0;
  let multiClicks = 0;
  let totalClicksDiscountable = 0;

  const CONCURRENCY = 5;
  for (let i = 0; i < allContacts.length; i += CONCURRENCY) {
    const batch = allContacts.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (c) => {
      const res = await auditAdAttribution(c.id, { silent: true });
      if (res && res.success) {
        totalAudited++;
        if (res.isMultipleClick) {
          multiClicks++;
          totalClicksDiscountable += (res.clicksToDiscount || 0);
        } else {
          singleClicks++;
        }
      }
    }));

    const progress = Math.min(i + CONCURRENCY, allContacts.length);
    if (progress % 50 === 0 || progress === allContacts.length) {
      console.log(`[PROGRESO] ${progress}/${allContacts.length} peinados | 🎯 Nuevos/Únicos: ${singleClicks} | ⚠️ Reingresos (Descuentos): ${multiClicks} (Total a descontar: ${totalClicksDiscountable} leads)...`);
    }
    await sleep(200);
  }

  console.log(`\n=================================================`);
  console.log(`🎉 REPORTE FINAL DE AUDITORÍA HISTÓRICA:`);
  console.log(`=================================================`);
  console.log(`👥 Total Contactos Auditados: ${totalAudited}`);
  console.log(`✅ Leads Limpios (1 Solo Clic): ${singleClicks}`);
  console.log(`⚠️ Casos de Reingreso (Múltiples Clics): ${multiClicks}`);
  console.log(`💰 TOTAL LEADS A DESCONTAR A AGENCIAS: ${totalClicksDiscountable} leads`);
  console.log(`=================================================\n`);
}

// ==========================================
// MODO CLI DIRECTO (Para pruebas y peinados)
// ==========================================
if (process.argv[1] && process.argv[1].endsWith('ad_attribution_engine.js')) {
  const arg = process.argv[2];

  if (arg === '--all' || arg === '-a' || arg === 'all') {
    runHistoricalAdAttributionSweep();
  } else if (arg) {
    auditAdAttribution(arg);
  } else {
    // Si no se especifica ID ni --all, tomamos el contacto más reciente de la subcuenta para testear
    console.log("=================================================");
    console.log("🎯 AD ATTRIBUTION ENGINE - PRUEBA LOCAL");
    console.log("Uso: node ad_attribution_engine.js <contactId>");
    console.log("     node ad_attribution_engine.js --all (Peinado Completo)");
    console.log("=================================================");
    console.log("Buscando el contacto más reciente en GHL para prueba rápida...");

    (async () => {
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=1`, {
          headers: HEADERS_CONTACTS
        });
        const data = await res.json();
        const contacts = data.contacts || [];

        if (contacts.length > 0) {
          const testContact = contacts[0];
          console.log(`Contacto encontrado: ${testContact.firstName || ''} ${testContact.lastName || ''} (ID: ${testContact.id})`);
          await auditAdAttribution(testContact.id);
        } else {
          console.log("No se encontraron contactos en la subcuenta.");
        }
      } catch (err) {
        console.error("Error en prueba local:", err.message);
      }
    })();
  }
}
