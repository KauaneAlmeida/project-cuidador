/* ============================================================
   🚀 INICIALIZAÇÃO
   ============================================================ */
require("dotenv").config();

// Debug logs: mostra se as variáveis estão sendo carregadas
console.log("🔧 Environment Variables Check:");
console.log("✅ TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "Loaded" : "❌ Missing");
console.log("✅ TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "Loaded" : "❌ Missing");
console.log("✅ TWILIO_PHONE_NUMBER:", process.env.TWILIO_PHONE_NUMBER ? process.env.TWILIO_PHONE_NUMBER : "❌ Missing");
console.log("✅ TEST_PHONE_NUMBER:", process.env.TEST_PHONE_NUMBER ? process.env.TEST_PHONE_NUMBER : "❌ Missing");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const twilio = require("twilio");
const cors = require("cors")({ origin: true });

// Inicializa Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

/* ============================================================
   🔧 TWILIO CONFIG
   ============================================================ */
const getTwilioConfig = () => ({
  sid: process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  phone: process.env.TWILIO_PHONE_NUMBER, // Exemplo: whatsapp:+14155238886 (sandbox Twilio)
});

const getTwilioClient = () => {
  const cfg = getTwilioConfig();
  if (!cfg.sid || !cfg.token) {
    console.error("❌ Twilio configuration missing.");
    return null;
  }
  return twilio(cfg.sid, cfg.token);
};

// Garante que o número tem o prefixo "whatsapp:"
const formatPhoneForWhatsApp = (phone) => {
  if (!phone) return null;
  if (phone.startsWith("whatsapp:")) return phone;
  const digits = phone.replace(/\D/g, "");
  return `whatsapp:+${digits}`;
};

// Envia mensagem pelo WhatsApp
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
   📌 WELCOME MESSAGE
   ============================================================ */
exports.sendWelcomeMessage = functions.https.onCall(async (data, context) => {
  const { nome, telefone } = data;

  if (!telefone) {
    return { success: false, error: "Telefone não informado" };
  }

  const msg = `🎉 Olá ${nome || "usuário"}! Seja bem-vindo ao Cuidador Digital 👵👴. 
A partir de agora, você receberá lembretes automáticos dos seus medicamentos. 💊`;

  return await sendWhatsAppMessage(telefone, msg);
});

/* ============================================================
   ⏰ FUNÇÕES DE LEMBRETES
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
  return new Date().getDay(); // 0 = Domingo, 1 = Segunda ...
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

// Executa a cada 1 minuto em produção
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  exports.checkMedicationReminders = functions.pubsub
    .schedule("every 1 minutes")
    .timeZone("America/Sao_Paulo")
    .onRun(checkMedicationRemindersLogic);
}

// Debug manual (emulador)
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
   🌐 HTTP ENDPOINTS PARA TESTE
   ============================================================ */

// Testa envio de mensagem no WhatsApp
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

// Health check (pra ver se o Twilio está ok)
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
        timezone: "America/Sao_Paulo",
      },
      environment: {
        nodeVersion: process.version,
        twilioConfigured: !!(cfg.sid && cfg.token && cfg.phone),
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message });
  }
});
