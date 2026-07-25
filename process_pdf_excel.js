const fs = require('fs');
const pdfParse = require('pdf-parse');
const pdf = typeof pdfParse === 'function' ? pdfParse : pdfParse.default;
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function processPdfAndExportExcel() {
  console.log('📖 Processing PDF files and creating Excel dataset...');

  const dataDir = fs.readFileSync('รายชื่อผู้อำนวยการฝ่าย.pdf');
  const pdfDir = await pdf(dataDir);
  
  const dataStaff = fs.readFileSync('รายชื่อ.ระดับ 1-8 (ส่วนกลาง).pdf');
  const pdfStaff = await pdf(dataStaff);

  const dirRawText = pdfDir.text;
  const staffRawText = pdfStaff.text;

  // Process Directors
  const dirLines = dirRawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const directorsList = [];
  let dirIndex = 1;

  for (let line of dirLines) {
    if (isHeaderOrFooter(line)) continue;
    line = cleanThaiName(line);

    // Look for name patterns
    const nameMatch = line.match(/(นาย|นาง|นางสาว|ผอ\.)?\s*([ก-๙]+)\s+([ก-๙]+)(.*)/);
    if (nameMatch) {
      const prefix = nameMatch[1] || '';
      const fname = nameMatch[2];
      const lname = nameMatch[3];
      const rest = nameMatch[4] ? nameMatch[4].trim() : '';

      const fullName = `${prefix}${fname} ${lname}`.trim();
      const pos = rest || 'ผู้อำนวยการฝ่าย';
      const dept = rest || 'ส่วนกลาง อสป.';

      directorsList.push({
        no: dirIndex,
        emp_code: `DIR-${String(dirIndex).padStart(2, '0')}`,
        prefix,
        name: fullName,
        position: pos,
        department: dept,
        role_type: 'DIRECTOR'
      });
      dirIndex++;
    }
  }

  // Process Staff Level 1-8
  const staffLines = staffRawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const staffList = [];
  let staffIndex = 1;

  for (let line of staffLines) {
    if (isHeaderOrFooter(line)) continue;
    line = cleanThaiName(line);

    const nameMatch = line.match(/^(\d+)?\s*(นาย|นาง|นางสาว)?\s*([ก-๙]+)\s+([ก-๙]+)(.*)/);
    if (nameMatch) {
      const numPrefix = nameMatch[1];
      const prefix = nameMatch[2] || '';
      const fname = nameMatch[3];
      const lname = nameMatch[4];
      const rest = nameMatch[5] ? nameMatch[5].trim() : '';

      const seqNo = numPrefix ? parseInt(numPrefix) : staffIndex;
      const fullName = `${prefix}${fname} ${lname}`.trim();
      const pos = rest || 'พนักงานปฏิบัติการ (ระดับ 1-8)';
      const dept = 'ส่วนกลาง อสป.';

      staffList.push({
        no: seqNo,
        emp_code: `EMP-${String(seqNo).padStart(3, '0')}`,
        prefix,
        name: fullName,
        position: pos,
        department: dept,
        role_type: 'STAFF'
      });
      staffIndex++;
    }
  }

  console.log(`✅ Parsed Directors: ${directorsList.length}, Staff: ${staffList.length}`);

  // Create UTF-8 BOM CSV (Excel Compatible)
  let csvData = '\uFEFF';
  csvData += '=== ตารางรายชื่อผู้อำนวยการฝ่าย (DIRECTORS) ===\n';
  csvData += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","หน่วยงาน/ฝ่าย","บทบาท"\n';

  directorsList.forEach(d => {
    csvData += `"${d.no}","${d.emp_code}","${d.name}","${d.position}","${d.department}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csvData += '\n=== ตารางรายชื่อพนักงานระดับ 1-8 (ส่วนกลาง) (STAFF LEVEL 1-8) ===\n';
  csvData += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","หน่วยงาน/ฝ่าย","บทบาท"\n';

  staffList.forEach(s => {
    csvData += `"${s.no}","${s.emp_code}","${s.name}","${s.position}","${s.department}","พนักงาน (STAFF)"\n`;
  });

  fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csvData, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csvData, 'utf-8');

  // Update SQLite Database with clean dataset
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  // Insert Directors into DB
  for (const d of directorsList) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'DIRECTOR', ?, ?);`,
      [d.emp_code, d.name, d.department, d.position]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, queue_order, status, current_round) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, d.no]
    );
  }

  // Insert Staff into DB
  for (const s of staffList) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'STAFF', ?, ?);`,
      [s.emp_code, s.name, s.department, s.position]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, queue_order, status, current_round) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, s.no]
    );
  }

  console.log('🎉 SQLite database successfully updated with real PDF dataset!');
}

function cleanThaiName(str) {
  // Fix specific duplicated names requested by user
  str = str.replace(/นวรรณ\s+นวรรณ/g, 'นวรรณ');
  str = str.replace(/ปฏิยุทธิ์\s+ปฏิยุทธิ์/g, 'ปฏิยุทธิ์');
  
  // Generic duplicate Thai word cleaner
  str = str.replace(/([ก-๙]+)\s+\1/g, '$1');

  return str;
}

function isHeaderOrFooter(line) {
  const lower = line.toLowerCase();
  return (
    lower.includes('ลำดับ') ||
    lower.includes('รายชื่อ') ||
    lower.includes('หน้า') ||
    lower.includes('ระดับ') ||
    lower.includes('องค์การสะพานปลา') ||
    line.length < 3
  );
}

processPdfAndExportExcel().catch(console.error);
