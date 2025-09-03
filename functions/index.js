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
  const digits = phone.replace(/\D/g, "");
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
    console.log(`📱 Sending WhatsApp from ${cfg.phone} to ${formattedTo}: ${message}`);

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

      // Save responsavel
      const responsavelRef = await db.collection('responsaveis').add({
        ...responsavel,
        createdAt: FieldValue.serverTimestamp()
      });

      // Save idoso
      const idosoRef = await db.collection('idosos').add({
        ...idoso,
        responsavelId: responsavelRef.id,
        createdAt: FieldValue.serverTimestamp()
      });

      // Save medicamentos
      const medicamentosPromises = medicamentos.map(med => 
        db.collection('medicamentos').add({
          ...med,
          idosoId: idosoRef.id,
          ativo: true,
          createdAt: FieldValue.serverTimestamp()
        })
      );
      await Promise.all(medicamentosPromises);

      // Save contatos de emergencia
      if (contatos && contatos.length > 0) {
        const contatosPromises = contatos.map(contato => 
          db.collection('contatos_emergencia').add({
            ...contato,
            idosoId: idosoRef.id,
            createdAt: FieldValue.serverTimestamp()
          })
        );
        await Promise.all(contatosPromises);
      }

      // Save LGPD consent
      await db.collection('lgpd_consents').add({
        responsavelId: responsavelRef.id,
        idosoId: idosoRef.id,
        aceito: lgpdConsent,
        dataAceite: FieldValue.serverTimestamp(),
        versao: '1.0'
      });

      // Send welcome message
      const welcomeMsg = `🎉 Olá ${idoso.nome}! Seja bem-vindo ao Cuidador Digital 👵👴. 
A partir de agora, você receberá lembretes automáticos dos seus medicamentos. 💊

Quando receber um lembrete, responda:
1️⃣ para "Tomei"
2️⃣ para "Não tomei"  
3️⃣ para "Adiar 10 min"

Para parar os lembretes, envie "SAIR".

Vamos cuidar da sua saúde juntos! 💙`;

      const twilioResult = await sendWhatsAppMessage(idoso.whatsapp, welcomeMsg);

      console.log('✅ Registration completed successfully');

      res.json({
        success: true,
        data: {
          responsavelId: responsavelRef.id,
          idosoId: idosoRef.id,
          contatosCount: contatos?.length || 0,
          medicamentosCount: medicamentos.length,
          twilioSent: twilioResult.success,
          twilioSid: twilioResult.sid
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

const createReminderMessage = (nomeIdoso, medicacao, dosagem) => {
  return `⏰ Olá, ${nomeIdoso} 👋 — Hora do remédio *${medicacao}* (${dosagem}). 
Responda: 1) ✅ Tomei  2) ❌ Não tomei  3) ⏳ Adiar 10 min.`;
};

const getCurrentBrazilTime = () => {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCurrentDayOfWeek = () => {
  return new Date().getDay(); // 0 = Sunday, 1 = Monday ...
};

async function checkMedicationRemindersLogic() {
  console.log("🔍 Checking for medication reminders...");
  const currentTime = getCurrentBrazilTime();
  const currentDay = parseInt(getCurrentDayOfWeek()) % 7;

  const medicamentosSnapshot = await db
    .collection("medicamentos")
    .where("ativo", "==", true)
    .get();

  if (medicamentosSnapshot.empty) {
    console.log("📋 No active medications found");
    return;
  }

  const batch = db.batch();
  let remindersToSend = [];

  for (const medicamentoDoc of medicamentosSnapshot.docs) {
    const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };

    if (!medicamento.diasDaSemana.includes(currentDay)) continue;

    const isTimeToRemind = medicamento.horarios.some((horario) => {
      const scheduledTime = horario.substring(0, 5);
      return scheduledTime === currentTime;
    });

    if (isTimeToRemind) {
      const idosoDoc = await db.collection("idosos").doc(medicamento.idosoId).get();
      if (!idosoDoc.exists) continue;
      const idoso = { id: idosoDoc.id, ...idosoDoc.data() };

      const lembreteStatusRef = db.collection("lembretes_status").doc();
      const lembreteStatus = {
        medicamentoId: medicamento.id,
        idosoId: idoso.id,
        dataHora: FieldValue.serverTimestamp(),
        status: "enviado",
        tentativas: 1,
        horarioOriginal: currentTime,
      };

      batch.set(lembreteStatusRef, lembreteStatus);
      remindersToSend.push({ idoso, medicamento, lembreteId: lembreteStatusRef.id });
    }
  }

  if (remindersToSend.length > 0) {
    await batch.commit();
  }

  for (const reminder of remindersToSend) {
    const message = createReminderMessage(
      reminder.idoso.nome,
      reminder.medicamento.nome,
      reminder.medicamento.dosagem
    );

    const result = await sendWhatsAppMessage(reminder.idoso.whatsapp, message);

    if (result.success) {
      await db.collection("lembretes_status").doc(reminder.lembreteId).update({
        twilioSid: result.sid,
        twilioStatus: result.status,
      });
    } else {
      await db.collection("lembretes_status").doc(reminder.lembreteId).update({
        status: "erro",
        erro: result.error,
      });
    }
  }
}

// Production scheduler (every 1 minute)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  exports.checkMedicationReminders = functions.pubsub
    .schedule("every 1 minutes")
    .timeZone("America/Sao_Paulo")
    .onRun(checkMedicationRemindersLogic);
}

// Debug manual trigger
exports.debugCheckMedicationReminders = functions.https.onRequest(async (req, res) => {
  try {
    await checkMedicationRemindersLogic();
    res.send("✅ checkMedicationReminders executed manually!");
  } catch (error) {
    console.error("❌ Error running checkMedicationReminders manually:", error);
    res.status(500).send(error.toString());
  }
});

/* ============================================================
   📱 WHATSAPP WEBHOOK HANDLER
   ============================================================ */

exports.handleWhatsAppWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { From, Body } = req.body;
      
      if (!From || !Body) {
        return res.status(400).json({ error: 'Missing From or Body' });
      }

      console.log(`📱 WhatsApp webhook: ${From} -> ${Body}`);

      // Extract phone number (remove whatsapp: prefix)
      const phoneNumber = From.replace('whatsapp:', '').replace('+', '');
      
      // Handle opt-out
      if (Body.toUpperCase().includes('SAIR')) {
        await handleOptOut(phoneNumber);
        return res.json({ success: true, action: 'opt-out' });
      }

      // Handle medication responses (1, 2, 3)
      if (['1', '2', '3'].includes(Body.trim())) {
        await handleMedicationResponse(phoneNumber, Body.trim());
        return res.json({ success: true, action: 'medication-response' });
      }

      // Unknown response
      const unknownMsg = `Não entendi sua resposta "${Body}". 
Para lembretes de medicação, responda: 1, 2 ou 3.
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
  // Find the most recent pending reminder for this phone number
  const idososSnapshot = await db.collection('idosos')
    .where('whatsapp', '==', phoneNumber)
    .get();

  if (idososSnapshot.empty) {
    console.log(`❌ No idoso found for phone: ${phoneNumber}`);
    return;
  }

  const idoso = { id: idososSnapshot.docs[0].id, ...idososSnapshot.docs[0].data() };

  // Find most recent pending reminder
  const lembreteSnapshot = await db.collection('lembretes_status')
    .where('idosoId', '==', idoso.id)
    .where('status', '==', 'enviado')
    .orderBy('dataHora', 'desc')
    .limit(1)
    .get();

  if (lembreteSnapshot.empty) {
    console.log(`❌ No pending reminders for idoso: ${idoso.id}`);
    return;
  }

  const lembrete = { id: lembreteSnapshot.docs[0].id, ...lembreteSnapshot.docs[0].data() };
  
  // Get medication details
  const medicamentoDoc = await db.collection('medicamentos').doc(lembrete.medicamentoId).get();
  const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };

  let newStatus = '';
  let confirmationMsg = '';
  let shouldReschedule = false;

  switch (response) {
    case '1': // Tomei
      newStatus = 'tomou';
      confirmationMsg = `Perfeito, ${idoso.nome}! ✔️ Registramos que você tomou ${medicamento.nome}. Obrigado!`;
      break;
    case '2': // Não tomei
      newStatus = 'nao_tomou';
      confirmationMsg = `Entendido. Foi registrado que ${medicamento.nome} não foi tomado. Se precisar de ajuda, fale com seu responsável.`;
      break;
    case '3': // Adiar
      newStatus = 'adiado';
      confirmationMsg = `Ok, vamos lembrar de novo em ${process.env.FUNCTIONS_EMULATOR === "true" ? "1 minuto" : "10 minutos"} — responda 1 quando tomar :)`;
      shouldReschedule = true;
      break;
  }

  // Update reminder status
  await db.collection('lembretes_status').doc(lembrete.id).update({
    status: newStatus,
    respostaRecebida: response,
    ultimaResposta: FieldValue.serverTimestamp()
  });

  // Send confirmation
  await sendWhatsAppMessage(`whatsapp:+${phoneNumber}`, confirmationMsg);

  // Reschedule if needed (3 = delay)
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
      adiado: true
    });
  }
}

async function handleOptOut(phoneNumber) {
  // Find idoso and deactivate all medications
  const idososSnapshot = await db.collection('idosos')
    .where('whatsapp', '==', phoneNumber)
    .get();

  if (idososSnapshot.empty) return;

  const idoso = { id: idososSnapshot.docs[0].id, ...idososSnapshot.docs[0].data() };

  // Deactivate all medications
  const medicamentosSnapshot = await db.collection('medicamentos')
    .where('idosoId', '==', idoso.id)
    .get();

  const batch = db.batch();
  medicamentosSnapshot.docs.forEach(doc => {
    batch.update(doc.ref, { ativo: false, optOutDate: FieldValue.serverTimestamp() });
  });
  await batch.commit();

  // Send confirmation
  const optOutMsg = `${idoso.nome}, os lembretes foram interrompidos conforme solicitado.

Para reativar, entre em contato com seu responsável.

Cuide-se! 💙`;

  await sendWhatsAppMessage(`whatsapp:+${phoneNumber}`, optOutMsg);
}

/* ============================================================
   📊 REPORTING AND CSV EXPORT
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

      const stats = {
        total: lembretes.length,
        tomou: lembretes.filter(l => l.status === 'tomou').length,
        naoTomou: lembretes.filter(l => l.status === 'nao_tomou').length,
        adiado: lembretes.filter(l => l.status === 'adiado').length,
        semResposta: lembretes.filter(l => l.status === 'sem_resposta').length
      };

      res.json({
        success: true,
        data: {
          date: targetDate.toISOString().split('T')[0],
          stats,
          lembretes
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
      const { idosoId } = req.query;
      
      if (!idosoId) {
        return res.status(400).json({ error: 'idosoId is required' });
      }

      // Get last 5000 reminder logs for Power BI
      const lembretesSnapshot = await db.collection('lembretes_status')
        .where('idosoId', '==', idosoId)
        .orderBy('dataHora', 'desc')
        .limit(5000)
        .get();

      // Generate CSV
      let csv = 'dataHora,status,medicamentoId,respostaRecebida,tentativas\n';
      
      lembretesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const dataHora = data.dataHora.toDate().toISOString();
        csv += `${dataHora},${data.status},${data.medicamentoId},${data.respostaRecebida || ''},${data.tentativas}\n`;
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
        await db.collection('users').doc(uid).set({
          plan,
          subscription: {
            status: 'active',
            stripeCustomer: session.customer,
            stripeSub: session.subscription,
            updatedAt: FieldValue.serverTimestamp()
          },
          limits: getSubscriptionLimits(plan)
        }, { merge: true });

        console.log(`✅ Subscription activated for user ${uid}: ${plan}`);
        break;

      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        
        // Find user by stripe customer ID
        const usersSnapshot = await db.collection('users')
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

function getSubscriptionLimits(plan) {
  const limits = {
    free: { elders: 1, medications: 2, reminders: 2 },
    basic: { elders: 1, medications: 3, reminders: 3 },
    family: { elders: 4, medications: 50, reminders: 10 },
    premium: { elders: 10, medications: 200, reminders: -1 } // unlimited
  };
  
  return limits[plan] || limits.free;
}

/* ============================================================
   🧪 TESTING ENDPOINTS
   ============================================================ */

exports.testTwilio = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (!process.env.TEST_PHONE_NUMBER) {
        throw new Error("TEST_PHONE_NUMBER not set in .env");
      }
      
      const message = await sendWhatsAppMessage(
        process.env.TEST_PHONE_NUMBER,
        "🚀 Teste de mensagem pelo Firebase Functions + Twilio!"
      );
      
      res.json({ success: true, ...message });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

exports.getHealthStatus = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const twilioClient = getTwilioClient();
    const cfg = getTwilioConfig();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        firebase: true,
        twilio: !!(twilioClient && cfg.phone),
        stripe: !!process.env.STRIPE_SECRET_KEY,
        timezone: "America/Sao_Paulo",
      },
      environment: {
        nodeVersion: process.version,
        twilioConfigured: !!(cfg.sid && cfg.token && cfg.phone),
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        isEmulator: process.env.FUNCTIONS_EMULATOR === "true"
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message });
  }
});