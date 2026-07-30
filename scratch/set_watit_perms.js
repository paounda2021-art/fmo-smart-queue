const { dbRun } = require('../db/database');

async function setWatitPerms() {
  const perms = JSON.stringify(['quick', 'queue']);
  await dbRun(`
    UPDATE personnel 
    SET menu_permissions = ? 
    WHERE emp_code = 'EMP-102' OR name LIKE '%วาทิต%';
  `, [perms]);

  console.log('✅ อัปเดตสิทธิ์ของคุณวาทิต (EMP-102) เป็น ["quick", "queue"] เรียบร้อยแล้ว!');
}

setWatitPerms();
