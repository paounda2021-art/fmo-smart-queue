const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/fmo_smart_queue.db'); 

// รับค่ารหัสจากการพิมพ์ใน PowerShell
const targetCode = process.argv[2]; 

if (!targetCode) {
    console.log("⚠️ กรุณาระบุรหัสที่ต้องการปลดล็อคด้วยครับ (เช่น node unlink.js DIR-01)");
    process.exit(1);
}

db.run(`UPDATE personnel SET line_user_id = NULL WHERE emp_code = ?`, [targetCode], function(err) {
    if (err) {
        console.error("❌ เกิดข้อผิดพลาด:", err.message);
    } else if (this.changes === 0) {
        console.log(`⚠️ ไม่พบรหัส ${targetCode} ในระบบ หรือรหัสนี้ยังไม่ได้ผูกบัญชีไว้ครับ`);
    } else {
        // 💡 ให้มันแสดงรหัสอัตโนมัติตามที่เราพิมพ์
        console.log(`✅ ปลดล็อคบัญชี ${targetCode} เรียบร้อยแล้ว!`);
    }
});