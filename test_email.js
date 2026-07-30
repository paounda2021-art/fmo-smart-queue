const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const envPath = path.join(__dirname, '.env');
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
  const user = process.env.SMTP_USER || 'ranida.c@fishmarket.co.th';
  const pass = process.env.SMTP_PASS || '';

  if (!pass) {
    console.log('⚠️ ยังไม่ได้ระบุรหัสผ่าน SMTP_PASS ในไฟล์ .env');
    return;
  }

  // รายการ Host และ Port ที่จะทดสอบ
  const candidates = [
    { host: process.env.SMTP_HOST || 'mail.fishmarket.co.th', port: 587 },
    { host: 'mail.fishmarket.co.th', port: 465 },
    { host: 'mail.fishmarket.co.th', port: 25 },
    { host: 'mail.workd.go.th', port: 587 },
    { host: 'mail.workd.go.th', port: 465 },
    { host: 'webmail.workd.go.th', port: 465 },
    { host: 'smtp.gmail.com', port: 587 }
  ];

  console.log('📧 กำลังเริ่มทดสอบการเชื่อมต่อ SMTP Server ขององค์กร...');

  for (const item of candidates) {
    console.log(`\n🔍 กำลังทดสอบ Host: ${item.host} (Port: ${item.port})...`);
    
    const transporter = nodemailer.createTransport({
      host: item.host,
      port: item.port,
      secure: item.port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000
    });

    try {
      const info = await transporter.sendMail({
        from: `"FMO Smart Queue" <${user}>`,
        to: 'ranida.c@fishmarket.co.th',
        subject: '[FMO Smart Queue] ทดสอบระบบแจ้งเตือนทางอีเมล',
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #0284c7; border-radius: 12px; max-width: 600px;">
            <h2 style="color: #0284c7;">📢 ทดสอบระบบแจ้งเตือนคำสั่งจัดสรรคิวกิจกรรม อสป.</h2>
            <p>เรียนคุณ รณิดา โชติธนาอุดม (ranida.c@fishmarket.co.th)</p>
            <p>นี่คืออีเมลทดสอบการส่งระบบแจ้งเตือนคิวกิจกรรมจาก <strong>FMO Smart Queue System</strong></p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
            <p style="color: #10b981; font-weight: bold;">✅ สำเร็จผ่าน Host: ${item.host} (Port: ${item.port})</p>
          </div>
        `
      });

      console.log(`🎉 ส่งอีเมลสำเร็จแล้ว! ผ่าน Host: ${item.host} (Port: ${item.port})`);
      console.log(`💡 โปรดอัปเดต SMTP_HOST=${item.host} และ SMTP_PORT=${item.port} ใน .env`);
      return;
    } catch (err) {
      console.log(`❌ ไม่ผ่าน (${item.host}:${item.port}):`, err.message);
    }
  }
}

testSendEmail();
