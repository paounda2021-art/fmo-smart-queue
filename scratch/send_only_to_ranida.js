const { dbGet } = require('../db/database');
const { sendMissionNotification } = require('../services/notification');

async function sendOnlyToRanida() {
  try {
    // 1. ดึงภารกิจล่าสุด (กิจกรรม 36)
    const mission = await dbGet(`SELECT * FROM missions ORDER BY id DESC LIMIT 1;`);
    if (!mission) {
      console.log('⚠️ ไม่พบกิจกรรมในระบบ');
      return;
    }

    // 2. ดึงข้อมูลคุณซารีนา และจำลองให้อีเมลส่งไปที่ ranida.c@fishmarket.co.th ท่านเดียวเท่านั้น!
    const sarina = await dbGet(`SELECT * FROM personnel WHERE emp_code = 'EMP-009' OR name LIKE '%ซารีนา%';`);
    if (!sarina) {
      console.log('⚠️ ไม่พบข้อมูลคุณซารีนาในระบบ');
      return;
    }

    // ล็อกเป้าหมายผู้รับเฉพาะคุณรณิดา (ranida.c@fishmarket.co.th) ท่านเดียว 100% ไม่ส่งหาคนอื่นเลย
    const targetPerson = {
      ...sarina,
      email: 'ranida.c@fishmarket.co.th'
    };

    console.log(`🛡️ [TEST MODE] ยิงส่งอีเมลเฉพาะกิจกรรม "${mission.mission_title}" (ID: ${mission.id})`);
    console.log(`🎯 ส่งหาท่านเดียวเท่านั้น: ${targetPerson.name} -> ranida.c@fishmarket.co.th`);
    console.log(`🔒 คนอื่นในระบบจะไม่ได้รับอีเมลแม้แต่คนเดียว 100%!`);

    await sendMissionNotification(mission, [targetPerson], false);

    console.log('🎉 ยิงส่งอีเมลเฉพาะคุณรณิดาเรียบร้อยแล้ว!');
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
  }
}

sendOnlyToRanida();
