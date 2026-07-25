const { dbRun, dbGet, dbAll, initSchema } = require('./database');

async function seedData() {
  console.log('🌱 Initializing SQLite Schema & Seeding FMO Data...');
  await initSchema();

  // Check if personnel already exists
  const existingCount = await dbGet(`SELECT COUNT(*) as count FROM personnel;`);
  if (existingCount && existingCount.count > 0) {
    console.log('ℹ️ Personnel data already seeded.');
    return;
  }

  // 1. Seed 8 Directors (ผอ.ฝ่าย)
  const directorDepartments = [
    { title: 'ผอ.ฝ่ายบริหารจัดการและอำนวยการ', dept: 'ฝ่ายบริหารจัดการและอำนวยการ' },
    { title: 'ผอ.ฝ่ายพัฒนาธุรกิจและกิจกรรมมหาชน', dept: 'ฝ่ายพัฒนาธุรกิจและกิจกรรมมหาชน' },
    { title: 'ผอ.ฝ่ายสะพานปลาและท่าเทียบเรือ', dept: 'ฝ่ายสะพานปลาและท่าเทียบเรือ' },
    { title: 'ผอ.ฝ่ายการเงินและบัญชี', dept: 'ฝ่ายการเงินและบัญชี' },
    { title: 'ผอ.ฝ่ายวิศวกรรมและเทคโนโลยีสารสนเทศ', dept: 'ฝ่ายวิศวกรรมและเทคโนโลยีสารสนเทศ' },
    { title: 'ผอ.ฝ่ายตรวจสอบภายใน', dept: 'ฝ่ายตรวจสอบภายใน' },
    { title: 'ผอ.ฝ่ายยุทธศาสตร์และประกันคุณภาพ', dept: 'ฝ่ายยุทธศาสตร์และประกันคุณภาพ' },
    { title: 'ผอ.ฝ่ายทรัพยากรบุคคลและกฎหมาย', dept: 'ฝ่ายทรัพยากรบุคคลและกฎหมาย' },
  ];

  const directorNames = [
    'นายสมชาย วงศ์สุวรรณ',
    'นางสาวสิริพร รัตนพิบูลย์',
    'นายวิชัย ชัยเจริญ',
    'นางนภา กิตติวรกุล',
    'นายประเสริฐ ศรีสุข',
    'นางสาวอนงค์นาถ เจริญผล',
    'นายเกียรติศักดิ์ พรหมมณี',
    'นายธนพล วุฒิชัย'
  ];

  for (let i = 0; i < 8; i++) {
    const empCode = `FMO-D${(i + 1).toString().padStart(2, '0')}`;
    const name = directorNames[i];
    const dept = directorDepartments[i].dept;
    const pos = directorDepartments[i].title;

    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, phone, email) 
       VALUES (?, ?, 'DIRECTOR', ?, ?, ?, ?);`,
      [empCode, name, dept, pos, `081-900-000${i+1}`, `director0${i+1}@fmo.or.th`]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) 
       VALUES (?, 'DIRECTOR', 1, ?, 'WAITING');`,
      [res.lastID, i + 1]
    );
  }

  console.log('✅ Seeded 8 Directors.');

  // 2. Seed 94 Staff Members (พนักงาน 94 ท่าน)
  const staffNamesFirst = ['กิตติ', 'ชลธิชา', 'ณัฐพงษ์', 'ทิพวรรณ', 'ธนากร', 'นพดล', 'ปิยะนันท์', 'พงศธร', 'ภัทรา', 'เมธาสิทธิ์', 'วรวุฒิ', 'ศุภชัย', 'สุภัสสรา', 'อภิสิทธิ์', 'อมรรัตน์'];
  const staffNamesLast = ['มีสุข', 'สุขเจริญ', 'มั่นคง', 'จันทร์หอม', 'บุญมี', 'แก้วกระจ่าง', 'รุ่งเรือง', 'ศิริโชติ', 'มงคลทรัพย์', 'ทองแท้'];

  const depts = [
    'ฝ่ายบริหารจัดการและอำนวยการ',
    'ฝ่ายพัฒนาธุรกิจและกิจกรรมมหาชน',
    'ฝ่ายสะพานปลาและท่าเทียบเรือ',
    'ฝ่ายการเงินและบัญชี',
    'ฝ่ายวิศวกรรมและเทคโนโลยีสารสนเทศ',
    'ฝ่ายตรวจสอบภายใน',
    'ฝ่ายยุทธศาสตร์และประกันคุณภาพ',
    'ฝ่ายทรัพยากรบุคคลและกฎหมาย'
  ];

  for (let i = 1; i <= 94; i++) {
    const empCode = `FMO-S${i.toString().padStart(3, '0')}`;
    const fn = staffNamesFirst[(i - 1) % staffNamesFirst.length];
    const ln = staffNamesLast[(i - 1) % staffNamesLast.length];
    const name = `${fn} ${ln} (ส.${i})`;
    const dept = depts[(i - 1) % depts.length];
    const pos = i % 3 === 0 ? 'เจ้าหน้าที่บริหารงานทั่วไป 6' : i % 2 === 0 ? 'นักวิเคราะห์นโยบายและแผน 5' : 'เจ้าหน้าที่ปฏิบัติการ 4';

    const res = await dbRun(
      `INSERT INTO personnel (emp_code, name, role_type, department, position, phone, email) 
       VALUES (?, ?, 'STAFF', ?, ?, ?, ?);`,
      [empCode, name, dept, pos, `089-${100 + i}-${1000 + i}`, `staff${i}@fmo.or.th`]
    );

    await dbRun(
      `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) 
       VALUES (?, 'STAFF', 1, ?, 'WAITING');`,
      [res.lastID, i]
    );
  }

  console.log('✅ Seeded 94 Staff Members.');

  // 3. Seed Sample Past Missions & Assignments for realistic history demo
  const sampleMissions = [
    {
      title: 'โครงการเปิดตัวสะพานปลาสะอาดสุขอนามัย 2026',
      desc: 'ตรวจประเมินและจัดกิจกรรมเปิดตัวท่าเทียบเรือมาตรฐานสากล',
      location: 'สะพานปลาสมุทรปราการ',
      start: '2026-06-10 09:00:00',
      end: '2026-06-10 16:30:00',
      directors: 1,
      staff: 5,
      status: 'COMPLETED'
    },
    {
      title: 'กิจกรรมจิตอาสาฟื้นฟูสิ่งแวดล้อมชายฝั่ง อสป.',
      desc: 'กิจกรรมเก็บขยะและบำรุงรักษาพื้นที่สะพานปลา',
      location: 'สะพานปลากระบี่',
      start: '2026-06-25 08:30:00',
      end: '2026-06-25 15:00:00',
      directors: 1,
      staff: 8,
      status: 'COMPLETED'
    },
    {
      title: 'ภารกิจออกตรวจตลาดสัตว์น้ำเคลื่อนที่ประจำไตรมาส 2',
      desc: 'ตรวจสุ่มมาตรฐานสุขอนามัยและการชั่งตวงวัด',
      location: 'สะพานปลาหัวหิน',
      start: '2026-07-05 07:00:00',
      end: '2026-07-05 14:00:00',
      directors: 1,
      staff: 6,
      status: 'COMPLETED'
    },
    {
      title: 'มหกรรมสินค้าประมง อสป. แฟร์ 2026',
      desc: 'งานแสดงและจำหน่ายสินค้าสัตว์น้ำคุณภาพสูงแก่ประชาชน',
      location: 'ศูนย์แสดงสินค้า อสป. กรุงเทพฯ',
      start: '2026-07-28 09:00:00',
      end: '2026-07-30 18:00:00',
      directors: 2,
      staff: 10,
      status: 'SCHEDULED'
    }
  ];

  for (let mIdx = 0; mIdx < sampleMissions.length; mIdx++) {
    const m = sampleMissions[mIdx];
    const mRes = await dbRun(
      `INSERT INTO missions (mission_title, description, location, start_date, end_date, required_directors, required_staff, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [m.title, m.desc, m.location, m.start, m.end, m.directors, m.staff, m.status]
    );

    const missionId = mRes.lastID;

    // Simulate complete assignments for completed missions
    if (m.status === 'COMPLETED') {
      // Pick Director (mIdx + 1)
      const dirRes = await dbGet(`SELECT id FROM personnel WHERE role_type = 'DIRECTOR' ORDER BY id LIMIT 1 OFFSET ?;`, [mIdx]);
      if (dirRes) {
        await dbRun(
          `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status)
           VALUES (?, ?, 'DIRECTOR', 1, 1, 'JOINED');`,
          [missionId, dirRes.id]
        );
        // Mark director completed in round 1
        await dbRun(`UPDATE queue_members SET status = 'COMPLETED', last_assigned_at = ? WHERE personnel_id = ?;`, [m.end, dirRes.id]);
      }

      // Pick Staff members
      const staffStartOffset = mIdx * 8;
      const staffMembers = await dbAll(`SELECT id FROM personnel WHERE role_type = 'STAFF' ORDER BY id LIMIT ? OFFSET ?;`, [m.staff, staffStartOffset]);
      for (const st of staffMembers) {
        await dbRun(
          `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status)
           VALUES (?, ?, 'STAFF', 1, 0, 'JOINED');`,
          [missionId, st.id]
        );
        await dbRun(`UPDATE queue_members SET status = 'COMPLETED', last_assigned_at = ? WHERE personnel_id = ?;`, [m.end, st.id]);
      }
    }
  }

  // Simulate 1 or 2 Skipped/Hold cases to demonstrate Skip & Hold logic UI
  const holdDirector = await dbGet(`SELECT personnel_id FROM queue_members WHERE role_type = 'DIRECTOR' AND status = 'WAITING' ORDER BY queue_order LIMIT 1;`);
  if (holdDirector) {
    await dbRun(
      `UPDATE queue_members SET status = 'HOLD', hold_reason = 'ติดราชการต่างจังหวัดด่วน', hold_timestamp = '2026-07-20 10:00:00' WHERE personnel_id = ?;`,
      [holdDirector.personnel_id]
    );
  }

  const holdStaff = await dbGet(`SELECT personnel_id FROM queue_members WHERE role_type = 'STAFF' AND status = 'WAITING' ORDER BY queue_order LIMIT 1;`);
  if (holdStaff) {
    await dbRun(
      `UPDATE queue_members SET status = 'HOLD', hold_reason = 'อบรมหลักสูตรยุทธศาสตร์ อสป.', hold_timestamp = '2026-07-21 14:30:00' WHERE personnel_id = ?;`,
      [holdStaff.personnel_id]
    );
  }

  console.log('✅ Seeded Sample Missions & Initial Queue Hold States.');
  console.log('🎉 Seeding complete successfully!');
}

seedData().catch(err => {
  console.error('❌ Seeding error:', err);
});
