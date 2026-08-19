const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) {
      process.env[key.trim()] = val.trim();
    }
  });
}

async function testSendEmail() {
  const host = process.env.SMTP_HOST || 'webmail.workd.go.th';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || 'it@fishmarket.co.th';
  const pass = process.env.SMTP_PASS || '';

  console.log('📧 ข้อมูล SMTP:', { host, port, user, passConfigured: Boolean(pass) });

  if (!pass) {
    console.log('⚠️ ยังไม่ได้ระบุรหัสผ่าน SMTP_PASS ในไฟล์ .env');
    console.log('💡 กรุณาใส่รหัสผ่านใน .env ก่อนทดสอบยิงนะครับ');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  try {
    console.log('🚀 กำลังส่งอีเมลทดสอบหา ranida.c@fishmarket.co.th...');
    const info = await transporter.sendMail({
      from: `"FMO Smart Queue" <${user}>`,
      to: 'ranida.c@fishmarket.co.th',
      subject: '[FMO Smart Queue] ทดสอบระบบแจ้งเตือนทางอีเมล',
      html: `
        <div style="font-family: 'Sarabun', sans-serif; padding: 20px; border: 1px solid #0284c7; border-radius: 12px; max-width: 600px;">
          <h2 style="color: #0284c7;">📢 ทดสอบระบบแจ้งเตือนคำสั่งจัดสรรคิวกิจกรรม อสป.</h2>
          <p>เรียนคุณ รณิดา โชติธนาอุดม (ranida.c@fishmarket.co.th)</p>
          <p>นี่คืออีเมลทดสอบการส่งระบบแจ้งเตือนคิวกิจกรรมจาก <strong>FMO Smart Queue System</strong></p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
          <p style="color: #10b981; font-weight: bold;">✅ การเชื่อมต่อระบบอีเมลสำเร็จเรียบร้อยแล้ว (ส่งจาก ${user})</p>
        </div>
      `
    });

    console.log('🎉 ส่งอีเมลสำเร็จเรียบร้อยแล้ว! Message ID:', info.messageId);
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการส่งอีเมล:', err.message);
  }
}

testSendEmail();
