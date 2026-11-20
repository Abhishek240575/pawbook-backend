/**
 * PawBook WhatsApp Notification Service
 * Uses Twilio WhatsApp API (WhatsApp Business via Twilio sandbox / WABA)
 *
 * ENV VARIABLES REQUIRED (add to .env):
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_WA_FROM=whatsapp:+14155238886        ← Twilio sandbox number (or your WABA number)
 *   VET_WHATSAPP=whatsapp:+919999999999         ← Vet's WhatsApp (can be overridden per-vet)
 *   APP_BASE_URL=https://pawbook.deemona.com
 *
 * HOW IT WORKS:
 *   - All messages go through Twilio → WhatsApp Business API → recipient's WhatsApp
 *   - For production: apply for a WhatsApp Business Account (WABA) at business.whatsapp.com
 *     Twilio handles the WABA bridge. Same code, just change TWILIO_WA_FROM to your WABA number.
 *   - For testing: use Twilio Sandbox (recipients must opt-in by texting "join <keyword>")
 */

'use strict';

const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = process.env.TWILIO_WA_FROM || 'whatsapp:+14155238886';
const APP_URL = process.env.APP_BASE_URL || 'https://pawbook.deemona.com';

/** Normalize any phone string → WhatsApp: format */
function waNum(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : '+' + digits;
  return 'whatsapp:' + e164;
}

/** Core send — returns Twilio message SID or null on failure */
async function sendWA(to, body) {
  const toNum = waNum(to);
  if (!toNum) {
    console.warn('[WA] Invalid phone, skipping:', to);
    return null;
  }
  try {
    const msg = await client.messages.create({ from: FROM, to: toNum, body });
    console.log('[WA] Sent to', toNum, '→ SID:', msg.sid);
    return msg.sid;
  } catch (err) {
    console.error('[WA] Failed to', toNum, ':', err.message);
    return null;
  }
}

/** Send to multiple numbers in parallel, ignore failures */
async function sendWAMany(phones, body) {
  return Promise.allSettled(phones.filter(Boolean).map(p => sendWA(p, body)));
}

/* ═══════════════════════════════════════════════════════════════════════
   1. APPOINTMENT BOOKED — notify vet + owner simultaneously
   ═══════════════════════════════════════════════════════════════════════ */
async function notifyAppointmentBooked({ vetPhone, ownerPhone, vetName, ownerName, petName, apptDate, apptTime, consultType, apptId }) {
  const dateStr = formatDate(apptDate);
  const timeStr = formatTime(apptTime);
  const bookingUrl = `${APP_URL}/11_vet_booking.html`;

  const vetMsg =
    `🐾 *New Appointment Request — PawBook*\n\n` +
    `A pet owner has requested an appointment.\n\n` +
    `👤 *Owner:* ${ownerName}\n` +
    `🐶 *Pet:* ${petName}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🕐 *Time:* ${timeStr}\n` +
    `📋 *Type:* ${consultType}\n\n` +
    `Please confirm or cancel from your Vet Portal:\n${bookingUrl}\n\n` +
    `Appointment ID: ${apptId}`;

  const ownerMsg =
    `🐾 *Appointment Request Sent — PawBook*\n\n` +
    `Hi ${ownerName}! Your appointment request has been sent to *${vetName}*.\n\n` +
    `🐶 *Pet:* ${petName}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🕐 *Time:* ${timeStr}\n` +
    `📋 *Type:* ${consultType}\n\n` +
    `You will receive a confirmation once the vet approves. ✅\n` +
    `Track your appointment: ${bookingUrl}`;

  return sendWAMany([vetPhone, ownerPhone], null, [
    { to: vetPhone, body: vetMsg },
    { to: ownerPhone, body: ownerMsg }
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════
   2. APPOINTMENT CONFIRMED by vet — notify both
   ═══════════════════════════════════════════════════════════════════════ */
async function notifyAppointmentConfirmed({ vetPhone, ownerPhone, vetName, ownerName, petName, apptDate, apptTime, consultType, apptId, vetNote }) {
  const dateStr = formatDate(apptDate);
  const timeStr = formatTime(apptTime);
  const bookingUrl = `${APP_URL}/11_vet_booking.html`;

  const ownerMsg =
    `✅ *Appointment Confirmed — PawBook*\n\n` +
    `Hi ${ownerName}! *${vetName}* has confirmed your appointment.\n\n` +
    `🐶 *Pet:* ${petName}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🕐 *Time:* ${timeStr}\n` +
    `📋 *Type:* ${consultType}\n` +
    (vetNote ? `\n📝 *Note from vet:* ${vetNote}\n` : '') +
    `\nSee you there! 🏥\n${bookingUrl}`;

  const vetMsg =
    `✅ *Appointment Confirmed — PawBook*\n\n` +
    `You have confirmed the appointment for:\n\n` +
    `👤 *Owner:* ${ownerName}\n` +
    `🐶 *Pet:* ${petName}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🕐 *Time:* ${timeStr}\n\n` +
    `The pet owner has been notified. Appointment ID: ${apptId}`;

  return Promise.allSettled([
    sendWA(ownerPhone, ownerMsg),
    sendWA(vetPhone, vetMsg)
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════
   3. APPOINTMENT CANCELLED — notify both with reason
   ═══════════════════════════════════════════════════════════════════════ */
async function notifyAppointmentCancelled({ vetPhone, ownerPhone, vetName, ownerName, petName, apptDate, apptTime, cancelledBy, reason, apptId }) {
  const dateStr = formatDate(apptDate);
  const timeStr = formatTime(apptTime);
  const bookingUrl = `${APP_URL}/11_vet_booking.html`;

  let ownerMsg, vetMsg;

  if (cancelledBy === 'vet') {
    ownerMsg =
      `❌ *Appointment Cancelled — PawBook*\n\n` +
      `Hi ${ownerName}, *${vetName}* has cancelled your appointment.\n\n` +
      `🐶 *Pet:* ${petName}\n` +
      `📅 *Was scheduled:* ${dateStr} at ${timeStr}\n` +
      (reason ? `📝 *Reason:* ${reason}\n` : '') +
      `\nPlease book a new appointment at your convenience:\n${bookingUrl}`;

    vetMsg =
      `❌ *Appointment Cancelled — PawBook*\n\n` +
      `You cancelled the appointment for *${petName}* (owner: ${ownerName}) on ${dateStr} at ${timeStr}.\n` +
      (reason ? `Reason noted: ${reason}\n` : '') +
      `The pet owner has been notified.`;
  } else {
    vetMsg =
      `❌ *Appointment Cancelled by Owner — PawBook*\n\n` +
      `*${ownerName}* has cancelled their appointment.\n\n` +
      `🐶 *Pet:* ${petName}\n` +
      `📅 *Was scheduled:* ${dateStr} at ${timeStr}\n` +
      (reason ? `📝 *Reason:* ${reason}\n` : '') +
      `\nThis slot is now free. Appointment ID: ${apptId}`;

    ownerMsg =
      `❌ *Appointment Cancelled — PawBook*\n\n` +
      `Hi ${ownerName}, your appointment with *${vetName}* on ${dateStr} at ${timeStr} has been cancelled.\n` +
      (reason ? `Reason: ${reason}\n` : '') +
      `\nBook again anytime: ${bookingUrl}`;
  }

  return Promise.allSettled([
    sendWA(ownerPhone, ownerMsg),
    sendWA(vetPhone, vetMsg)
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════
   4. PRE-APPOINTMENT REMINDER — sent every 10 hrs until consultation done
      Call this from a cron job: schedule after confirmation, repeat until status = 'completed'
   ═══════════════════════════════════════════════════════════════════════ */
async function sendAppointmentReminder({ ownerPhone, vetName, petName, apptDate, apptTime, consultType, hoursUntil }) {
  const dateStr = formatDate(apptDate);
  const timeStr = formatTime(apptTime);

  let urgencyLine;
  if (hoursUntil <= 1)        urgencyLine = `⏰ Your appointment is in *less than 1 hour!*`;
  else if (hoursUntil <= 12)  urgencyLine = `⏰ Your appointment is in *${Math.round(hoursUntil)} hours.*`;
  else if (hoursUntil <= 24)  urgencyLine = `📅 Your appointment is *tomorrow.*`;
  else                        urgencyLine = `📅 Upcoming appointment reminder.`;

  const msg =
    `🐾 *Appointment Reminder — PawBook*\n\n` +
    `${urgencyLine}\n\n` +
    `🏥 *Vet:* ${vetName}\n` +
    `🐶 *Pet:* ${petName}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🕐 *Time:* ${timeStr}\n` +
    `📋 *Type:* ${consultType}\n\n` +
    `Please be on time. See you soon! 🐾`;

  return sendWA(ownerPhone, msg);
}

/* ═══════════════════════════════════════════════════════════════════════
   5. PRESCRIPTION DELIVERED — sent to both owner and vet after consultation
   ═══════════════════════════════════════════════════════════════════════ */
async function sendPrescription({ vetPhone, ownerPhone, vetName, ownerName, petName, petBreed, apptDate, medicines, instructions, followUpDate, prescriptionId }) {
  const dateStr = formatDate(apptDate);
  const rxUrl = `${APP_URL}/11_vet_booking.html#rx-${prescriptionId}`;

  // Build medicine list
  const medLines = (medicines || []).map((m, i) =>
    `${i+1}. *${m.name}* — ${m.dosage}, ${m.frequency}` + (m.duration ? `, for ${m.duration}` : '') + (m.instructions ? `\n   _${m.instructions}_` : '')
  ).join('\n');

  const ownerMsg =
    `💊 *Prescription from ${vetName} — PawBook*\n\n` +
    `Hi ${ownerName}! Here is *${petName}'s* prescription from today's consultation.\n\n` +
    `📅 *Consultation date:* ${dateStr}\n` +
    `🏥 *Vet:* ${vetName}\n\n` +
    `*Prescribed Medicines:*\n${medLines}\n\n` +
    (instructions ? `📋 *Instructions:* ${instructions}\n\n` : '') +
    (followUpDate ? `🔁 *Follow-up:* ${formatDate(followUpDate)}\n\n` : '') +
    `View full prescription: ${rxUrl}\n\n` +
    `_Please follow the dosage instructions carefully. Contact your vet if you notice any side effects._`;

  const vetMsg =
    `💊 *Prescription Sent — PawBook*\n\n` +
    `Prescription for *${petName}* (${petBreed || 'pet'}) — ${ownerName}\n` +
    `Consultation: ${dateStr}\n\n` +
    `*Medicines prescribed:*\n${medLines}\n\n` +
    (instructions ? `Instructions: ${instructions}\n\n` : '') +
    (followUpDate ? `Follow-up: ${formatDate(followUpDate)}\n\n` : '') +
    `Prescription ID: ${prescriptionId}\nFull record: ${rxUrl}`;

  return Promise.allSettled([
    sendWA(ownerPhone, ownerMsg),
    sendWA(vetPhone, vetMsg)
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════
   6. VACCINATION REMINDER — sent every 24 hrs as due date approaches
      Triggered by cron. Send when: 30 days, 7 days, 3 days, 1 day, overdue
   ═══════════════════════════════════════════════════════════════════════ */
async function sendVaccinationReminder({ ownerPhone, ownerName, petName, vaccineName, dueDate, daysUntilDue, vetName, bookingUrl }) {
  const dueDateStr = formatDate(dueDate);
  const url = bookingUrl || `${APP_URL}/11_vet_booking.html`;

  let urgency, emoji;
  if (daysUntilDue < 0) {
    urgency = `*OVERDUE by ${Math.abs(daysUntilDue)} day(s)!* Please book immediately.`;
    emoji = '🚨';
  } else if (daysUntilDue === 0) {
    urgency = `*DUE TODAY!* Please book immediately.`;
    emoji = '🚨';
  } else if (daysUntilDue <= 3) {
    urgency = `due in *${daysUntilDue} day(s)* — book this week!`;
    emoji = '⚠️';
  } else if (daysUntilDue <= 7) {
    urgency = `due in *${daysUntilDue} days* — book soon.`;
    emoji = '📅';
  } else {
    urgency = `due on *${dueDateStr}* — plan ahead.`;
    emoji = '💉';
  }

  const msg =
    `${emoji} *Vaccination Reminder — PawBook*\n\n` +
    `Hi ${ownerName}! *${petName}'s* ${vaccineName} vaccination is ${urgency}\n\n` +
    `📅 *Due date:* ${dueDateStr}\n` +
    `🏥 *Recommended vet:* ${vetName || 'Your registered vet'}\n\n` +
    `Book now to keep ${petName} protected! 🐾\n${url}`;

  return sendWA(ownerPhone, msg);
}

/* ═══════════════════════════════════════════════════════════════════════
   7. SOS EMERGENCY ALERT — owner sends to vet in emergency
      Sends high-priority WhatsApp to vet immediately (even outside clinic hours)
   ═══════════════════════════════════════════════════════════════════════ */
async function sendSOSAlert({ vetPhone, ownerPhone, ownerName, petName, petBreed, emergencyDesc, ownerLocation, apptId }) {
  const timeNow = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const url = `${APP_URL}/11_vet_booking.html`;

  const vetMsg =
    `🚨🚨 *SOS EMERGENCY — PawBook* 🚨🚨\n\n` +
    `A pet owner needs URGENT veterinary assistance!\n\n` +
    `👤 *Owner:* ${ownerName}\n` +
    `📞 *Owner Phone:* ${ownerPhone || 'Not provided'}\n` +
    `🐾 *Pet:* ${petName}${petBreed ? ' (' + petBreed + ')' : ''}\n` +
    `🕐 *Time:* ${timeNow}\n` +
    `📍 *Location:* ${ownerLocation || 'Not shared'}\n\n` +
    `🆘 *Emergency:* ${emergencyDesc}\n\n` +
    `Please respond immediately or call the owner directly.\n` +
    `View record: ${url}` +
    (apptId ? `\nAppointment ref: ${apptId}` : '');

  const ownerMsg =
    `🚨 *SOS Sent — PawBook*\n\n` +
    `Hi ${ownerName}, your SOS alert has been sent to your vet.\n\n` +
    `🐾 *Pet:* ${petName}\n` +
    `🕐 *Sent at:* ${timeNow}\n\n` +
    `*Your vet will contact you shortly.* If this is a life-threatening emergency, also call your nearest 24-hour animal hospital.\n\n` +
    `🏥 *Emergency Animal Hospitals:*\n` +
    `• AIIMS Animal Hospital Delhi: 011-26588500\n` +
    `• Cessna Lifeline Vet Hospital (Bangalore): 080-25638000\n` +
    `• Mumbai SPCA: 022-24132044\n\n` +
    `Stay calm and keep your pet comfortable. 🐾`;

  return Promise.allSettled([
    sendWA(vetPhone, vetMsg),
    sendWA(ownerPhone, ownerMsg)
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
function formatDate(d) {
  if (!d) return 'TBD';
  try {
    const dt = new Date(d.includes('T') ? d : d + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  } catch { return d; }
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m||0).padStart(2,'0')} ${ampm}`;
}

module.exports = {
  sendWA,
  notifyAppointmentBooked,
  notifyAppointmentConfirmed,
  notifyAppointmentCancelled,
  sendAppointmentReminder,
  sendPrescription,
  sendVaccinationReminder,
  sendSOSAlert,
};
