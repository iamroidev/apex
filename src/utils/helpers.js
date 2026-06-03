// ---------- INPUT SANITIZATION ----------
function sanitizeString(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  // Strip HTML tags and trim
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ---------- ICS CALENDAR GENERATOR ----------
function generateICS({ title, description, startDate, durationMinutes, roomId, hostName, organizer }) {
  const formatDT = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const start = new Date(startDate);
  const end = new Date(start.getTime() + (durationMinutes || 60) * 60000);
  const uid = roomId + '-' + Date.now() + '@apexclassroom';
  const meetingUrl = `https://${process.env.PUBLIC_HOST || 'apexclassroom.duckdns.org'}/?join=${roomId}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apex Classroom//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTART:' + formatDT(start),
    'DTEND:' + formatDT(end),
    'SUMMARY:' + (title || 'Meeting'),
    'DESCRIPTION:' + (description || '') + '\\n\\nJoin link: ' + meetingUrl,
    'LOCATION:' + meetingUrl,
    'ORGANIZER;CN=' + (organizer || hostName || 'Host') + ':mailto:' + (process.env.EMAIL_USER || 'noreply@apexclassroom.duckdns.org'),
    'ATTENDEE:mailto:' + (process.env.EMAIL_USER || 'noreply@apexclassroom.duckdns.org'),
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: ' + (title || 'Meeting') + ' starts in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// ---------- EMAIL NOTIFICATIONS ----------
async function sendEmail(to, subject, htmlBody) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  if (!emailUser || !emailPass) return false;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });
    await transporter.sendMail({
      from: `"Apex Classroom" <${emailUser}>`,
      to,
      subject,
      html: htmlBody
    });
    return true;
  } catch (e) {
    console.error('Email send failed:', e.message);
    return false;
  }
}

module.exports = {
  sanitizeString,
  generateICS,
  sendEmail
};
