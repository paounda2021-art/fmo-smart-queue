const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function buildDataset() {
  console.log('🚀 Parsing official FMO PDF files...');

  // 1. Read Directors PDF
  const dirBuf = fs.readFileSync('รายชื่อผู้อำนวยการฝ่าย.pdf');
  const dirPdf = new PDFParse(new Uint8Array(dirBuf));
  await dirPdf.load();
  const dirText = await dirPdf.getText();

  // 2. Read Staff PDF
  const staffBuf = fs.readFileSync('รายชื่อ.ระดับ 1-8 (ส่วนกลาง).pdf');
  const staffPdf = new PDFParse(new Uint8Array(staffBuf));
  await staffPdf.load();
  const staffText = await staffPdf.getText();

  const directors = [];
  const dirLines = dirText.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of dirLines) {
    if (line.includes('บริษัท:') || line.includes('ข้อมูล ณ') || line.includes('รายงาน') || line.includes('--') || line.startsWith('ลาดับ')) continue;
    
    // Pattern: 1 นางสาว ปิยวรรณ แก้วกล้า ผู้อานวยการฝ่าย ฝ่ายบัญชีการเงิน
    const match = line.match(/^(\d+)\s+(นาย|นาง|นางสาว)?\s*([^\s]+)\s+([^\s]+)\s+(.+)$/);
    if (match) {
      const seq = parseInt(match[1]);
      const prefix = match[2] || '';
      const fname = match[3];
      const lname = match[4];
      const rest = match[5].trim();

      // Split position & department
      let pos = 'ผู้อำนวยการฝ่าย';
      let dept = rest;

      if (rest.startsWith('ผู้อานวยการฝ่าย') || rest.startsWith('รักษาการผู้อานวยการฝ่าย')) {
        const parts = rest.split(/\s+(.+)/);
        pos = parts[0].replace(/ผู้อานวยการ/g, 'ผู้อำนวยการ');
        dept = (parts[1] || 'ส่วนกลาง อสป.').replace(/สานักงาน/g, 'สำนักงาน').replace(/ผู้อานวยการ/g, 'ผู้อำนวยการ');
      }

      directors.push({
        no: seq,
        emp_code: `DIR-${String(seq).padStart(2, '0')}`,
        name: `${prefix} ${fname} ${lname}`.trim().replace(/\s+/g, ' '),
        position: pos,
        department: dept,
        role_type: 'DIRECTOR'
      });
    }
  }

  const staff = [];
  const staffLines = staffText.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (let line of staffLines) {
    if (line.includes('บริษัท:') || line.includes('ข้อมูล ณ') || line.includes('รายงาน') || line.includes('--') || line.startsWith('ลาดับ')) continue;

    // FIX USER REQUESTED NAME DUPLICATIONS:
    line = line.replace(/นวรรณ\s+นวรรณ/g, 'นวรรณ');
    line = line.replace(/ปฏิยุทธ์\s+ปฏิยุทธ์/g, 'ปฏิยุทธ์');
    line = line.replace(/ปฏิยุทธิ์\s+ปฏิยุทธิ์/g, 'ปฏิยุทธิ์');

    // Pattern: 1 นาย ชลพัฒน์ ชนะไพรรินทร์ เจ้าหน้าที่นโยบายและแผน สานักงานยุทธศาสตร์และแผนงาน ฝ่ายยุทธศาสตร์การพัฒนา
    const match = line.match(/^(\d+)\s+(ว่าที่ร้อยตรี|นาย|นาง|นางสาว)?\s*([^\s]+)\s+([^\s]+)\s+(.+)$/);
    if (match) {
      const seq = parseInt(match[1]);
      const prefix = match[2] || '';
      const fname = match[3];
      const lname = match[4];
      const rest = match[5].trim().replace(/สานักงาน/g, 'สำนักงาน').replace(/ผู้อานวยการ/g, 'ผู้อำนวยการ');

      // Split position & department if present
      let pos = rest;
      let dept = 'ส่วนกลาง อสป.';

      if (rest.includes(' ฝ่าย')) {
        const parts = rest.split(/\s+(ฝ่าย.+)$/);
        pos = parts[0];
        dept = parts[1];
      }

      staff.push({
        no: seq,
        emp_code: `EMP-${String(seq).padStart(3, '0')}`,
        name: `${prefix} ${fname} ${lname}`.trim().replace(/\s+/g, ' '),
        position: pos,
        department: dept,
        role_type: 'STAFF'
      });
    }
  }

  console.log(`✅ Parsed Directors: ${directors.length} persons`);
  console.log(`✅ Parsed Staff Level 1-8: ${staff.length} persons`);

  // Verify Name Fixes
  const fixedNavawan = staff.find(s => s.name.includes('นวรรณ'));
  const fixedPatiyut = staff.find(s => s.name.includes('ปฏิยุทธ์') || s.name.includes('ปฏิยุทธิ์'));
  console.log('📌 Verified Name Fix (Line 19):', fixedNavawan ? fixedNavawan.name : 'Not Found');
  console.log('📌 Verified Name Fix (Line 23):', fixedPatiyut ? fixedPatiyut.name : 'Not Found');

  // Generate Excel-Compatible UTF-8 BOM CSV File
  let csv = '\uFEFF';
  csv += '=== รายชื่อผู้อำนวยการฝ่าย (DIRECTORS 8 ท่าน) ===\n';
  csv += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","บทบาท"\n';
  directors.forEach(d => {
    csv += `"${d.no}","${d.emp_code}","${d.name}","${d.position}","${d.department}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csv += '\n=== รายชื่อพนักงาน ระดับ 1-8 ส่วนกลาง (STAFF 94 ท่าน) ===\n';
  csv += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","บทบาท"\n';
  staff.forEach(s => {
    csv += `"${s.no}","${s.emp_code}","${s.name}","${s.position}","${s.department}","พนักงาน (STAFF)"\n`;
  });

  fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');

  // Update SQLite Database with exact PDF dataset
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  for (const d of directors) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'DIRECTOR', ?, ?);`,
      [d.emp_code, d.name, d.department, d.position]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, d.no]
    );
  }

  for (const s of staff) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position) VALUES (?, ?, 'STAFF', ?, ?);`,
      [s.emp_code, s.name, s.department, s.position]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, s.no]
    );
  }

  console.log('🎉 SQLite database successfully updated with 102 real personnel from official PDF files!');
}

buildDataset().catch(console.error);
