const fs = require('fs');
const { dbRun, dbGet, dbAll, initSchema } = require('./db/database');

async function importUpdatedCsv() {
  let csvPath = 'public/FMO_Real_Personnel_Dataset.csv';
  if (!fs.existsSync(csvPath)) {
    csvPath = 'FMO_Real_Personnel_Dataset.csv';
  }

  console.log(`📖 Reading CSV file: ${csvPath}`);
  let content = fs.readFileSync(csvPath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const directors = [];
  const staff = [];

  let currentSection = null;

  for (let line of lines) {
    if (line.includes('DIRECTORS') || line.includes('ผู้อำนวยการ')) {
      currentSection = 'DIRECTOR';
      continue;
    }
    if (line.includes('STAFF') || line.includes('พนักงาน')) {
      currentSection = 'STAFF';
      continue;
    }
    if (line.includes('ลำดับ') || line.includes('รหัสพนักงาน')) continue;

    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 3) continue;

    let empCode = cols[0] || '';
    let name = cols[1] || '';
    let pos = cols[2] || '';
    let dept = cols[3] || '';
    let role = cols[4] || '';
    let email = cols[5] || '';

    // Fix shifted columns if first column was numeric index
    if (/^\d+$/.test(empCode)) {
      empCode = cols[1] || '';
      name = cols[2] || '';
      pos = cols[3] || '';
      dept = cols[4] || '';
      role = cols[5] || '';
      email = cols[6] || '';
    }

    if (!name) continue;

    const isDir = empCode.startsWith('DIR') || role.toUpperCase().includes('DIRECTOR') || role.includes('ผอ.') || role.includes('รผอ') || role.includes('ผออ') || currentSection === 'DIRECTOR';

    const item = {
      emp_code: empCode,
      name,
      position: pos,
      department: dept,
      email,
      role_type: isDir ? 'DIRECTOR' : 'STAFF'
    };

    if (isDir) {
      directors.push(item);
    } else {
      staff.push(item);
    }
  }

  // Ensure DIR-09 and DIR-10 are placed BEFORE DIR-01
  directors.sort((a, b) => {
    const getWeight = (code) => {
      if (code === 'DIR-09') return 1;
      if (code === 'DIR-10') return 2;
      const numMatch = code.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0]) : 99;
      return 10 + num;
    };
    return getWeight(a.emp_code) - getWeight(b.emp_code);
  });

  // Reassign sequential 1..N order
  directors.forEach((d, idx) => d.no = idx + 1);
  staff.forEach((s, idx) => s.no = idx + 1);

  console.log(`✅ Directors Parsed (${directors.length} persons):`);
  directors.forEach(d => console.log(`  Queue #${d.no} [${d.emp_code}] ${d.name} (${d.position})`));

  console.log(`\n✅ Staff Parsed (${staff.length} persons) - Sample 5:`);
  staff.slice(0, 5).forEach(s => console.log(`  Queue #${s.no} [${s.emp_code}] ${s.name} (${s.position})`));

  // Populate SQLite Database
  await initSchema();
  await dbRun(`DELETE FROM mission_assignments;`);
  await dbRun(`DELETE FROM queue_members;`);
  await dbRun(`DELETE FROM personnel;`);
  await dbRun(`UPDATE queue_state SET current_round = 1;`);

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

  console.log('\n🎉 SQLite database successfully updated with DIR-09 and DIR-10 at the VERY TOP!');
}

importUpdatedCsv().catch(console.error);
