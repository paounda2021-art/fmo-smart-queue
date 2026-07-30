const { dbGet } = require('../db/database');
const { sendMissionNotification } = require('../services/notification');

async function testSendSarinaMission36() {
  try {
    // 1. ดึงภารกิจกิจกรรม 36
    const mission = await dbGet(`SELECT * FROM missions ORDER BY id DESC LIMIT 1;`);
    if (!mission) {
      console.log('⚠️ ไม่พบกิจกรรมในระบบ');
      return;
    }

    // 2. ดึงข้อมูลคุณซารีนา
    const sarina = await dbGet(`SELECT * FROM personnel WHERE emp_code = 'EMP-009' OR email LIKE '%ranida.c%';`);
    if (!sarina) {
      console.log('⚠️ ไม่พบข้อมูลคุณซารีนาในระบบ');
      return;
    }

    console.log(`📌 เตรียมทดสอบส่งอีเมลกิจกรรม "${mission.mission_title}" (ID: ${mission.id})`);
    console.log(`👤 ผู้รับ: ${sarina.name} (${sarina.emp_code}) | Email: ${sarina.email}`);

    // 3. เรียกฟังก์ชันยิงส่งแจ้งเตือนเฉพาะคุณซารีนา
    await sendMissionNotification(mission, [sarina], false);

    console.log('🎉 ทำการยิงส่งอีเมลกิจกรรม 36 หาคุณซารีนา เรียบร้อยแล้ว!');
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการส่ง:', err);
  }
}

testSendSarinaMission36();
