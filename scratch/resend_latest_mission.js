const { dbGet, dbAll } = require('../db/database');
const { sendMissionNotification } = require('../services/notification');

async function resendLatestMission() {
  try {
    // 1. ดึงภารกิจล่าสุด
    const latestMission = await dbGet(`
      SELECT * FROM missions ORDER BY id DESC LIMIT 1;
    `);

    if (!latestMission) {
      console.log('⚠️ ไม่พบภารกิจในระบบ');
      return;
    }

    console.log(`📌 ดึงภารกิจล่าสุด: ID ${latestMission.id} - ${latestMission.mission_title}`);

    // 2. ดึงบุคลากรที่ได้รับจัดสรรในภารกิจนี้
    const assignments = await dbAll(`
      SELECT 
        ma.*,
        p.id as personnel_id,
        p.emp_code,
        p.name,
        p.position,
        p.department,
        p.phone,
        p.email,
        p.line_user_id
      FROM mission_assignments ma
      JOIN personnel p ON p.id = ma.personnel_id
      WHERE ma.mission_id = ?;
    `, [latestMission.id]);

    if (assignments.length === 0) {
      console.log('⚠️ ไม่พบบุคลากรที่ได้รับการจัดสรรในภารกิจนี้');
      return;
    }

    console.log(`🚀 กำลังส่งแจ้งเตือนซ้ำ (LINE + EMAIL) ให้กับบุคลากร ${assignments.length} ท่าน...`);
    assignments.forEach(p => {
      console.log(`  - ${p.name} (${p.emp_code}) | Email: ${p.email} | LINE: ${p.line_user_id}`);
    });

    await sendMissionNotification(latestMission, assignments, false);
    console.log('🎉 ส่งแจ้งเตือนซ้ำสำหรับภารกิจล่าสุดเรียบร้อยแล้ว!');
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการส่งแจ้งเตือนซ้ำ:', err);
  }
}

resendLatestMission();
