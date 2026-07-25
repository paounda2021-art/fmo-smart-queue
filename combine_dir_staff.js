const fs = require('fs');
const XLSX = require('xlsx');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function combineAll() {
  console.log('📖 Combining Directors (DIR-09, DIR-10, DIR-01..DIR-08) and 105 Staff...');

  // 1. Read Directors from CSV or XLSX
  const csvContent = fs.readFileSync('public/FMO_Real_Personnel_Dataset.csv', 'utf-8');
  const csvLines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const rawDirs = [
    { emp_code: 'DIR-09', name: 'นายศุภชาติ ชาสมบัติ', position: 'รผอ.บร.', department: 'รผอ.', email: 'supachai.c@fishmarket.co.th' },
    { emp_code: 'DIR-10', name: 'นายปรีดา ยังสุขสถาพร', position: 'ผออ.', department: 'ผออ.', email: 'preeda.y@fishmarket.co.th' }
  ];

  // Read DIR-01..DIR-08 from Excel
  const workbook = XLSX.readFile('fmo_personnel.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);

  for (const row of rawRows) {
    if (!row.name) continue;
    const empCode = row.emp_code || '';
    if (empCode.startsWith('DIR-') && empCode !== 'DIR-09' && empCode !== 'DIR-10') {
      rawDirs.push({
        emp_code: empCode,
        name: row.name.trim().replace(/\s+/g, ' '),
        position: row.position ? row.position.trim() : 'ผู้อำนวยการฝ่าย',
        department: row.department1 ? row.department1.trim() : 'ส่วนกลาง อสป.',
        email: row.email ? row.email.trim() : ''
      });
    }
  }

  // Sort Directors so DIR-10 is absolute topmost (#1) and DIR-09 is #2
  rawDirs.sort((a, b) => {
    const getWeight = (code) => {
      if (code === 'DIR-10') return 1;
      if (code === 'DIR-09') return 2;
      const numMatch = code.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0]) : 99;
      return 10 + num;
    };
    return getWeight(a.emp_code) - getWeight(b.emp_code);
  });

  // Re-assign 1..N order for Directors
  rawDirs.forEach((d, idx) => d.no = idx + 1);

  // 2. Read Staff from Excel (EMP-001 to EMP-105)
  // PDF sequence matching
  const pdfBuf = fs.readFileSync('รายชื่อ.ระดับ 1-8 (ส่วนกลาง).pdf');
  const { PDFParse } = require('pdf-parse');
  const pdfInst = new PDFParse(new Uint8Array(pdfBuf));
  await pdfInst.load();
  const pdfText = await pdfInst.getText();

  const pdfStaffMap = new Map();
  pdfText.text.split(/\r?\n/).forEach(l => {
    const match = l.match(/^(\d+)\s+(ว่าที่ร้อยตรี|นาย|นาง|นางสาว)?\s*([^\s]+)/);
    if (match) {
      pdfStaffMap.set(match[3], parseInt(match[1]));
    }
  });

  const staffList = [];
  let unmappedCount = 0;

  for (const row of rawRows) {
    if (!row.name) continue;
    const role = (row.role_type || '').toUpperCase();
    if (role.includes('DIR') || (row.emp_code || '').startsWith('DIR')) continue;

    const cleanName = row.name.trim().replace(/\s+/g, ' ');
    const email = row.email ? row.email.trim() : '';
    const pos = row.position ? row.position.trim() : 'พนักงานปฏิบัติการ (ระดับ 1-8)';
    let dept = row.department1 ? row.department1.trim() : '';
    if (row.department2 && row.department2.trim()) dept += ` (${row.department2.trim()})`;

    let seqNo = null;
    if (row.emp_code && row.emp_code.match(/EMP-(\d+)/i)) {
      seqNo = parseInt(row.emp_code.match(/EMP-(\d+)/i)[1]);
    } else {
      const fnameMatch = cleanName.match(/(ว่าที่ร้อยตรี|นาย|นาง|นางสาว)?\s*([^\s]+)/);
      if (fnameMatch && pdfStaffMap.has(fnameMatch[2])) {
        seqNo = pdfStaffMap.get(fnameMatch[2]);
      }
    }

    if (!seqNo) {
      unmappedCount++;
      seqNo = 94 + unmappedCount;
    }

    staffList.push({
      no: seqNo,
      emp_code: `EMP-${String(seqNo).padStart(3, '0')}`,
      name: cleanName,
      position: pos,
      department: dept || 'ส่วนกลาง อสป.',
      email,
      role_type: 'STAFF'
    });
  }

  staffList.sort((a, b) => a.no - b.no);

  console.log(`✅ Directors Prepared: ${rawDirs.length} persons`);
  rawDirs.forEach(d => console.log(`  Queue #${d.no} [${d.emp_code}] ${d.name} (${d.position})`));

  console.log(`\n✅ Staff Prepared: ${staffList.length} persons`);

  // Update SQLite Database
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  for (const d of rawDirs) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'DIRECTOR', ?, ?, ?);`,
      [d.emp_code, d.name, d.department, d.position, d.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, d.no]
    );
  }

  for (let i = 0; i < staffList.length; i++) {
    const s = staffList[i];
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'STAFF', ?, ?, ?);`,
      [s.emp_code, s.name, s.department, s.position, s.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, i + 1]
    );
  }

  // Export clean CSV
  let csv = '\uFEFF';
  csv += '=== รายชื่อผู้อำนวยการและหัวหน้าทีม (DIRECTORS) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  rawDirs.forEach(d => {
    csv += `"${d.no}","${d.emp_code}","${d.name}","${d.position}","${d.department}","${d.email}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csv += '\n=== รายชื่อพนักงาน (STAFF) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  staffList.forEach((s, idx) => {
    csv += `"${idx + 1}","${s.emp_code}","${s.name}","${s.position}","${s.department}","${s.email}","พนักงาน (STAFF)"\n`;
  });

  try { fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8'); } catch (e) {}
  fs.writeFileSync('public/FMO_Real_Personnel_Dataset_Official.csv', csv, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');

  console.log('\n🎉 Complete! DIR-09 and DIR-10 are placed at the VERY TOP of Team Leaders before DIR-01!');
}

combineAll().catch(console.error);
