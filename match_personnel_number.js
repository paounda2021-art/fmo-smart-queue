const fs = require('fs');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function matchAndSortByNumber() {
  console.log('📖 Reading PDF files to get official sequence numbers...');

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

  // Build PDF Staff map: name -> seq
  const pdfStaffMap = new Map();
  const pdfStaffLines = staffText.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (let line of pdfStaffLines) {
    line = line.replace(/นวรรณ\s+นวรรณ/g, 'นวรรณ').replace(/ปฏิยุทธ์\s+ปฏิยุทธ์/g, 'ปฏิยุทธ์');
    const match = line.match(/^(\d+)\s+(ว่าที่ร้อยตรี|นาย|นาง|นางสาว)?\s*([^\s]+)\s+([^\s]+)/);
    if (match) {
      const seq = parseInt(match[1]);
      const prefix = match[2] || '';
      const fname = match[3];
      const lname = match[4];
      const nameKey = `${prefix} ${fname} ${lname}`.trim().replace(/\s+/g, ' ');
      pdfStaffMap.set(fname, seq);
      pdfStaffMap.set(nameKey, seq);
    }
  }

  // 3. Read Excel file
  const workbook = XLSX.readFile('fmo_personnel.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);

  const directors = [];
  const staff = [];

  let unmappedStaffCount = 0;

  for (const row of rawRows) {
    if (!row.name || row.name.trim().length === 0) continue;

    const role = (row.role_type || '').toUpperCase().includes('DIR') ? 'DIRECTOR' : 'STAFF';
    const cleanName = row.name.trim().replace(/\s+/g, ' ');
    const email = row.email ? row.email.trim() : '';
    const pos = row.position ? row.position.trim() : '';
    let dept = row.department1 ? row.department1.trim() : '';
    if (row.department2 && row.department2.trim()) {
      dept += ` (${row.department2.trim()})`;
    }

    if (role === 'DIRECTOR') {
      let dirNo = 1;
      const codeMatch = (row.emp_code || '').match(/\d+/);
      if (codeMatch) dirNo = parseInt(codeMatch[0]);

      directors.push({
        no: dirNo,
        emp_code: `DIR-${String(dirNo).padStart(2, '0')}`,
        name: cleanName,
        email,
        position: pos || 'ผู้อำนวยการฝ่าย',
        department: dept || 'ส่วนกลาง อสป.',
        role_type: 'DIRECTOR'
      });
    } else {
      // Find matching number from PDF or emp_code
      let seqNo = null;

      // Check if emp_code has number e.g. EMP-001
      if (row.emp_code && row.emp_code.match(/EMP-(\d+)/i)) {
        seqNo = parseInt(row.emp_code.match(/EMP-(\d+)/i)[1]);
      } else {
        // Find by first name match in PDF
        const fnameMatch = cleanName.match(/(ว่าที่ร้อยตรี|นาย|นาง|นางสาว)?\s*([^\s]+)/);
        if (fnameMatch) {
          const fname = fnameMatch[2];
          if (pdfStaffMap.has(fname)) {
            seqNo = pdfStaffMap.get(fname);
          }
        }
      }

      if (!seqNo) {
        unmappedStaffCount++;
        seqNo = 94 + unmappedStaffCount;
      }

      staff.push({
        no: seqNo,
        emp_code: `EMP-${String(seqNo).padStart(3, '0')}`,
        name: cleanName,
        email,
        position: pos || 'พนักงานปฏิบัติการ (ระดับ 1-8)',
        department: dept || 'ส่วนกลาง อสป.',
        role_type: 'STAFF'
      });
    }
  }

  // Sort Directors by sequence number `no`
  directors.sort((a, b) => a.no - b.no);

  // Sort Staff by sequence number `no` (EMP-001, EMP-002, EMP-003...)
  staff.sort((a, b) => a.no - b.no);

  console.log(`✅ Loaded & Sorted Directors: ${directors.length} persons`);
  console.log(`✅ Loaded & Sorted Staff: ${staff.length} persons`);

  console.log('\n--- FIRST 15 STAFF MEMBERS (Sorted by EMP number) ---');
  staff.slice(0, 15).forEach(s => console.log(`Order ${s.no}: [${s.emp_code}] ${s.name} | ${s.position} | ${s.email}`));

  console.log('\n--- LAST 10 STAFF MEMBERS (Sorted by EMP number) ---');
  staff.slice(-10).forEach(s => console.log(`Order ${s.no}: [${s.emp_code}] ${s.name} | ${s.position} | ${s.email}`));

  // Generate UTF-8 BOM CSV File for Excel
  let csv = '\uFEFF';
  csv += '=== รายชื่อผู้อำนวยการฝ่าย (DIRECTORS เรียงตามลำดับ DIR-01 ถึง DIR-08) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  directors.forEach((d, idx) => {
    csv += `"${idx + 1}","${d.emp_code}","${d.name}","${d.position}","${d.department}","${d.email}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csv += '\n=== รายชื่อพนักงาน (STAFF เรียงตามลำดับ EMP-001 ถึง EMP-105) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  staff.forEach((s, idx) => {
    csv += `"${idx + 1}","${s.emp_code}","${s.name}","${s.position}","${s.department}","${s.email}","พนักงาน (STAFF)"\n`;
  });

  try { fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8'); } catch (e) {}
  fs.writeFileSync('public/FMO_Real_Personnel_Dataset_Official.csv', csv, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');

  // Update SQLite Database with clean sorted dataset
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  // Insert Directors into DB in exact order 1..8
  for (let i = 0; i < directors.length; i++) {
    const d = directors[i];
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'DIRECTOR', ?, ?, ?);`,
      [d.emp_code, d.name, d.department, d.position, d.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, i + 1]
    );
  }

  // Insert Staff into DB in exact order 1..105 (EMP-001, EMP-002, EMP-003...)
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'STAFF', ?, ?, ?);`,
      [s.emp_code, s.name, s.department, s.position, s.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, i + 1]
    );
  }

  console.log('\n🎉 SQLite database successfully updated! Sorted by EMP number (EMP-001, EMP-002, EMP-003...)!');
}

matchAndSortByNumber().catch(console.error);
