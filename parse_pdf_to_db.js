const fs = require('fs');
const pdf = require('pdf-parse');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function importRealDataFromPdfs() {
  console.log('📖 Reading PDF files...');

  const dataDir = fs.readFileSync('รายชื่อผู้อำนวยการฝ่าย.pdf');
  const pdfDir = await pdf(dataDir);
  
  const dataStaff = fs.readFileSync('รายชื่อ.ระดับ 1-8 (ส่วนกลาง).pdf');
  const pdfStaff = await pdf(dataStaff);

  fs.writeFileSync('dir_raw.txt', pdfDir.text, 'utf-8');
  fs.writeFileSync('staff_raw.txt', pdfStaff.text, 'utf-8');

  console.log('PDFs extracted successfully!');
  console.log('--- Director Text Length:', pdfDir.text.length);
  console.log('--- Staff Text Length:', pdfStaff.text.length);

  await initSchema();

  // Clear sample data
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  // Parse Director lines
  const dirLines = pdfDir.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let dirOrder = 1;

  for (let line of dirLines) {
    if (line.includes('ลำดับ') || line.includes('รายชื่อ') || line.includes('หน้า') || line.length < 5) continue;
    
    line = fixDuplicatedName(line);

    // Regex for Thai Name
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      let empCode = `DIR-0${dirOrder}`;
      let name = '';
      let pos = 'ผู้อำนวยการฝ่าย';
      let dept = 'ส่วนกลาง อสป.';

      // Check if line starts with number
      let idx = 0;
      if (/^\d+$/.test(parts[0])) {
        idx = 1;
      }

      if (parts[idx]) {
        name = parts.slice(idx, idx + 2).join(' ');
        if (parts[idx + 2]) {
          pos = parts.slice(idx + 2).join(' ');
          dept = pos;
        }
      }

      if (name.length >= 4) {
        const pRes = await dbRun(
          `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'DIRECTOR', ?, ?);`,
          [empCode, name, dept, pos]
        );

        await dbRun(
          `INSERT INTO queue_members (personnel_id, role_type, queue_order, status, current_round) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
          [pRes.lastID, dirOrder]
        );

        dirOrder++;
      }
    }
  }

  // Parse Staff lines
  const staffLines = pdfStaff.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let staffOrder = 1;

  for (let line of staffLines) {
    if (line.includes('ลำดับ') || line.includes('รายชื่อ') || line.includes('หน้า') || line.includes('ระดับ') || line.length < 5) continue;
    
    line = fixDuplicatedName(line);

    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      let empCode = `EMP-${String(staffOrder).padStart(3, '0')}`;
      let idx = 0;
      if (/^\d+$/.test(parts[0])) {
        idx = 1;
      }

      let name = parts.slice(idx, idx + 2).join(' ');
      let pos = parts.slice(idx + 2).join(' ') || 'พนักงานปฏิบัติการ (ระดับ 1-8)';
      let dept = 'ส่วนกลาง อสป.';

      if (name.length >= 4) {
        const pRes = await dbRun(
          `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'STAFF', ?, ?);`,
          [empCode, name, dept, pos]
        );

        await dbRun(
          `INSERT INTO queue_members (personnel_id, role_type, queue_order, status, current_round) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
          [pRes.lastID, staffOrder]
        );

        staffOrder++;
      }
    }
  }

  console.log(`🎉 Success! Imported Directors: ${dirOrder - 1}, Staff: ${staffOrder - 1}`);
}

function fixDuplicatedName(line) {
  // Fix "นวรรณ นวรรณ" -> "นวรรณ"
  line = line.replace(/นวรรณ\s+นวรรณ/g, 'นวรรณ');
  // Fix "ปฏิยุทธิ์ ปฏิยุทธิ์" -> "ปฏิยุทธิ์"
  line = line.replace(/ปฏิยุทธิ์\s+ปฏิยุทธิ์/g, 'ปฏิยุทธิ์');

  // Generic repeated word replacement for Thai names like "ชื่อ ชื่อ นามสกุล" -> "ชื่อ นามสกุล"
  line = line.replace(/([ก-๙]+)\s+\1/g, '$1');

  return line;
}

importRealDataFromPdfs().catch(console.error);
