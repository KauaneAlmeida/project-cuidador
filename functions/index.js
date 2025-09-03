/* ============================================================
   🚀 CUIDADOR DIGITAL - FIREBASE CLOUD FUNCTIONS
   Complete medication reminder system with WhatsApp integration
   ============================================================ */

require("dotenv").config();

// Debug logs: environment variables check
console.log("🔧 Environment Variables Check:");
console.log("✅ TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "Loaded" : "❌ Missing");
console.log("✅ TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "Loaded" : "❌ Missing");
console.log("✅ TWILIO_PHONE_NUMBER:", process.env.TWILIO_PHONE_NUMBER ? process.env.TWILIO_PHONE_NUMBER : "❌ Missing");
console.log("✅ TEST_PHONE_NUMBER:", process.env.TEST_PHONE_NUMBER ? process.env.TEST_PHONE_NUMBER : "❌ Missing");
console.log("✅ STRIPE_SECRET_KEY:", process.env.STRIPE_SECRET_KEY ? "Loaded" : "❌ Missing");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const twilio = require("twilio");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require("cors")({ origin: true });

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

/* ============================================================
   📋 SUBSCRIPTION PLANS CONFIGURATION
   ============================================================ */

const SUBSCRIPTION_LIMITS = {
  free: { elders: 1, medications: 2, reminders: 2 },
  basic: { elders: 1, medications: 5, reminders: 5 },
  family: { elders: 3, medications: 15, reminders: 15 },
  premium: { elders: -1, medications: -1, reminders: -1 } // unlimited
};

const getSubscriptionLimits = (plan) => {
  return SUBSCRIPTION_LIMITS[plan] || SUBSCRIPTION_LIMITS.free;
};

const checkPlanLimits = async (responsavelId, plan = 'free') => {
  const limits = getSubscriptionLimits(plan);
  
  if (limits.elders === -1) return { allowed: true }; // unlimited
  
  const eldersSnapshot = await db.collection('idosos')
    .where('responsavelId', '==', responsavelId)
    .get();
  
  const currentElders = eldersSnapshot.size;
  
  return {
    allowed: currentElders < limits.elders,
    current: currentElders,
    limit: limits.elders,
    plan
  };
};

/* ============================================================
   🔧 TWILIO WHATSAPP HELPERS
   ============================================================ */

const getTwilioConfig = () => ({
  sid: process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  phone: process.env.TWILIO_PHONE_NUMBER,
});

const getTwilioClient = () => {
  const cfg = getTwilioConfig();
  if (!cfg.sid || !cfg.token) {
    console.error("❌ Twilio configuration missing.");
    return null;
  }
  return twilio(cfg.sid, cfg.token);
};

const formatPhoneForWhatsApp = (phone) => {
  if (!phone) return null;
  if (phone.startsWith("whatsapp:")) return phone;
  
  // Remove all non-digits and ensure it starts with country code
  const digits = phone.replace(/\D/g, "");
  
  // If it's a Brazilian number without country code, add 55
  if (digits.length === 10 || digits.length === 11) {
    return `whatsapp:+55${digits}`;
  }
  
  // If it already has country code
  if (digits.length > 11) {
    return `whatsapp:+${digits}`;
  }
  
  return `whatsapp:+${digits}`;
};

const sendWhatsAppMessage = async (to, message) => {
  const twilioClient = getTwilioClient();
  const cfg = getTwilioConfig();

  if (!twilioClient || !cfg.phone) {
    console.error("❌ Twilio client not available");
    return { success: false, error: "Twilio not configured" };
  }

  try {
    const formattedTo = formatPhoneForWhatsApp(to);
    console.log(`📱 Sending WhatsApp from ${cfg.phone} to ${formattedTo}`);
    console.log(`💬 Message: ${message.substring(0, 100)}...`);

    const result = await twilioClient.messages.create({
      from: cfg.phone,
      to: formattedTo,
      body: message,
    });

    console.log("✅ Message sent successfully:", result.sid);
    return { success: true, sid: result.sid, status: result.status };
  } catch (error) {
    console.error("❌ Twilio error:", error);
    return { success: false, error: error.message };
  }
};

/* ============================================================
   💬 WHATSAPP MESSAGE TEMPLATES
   ============================================================ */

const createWelcomeMessage = (nomeIdoso) => {
  return `🎉 Olá ${nomeIdoso}! Seja bem-vindo ao Cuidador Digital 👵👴

A partir de agora, você receberá lembretes automáticos dos seus medicamentos. 💊

Quando receber um lembrete, responda:
1️⃣ para "Tomei"
2️⃣ para "Não tomei"  
3️⃣ para "Adiar 10 min"

Para parar os lembretes, envie "SAIR".

Vamos cuidar da sua saúde juntos! 💙`;
};

const createReminderMessage = (nomeIdoso, medicacao, dosagem) => {
  return `⏰ Olá, ${nomeIdoso} 👋 — Hora do remédio *${medicacao}* (${dosagem})

Responda:
1️⃣ ✅ Tomei
2️⃣ ❌ Não tomei  
3️⃣ ⏳ Adiar 10 min`;
};

const createConfirmationMessage = (nomeIdoso, medicacao, response) => {
  const messages = {
    '1': `Perfeito, ${nomeIdoso}! ✔️ Registramos que você tomou *${medicacao}*. Obrigado! 💙`,
    '2': `Entendido, ${nomeIdoso}. Foi registrado que *${medicacao}* não foi tomado. Se precisar de ajuda, fale com seu responsável. 🤗`,
    '3': `Ok, ${nomeIdoso}! Vamos lembrar de novo em ${process.env.FUNCTIONS_EMULATOR === "true" ? "1 minuto" : "10 minutos"} — responda 1 quando tomar 😊`
  };
  
  return messages[response] || `Não entendi sua resposta "${response}". Responda: 1, 2 ou 3.`;
};

const createEmergencyAlert = (nomeIdoso, medicacao, horario) => {
  return `⚠️ *ALERTA DE MEDICAÇÃO*

${nomeIdoso} não confirmou o remédio *${medicacao}* das ${horario}.

Por favor, verifique se está tudo bem. 🚨`;
};

const createOptOutConfirmation = (nomeIdoso) => {
  return `${nomeIdoso}, os lembretes foram interrompidos conforme solicitado. ✋

Para reativar, entre em contato com seu responsável.

Cuide-se! 💙`;
};

const createDailyReport = (nomeIdoso, stats) => {
  return `📊 *Relatório Diário - ${nomeIdoso}*

✅ Medicamentos tomados: ${stats.tomou}
❌ Não tomados: ${stats.naoTomou}
⏳ Adiados: ${stats.adiado}
📋 Total de lembretes: ${stats.total}

Taxa de adesão: ${Math.round((stats.tomou / stats.total) * 100)}%

Continue assim! 💪`;
};

/* ============================================================
   📝 REGISTRATION ENDPOINT
   ============================================================ */

exports.saveRegistration = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { responsavel, idoso, contatos, medicamentos, lgpdConsent } = req.body;

      if (!responsavel || !idoso || !medicamentos || !lgpdConsent) {
        return res.status(400).json({ error: 'Missing required data' });
      }

      console.log('📝 Starting registration process...');

      // Check if responsavel already exists
      let responsavelRef;
      const existingResponsavelSnapshot = await db.collection('responsaveis')
        .where('whatsapp', '==', responsavel.whatsapp)
        .get();

      if (!existingResponsavelSnapshot.empty) {
        responsavelRef = existingResponsavelSnapshot.docs[0].ref;
        console.log('👤 Using existing responsavel:', responsavelRef.id);
      } else {
        responsavelRef = await db.collection('responsaveis').add({
          ...responsavel,
          plan: 'free', // Default plan
          createdAt: FieldValue.serverTimestamp()
        });
        console.log('👤 Created new responsavel:', responsavelRef.id);
      }

      // Check plan limits before creating elder
      const responsavelDoc = await responsavelRef.get();
      const responsavelData = responsavelDoc.data();
      const planCheck = await checkPlanLimits(responsavelRef.id, responsavelData.plan);

      if (!planCheck.allowed) {
        return res.status(400).json({ 
          error: `Plan limit exceeded. Your ${planCheck.plan} plan allows ${planCheck.limit} elder(s), but you already have ${planCheck.current}.`,
          planLimits: planCheck
        });
      }

      // Save idoso
      const idosoRef = await db.collection('idosos').add({
        ...idoso,
        responsavelId: responsavelRef.id,
        ativo: true,
        createdAt: FieldValue.serverTimestamp()
      });
      console.log('👴 Created idoso:', idosoRef.id);

      // Save medicamentos
      const medicamentosPromises = medicamentos.map(med => 
        db.collection('medicamentos').add({
          ...med,
          idosoId: idosoRef.id,
          ativo: true,
          createdAt: FieldValue.serverTimestamp()
        })
      );
      const medicamentosRefs = await Promise.all(medicamentosPromises);
      console.log('💊 Created medicamentos:', medicamentosRefs.length);

      // Save contatos de emergencia
      let contatosCount = 0;
      if (contatos && contatos.length > 0) {
        const contatosPromises = contatos.map(contato => 
          db.collection('contatos_emergencia').add({
            ...contato,
            idosoId: idosoRef.id,
            createdAt: FieldValue.serverTimestamp()
          })
        );
        await Promise.all(contatosPromises);
        contatosCount = contatos.length;
        console.log('📞 Created emergency contacts:', contatosCount);
      }

      // Save LGPD consent
      await db.collection('lgpd_consents').add({
        responsavelId: responsavelRef.id,
        idosoId: idosoRef.id,
        aceito: lgpdConsent,
        dataAceite: FieldValue.serverTimestamp(),
        versao: '1.0',
        ipAddress: req.ip || 'unknown'
      });
      console.log('🔒 LGPD consent saved');

      // Send welcome message
      const welcomeMsg = createWelcomeMessage(idoso.nome);
      const twilioResult = await sendWhatsAppMessage(idoso.whatsapp, welcomeMsg);

      console.log('✅ Registration completed successfully');

      res.json({
        success: true,
        data: {
          responsavelId: responsavelRef.id,
          idosoId: idosoRef.id,
          contatosCount,
          medicamentosCount: medicamentos.length,
          twilioSent: twilioResult.success,
          twilioSid: twilioResult.sid,
          planLimits: planCheck
        }
      });

    } catch (error) {
      console.error('❌ Registration error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Internal server error' 
      });
    }
  });
});

/* ============================================================
   ⏰ MEDICATION REMINDER SCHEDULER
   ============================================================ */

const getCurrentBrazilTime = () => {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCurrentDayOfWeek = () => {
  const now = new Date();
  const brazilTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return brazilTime.getDay(); // 0 = Sunday, 1 = Monday ...
};

async function checkMedicationRemindersLogic() {
  console.log("🔍 Checking for medication reminders...");
  const currentTime = getCurrentBrazilTime();
  const currentDay = getCurrentDayOfWeek();
  
  console.log(`⏰ Current Brazil time: ${currentTime}, Day: ${currentDay}`);

  // Get all active medications
  const medicamentosSnapshot = await db
    .collection("medicamentos")
    .where("ativo", "==", true)
    .get();

  if (medicamentosSnapshot.empty) {
    console.log("📋 No active medications found");
    return;
  }

  console.log(`💊 Found ${medicamentosSnapshot.size} active medications`);

  const batch = db.batch();
  let remindersToSend = [];

  for (const medicamentoDoc of medicamentosSnapshot.docs) {
    const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };

    // Check if today is a scheduled day
    if (!medicamento.diasDaSemana.includes(currentDay)) {
      console.log(`📅 Skipping ${medicamento.nome} - not scheduled for day ${currentDay}`);
      continue;
    }

    // Check if current time matches any scheduled time
    const isTimeToRemind = medicamento.horarios.some((horario) => {
      const scheduledTime = horario.substring(0, 5); // HH:mm format
      return scheduledTime === currentTime;
    });

    if (isTimeToRemind) {
      console.log(`⏰ Time to remind: ${medicamento.nome} at ${currentTime}`);
      
      // Get idoso data
      const idosoDoc = await db.collection("idosos").doc(medicamento.idosoId).get();
      if (!idosoDoc.exists) {
        console.log(`❌ Idoso not found: ${medicamento.idosoId}`);
        continue;
      }
      
      const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
      
      if (!idoso.ativo) {
        console.log(`⏸️ Idoso inactive: ${idoso.nome}`);
        continue;
      }

      // Check if reminder already sent for this time today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingReminderSnapshot = await db.collection("lembretes_status")
        .where("medicamentoId", "==", medicamento.id)
        .where("idosoId", "==", idoso.id)
        .where("horarioOriginal", "==", currentTime)
        .where("dataHora", ">=", Timestamp.fromDate(today))
        .where("dataHora", "<", Timestamp.fromDate(tomorrow))
        .get();

      if (!existingReminderSnapshot.empty) {
        console.log(`⏭️ Reminder already sent for ${medicamento.nome} at ${currentTime}`);
        continue;
      }

      // Create reminder status record
      const lembreteStatusRef = db.collection("lembretes_status").doc();
      const lembreteStatus = {
        medicamentoId: medicamento.id,
        idosoId: idoso.id,
        dataHora: FieldValue.serverTimestamp(),
        status: "enviado",
        tentativas: 1,
        horarioOriginal: currentTime,
        adiado: false
      };

      batch.set(lembreteStatusRef, lembreteStatus);
      remindersToSend.push({ idoso, medicamento, lembreteId: lembreteStatusRef.id });
    }
  }

  // Commit all reminder status records
  if (remindersToSend.length > 0) {
    await batch.commit();
    console.log(`📝 Created ${remindersToSend.length} reminder status records`);
  }

  // Send WhatsApp messages
  for (const reminder of remindersToSend) {
    const message = createReminderMessage(
      reminder.idoso.nome,
      reminder.medicamento.nome,
      reminder.medicamento.dosagem
    );

    const result = await sendWhatsAppMessage(reminder.idoso.whatsapp, message);

    // Update reminder status with Twilio result
    const updateData = {
      twilioSent: result.success,
      twilioError: result.success ? null : result.error
    };

    if (result.success) {
      updateData.twilioSid = result.sid;
      updateData.twilioStatus = result.status;
    } else {
      updateData.status = "erro";
      updateData.erro = result.error;
    }

    await db.collection("lembretes_status").doc(reminder.lembreteId).update(updateData);
    
    console.log(`📱 Reminder sent to ${reminder.idoso.nome}: ${result.success ? '✅' : '❌'}`);
  }

  console.log(`✅ Medication reminders check completed. Sent: ${remindersToSend.length}`);
}

// Production scheduler (every 1 minute)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  exports.checkMedicationReminders = functions.pubsub
    .schedule("every 1 minutes")
    .timeZone("America/Sao_Paulo")
    .onRun(checkMedicationRemindersLogic);
}

// Debug manual trigger for emulator
exports.debugCheckMedicationReminders = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      console.log("🧪 Manual trigger: checkMedicationReminders");
      await checkMedicationRemindersLogic();
      res.json({ 
        success: true, 
        message: "✅ checkMedicationReminders executed manually!",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Error running checkMedicationReminders manually:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
});

/* ============================================================
   📱 WHATSAPP WEBHOOK HANDLER
   ============================================================ */

exports.handleWhatsAppWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { From, Body, MessageSid } = req.body;
      
      if (!From || !Body) {
        return res.status(400).json({ error: 'Missing From or Body' });
      }

      console.log(`📱 WhatsApp webhook received:`);
      console.log(`📞 From: ${From}`);
      console.log(`💬 Body: ${Body}`);
      console.log(`🆔 MessageSid: ${MessageSid}`);

      // Extract phone number (remove whatsapp: prefix and +)
      const phoneNumber = From.replace('whatsapp:', '').replace('+', '');
      console.log(`📱 Processed phone: ${phoneNumber}`);
      
      // Handle opt-out
      if (Body.toUpperCase().includes('SAIR')) {
        await handleOptOut(phoneNumber);
        return res.json({ success: true, action: 'opt-out' });
      }

      // Handle medication responses (1, 2, 3)
      const response = Body.trim();
      if (['1', '2', '3'].includes(response)) {
        await handleMedicationResponse(phoneNumber, response);
        return res.json({ success: true, action: 'medication-response', response });
      }

      // Unknown response
      const unknownMsg = `Não entendi sua resposta "${Body}". 🤔

Para lembretes de medicação, responda:
1️⃣ 2️⃣ ou 3️⃣

Para parar os lembretes, envie "SAIR".`;
      
      await sendWhatsAppMessage(From, unknownMsg);
      res.json({ success: true, action: 'unknown-response' });

    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

async function handleMedicationResponse(phoneNumber, response) {
  console.log(`🔍 Processing medication response: ${phoneNumber} -> ${response}`);
  
  // Find the idoso by phone number
  const idososSnapshot = await db.collection('idosos')
    .where('whatsapp', '==', phoneNumber)
    .get();

  if (idososSnapshot.empty) {
    console.log(`❌ No idoso found for phone: ${phoneNumber}`);
    return;
  }

  const idoso = { id: idososSnapshot.docs[0].id, ...idososSnapshot.docs[0].data() };
  console.log(`👴 Found idoso: ${idoso.nome} (${idoso.id})`);

  // Find most recent pending reminder (sent in last 30 minutes)
  const thirtyMinutesAgo = new Date();
  thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);

  const lembreteSnapshot = await db.collection('lembretes_status')
    .where('idosoId', '==', idoso.id)
    .where('status', '==', 'enviado')
    .where('dataHora', '>=', Timestamp.fromDate(thirtyMinutesAgo))
    .orderBy('dataHora', 'desc')
    .limit(1)
    .get();

  if (lembreteSnapshot.empty) {
    console.log(`❌ No recent pending reminders for idoso: ${idoso.id}`);
    
    // Send message explaining no pending reminders
    const noReminderMsg = `Olá ${idoso.nome}! Não encontrei nenhum lembrete pendente recente. 

Se você acabou de tomar um medicamento, tudo bem! 😊`;
    await sendWhatsAppMessage(`whatsapp:+${phoneNumber}`, noReminderMsg);
    return;
  }

  const lembrete = { id: lembreteSnapshot.docs[0].id, ...lembreteSnapshot.docs[0].data() };
  console.log(`📋 Found pending reminder: ${lembrete.id}`);
  
  // Get medication details
  const medicamentoDoc = await db.collection('medicamentos').doc(lembrete.medicamentoId).get();
  if (!medicamentoDoc.exists) {
    console.log(`❌ Medication not found: ${lembrete.medicamentoId}`);
    return;
  }
  
  const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };
  console.log(`💊 Medication: ${medicamento.nome}`);

  let newStatus = '';
  let shouldReschedule = false;

  switch (response) {
    case '1': // Tomei
      newStatus = 'tomou';
      break;
    case '2': // Não tomei
      newStatus = 'nao_tomou';
      break;
    case '3': // Adiar
      newStatus = 'adiado';
      shouldReschedule = true;
      break;
  }

  // Update reminder status
  await db.collection('lembretes_status').doc(lembrete.id).update({
    status: newStatus,
    respostaRecebida: response,
    ultimaResposta: FieldValue.serverTimestamp()
  });
  console.log(`📝 Updated reminder status to: ${newStatus}`);

  // Send confirmation message
  const confirmationMsg = createConfirmationMessage(idoso.nome, medicamento.nome, response);
  await sendWhatsAppMessage(`whatsapp:+${phoneNumber}`, confirmationMsg);

  // Reschedule if needed (response = 3)
  if (shouldReschedule) {
    const delayMinutes = process.env.FUNCTIONS_EMULATOR === "true" ? 1 : 10;
    const newReminderTime = new Date();
    newReminderTime.setMinutes(newReminderTime.getMinutes() + delayMinutes);

    await db.collection('lembretes_status').add({
      medicamentoId: lembrete.medicamentoId,
      idosoId: idoso.id,
      dataHora: Timestamp.fromDate(newReminderTime),
      status: 'agendado',
      tentativas: 1,
      horarioOriginal: lembrete.horarioOriginal,
      adiado: true,
      lembreteOriginalId: lembrete.id
    });
    
    console.log(`⏳ Rescheduled reminder for ${delayMinutes} minutes later`);
  }
}

async function handleOptOut(phoneNumber) {
  console.log(`🚪 Processing opt-out for: ${phoneNumber}`);
  
  // Find idoso and deactivate all medications
  const idososSnapshot = await db.collection('idosos')
    .where('whatsapp', '==', phoneNumber)
    .get();

  if (idososSnapshot.empty) {
    console.log(`❌ No idoso found for opt-out: ${phoneNumber}`);
    return;
  }

  const idoso = { id: idososSnapshot.docs[0].id, ...idososSnapshot.docs[0].data() };
  console.log(`👴 Processing opt-out for: ${idoso.nome}`);

  // Deactivate all medications for this elder
  const medicamentosSnapshot = await db.collection('medicamentos')
    .where('idosoId', '==', idoso.id)
    .where('ativo', '==', true)
    .get();

  if (!medicamentosSnapshot.empty) {
    const batch = db.batch();
    medicamentosSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, { 
        ativo: false, 
        optOutDate: FieldValue.serverTimestamp(),
        optOutReason: 'user_request'
      });
    });
    await batch.commit();
    console.log(`🔇 Deactivated ${medicamentosSnapshot.size} medications`);
  }

  // Send confirmation
  const optOutMsg = createOptOutConfirmation(idoso.nome);
  await sendWhatsAppMessage(`whatsapp:+${phoneNumber}`, optOutMsg);
  
  // Notify responsavel
  const responsavelDoc = await db.collection('responsaveis').doc(idoso.responsavelId).get();
  if (responsavelDoc.exists) {
    const responsavel = responsavelDoc.data();
    const notificationMsg = `ℹ️ *Notificação Importante*

${idoso.nome} solicitou a interrupção dos lembretes de medicação.

Para reativar, acesse o painel administrativo ou entre em contato conosco.`;
    
    await sendWhatsAppMessage(responsavel.whatsapp, notificationMsg);
  }
}

/* ============================================================
   📊 REPORTING AND ANALYTICS
   ============================================================ */

exports.generateReport = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { idosoId, date } = req.query;
      
      if (!idosoId) {
        return res.status(400).json({ error: 'idosoId is required' });
      }

      const targetDate = date ? new Date(date) : new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`📊 Generating report for idoso ${idosoId} on ${targetDate.toDateString()}`);

      // Get reminders for the specified date
      const lembretesSnapshot = await db.collection('lembretes_status')
        .where('idosoId', '==', idosoId)
        .where('dataHora', '>=', Timestamp.fromDate(startOfDay))
        .where('dataHora', '<=', Timestamp.fromDate(endOfDay))
        .orderBy('dataHora', 'desc')
        .get();

      const lembretes = lembretesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        dataHora: doc.data().dataHora.toDate()
      }));

      // Calculate statistics
      const stats = {
        total: lembretes.length,
        tomou: lembretes.filter(l => l.status === 'tomou').length,
        naoTomou: lembretes.filter(l => l.status === 'nao_tomou').length,
        adiado: lembretes.filter(l => l.status === 'adiado').length,
        semResposta: lembretes.filter(l => l.status === 'sem_resposta').length,
        enviado: lembretes.filter(l => l.status === 'enviado').length
      };

      // Calculate adherence rate
      const totalResponses = stats.tomou + stats.naoTomou;
      const adherenceRate = totalResponses > 0 ? Math.round((stats.tomou / totalResponses) * 100) : 0;

      console.log(`📈 Report stats:`, stats);

      res.json({
        success: true,
        data: {
          date: targetDate.toISOString().split('T')[0],
          stats: {
            ...stats,
            adherenceRate
          },
          lembretes,
          summary: {
            adherenceRate,
            totalMedications: stats.total,
            onTime: stats.tomou,
            missed: stats.naoTomou
          }
        }
      });

    } catch (error) {
      console.error('❌ Report generation error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

exports.generateReportCsv = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { idosoId, days = 30 } = req.query;
      
      if (!idosoId) {
        return res.status(400).json({ error: 'idosoId is required' });
      }

      const daysBack = parseInt(days) || 30;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      console.log(`📊 Generating CSV report for idoso ${idosoId}, last ${daysBack} days`);

      // Get reminder logs for Power BI analysis
      const lembretesSnapshot = await db.collection('lembretes_status')
        .where('idosoId', '==', idosoId)
        .where('dataHora', '>=', Timestamp.fromDate(startDate))
        .where('dataHora', '<=', Timestamp.fromDate(endDate))
        .orderBy('dataHora', 'desc')
        .limit(5000)
        .get();

      // Generate CSV header
      let csv = 'dataHora,status,medicamentoId,medicamentoNome,respostaRecebida,tentativas,horarioOriginal,adiado\n';
      
      // Get medication names for better CSV readability
      const medicamentoIds = [...new Set(lembretesSnapshot.docs.map(doc => doc.data().medicamentoId))];
      const medicamentosMap = {};
      
      for (const medId of medicamentoIds) {
        const medDoc = await db.collection('medicamentos').doc(medId).get();
        if (medDoc.exists) {
          medicamentosMap[medId] = medDoc.data().nome;
        }
      }

      // Generate CSV rows
      lembretesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const dataHora = data.dataHora.toDate().toISOString();
        const medicamentoNome = medicamentosMap[data.medicamentoId] || 'Unknown';
        
        csv += `${dataHora},${data.status},${data.medicamentoId},"${medicamentoNome}",${data.respostaRecebida || ''},${data.tentativas},${data.horarioOriginal || ''},${data.adiado || false}\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="lembretes_${idosoId}_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);

    } catch (error) {
      console.error('❌ CSV generation error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

/* ============================================================
   💳 STRIPE PAYMENT INTEGRATION
   ============================================================ */

exports.createCheckoutSession = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { plan, uid, email } = req.body;

      if (!plan || !uid) {
        return res.status(400).json({ error: 'Missing plan or uid' });
      }

      const priceIds = {
        basic: process.env.STRIPE_BASIC_PRICE,
        family: process.env.STRIPE_FAMILY_PRICE,
        premium: process.env.STRIPE_PREMIUM_PRICE
      };

      const priceId = priceIds[plan];
      if (!priceId) {
        return res.status(400).json({ error: 'Invalid plan' });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
          price: priceId,
          quantity: 1,
        }],
        success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/pricing`,
        client_reference_id: uid,
        customer_email: email,
        metadata: {
          uid,
          plan
        }
      });

      res.json({ 
        success: true, 
        sessionId: session.id,
        url: session.url 
      });

    } catch (error) {
      console.error('❌ Stripe checkout error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        const { uid, plan } = session.metadata;

        // Update user subscription in Firestore
        await db.collection('responsaveis').doc(uid).update({
          plan,
          subscription: {
            status: 'active',
            stripeCustomer: session.customer,
            stripeSub: session.subscription,
            updatedAt: FieldValue.serverTimestamp()
          },
          limits: getSubscriptionLimits(plan)
        });

        console.log(`✅ Subscription activated for user ${uid}: ${plan}`);
        break;

      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        
        // Find user by stripe customer ID
        const usersSnapshot = await db.collection('responsaveis')
          .where('subscription.stripeCustomer', '==', subscription.customer)
          .get();

        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          await userDoc.ref.update({
            plan: 'free',
            'subscription.status': 'canceled',
            'subscription.updatedAt': FieldValue.serverTimestamp(),
            limits: getSubscriptionLimits('free')
          });
        }
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

/* ============================================================
   ⚠️ EMERGENCY ALERTS (Check for unanswered reminders)
   ============================================================ */

async function checkEmergencyAlertsLogic() {
  console.log("🚨 Checking for emergency alerts...");
  
  const twentyMinutesAgo = new Date();
  twentyMinutesAgo.setMinutes(twentyMinutesAgo.getMinutes() - 20);

  // Find reminders sent more than 20 minutes ago without response
  const unrespondedSnapshot = await db.collection('lembretes_status')
    .where('status', '==', 'enviado')
    .where('dataHora', '<=', Timestamp.fromDate(twentyMinutesAgo))
    .get();

  if (unrespondedSnapshot.empty) {
    console.log("✅ No emergency alerts needed");
    return;
  }

  console.log(`🚨 Found ${unrespondedSnapshot.size} unresponded reminders`);

  for (const lembreteDoc of unrespondedSnapshot.docs) {
    const lembrete = { id: lembreteDoc.id, ...lembreteDoc.data() };
    
    // Get idoso and medication data
    const [idosoDoc, medicamentoDoc] = await Promise.all([
      db.collection('idosos').doc(lembrete.idosoId).get(),
      db.collection('medicamentos').doc(lembrete.medicamentoId).get()
    ]);

    if (!idosoDoc.exists || !medicamentoDoc.exists) continue;

    const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
    const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };

    // Update status to sem_resposta
    await db.collection('lembretes_status').doc(lembrete.id).update({
      status: 'sem_resposta',
      alertaSent: FieldValue.serverTimestamp()
    });

    // Get emergency contacts
    const contatosSnapshot = await db.collection('contatos_emergencia')
      .where('idosoId', '==', idoso.id)
      .get();

    // Send emergency alert to contacts
    const alertMsg = createEmergencyAlert(idoso.nome, medicamento.nome, lembrete.horarioOriginal);
    
    const alertPromises = [];
    
    // Send to emergency contacts
    contatosSnapshot.docs.forEach(contatoDoc => {
      const contato = contatoDoc.data();
      alertPromises.push(sendWhatsAppMessage(contato.whatsapp, alertMsg));
    });

    // Send to responsavel
    const responsavelDoc = await db.collection('responsaveis').doc(idoso.responsavelId).get();
    if (responsavelDoc.exists) {
      const responsavel = responsavelDoc.data();
      alertPromises.push(sendWhatsAppMessage(responsavel.whatsapp, alertMsg));
    }

    await Promise.all(alertPromises);
    console.log(`🚨 Emergency alert sent for ${idoso.nome} - ${medicamento.nome}`);
  }
}

// Production emergency alert checker (every 5 minutes)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  exports.checkEmergencyAlerts = functions.pubsub
    .schedule("every 5 minutes")
    .timeZone("America/Sao_Paulo")
    .onRun(checkEmergencyAlertsLogic);
}

// Debug manual trigger for emergency alerts
exports.debugCheckEmergencyAlerts = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      console.log("🧪 Manual trigger: checkEmergencyAlerts");
      await checkEmergencyAlertsLogic();
      res.json({ 
        success: true, 
        message: "✅ checkEmergencyAlerts executed manually!",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Error running checkEmergencyAlerts manually:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
});

/* ============================================================
   📈 DAILY REPORTS (Send daily summary to caregivers)
   ============================================================ */

async function sendDailyReportsLogic() {
  console.log("📈 Sending daily reports...");
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  // Get all active elders
  const idososSnapshot = await db.collection('idosos')
    .where('ativo', '==', true)
    .get();

  for (const idosoDoc of idososSnapshot.docs) {
    const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
    
    // Get yesterday's reminders
    const lembretesSnapshot = await db.collection('lembretes_status')
      .where('idosoId', '==', idoso.id)
      .where('dataHora', '>=', Timestamp.fromDate(yesterday))
      .where('dataHora', '<=', Timestamp.fromDate(endOfYesterday))
      .get();

    if (lembretesSnapshot.empty) continue;

    const lembretes = lembretesSnapshot.docs.map(doc => doc.data());
    
    const stats = {
      total: lembretes.length,
      tomou: lembretes.filter(l => l.status === 'tomou').length,
      naoTomou: lembretes.filter(l => l.status === 'nao_tomou').length,
      adiado: lembretes.filter(l => l.status === 'adiado').length,
      semResposta: lembretes.filter(l => l.status === 'sem_resposta').length
    };

    // Send report to responsavel
    const responsavelDoc = await db.collection('responsaveis').doc(idoso.responsavelId).get();
    if (responsavelDoc.exists) {
      const responsavel = responsavelDoc.data();
      const reportMsg = createDailyReport(idoso.nome, stats);
      
      await sendWhatsAppMessage(responsavel.whatsapp, reportMsg);
      console.log(`📈 Daily report sent for ${idoso.nome} to ${responsavel.nome}`);
    }
  }
}

// Production daily reports (every day at 8 AM Brazil time)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  exports.sendDailyReports = functions.pubsub
    .schedule("0 8 * * *")
    .timeZone("America/Sao_Paulo")
    .onRun(sendDailyReportsLogic);
}

// Debug manual trigger for daily reports
exports.debugSendDailyReports = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      console.log("🧪 Manual trigger: sendDailyReports");
      await sendDailyReportsLogic();
      res.json({ 
        success: true, 
        message: "✅ sendDailyReports executed manually!",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Error running sendDailyReports manually:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
});

/* ============================================================
   🧪 TESTING AND HEALTH CHECK ENDPOINTS
   ============================================================ */

exports.testTwilio = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (!process.env.TEST_PHONE_NUMBER) {
        throw new Error("TEST_PHONE_NUMBER not set in .env");
      }
      
      const testMessage = `🚀 Teste de mensagem pelo Firebase Functions + Twilio!

Timestamp: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

Se você recebeu esta mensagem, a integração está funcionando perfeitamente! ✅`;
      
      const result = await sendWhatsAppMessage(
        process.env.TEST_PHONE_NUMBER,
        testMessage
      );
      
      res.json({ 
        success: true, 
        message: "Test message sent",
        ...result,
        testPhone: process.env.TEST_PHONE_NUMBER
      });
    } catch (error) {
      console.error("❌ Twilio test error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

exports.getHealthStatus = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const twilioClient = getTwilioClient();
      const cfg = getTwilioConfig();

      // Count database records
      const [responsaveisSnapshot, idososSnapshot, medicamentosSnapshot] = await Promise.all([
        db.collection('responsaveis').get(),
        db.collection('idosos').get(),
        db.collection('medicamentos').where('ativo', '==', true).get()
      ]);

      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        brazilTime: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        services: {
          firebase: true,
          firestore: true,
          twilio: !!(twilioClient && cfg.phone),
          stripe: !!process.env.STRIPE_SECRET_KEY,
        },
        environment: {
          nodeVersion: process.version,
          timezone: "America/Sao_Paulo",
          isEmulator: process.env.FUNCTIONS_EMULATOR === "true",
          twilioConfigured: !!(cfg.sid && cfg.token && cfg.phone),
          stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        },
        database: {
          responsaveis: responsaveisSnapshot.size,
          idosos: idososSnapshot.size,
          medicamentosAtivos: medicamentosSnapshot.size
        },
        config: {
          twilioPhone: cfg.phone || "Not configured",
          testPhone: process.env.TEST_PHONE_NUMBER || "Not configured"
        }
      });
    } catch (error) {
      console.error("❌ Health check error:", error);
      res.status(500).json({ 
        status: "error", 
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
});

/* ============================================================
   🔄 MANUAL REMINDER TRIGGER (for testing)
   ============================================================ */

exports.sendManualReminder = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { idosoId, medicamentoId } = req.body;

      if (!idosoId || !medicamentoId) {
        return res.status(400).json({ error: 'Missing idosoId or medicamentoId' });
      }

      // Get idoso and medication data
      const [idosoDoc, medicamentoDoc] = await Promise.all([
        db.collection('idosos').doc(idosoId).get(),
        db.collection('medicamentos').doc(medicamentoId).get()
      ]);

      if (!idosoDoc.exists || !medicamentoDoc.exists) {
        return res.status(404).json({ error: 'Idoso or medication not found' });
      }

      const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
      const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };

      // Create reminder status record
      const lembreteStatusRef = await db.collection("lembretes_status").add({
        medicamentoId: medicamento.id,
        idosoId: idoso.id,
        dataHora: FieldValue.serverTimestamp(),
        status: "enviado",
        tentativas: 1,
        horarioOriginal: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        manual: true
      });

      // Send WhatsApp message
      const message = createReminderMessage(idoso.nome, medicamento.nome, medicamento.dosagem);
      const twilioResult = await sendWhatsAppMessage(idoso.whatsapp, message);

      // Update reminder status with Twilio result
      await lembreteStatusRef.update({
        twilioSent: twilioResult.success,
        twilioSid: twilioResult.sid,
        twilioError: twilioResult.success ? null : twilioResult.error
      });

      res.json({
        success: true,
        data: {
          lembreteId: lembreteStatusRef.id,
          twilioSent: twilioResult.success,
          twilioSid: twilioResult.sid
        }
      });

    } catch (error) {
      console.error('❌ Manual reminder error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

console.log("🚀 Cuidador Digital Functions loaded successfully!");