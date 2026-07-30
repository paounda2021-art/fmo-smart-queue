const { exec } = require('child_process');

async function testSendEmail() {
  const to = 'ranida.c@fishmarket.co.th';
  const from = 'carbooking@workd.go.th';
  const subject = '[FMO Smart Queue] ทดสอบระบบแจ้งเตือนทางอีเมล';
  const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #0284c7; border-radius: 12px; max-width: 600px;">
      <h2 style="color: #0284c7;">📢 ทดสอบระบบแจ้งเตือนคำสั่งจัดสรรคิวกิจกรรม อสป.</h2>
      <p>เรียนคุณ รณิดา โชติธนาอุดม (ranida.c@fishmarket.co.th)</p>
      <p>นี่คืออีเมลทดสอบการส่งระบบแจ้งเตือนคิวกิจกรรมจาก <strong>FMO Smart Queue System</strong> (ใช้วิธีเดียวกับระบบ car-booking)</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
      <p style="color: #10b981; font-weight: bold;">✅ สำเร็จเรียบร้อยแล้วผ่าน Windows Mail Relay</p>
    </div>
  `;

  console.log(`🚀 กำลังส่งอีเมลทดสอบหา ${to} (แบบเดียวกับ car-booking)...`);

  const escapedSubject = subject.replace(/'/g, "''");
  const escapedBody = html.replace(/'/g, "''");
  const escapedTo = to.replace(/'/g, "''");

  const psCommand = `Start-Job -ScriptBlock {
    param($toAddr, $subj, $bodyText, $fromAddr)
    try {
      $mail = New-Object System.Net.Mail.MailMessage
      $mail.From = New-Object System.Net.Mail.MailAddress($fromAddr)
      $toAddr.Split(',') | ForEach-Object { if ($_.Trim()) { $mail.To.Add($_.Trim()) } }
      $mail.Subject = $subj
      $mail.Body = $bodyText
      $mail.IsBodyHtml = $true
      $mail.BodyEncoding = [System.Text.Encoding]::UTF8
      $mail.SubjectEncoding = [System.Text.Encoding]::UTF8

      $smtp = New-Object System.Net.Mail.SmtpClient("localhost", 25)
      $smtp.Timeout = 10000
      $smtp.Send($mail)
      $mail.Dispose()
      $smtp.Dispose()
      Write-Host "SUCCESS"
    } catch {
      Write-Host "Error sending email: $_"
    }
  } -ArgumentList '${escapedTo}', '${escapedSubject}', '${escapedBody}', '${from}'`;

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/"/g, '\\"')}"`, (err) => {
    if (err) {
      console.error('❌ เกิดข้อผิดพลาดในการส่งอีเมล:', err);
    } else {
      console.log('🎉 ส่งคำสั่งยิงอีเมลพื้นหลังเรียบร้อยแล้ว! (ดูผลในกล่องข้อความ)');
    }
  });
}

testSendEmail();
