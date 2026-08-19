const { dbRun } = require('../db/database');

async function setPimradaPerms() {
  const perms = JSON.stringify(['quick', 'dashboard', 'queue', 'individual', 'reports', 'calendar']);
  await dbRun(`
    UPDATE personnel 
    SET menu_permissions = ? 
    WHERE emp_code = 'EMP-043' OR name LIKE '%พิมพ์ลดา%';
  `, [perms]);

  console.log('✅ อัปเดตสิทธิ์ของคุณพิมพ์ลดา (EMP-043) เป็น 6 เมนูตรงตามรูปฝั่งซ้ายเรียบร้อยแล้ว!');
}

setPimradaPerms();
