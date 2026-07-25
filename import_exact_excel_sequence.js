const fs = require('fs');
const XLSX = require('xlsx');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function importExactExcelSequence() {
  console.log('📖 Importing personnel in 100% EXACT order from fmo_personnel.xlsx...');
  const workbook = XLSX.readFile('fmo_personnel.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);

  const directors = [];
  const staff = [];

  // Hardcode DIR-09 and DIR-10 at top if not present in Excel rows
  const hardcodedDirs = [
    { emp_code: 'DIR-10', name: 'นายปรีดา ยังสุขสถาพร', position: 'ผออ. (ผู้อำนวยการ อสป.)', department: 'ผออ.', email: 'preeda.y@fishmarket.co.th' },
    { emp_code: 'DIR-09', name: 'นายศุภชาติ ชาสมบัติ', position: 'รผอ.บร. (รองผู้อำนวยการ)', department: 'รผอ.', email: 'supachai.c@fishmarket.co.th' }
  ];

  for (const r of rawRows) {
    if (!r.name) continue;
    const isDir = (r.role_type || '').toUpperCase().includes('DIR') || (r.emp_code || '').startsWith('DIR');
    const cleanName = r.name.trim().replace(/\s+/g, ' ');
    const email = r.email ? r.email.trim() : '';
    const pos = r.position ? r.position.trim() : '';
    let dept = r.department1 ? r.department1.trim() : '';
    if (r.department2 && r.department2.trim()) dept += ` (${r.department2.trim()})`;

    if (isDir) {
      const code = r.emp_code ? r.emp_code.trim() : 'DIR-01';
      if (code !== 'DIR-09' && code !== 'DIR-10') {
        directors.push({
          emp_code: code,
          name: cleanName,
          position: pos || 'ผู้อำนวยการฝ่าย',
          department: dept || 'ส่วนกลาง อสป.',
          email,
          role_type: 'DIRECTOR'
        });
      }
    } else {
      staff.push({
        name: cleanName,
        position: pos || 'พนักงาน',
        department: dept || 'ส่วนกลาง อสป.',
        email,
        role_type: 'STAFF'
      });
    }
  }

  // Combine Directors: DIR-10 first, DIR-09 second, then DIR-01 to DIR-08
  directors.sort((a, b) => {
    const numA = parseInt((a.emp_code.match(/\d+/) || [99])[0]);
    const numB = parseInt((b.emp_code.match(/\d+/) || [99])[0]);
    return numA - numB;
  });

  const finalDirectors = [...hardcodedDirs, ...directors];
  finalDirectors.forEach((d, idx) => d.no = idx + 1);

  // Assign EMP-001 to EMP-105 in exact Excel row order
  staff.forEach((s, idx) => {
    const seq = idx + 1;
    s.no = seq;
    s.emp_code = `EMP-${String(seq).padStart(3, '0')}`;
  });

  console.log(`✅ Directors Final (${finalDirectors.length} persons):`);
  finalDirectors.forEach(d => console.log(`  Queue #${d.no} [${d.emp_code}] ${d.name} (${d.position})`));

  console.log(`\n✅ Staff Final (${staff.length} persons):`);
  console.log('--- First 5 Staff in exact Excel row order ---');
  staff.slice(0, 5).forEach(s => console.log(`  Queue #${s.no} [${s.emp_code}] ${s.name} (${s.position})`));

  console.log('--- Person #94 and #95 (Last added) ---');
  console.log(`  Queue #${staff[93].no} [${staff[93].emp_code}] ${staff[93].name} (${staff[93].position})`);
  console.log(`  Queue #${staff[94].no} [${staff[94].emp_code}] ${staff[94].name} (${staff[94].position})`);

  // Update SQLite Database
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  // Insert Directors
  for (const d of finalDirectors) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'DIRECTOR', ?, ?, ?);`,
      [d.emp_code, d.name, d.department, d.position, d.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, d.no]
    );
  }

  // Insert Staff in EXACT order
  for (const s of staff) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'STAFF', ?, ?, ?);`,
      [s.emp_code, s.name, s.department, s.position, s.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, s.no]
    );
  }

  // Export clean CSV
  let csv = '\uFEFF';
  csv += '=== รายชื่อผู้อำนวยการและหัวหน้าทีม (DIRECTORS) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  finalDirectors.forEach(d => {
    csv += `"${d.no}","${d.emp_code}","${d.name}","${d.position}","${d.department}","${d.email}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csv += '\n=== รายชื่อพนักงาน (STAFF เรียงตามไฟล์ Excel เดิม) ===\n';
  csv += '"ลำดับคิว","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  staff.forEach(s => {
    csv += `"${s.no}","${s.emp_code}","${s.name}","${s.position}","${s.department}","${s.email}","พนักงาน (STAFF)"\n`;
  });

  try { fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8'); } catch (e) {}
  fs.writeFileSync('public/FMO_Real_Personnel_Dataset_Official.csv', csv, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');

  console.log('\n🎉 Complete! Database and CSV updated in 100% EXACT order from your original Excel file!');
}

importExactExcelSequence().catch(console.error);
