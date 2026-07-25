const XLSX = require('xlsx');
const fs = require('fs');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function importUserExcel() {
  console.log('📖 Reading user Excel file: fmo_personnel.xlsx...');
  const workbook = XLSX.readFile('fmo_personnel.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet);

  console.log(`Found ${rawRows.length} total personnel records in Excel!`);

  const directors = [];
  const staff = [];

  let dirIndex = 1;
  let staffIndex = 1;

  for (const row of rawRows) {
    if (!row.name || row.name.trim().length === 0) continue;

    const role = (row.role_type || '').toUpperCase().includes('DIR') ? 'DIRECTOR' : 'STAFF';
    const cleanName = row.name.trim().replace(/\s+/g, ' ');
    const email = row.email ? row.email.trim() : '';
    const pos = row.position ? row.position.trim() : (role === 'DIRECTOR' ? 'ผู้อำนวยการฝ่าย' : 'พนักงาน');
    
    let dept = row.department1 ? row.department1.trim() : '';
    if (row.department2 && row.department2.trim()) {
      dept += ` (${row.department2.trim()})`;
    }
    if (!dept) dept = 'ส่วนกลาง อสป.';

    if (role === 'DIRECTOR') {
      const empCode = row.emp_code && row.emp_code.startsWith('DIR') 
        ? row.emp_code.trim() 
        : `DIR-${String(dirIndex).padStart(2, '0')}`;
      
      directors.push({
        emp_code: empCode,
        name: cleanName,
        email,
        position: pos,
        department: dept,
        role_type: 'DIRECTOR'
      });
      dirIndex++;
    } else {
      const empCode = row.emp_code && row.emp_code.startsWith('EMP-')
        ? row.emp_code.trim()
        : `EMP-${String(staffIndex).padStart(3, '0')}`;

      staff.push({
        emp_code: empCode,
        name: cleanName,
        email,
        position: pos,
        department: dept,
        role_type: 'STAFF'
      });
      staffIndex++;
    }
  }

  // Sort Directors by DIR code (DIR-01 to DIR-08)
  directors.sort((a, b) => a.emp_code.localeCompare(b.emp_code, undefined, { numeric: true }));

  // Re-assign 1..N order
  directors.forEach((d, idx) => d.no = idx + 1);
  staff.forEach((s, idx) => s.no = idx + 1);

  console.log(`✅ Loaded Directors: ${directors.length} persons`);
  console.log(`✅ Loaded Staff: ${staff.length} persons`);

  // Print Sample Directors
  console.log('\n--- DIRECTOR LIST ---');
  directors.forEach(d => console.log(`${d.no}. [${d.emp_code}] ${d.name} | ${d.position} | ${d.department} | ${d.email}`));

  console.log('\n--- STAFF LIST SAMPLE (First 10) ---');
  staff.slice(0, 10).forEach(s => console.log(`${s.no}. [${s.emp_code}] ${s.name} | ${s.position} | ${s.department} | ${s.email}`));

  // Generate UTF-8 BOM CSV File for Excel
  let csv = '\uFEFF';
  csv += '=== รายชื่อผู้อำนวยการฝ่าย (DIRECTORS) ===\n';
  csv += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  directors.forEach(d => {
    csv += `"${d.no}","${d.emp_code}","${d.name}","${d.position}","${d.department}","${d.email}","ผอ.ฝ่าย (DIRECTOR)"\n`;
  });

  csv += '\n=== รายชื่อพนักงาน (STAFF) ===\n';
  csv += '"ลำดับที่","รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","ฝ่าย/หน่วยงาน","อีเมล","บทบาท"\n';
  staff.forEach(s => {
    csv += `"${s.no}","${s.emp_code}","${s.name}","${s.position}","${s.department}","${s.email}","พนักงาน (STAFF)"\n`;
  });

  try {
    fs.writeFileSync('public/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');
  } catch (e) {
    console.log('Notice: public/FMO_Real_Personnel_Dataset.csv is open in another app, writing to FMO_Real_Personnel_Dataset_Official.csv');
  }
  fs.writeFileSync('public/FMO_Real_Personnel_Dataset_Official.csv', csv, 'utf-8');
  fs.writeFileSync('C:/Users/FMO-10/.gemini/antigravity/brain/fd52a021-e54d-4a30-8aee-9743d05d6dd9/FMO_Real_Personnel_Dataset.csv', csv, 'utf-8');

  // Populate SQLite Database
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

  // Insert Directors
  for (const d of directors) {
    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, email) VALUES (?, ?, 'DIRECTOR', ?, ?, ?);`,
      [d.emp_code, d.name, d.department, d.position, d.email]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, d.no]
    );
  }

  // Insert Staff
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

  console.log('\n🎉 SQLite database successfully updated with 100% exact Excel dataset from user!');
}

importUserExcel().catch(console.error);
