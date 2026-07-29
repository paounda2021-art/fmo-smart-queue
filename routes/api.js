const express = require('express');
const router = express.Router();
const axios = require('axios');
const { dbRun, dbGet, dbAll } = require('../db/database');
const { sendMissionNotification, formatDate24h } = require('../services/notification');

// Helper: Generate Auto-Running Mission Code (FMO-ATMMYY-XXX)
async function generateMissionCode() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    // ดึงปีปัจจุบัน (เช่น 2026 + 543 = 2569) แล้วตัดเอาแค่ 2 หลักท้าย ('69')
    const thaiYear = now.getFullYear() + 543;
    const shortYear = String(thaiYear).slice(-2);
    const prefix = `FMO-AT${month}${shortYear}-`;

    try {
        // ใช้ dbGet ดึงข้อมูลรหัสล่าสุดของเดือนนี้
        const row = await dbGet(
            `SELECT mission_code FROM missions WHERE mission_code LIKE ? ORDER BY id DESC LIMIT 1`,
            [`${prefix}%`]
        );
        
        let nextNumber = 1;
        // ถ้าระบบค้นเจอข้อมูลเก่า ให้เอาเลข 3 หลักท้ายมาบวก 1
        if (row && row.mission_code) {
            const lastCode = row.mission_code;
            const lastNumberStr = lastCode.split('-').pop(); // ตัดเอาเฉพาะส่วนท้าย
            nextNumber = parseInt(lastNumberStr, 10) + 1;
        }
        
        // ประกอบร่างรหัสใหม่ พร้อมเติมเลข 0 ด้านหน้าให้ครบ 3 หลัก (001, 002, ...)
        return prefix + String(nextNumber).padStart(3, '0');
    } catch (error) {
        console.error('Error generating mission code:', error);
        throw error; // โยน Error กลับไปให้ Route จัดการ
    }
}
// Helper: Auto-advance round if everyone completed
/*async function checkAndAdvanceRound(roleType) {
  const state = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = ?;`, [roleType]);
  const currentRound = state ? state.current_round : 1;

  const remaining = await dbGet(
    `SELECT COUNT(*) as count FROM queue_members WHERE role_type = ? AND current_round = ? AND status != 'COMPLETED';`,
    [roleType, currentRound]
  );

  if (remaining && remaining.count === 0) {
    const nextRound = currentRound + 1;
    console.log(`🔄 Strict Round Control: All ${roleType} members completed Round ${currentRound}. Advancing to Round ${nextRound}!`);

    await dbRun(`UPDATE queue_state SET current_round = ?, updated_at = CURRENT_TIMESTAMP WHERE role_type = ?;`, [nextRound, roleType]);

    await dbRun(
      `UPDATE queue_members 
       SET current_round = ?, status = 'WAITING', hold_reason = NULL, hold_timestamp = NULL 
       WHERE role_type = ?;`,
      [nextRound, roleType]
    );

    return { roundAdvanced: true, newRound: nextRound };
  }

  return { roundAdvanced: false, currentRound };
}*/

// -------------------------------------------------------------
// Helper: Fisher–Yates Shuffle
// ใช้สุ่มลำดับพนักงานอย่างทั่วถึง
// -------------------------------------------------------------
function shuffleArray(items) {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));

    [shuffled[i], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[i]
    ];
  }

  return shuffled;
}


// -------------------------------------------------------------
// Helper: Auto-advance round if everyone completed
//
// DIRECTOR:
// - ใช้เฉพาะ DIR-01 ถึง DIR-08
// - DIR-09 และ DIR-10 เป็นสำรอง ไม่เข้าคิวอัตโนมัติ
// - เมื่อขึ้นรอบใหม่ เริ่มเรียงจาก DIR-01 เสมอ
//
// STAFF:
// - คนที่ได้รับจัดสรรแล้วเป็น COMPLETED
// - ไม่ถูกเลือกซ้ำภายในรอบเดิม
// - เมื่อครบทุกคน จึงขึ้นรอบใหม่และสุ่มลำดับใหม่ทั้งหมด
// -------------------------------------------------------------
async function checkAndAdvanceRound(roleType) {
  const normalizedRoleType = String(roleType || '').toUpperCase();

  if (!['DIRECTOR', 'STAFF'].includes(normalizedRoleType)) {
    throw new Error(`Invalid role type: ${roleType}`);
  }

  // อ่านรอบปัจจุบัน
  const state = await dbGet(
    `SELECT current_round
     FROM queue_state
     WHERE role_type = ?;`,
    [normalizedRoleType]
  );

  const currentRound = state ? state.current_round : 1;

  let remaining;

  // -----------------------------------------------------------
  // ตรวจจำนวนคนที่ยังไม่จบรอบ
  // -----------------------------------------------------------
  if (normalizedRoleType === 'DIRECTOR') {
    // DIR-09 และ DIR-10 เป็นสำรอง
    // จึงไม่นำมานับว่าต้อง COMPLETED ก่อนขึ้นรอบใหม่
    remaining = await dbGet(
      `SELECT COUNT(*) AS count
       FROM queue_members qm
       JOIN personnel p
         ON p.id = qm.personnel_id
       WHERE qm.role_type = 'DIRECTOR'
         AND qm.current_round = ?
         AND UPPER(p.emp_code) NOT IN ('DIR-09', 'DIR-10')
         AND qm.status != 'COMPLETED';`,
      [currentRound]
    );
  } else {
    // STAFF ทุกคนต้องได้รับการจัดสรรครบก่อนเริ่มสุ่มรอบใหม่
    remaining = await dbGet(
      `SELECT COUNT(*) AS count
       FROM queue_members qm
       WHERE qm.role_type = 'STAFF'
         AND qm.current_round = ?
         AND qm.status != 'COMPLETED';`,
      [currentRound]
    );
  }

  // ยังมีคนที่ไม่ได้รับการจัดสรรในรอบปัจจุบัน
  if (!remaining || remaining.count > 0) {
    return {
      roundAdvanced: false,
      currentRound,
      remainingCount: remaining ? remaining.count : 0
    };
  }

  // -----------------------------------------------------------
  // ทุกคนในรอบครบแล้ว → เริ่มรอบใหม่
  // -----------------------------------------------------------
  const nextRound = currentRound + 1;

  console.log(
    `🔄 ${normalizedRoleType}: ครบรอบ ${currentRound} แล้ว กำลังเริ่มรอบ ${nextRound}`
  );

  await dbRun(
    `UPDATE queue_state
     SET current_round = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE role_type = ?;`,
    [nextRound, normalizedRoleType]
  );

  // -----------------------------------------------------------
  // STAFF: สุ่มลำดับใหม่ทั้งหมดในรอบใหม่
  // -----------------------------------------------------------
  if (normalizedRoleType === 'STAFF') {
    const staffMembers = await dbAll(
      `SELECT
         qm.id AS queue_id,
         qm.personnel_id,
         p.emp_code,
         p.name
       FROM queue_members qm
       JOIN personnel p
         ON p.id = qm.personnel_id
       WHERE qm.role_type = 'STAFF'
       ORDER BY qm.queue_order ASC, p.emp_code ASC;`
    );

    const shuffledStaff = shuffleArray(staffMembers);

    for (let index = 0; index < shuffledStaff.length; index++) {
      const member = shuffledStaff[index];

      await dbRun(
        `UPDATE queue_members
         SET current_round = ?,
             queue_order = ?,
             status = 'WAITING',
             hold_reason = NULL,
             hold_timestamp = NULL
         WHERE id = ?;`,
        [
          nextRound,
          index + 1,
          member.queue_id
        ]
      );
    }

    console.log(
      `🎲 STAFF รอบ ${nextRound}: สุ่มลำดับพนักงานใหม่จำนวน ${shuffledStaff.length} คนเรียบร้อยแล้ว`
    );

    console.log(
      '🎲 ลำดับ STAFF ใหม่:',
      shuffledStaff.map((member, index) =>
        `${index + 1}. ${member.emp_code}`
      ).join(' | ')
    );
  }

  // -----------------------------------------------------------
  // DIRECTOR: เรียงใหม่จาก DIR-01 และกัน DIR-09, DIR-10 เป็นสำรอง
  // -----------------------------------------------------------
  if (normalizedRoleType === 'DIRECTOR') {
    const directors = await dbAll(
      `SELECT
         qm.id AS queue_id,
         p.emp_code,
         p.name
       FROM queue_members qm
       JOIN personnel p
         ON p.id = qm.personnel_id
       WHERE qm.role_type = 'DIRECTOR'
         AND UPPER(p.emp_code) NOT IN ('DIR-09', 'DIR-10')
       ORDER BY
         CAST(
           REPLACE(UPPER(p.emp_code), 'DIR-', '')
           AS INTEGER
         ) ASC;`
    );

    // กำหนด DIR-01 เป็นลำดับแรกทุกครั้งที่เริ่มรอบใหม่
    for (let index = 0; index < directors.length; index++) {
      const director = directors[index];

      await dbRun(
        `UPDATE queue_members
         SET current_round = ?,
             queue_order = ?,
             status = 'WAITING',
             hold_reason = NULL,
             hold_timestamp = NULL
         WHERE id = ?;`,
        [
          nextRound,
          index + 1,
          director.queue_id
        ]
      );
    }

    // DIR-09 และ DIR-10 เป็นสำรอง
    // ไม่ให้ระบบเลือกเข้าคิวอัตโนมัติ
    await dbRun(
      `UPDATE queue_members
       SET current_round = ?,
           status = 'HOLD',
           hold_reason = 'สำรอง ไม่เข้าคิวอัตโนมัติ',
           hold_timestamp = CURRENT_TIMESTAMP
       WHERE personnel_id IN (
         SELECT id
         FROM personnel
         WHERE UPPER(emp_code) IN ('DIR-09', 'DIR-10')
       );`,
      [nextRound]
    );

    console.log(
      `🔁 DIRECTOR รอบ ${nextRound}: เริ่มลำดับใหม่จาก DIR-01 และยกเว้น DIR-09, DIR-10`
    );
  }

  return {
    roundAdvanced: true,
    previousRound: currentRound,
    newRound: nextRound,
    roleType: normalizedRoleType
  };
}

// -------------------------------------------------------------
// 1. DASHBOARD OVERVIEW & ACTIVE QUEUE TRACKER
// -------------------------------------------------------------
router.get('/dashboard/stats', async (req, res) => {
  try {
    const dirState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'DIRECTOR';`);
    const staffState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'STAFF';`);

    const dirRound = dirState ? dirState.current_round : 1;
    const staffRound = staffState ? staffState.current_round : 1;

    // Next Director in Queue
    const nextDirector = await dbGet(
      `SELECT qm.*, p.emp_code, p.name, p.department, p.position 
       FROM queue_members qm
       JOIN personnel p ON qm.personnel_id = p.id
       WHERE qm.role_type = 'DIRECTOR' AND qm.status IN ('HOLD', 'WAITING')
       ORDER BY CASE qm.status WHEN 'HOLD' THEN 1 WHEN 'WAITING' THEN 2 END, qm.queue_order ASC
       LIMIT 1;`
    );

    // Next Staff in Queue
    const nextStaff = await dbGet(
      `SELECT qm.*, p.emp_code, p.name, p.department, p.position 
       FROM queue_members qm
       JOIN personnel p ON qm.personnel_id = p.id
       WHERE qm.role_type = 'STAFF' AND qm.status IN ('HOLD', 'WAITING')
       ORDER BY CASE qm.status WHEN 'HOLD' THEN 1 WHEN 'WAITING' THEN 2 END, qm.queue_order ASC
       LIMIT 1;`
    );

    // Participation Rate
    const totalPersonnel = await dbGet(`SELECT COUNT(*) as count FROM personnel;`);
    const activeParticipants = await dbGet(`SELECT COUNT(DISTINCT personnel_id) as count FROM mission_assignments;`);

    const totalCount = totalPersonnel ? totalPersonnel.count : 102;
    const activeCount = activeParticipants ? activeParticipants.count : 0;
    const participationRate = Math.round((activeCount / totalCount) * 100);

    const dirStats = await dbAll(`SELECT status, COUNT(*) as count FROM queue_members WHERE role_type = 'DIRECTOR' GROUP BY status;`);
    const staffStats = await dbAll(`SELECT status, COUNT(*) as count FROM queue_members WHERE role_type = 'STAFF' GROUP BY status;`);

    // Total Counts by Role
    const totalDirectorsCount = await dbGet(`SELECT COUNT(*) as count FROM personnel WHERE role_type = 'DIRECTOR';`);
    const totalStaffCount = await dbGet(`SELECT COUNT(*) as count FROM personnel WHERE role_type = 'STAFF';`);

    const totalMissions = await dbGet(`SELECT COUNT(*) as count FROM missions;`);
    const completedMissions = await dbGet(`SELECT COUNT(*) as count FROM missions WHERE status = 'COMPLETED';`);
    const scheduledMissions = await dbGet(`SELECT COUNT(*) as count FROM missions WHERE status = 'SCHEDULED';`);
    const totalHolds = await dbGet(`SELECT COUNT(*) as count FROM queue_members WHERE status = 'HOLD';`);

    res.json({
      success: true,
      data: {
        rounds: { directorRound: dirRound, staffRound: staffRound },
        totalDirectors: totalDirectorsCount ? totalDirectorsCount.count : 0,
        totalStaff: totalStaffCount ? totalStaffCount.count : 0,
        activeQueueTracker: {
          nextDirector: nextDirector || null,
          nextStaff: nextStaff || null
        },
        participationRate: {
          ratePct: participationRate,
          activeCount,
          totalCount
        },
        directorBreakdown: dirStats,
        staffBreakdown: staffStats,
        missions: {
          total: totalMissions ? totalMissions.count : 0,
          completed: completedMissions ? completedMissions.count : 0,
          scheduled: scheduledMissions ? scheduledMissions.count : 0
        },
        holdsCount: totalHolds ? totalHolds.count : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 2. DUAL ROTATION QUEUE LIST
// -------------------------------------------------------------
router.get('/queue/:roleType', async (req, res) => {
  try {
    const roleType = req.params.roleType.toUpperCase();
    if (!['DIRECTOR', 'STAFF'].includes(roleType)) {
      return res.status(400).json({ success: false, error: 'Invalid role_type' });
    }

    const state = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = ?;`, [roleType]);
    const currentRound = state ? state.current_round : 1;

    const members = await dbAll(
      `SELECT 
        qm.id as queue_id,
        qm.personnel_id,
        qm.role_type,
        qm.current_round,
        qm.queue_order,
        qm.status,
        qm.hold_reason,
        qm.hold_timestamp,
        qm.last_assigned_at,
        p.emp_code,
        p.name,
        p.department,
        p.position,
        p.phone,
        p.email,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.personnel_id = p.id) as total_missions_joined
       FROM queue_members qm
       JOIN personnel p ON qm.personnel_id = p.id
       WHERE qm.role_type = ?
       ORDER BY 
         CASE qm.status
           WHEN 'HOLD' THEN 1
           WHEN 'WAITING' THEN 2
           WHEN 'COMPLETED' THEN 3
         END,
         qm.queue_order ASC;`,
      [roleType]
    );

    res.json({
      success: true,
      roleType,
      currentRound,
      totalCount: members.length,
      members
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. CANDIDATE PREVIEW FOR NEW MISSION
// -------------------------------------------------------------

// LINE Webhook Endpoint
router.post('/line-webhook', async (req, res) => {
  // ตอบ LINE ทันที ป้องกัน webhook timeout
  res.status(200).send('OK');

  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  async function replyLine(replyToken, messages) {
    if (!replyToken || !Array.isArray(messages) || messages.length === 0) {
      return false;
    }

    if (!lineToken) {
      console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN');
      return false;
    }

    try {
      await axios.post(
        'https://api.line.me/v2/bot/message/reply',
        {
          replyToken,
          messages
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${lineToken}`
          }
        }
      );

      console.log('✅ ส่งข้อความตอบกลับ LINE สำเร็จ');
      return true;
    } catch (error) {
      console.error(
        '❌ LINE Reply API Error:',
        error.response?.data || error.message
      );
      return false;
    }
  }

  function createPdpaCard(person, empCode) {
    return {
      type: 'flex',
      altText: 'ขอความยินยอมการใช้ข้อมูลส่วนบุคคล (PDPA)',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#0056A0',
          paddingAll: '18px',
          contents: [
            {
              type: 'text',
              text: 'นโยบายความเป็นส่วนตัว (PDPA)',
              weight: 'bold',
              color: '#FFFFFF',
              size: 'sm'
            },
            {
              type: 'text',
              text: 'FMO Smart Queue',
              weight: 'bold',
              size: 'xl',
              color: '#FFFFFF',
              margin: 'sm'
            }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `สวัสดีคุณ ${person.name || '-'}`,
              weight: 'bold',
              size: 'md',
              color: '#111111',
              wrap: true
            },
            {
              type: 'text',
              text:
                'เพื่อรับการแจ้งเตือนคิวและภารกิจ องค์การสะพานปลา (อสป.) ' +
                'มีความจำเป็นต้องจัดเก็บ LINE User ID ของท่าน',
              wrap: true,
              size: 'sm',
              color: '#666666',
              margin: 'md'
            },
            {
              type: 'text',
              text:
                'ข้อมูลนี้ใช้เฉพาะภายในระบบ FMO Smart Queue ' +
                'และจัดเก็บตามมาตรฐานความปลอดภัย',
              wrap: true,
              size: 'sm',
              color: '#666666',
              margin: 'md'
            },
            {
              type: 'text',
              text: 'ท่านยินยอมให้ระบบจัดเก็บข้อมูลหรือไม่?',
              wrap: true,
              weight: 'bold',
              size: 'sm',
              color: '#0056A0',
              margin: 'lg'
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#0056A0',
              action: {
                type: 'message',
                label: '✅ ยินยอม (ผูกบัญชี)',
                text: `CONFIRM-${empCode}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'message',
                label: '❌ ไม่ยินยอม (ส่งเมลแทน)',
                text: `CANCEL-${empCode}`
              }
            }
          ]
        }
      }
    };
  }

  try {
    const events = Array.isArray(req.body?.events)
      ? req.body.events
      : [];

    for (const event of events) {
      try {
        const lineUserId = event.source?.userId || '';
        const replyToken = event.replyToken;

        // =============================================================
        // A. POSTBACK: ACK / BUSY
        // =============================================================
        if (event.type === 'postback') {
          const postbackData = String(event.postback?.data || '');
          let replyMessages = [];

          console.log('[DEBUG] 📩 LINE Postback:', postbackData);

          if (postbackData.startsWith('ACK|')) {
            const [, missionIdRaw, personnelIdRaw] =
              postbackData.split('|');

            const missionId =
              Number.parseInt(missionIdRaw, 10);

            const personnelId =
              Number.parseInt(personnelIdRaw, 10);

            if (
              !Number.isInteger(missionId) ||
              !Number.isInteger(personnelId)
            ) {
              replyMessages = [{
                type: 'text',
                text:
                  '❌ ข้อมูลการตอบรับไม่ถูกต้อง ' +
                  'กรุณาติดต่อเจ้าหน้าที่ค่ะ'
              }];
            } else {
              const assignment = await dbGet(
                `
                SELECT
                  ma.*,
                  p.name AS person_name,
                  m.mission_title,
                  m.description,
                  m.location,
                  m.start_date,
                  m.end_date,
                  m.dress_code
                FROM mission_assignments ma
                JOIN personnel p
                  ON p.id = ma.personnel_id
                JOIN missions m
                  ON m.id = ma.mission_id
                WHERE ma.mission_id = ?
                  AND ma.personnel_id = ?
                ORDER BY ma.id DESC
                LIMIT 1;
                `,
                [
                  missionId,
                  personnelId
                ]
              );

              if (!assignment) {
                replyMessages = [{
                  type: 'text',
                  text:
                    '❌ ไม่พบข้อมูลการจัดสรรในระบบ ' +
                    'กรุณาติดต่อเจ้าหน้าที่ค่ะ'
                }];
              }
              else if (
                assignment.ack_status === 'ACKNOWLEDGED'
              ) {
                replyMessages = [{
                  type: 'text',
                  text:
                    'ℹ️ ท่านได้กดรับทราบกิจกรรมนี้แล้วค่ะ'
                }];
              }
              else {
                await dbRun(
                  `
                  UPDATE mission_assignments
                  SET
                    ack_status = 'ACKNOWLEDGED',
                    ack_at = CURRENT_TIMESTAMP
                  WHERE id = ?;
                  `,
                  [assignment.id]
                );

                await checkAndUpdateMissionStatus(missionId);


                const missionDescription = String(
                  assignment.description || ''
                ).trim();

                const timeStr = (assignment.start_date && assignment.end_date)
                  ? `${formatDate24h(assignment.start_date)} - ${formatDate24h(assignment.end_date)}`
                  : '-';

                replyMessages = [{
                  type: 'text',
                  text:
                    `✅ รับทราบแล้วค่ะ คุณ ${assignment.person_name || '-'}\n\n` +
                    `📋 กิจกรรม:\n${assignment.mission_title || '-'}\n\n` +
                    `📍 สถานที่: ${assignment.location || '-'}\n` +
                    `⏰ เวลา (24 ชม.): ${timeStr}\n` +
                    `👔 การแต่งกาย: ${assignment.dress_code || 'ชุดปฏิบัติงาน อสป.'}\n\n` +
                    `📝 รายละเอียด/กำหนดการ:\n${missionDescription || 'ไม่มีรายละเอียดเพิ่มเติม'}\n\n` +
                    `ระบบได้บันทึกการตอบรับเข้าร่วมกิจกรรมเรียบร้อยแล้ว ขอบคุณค่ะ 🙏`
                }];
              }

            }
          } else if (postbackData.startsWith('BUSY|')) {
            const [, missionIdRaw, personnelIdRaw] = postbackData.split('|');
            const missionId = Number.parseInt(missionIdRaw, 10);
            const personnelId = Number.parseInt(personnelIdRaw, 10);

            const assignment = await dbGet(
              `
              SELECT ma.*, p.name, m.mission_title
              FROM mission_assignments ma
              JOIN personnel p ON p.id = ma.personnel_id
              JOIN missions m ON m.id = ma.mission_id
              WHERE ma.mission_id = ?
                AND ma.personnel_id = ?
              ORDER BY ma.id DESC
              LIMIT 1;
              `,
              [missionId, personnelId]
            );

            if (!assignment) {
              replyMessages = [{
                type: 'text',
                text: '❌ ไม่พบข้อมูลการจัดสรรในระบบ กรุณาติดต่อเจ้าหน้าที่ค่ะ'
              }];
            } else {
              await dbRun(
                `
                UPDATE mission_assignments
                SET assignment_status = 'BUSY_PENDING'
                WHERE id = ?;
                `,
                [assignment.id]
              );

              replyMessages = [{
                type: 'flex',
                altText: '🔴 แจ้งติดภารกิจ / ขอลา',
                contents: {
                  type: 'bubble',
                  header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#dc2626',
                    paddingAll: '14px',
                    contents: [
                      { type: 'text', text: '🔴 แจ้งติดภารกิจ / ขอลา', color: '#ffffff', weight: 'bold', size: 'md' }
                    ]
                  },
                  body: {
                    type: 'box',
                    layout: 'vertical',
                    paddingAll: '16px',
                    spacing: 'md',
                    contents: [
                      { type: 'text', text: `กิจกรรม: ${assignment.mission_title || '-'}`, weight: 'bold', size: 'sm', wrap: true },
                      { type: 'text', text: `เรียน คุณ ${assignment.name}`, size: 'xs', color: '#64748b' },
                      { type: 'text', text: 'กรณีมีผู้ปฏิบัติงานแทน : กรุณาพิมพ์รหัสพนักงาน (เช่น EMP-025)\n\nกรณีไม่มีผู้ปฏิบัติงานแทน : กรุณากดปุ่มด้านล่างเพื่อให้ระบบเลื่อนคิวถัดไปให้อัตโนมัติ', size: 'xs', color: '#334155', wrap: true }
                    ]
                  },
                  footer: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      {
                        type: 'button',
                        style: 'secondary',
                        color: '#f1f5f9',
                        action: {
                          type: 'postback',
                          label: '🟡 ไม่มีคนแทน (ให้ระบบเลื่อนคิว)',
                          data: `NO_SUB|${missionId}|${personnelId}`,
                          displayText: '🟡 ไม่มีผู้ปฏิบัติงานแทน (ขอลา)'
                        }
                      }
                    ]
                  }
                }
              }];
            }
          } else if (postbackData.startsWith('NO_SUB|')) {
            const [, missionIdRaw, personnelIdRaw] = postbackData.split('|');
            const missionId = Number.parseInt(missionIdRaw, 10);
            const personnelId = Number.parseInt(personnelIdRaw, 10);

            const assignment = await dbGet(
              `
              SELECT ma.*, p.name, p.role_type, m.mission_title
              FROM mission_assignments ma
              JOIN personnel p ON p.id = ma.personnel_id
              JOIN missions m ON m.id = ma.mission_id
              WHERE ma.mission_id = ?
                AND ma.personnel_id = ?
                AND ma.assignment_status IN ('JOINED', 'BUSY_PENDING')
              ORDER BY ma.id DESC
              LIMIT 1;
              `,
              [missionId, personnelId]
            );

            if (!assignment) {
              replyMessages = [{
                type: 'text',
                text: '❌ ไม่พบข้อมูลการจัดสรรในระบบ กรุณาติดต่อเจ้าหน้าที่ค่ะ'
              }];
            } else {
              await dbRun(
                `UPDATE mission_assignments 
                 SET assignment_status = 'DECLINED_NO_SUBSTITUTE', 
                     ack_status = 'DECLINED_BUSY', 
                     decline_reason = 'ติดภารกิจ/ขอลา (ไม่มีคนแทน)', 
                     ack_at = CURRENT_TIMESTAMP 
                 WHERE id = ?;`,
                [assignment.id]
              );

              await dbRun(
                `UPDATE queue_members 
                 SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
                 WHERE personnel_id = ?;`,
                [personnelId]
              );

              const nextCandidate = await dbGet(
                `SELECT qm.personnel_id, p.id, p.emp_code, p.name, p.role_type, p.department, p.position, p.email, p.phone, p.line_user_id
                 FROM queue_members qm
                 JOIN personnel p ON p.id = qm.personnel_id
                 WHERE UPPER(qm.role_type) = UPPER(?)
                   AND qm.status IN ('WAITING', 'HOLD')
                   AND qm.personnel_id != ?
                 ORDER BY qm.current_round ASC, qm.queue_order ASC
                 LIMIT 1;`,
                [assignment.role_type, personnelId]
              );

              if (nextCandidate) {
                await dbRun(
                  `INSERT INTO mission_assignments 
                   (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes, ack_status)
                   VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?, 'PENDING_ACK');`,
                  [
                    missionId,
                    nextCandidate.id,
                    assignment.role_type,
                    assignment.assigned_round,
                    assignment.is_leader,
                    personnelId,
                    `จัดสรรแทน [${assignment.name} ที่ขอลา (ไม่มีคนแทน)]`
                  ]
                );

                await dbRun(
                  `UPDATE queue_members 
                   SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
                   WHERE personnel_id = ?;`,
                  [nextCandidate.id]
                );

                await checkAndAdvanceRound(assignment.role_type);

                const mission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [missionId]);
                if (mission) {
                  sendMissionNotification(
                    mission,
                    [{ ...nextCandidate, personnel_id: nextCandidate.id }],
                    true
                  ).catch(e => console.error('Notification dispatch error:', e));
                }

                const channelNotice = (nextCandidate.line_user_id && nextCandidate.line_user_id.toLowerCase() !== 'email')
                  ? 'LINE และ อีเมล'
                  : 'ทางอีเมล';

                replyMessages = [{
                  type: 'text',
                  text:
                    `🔴 บันทึกการติดภารกิจของคุณ ${assignment.name} เรียบร้อยแล้วค่ะ (ถือว่าใช้สิทธิ์ในรอบนี้แล้ว)\n\n` +
                    `👤 ระบบได้จัดสรรพนักงานลำดับถัดไปคือ คุณ ${nextCandidate.name} (${nextCandidate.emp_code}) ปฏิบัติงานแทนให้อัตโนมัติเรียบร้อยแล้วค่ะ\n\n` +
                    `📩 แจ้งเตือนผู้ปฏิบัติงานคนใหม่เรียบร้อยแล้ว (${channelNotice})`
                }];
              } else {
                await checkAndAdvanceRound(assignment.role_type);
                replyMessages = [{
                  type: 'text',
                  text:
                    `🔴 บันทึกการติดภารกิจของคุณ ${assignment.name} เรียบร้อยแล้วค่ะ (ถือว่าใช้สิทธิ์ในรอบนี้แล้ว)\n\n` +
                    `⚠️ ขณะนี้ไม่มีพนักงานคงเหลือในคิวเพื่อปฏิบัติงานแทน ระบบจึงลงประวัติขอลาไว้ให้เรียบร้อยค่ะ`
                }];
              }
            }
          }


          await replyLine(replyToken, replyMessages);
          continue;
        }

        // =============================================================
        // B. MESSAGE TEXT
        // =============================================================
        if (event.type === 'message' && event.message?.type === 'text') {
          const rawText = String(event.message.text || '').trim();
          const userMessage = rawText.toUpperCase();
          let messagesPayload = [];

          console.log(`[DEBUG] 💬 ได้รับข้อความจาก LINE: "${rawText}"`);

          // -----------------------------------------------------------
          // B1. CONFIRM ผูกบัญชี
          // -----------------------------------------------------------
          if (userMessage.startsWith('CONFIRM-')) {
            const targetEmpCode = userMessage
              .replace('CONFIRM-', '')
              .trim();

            const person = await dbGet(
              `
              SELECT *
              FROM personnel
              WHERE UPPER(TRIM(emp_code)) = ?;
              `,
              [targetEmpCode]
            );

            if (!person) {
              messagesPayload = [{
                type: 'text',
                text: '❌ ไม่พบข้อมูลรหัสรับคิวค่ะ'
              }];
            } else {
              const savedLineUserId = String(person.line_user_id || '').trim();
              const currentLineUserId = String(lineUserId || '').trim();

              if (savedLineUserId === currentLineUserId && savedLineUserId && savedLineUserId.toLowerCase() !== 'email') {
                messagesPayload = [{
                  type: 'text',
                  text:
                    `✅ บัญชี LINE นี้ผูกกับรหัส ${targetEmpCode} เรียบร้อยแล้วค่ะ\n\n` +
                    `👤 ${person.name}\n\n` +
                    'สามารถใช้งานระบบ FMO Smart Queue ได้ตามปกติค่ะ'
                }];
              } else if (savedLineUserId && savedLineUserId.toLowerCase() !== 'email') {
                messagesPayload = [{
                  type: 'text',
                  text:
                    `⚠️ รหัส ${targetEmpCode} ถูกผูกกับบัญชี LINE อื่นแล้วค่ะ\n\n` +
                    'หากต้องการเปลี่ยนบัญชี กรุณาติดต่อทีม IT'
                }];
              } else {
                const bindResult = await dbRun(
                  `
                  UPDATE personnel
                  SET line_user_id = ?
                  WHERE id = ?
                    AND (line_user_id IS NULL OR line_user_id = '' OR line_user_id = 'email');
                  `,
                  [currentLineUserId, person.id]
                );

                if (bindResult?.changes > 0) {
                  messagesPayload = [{
                    type: 'text',
                    text:
                      `🎉 ยืนยันการผูกบัญชีสำเร็จค่ะ\n\n` +
                      `👤 ${person.name}\n\n` +
                      'พร้อมรับการแจ้งเตือนคิวและภารกิจทาง LINE แล้วค่ะ'
                  }];
                } else {
                  messagesPayload = [{
                    type: 'text',
                    text: '⚠️ ไม่สามารถผูกบัญชีได้ กรุณาลองใหม่อีกครั้งค่ะ'
                  }];
                }
              }
            }
          }

          // -----------------------------------------------------------
          // B2. CANCEL PDPA
          // -----------------------------------------------------------
          else if (userMessage.startsWith('CANCEL-')) {
            const targetEmpCode = userMessage
              .replace('CANCEL-', '')
              .trim();

            const person = await dbGet(
              `
              SELECT *
              FROM personnel
              WHERE UPPER(TRIM(emp_code)) = ?;
              `,
              [targetEmpCode]
            );

            if (person) {
              await dbRun(
                `
                UPDATE personnel
                SET line_user_id = 'email'
                WHERE id = ?;
                `,
                [person.id]
              );

              messagesPayload = [{
                type: 'text',
                text:
                  `❌ ท่านปฏิเสธการผูกบัญชี LINE (PDPA)\n\n` +
                  `📧 ระบบได้บันทึกช่องทางรับการแจ้งเตือนทางอีเมลเรียบร้อยแล้วค่ะ\n\n` +
                  `👤 ${person.name} (${person.emp_code})\n` +
                  `📮 การแจ้งเตือนคิวและภารกิจจะถูกจัดส่งไปยัง:\n` +
                  `👉 ${person.email || 'อีเมลองค์กรของคุณ'}`
              }];
            } else {
              messagesPayload = [{
                type: 'text',
                text: '❌ ยกเลิกการทำรายการเรียบร้อยแล้วค่ะ'
              }];
            }
          }

          // -----------------------------------------------------------
          // B3. พิมพ์แจ้งติดภารกิจ
          // -----------------------------------------------------------
          else if (rawText.includes('แจ้งติดภารกิจ')) {
            const latestAssignment = await dbGet(
              `
              SELECT ma.*, p.name, m.mission_title
              FROM mission_assignments ma
              JOIN personnel p ON p.id = ma.personnel_id
              JOIN missions m ON m.id = ma.mission_id
              WHERE p.line_user_id = ?
                AND ma.assignment_status NOT IN ('SUBSTITUTED', 'REPLACED')
              ORDER BY ma.id DESC
              LIMIT 1;
              `,
              [lineUserId]
            );

            if (!latestAssignment) {
              messagesPayload = [{
                type: 'text',
                text: '❌ ไม่พบรายการกิจกรรมที่ต้องปฏิบัติในขณะนี้ค่ะ'
              }];
            } else {
              await dbRun(
                `
                UPDATE mission_assignments
                SET assignment_status = 'BUSY_PENDING'
                WHERE id = ?;
                `,
                [latestAssignment.id]
              );

              messagesPayload = [{
                type: 'text',
                text:
                  `🔴 รับทราบการติดภารกิจ (${latestAssignment.mission_title || '-'})\n\n` +
                  `คุณ ${latestAssignment.name} กรุณาพิมพ์รหัสพนักงาน ` +
                  '(เช่น EMP-025) ที่ต้องการให้ปฏิบัติงานแทนค่ะ'
              }];
            }
          }

          // -----------------------------------------------------------
          // B4. รหัส EMP-/DIR-
          // ถ้ามี BUSY_PENDING = ใช้เป็นตัวแทน
          // ถ้าไม่มี = ใช้ตรวจ/ผูกบัญชี LINE
          // -----------------------------------------------------------
          else if (/^(EMP|DIR)-\d+$/i.test(userMessage)) {
            const pendingAssignment = await dbGet(
              `
              SELECT
                ma.*,
                p.name AS original_name,
                p.emp_code AS original_emp_code,
                (
                  SELECT leader.name
                  FROM mission_assignments leader_ma
                  JOIN personnel leader
                    ON leader.id = leader_ma.personnel_id
                  WHERE leader_ma.mission_id = ma.mission_id
                    AND leader_ma.is_leader = 1
                  ORDER BY leader_ma.id ASC
                  LIMIT 1
                ) AS team_leader_name
              FROM mission_assignments ma
              JOIN personnel p ON p.id = ma.personnel_id
              WHERE ma.assignment_status = 'BUSY_PENDING'
                AND p.line_user_id = ?
              ORDER BY ma.id DESC
              LIMIT 1;
              `,
              [lineUserId]
            );

            if (pendingAssignment) {
              const substituteUser = await dbGet(
                `
                SELECT *
                FROM personnel
                WHERE UPPER(TRIM(emp_code)) = ?;
                `,
                [userMessage]
              );

              if (!substituteUser) {
                messagesPayload = [{
                  type: 'text',
                  text: `❌ ไม่พบรหัส ${userMessage}`
                }];
              } else if (Number(substituteUser.id) === Number(pendingAssignment.personnel_id)) {
                messagesPayload = [{
                  type: 'text',
                  text: '⚠️ ไม่สามารถเลือกตนเองเป็นผู้ปฏิบัติงานแทนได้ค่ะ'
                }];
              } else {
                await dbRun(
                  `
                  UPDATE mission_assignments
                  SET assignment_status = 'SUBSTITUTED',
                      ack_status = 'DECLINED_BUSY',
                      decline_reason = ?,
                      notes = ?,
                      substituted_for_personnel_id = ?,
                      ack_at = CURRENT_TIMESTAMP
                  WHERE id = ?;
                  `,
                  [
                    `ติดภารกิจ ส่งตัวแทน ${substituteUser.name} (${substituteUser.emp_code})`,
                    `ส่ง ${substituteUser.name} (${substituteUser.emp_code}) ปฏิบัติงานแทน`,
                    substituteUser.id,
                    pendingAssignment.id
                  ]
                );

                const duplicateReplacement = await dbGet(
                  `
                  SELECT id
                  FROM mission_assignments
                  WHERE mission_id = ?
                    AND personnel_id = ?
                    AND assignment_status = 'JOINED'
                  ORDER BY id DESC
                  LIMIT 1;
                  `,
                  [pendingAssignment.mission_id, substituteUser.id]
                );

                if (!duplicateReplacement) {
                  await dbRun(
                    `
                    INSERT INTO mission_assignments
                    (
                      mission_id,
                      personnel_id,
                      role_type,
                      assigned_round,
                      is_leader,
                      assignment_status,
                      substituted_for_personnel_id,
                      ack_status,
                      notes
                    )
                    VALUES (?, ?, ?, ?, ?, 'JOINED', ?, 'PENDING_ACK', ?);
                    `,
                    [
                      pendingAssignment.mission_id,
                      substituteUser.id,
                      pendingAssignment.role_type,
                      pendingAssignment.assigned_round,
                      pendingAssignment.is_leader,
                      pendingAssignment.personnel_id,
                      `ปฏิบัติงานแทน ${pendingAssignment.original_name} (${pendingAssignment.original_emp_code || '-'})`
                    ]
                  );
                }

                const mission = await dbGet(
                  `SELECT * FROM missions WHERE id = ?;`,
                  [pendingAssignment.mission_id]
                );

                let replacementLineSent = false;

                if (mission) {
                  const notificationResult = await sendMissionNotification(
                    mission,
                    [{
                      ...substituteUser,
                      personnel_id: substituteUser.id,
                      role_type: pendingAssignment.role_type,
                      is_leader: pendingAssignment.is_leader,
                      substitute_for_name: pendingAssignment.original_name || '-',
                      team_leader_name: pendingAssignment.team_leader_name || '-'
                    }],
                    true
                  );

                  replacementLineSent = notificationResult === true;
                }

                messagesPayload = [{
                  type: 'text',
                  text:
                    `✅ ระบบได้บันทึกให้\n\n` +
                    `${substituteUser.name}\n` +
                    `(${substituteUser.emp_code})\n\n` +
                    `ปฏิบัติงานแทน: ${pendingAssignment.original_name}\n\n` +
                    `เรียบร้อยแล้วค่ะ\n\n` +
                    (replacementLineSent
                      ? '📩 ส่ง LINE แจ้งเตือนไปยังผู้ปฏิบัติงานแทนแล้วค่ะ'
                      : '⚠️ บันทึกตัวแทนสำเร็จ แต่ส่ง LINE แจ้งเตือนไม่สำเร็จ กรุณาตรวจสอบ Log')
                }];
              }
            } else {
              const person = await dbGet(
                `
                SELECT *
                FROM personnel
                WHERE UPPER(TRIM(emp_code)) = ?;
                `,
                [userMessage]
              );

              if (!person) {
                messagesPayload = [{
                  type: 'text',
                  text: `❌ ไม่พบรหัสรับคิว "${userMessage}" ในระบบค่ะ`
                }];
              } else {
                const savedLineUserId = String(person.line_user_id || '').trim();
                const currentLineUserId = String(lineUserId || '').trim();

                if (savedLineUserId === currentLineUserId && savedLineUserId && savedLineUserId.toLowerCase() !== 'email') {
                  messagesPayload = [{
                    type: 'text',
                    text:
                      `✅ บัญชี LINE นี้ผูกกับรหัส ${userMessage} เรียบร้อยแล้วค่ะ\n\n` +
                      `👤 ${person.name}\n\n` +
                      'สามารถใช้งานระบบและรับการแจ้งเตือนได้ตามปกติค่ะ'
                  }];
                } else if (savedLineUserId && savedLineUserId.toLowerCase() !== 'email') {
                  messagesPayload = [{
                    type: 'text',
                    text:
                      `⚠️ รหัส ${userMessage} ถูกผูกกับบัญชี LINE อื่นแล้วค่ะ\n\n` +
                      'หากต้องการเปลี่ยนบัญชี กรุณาติดต่อทีม IT'
                  }];
                } else {
                  messagesPayload = [createPdpaCard(person, userMessage)];
                }
              }
            }
          }

          // -----------------------------------------------------------
          // B5. ข้อความอื่น
          // -----------------------------------------------------------
          else {
            messagesPayload = [{
              type: 'text',
              text:
                'ℹ️ หากต้องการผูกบัญชี LINE กรุณาพิมพ์รหัสพนักงาน ' +
                'เช่น EMP-025 ค่ะ'
            }];
          }

          await replyLine(replyToken, messagesPayload);
        }
      } catch (eventError) {
        console.error(
          '❌ Event processing error:',
          eventError.response?.data || eventError.message || eventError
        );
      }
    }
  } catch (webhookError) {
    console.error(
      '❌ Webhook Error:',
      webhookError.response?.data || webhookError.message || webhookError
    );
  }
});

// -------------------------------------------------------------
// 3. PREVIEW CANDIDATES
// -------------------------------------------------------------
router.post('/missions/preview-candidates', async (req, res) => {
  try {
    const {
      required_directors = 1,
      required_staff = 1
    } = req.body;

    const directorCount = Math.max(
      0,
      Number.parseInt(required_directors, 10) || 0
    );

    const staffCount = Math.max(
      0,
      Number.parseInt(required_staff, 10) || 0
    );

    //----------------------------------------------------------
    // ตรวจว่าคิวเดิมครบรอบหรือยัง
    // ถ้าครบ ระบบจะเริ่มรอบใหม่ก่อนเลือกผู้สมัคร
    //----------------------------------------------------------
    await checkAndAdvanceRound('DIRECTOR');
    await checkAndAdvanceRound('STAFF');

    //----------------------------------------------------------
    // อ่านรอบปัจจุบัน
    //----------------------------------------------------------
    const directorState = await dbGet(`
      SELECT current_round
      FROM queue_state
      WHERE role_type = 'DIRECTOR';
    `);

    const staffState = await dbGet(`
      SELECT current_round
      FROM queue_state
      WHERE role_type = 'STAFF';
    `);

    const currentDirectorRound =
      directorState?.current_round || 1;

    const currentStaffRound =
      staffState?.current_round || 1;

    //----------------------------------------------------------
    // เลือก ผอ.ฝ่าย
    //
    // - เลือกเฉพาะ WAITING
    // - เฉพาะรอบปัจจุบัน
    // - ไม่เลือก DIR-09 และ DIR-10
    // - เรียงตามลำดับ DIR-01 → DIR-08
    //----------------------------------------------------------
    let directors = [];

      if (directorCount > 0) {
        directors = await dbAll(
          `
          SELECT
            qm.personnel_id,
            qm.role_type,
            qm.current_round,
            qm.queue_order,
            qm.status AS queue_status,
            p.emp_code,
            p.name,
            p.department,
            p.position,
            p.email,
            p.phone
          FROM queue_members qm
          JOIN personnel p
            ON p.id = qm.personnel_id
          WHERE UPPER(qm.role_type) = 'DIRECTOR'
            AND qm.current_round = ?
            AND qm.status = 'WAITING'

            -- ระบบอัตโนมัติใช้เฉพาะ DIR-01 ถึง DIR-08
            AND CAST(
              REPLACE(UPPER(TRIM(p.emp_code)), 'DIR-', '')
              AS INTEGER
            ) BETWEEN 1 AND 8

          ORDER BY
            CAST(
              REPLACE(UPPER(TRIM(p.emp_code)), 'DIR-', '')
              AS INTEGER
            ) ASC
          LIMIT ?;
          `,
          [
            currentDirectorRound,
            directorCount
          ]
        );
      }

    //----------------------------------------------------------
// เลือกพนักงานแบบผสม
//
// 1. เลือกจากหัวคิวปัจจุบัน 2 คน
// 2. เลือกจากท้ายคิวให้ครบจำนวนที่ระบุ
// 3. ไม่ให้ personnel_id ซ้ำกัน
//----------------------------------------------------------
let staff = [];

if (staffCount > 0) {
  // จำนวนที่เลือกจากหัวคิว
  const frontCount = Math.min(
    2,
    staffCount
  );

  // จำนวนที่ต้องเลือกเพิ่มจากท้ายคิว
  const backCount = Math.max(
    0,
    staffCount - frontCount
  );

  //--------------------------------------------------------
  // 1. ดึงจากหัวคิว 2 คนแรก
  //--------------------------------------------------------
  const frontStaff = await dbAll(
    `
    SELECT
      qm.personnel_id,
      qm.role_type,
      qm.current_round,
      qm.queue_order,
      qm.status AS queue_status,
      p.emp_code,
      p.name,
      p.department,
      p.position,
      p.email,
      p.phone
    FROM queue_members qm
    JOIN personnel p
      ON p.id = qm.personnel_id
    WHERE UPPER(qm.role_type) = 'STAFF'
      AND qm.current_round = ?
      AND qm.status = 'WAITING'
    ORDER BY
      qm.queue_order ASC,
      qm.personnel_id ASC
    LIMIT ?;
    `,
    [
      currentStaffRound,
      frontCount
    ]
  );

  //--------------------------------------------------------
  // 2. ดึงจากท้ายคิว
  //
  // ต้องไม่ซ้ำกับคนที่เลือกจากหัวคิวแล้ว
  //--------------------------------------------------------
  let backStaff = [];

  if (backCount > 0) {
    const frontIds = frontStaff.map(
      person => person.personnel_id
    );

    let excludeSql = '';
    const backParams = [
      currentStaffRound
    ];

    if (frontIds.length > 0) {
      const placeholders = frontIds
        .map(() => '?')
        .join(',');

      excludeSql = `
        AND qm.personnel_id
            NOT IN (${placeholders})
      `;

      backParams.push(...frontIds);
    }

    backParams.push(backCount);

    backStaff = await dbAll(
      `
      SELECT
        qm.personnel_id,
        qm.role_type,
        qm.current_round,
        qm.queue_order,
        qm.status AS queue_status,
        p.emp_code,
        p.name,
        p.department,
        p.position,
        p.email,
        p.phone
      FROM queue_members qm
      JOIN personnel p
        ON p.id = qm.personnel_id
      WHERE UPPER(qm.role_type) = 'STAFF'
        AND qm.current_round = ?
        AND qm.status = 'WAITING'
        ${excludeSql}
      ORDER BY
        qm.queue_order DESC,
        qm.personnel_id DESC
      LIMIT ?;
      `,
      backParams
    );
  }

  //--------------------------------------------------------
  // 3. รวมตามลำดับที่ต้องการ
  //
  // หัวคิวก่อน แล้วตามด้วยท้ายคิว
  //--------------------------------------------------------
  staff = [
    ...frontStaff,
    ...backStaff
  ];

  console.log(
    '👥 STAFF จากหัวคิว:',
    frontStaff.map(person =>
      person.emp_code
    )
  );

  console.log(
    '🔚 STAFF จากท้ายคิว:',
    backStaff.map(person =>
      person.emp_code
    )
  );

  console.log(
    '✅ STAFF ที่จัดสรรทั้งหมด:',
    staff.map(person =>
      person.emp_code
    )
  );
}

   res.json({
  success: true,
  data: {
    directors,
    staff
  }
});

  } catch (err) {
    console.error('Preview Candidates Error:', err);

    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: err.message
    });
  }
});

// -------------------------------------------------------------
// 4. CREATE MISSION & CONFIRM ASSIGNMENTS
// -------------------------------------------------------------
/*router.post('/missions/create', async (req, res) => {
  try {
    const {
      mission_title,
      description,
      location,
      dress_code,
      start_date,
      end_date,
      required_directors,
      required_staff,
      assigned_director_ids = [],
      assigned_staff_ids = [],
      skipped_personnel = []
    } = req.body;

    if (!mission_title || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อกิจกรรม วันที่เริ่มต้น และวันที่สิ้นสุด' });
    }

    // 1. Process Skipped Personnel (Set status to HOLD / Hold_In_Round)
    for (const skipItem of skipped_personnel) {
      if (skipItem.personnel_id) {
        await dbRun(
          `UPDATE queue_members 
           SET status = 'HOLD', hold_reason = ?, hold_timestamp = CURRENT_TIMESTAMP 
           WHERE personnel_id = ?;`,
          [skipItem.reason || 'ติดกิจกรรมซ้อน (Hold_In_Round)', skipItem.personnel_id]
        );
      }
    }

    // -------------------------------------------------------------
    // สร้างรหัสกิจกรรมอัตโนมัติ (เช่น FMO-AT0769-001)
    // -------------------------------------------------------------
    const newMissionCode = await generateMissionCode();

    // 2. Insert Mission Record (เพิ่ม mission_code เข้าไปในฐานข้อมูล)
    const mRes = await dbRun(
      `INSERT INTO missions (mission_code, mission_title, description, location, dress_code, start_date, end_date, required_directors, required_staff, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED');`,
      [
        newMissionCode,  // <--- แทรกตัวแปรรหัสกิจกรรมตรงนี้
        mission_title,
        description || '',
        location || '',
        dress_code || 'ชุดสุภาพ / ชุดปฏิบัติงาน อสป.',
        start_date,
        end_date,
        required_directors || assigned_director_ids.length,
        required_staff || assigned_staff_ids.length
      ]
    );
    const missionId = mRes.lastID;

    // 3. Assign Directors
    const dirState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'DIRECTOR';`);
    const currentDirRound = dirState ? dirState.current_round : 1;

    for (const pId of assigned_director_ids) {
      await dbRun(
        `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, ack_status)
         VALUES (?, ?, 'DIRECTOR', ?, 1, 'JOINED', 'PENDING_ACK');`,
        [missionId, pId, currentDirRound]
      );

      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [pId]
      );
    }

    // 4. Assign Staff
    const staffState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'STAFF';`);
    const currentStaffRound = staffState ? staffState.current_round : 1;

    for (const pId of assigned_staff_ids) {
      await dbRun(
        `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, ack_status)
         VALUES (?, ?, 'STAFF', ?, 0, 'JOINED', 'PENDING_ACK');`,
        [missionId, pId, currentStaffRound]
      );

      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [pId]
      );
    }

    // 5. ส่งแจ้งเตือน LINE & Email ให้คิวที่ถูกจัดสรร
    try {
      const allAssignedIds = [...assigned_director_ids, ...assigned_staff_ids];
      if (allAssignedIds.length > 0) {
        // ดึงข้อมูล personnel ของทุกคนที่ถูกจัดสรร
        const placeholders = allAssignedIds.map(() => '?').join(',');
        const assignedPersonnel = await dbAll(
          `SELECT p.*, qm.status as queue_status
           FROM personnel p
           LEFT JOIN queue_members qm ON p.id = qm.personnel_id
           WHERE p.id IN (${placeholders});`,
          allAssignedIds
        );

        // สร้าง assignedList พร้อม role_type และ is_leader
        const assignedList = assignedPersonnel.map(p => ({
          ...p,
          personnel_id: p.id,
          role_type: assigned_director_ids.includes(p.id) ? 'DIRECTOR' : 'STAFF',
          is_leader: assigned_director_ids.includes(p.id) ? 1 : 0
        }));

        const missionData = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [missionId]);
        if (missionData) {
          sendMissionNotification(missionData, assignedList, false)
            .catch(e => console.error('❌ Notification dispatch error (create mission):', e));
          console.log(`📢 ส่งแจ้งเตือนกิจกรรม "${mission_title}" ให้ ${assignedList.length} คน (LINE + Email)`);
        }
      }
    } catch (notifErr) {
      console.error('❌ เกิดข้อผิดพลาดตอนส่งแจ้งเตือน:', notifErr);
      // ไม่ block response ถ้า notification ล้มเหลว
    }

    res.json({
      success: true,
      message: `สร้างกิจกรรม "${mission_title}" สำเร็จ! ส่งแจ้งเตือน LINE & Email ให้ผู้ที่ถูกจัดสรรแล้ว`,
      mission_id: missionId,
      mission_code: newMissionCode
    });

  } catch (error) {
    console.error('Error creating mission:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการสร้างกิจกรรม' });
  }
});*/
// -------------------------------------------------------------
// 4. CREATE MISSION & CONFIRM ASSIGNMENTS
// -------------------------------------------------------------
router.post('/missions/create', async (req, res) => {
  try {
    const {
      mission_title,
      description,
      location,
      dress_code,
      start_date,
      end_date,
      required_directors,
      required_staff,
      assigned_director_ids = [],
      assigned_staff_ids = [],
      skipped_personnel = []
    } = req.body;

    //----------------------------------------------------------
    // ปรับ ID ให้เป็นตัวเลขทั้งหมด
    //----------------------------------------------------------
    const directorIds = assigned_director_ids
      .map(id => Number(id))
      .filter(Number.isInteger);

    const staffIds = assigned_staff_ids
      .map(id => Number(id))
      .filter(Number.isInteger);

    if (!mission_title || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error:
          'กรุณากรอกชื่อกิจกรรม วันที่เริ่มต้น และวันที่สิ้นสุด'
      });
    }

    //----------------------------------------------------------
    // 1. พักผู้ที่ถูกข้าม
    //
    // HOLD จะไม่ถูกเลือกซ้ำในรอบปัจจุบัน
    // เมื่อระบบขึ้นรอบใหม่ จึงกลับเป็น WAITING
    //----------------------------------------------------------
    for (const skipItem of skipped_personnel) {
      const personnelId = Number(skipItem.personnel_id);

      if (!Number.isInteger(personnelId)) {
        continue;
      }

      await dbRun(
        `
        UPDATE queue_members
        SET
          status = 'HOLD',
          hold_reason = ?,
          hold_timestamp = CURRENT_TIMESTAMP
        WHERE personnel_id = ?;
        `,
        [
          skipItem.reason ||
            'ติดกิจกรรมซ้อน (Hold_In_Round)',
          personnelId
        ]
      );
    }

    //----------------------------------------------------------
    // 2. สร้างรหัสกิจกรรม
    //----------------------------------------------------------
    const newMissionCode = await generateMissionCode();

    //----------------------------------------------------------
    // 3. บันทึกกิจกรรม
    //----------------------------------------------------------
    const missionResult = await dbRun(
      `
      INSERT INTO missions
      (
        mission_code,
        mission_title,
        description,
        location,
        dress_code,
        start_date,
        end_date,
        required_directors,
        required_staff,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED');
      `,
      [
        newMissionCode,
        mission_title,
        description || '',
        location || '',
        dress_code ||
          'ชุดสุภาพ / ชุดปฏิบัติงาน อสป.',
        start_date,
        end_date,
        Number(required_directors) || directorIds.length,
        Number(required_staff) || staffIds.length
      ]
    );

    const missionId = missionResult.lastID;

    //----------------------------------------------------------
    // อ่านรอบปัจจุบัน
    //----------------------------------------------------------
    const directorState = await dbGet(`
      SELECT current_round
      FROM queue_state
      WHERE role_type = 'DIRECTOR';
    `);

    const staffState = await dbGet(`
      SELECT current_round
      FROM queue_state
      WHERE role_type = 'STAFF';
    `);

    const currentDirectorRound =
      directorState?.current_round || 1;

    const currentStaffRound =
      staffState?.current_round || 1;

    //----------------------------------------------------------
    // 4. บันทึก ผอ.ฝ่าย
    //----------------------------------------------------------
    for (const personnelId of directorIds) {
      //--------------------------------------------------------
      // ป้องกัน DIR-09 และ DIR-10 ถูกจัดอัตโนมัติ
      //--------------------------------------------------------
      const director = await dbGet(
        `
        SELECT id, emp_code, name
        FROM personnel
        WHERE id = ?;
        `,
        [personnelId]
      );

      if (!director) {
        console.warn(
          `⚠️ ไม่พบข้อมูล DIRECTOR personnel_id=${personnelId}`
        );
        continue;
      }

      await dbRun(
        `
        INSERT INTO mission_assignments
        (
          mission_id,
          personnel_id,
          role_type,
          assigned_round,
          is_leader,
          assignment_status,
          ack_status
        )
        VALUES
        (
          ?, ?, 'DIRECTOR', ?, 1,
          'JOINED',
          'PENDING_ACK'
        );
        `,
        [
          missionId,
          personnelId,
          currentDirectorRound
        ]
      );

      //--------------------------------------------------------
      // เปลี่ยนเป็น COMPLETED
      // ทำให้ไม่ถูกเลือกซ้ำในรอบเดิม
      //--------------------------------------------------------
      await dbRun(
        `
        UPDATE queue_members
        SET
          status = 'COMPLETED',
          hold_reason = NULL,
          hold_timestamp = NULL,
          last_assigned_at = CURRENT_TIMESTAMP
        WHERE personnel_id = ?
          AND UPPER(role_type) = 'DIRECTOR'
          AND current_round = ?;
        `,
        [
          personnelId,
          currentDirectorRound
        ]
      );
    }

    //----------------------------------------------------------
    // 5. บันทึกพนักงาน
    //----------------------------------------------------------
    for (const personnelId of staffIds) {
      //--------------------------------------------------------
      // ตรวจว่ายังเป็น WAITING จริง
      // ป้องกันการส่ง ID ซ้ำหรือเลือกซ้ำจากหน้าจอเก่า
      //--------------------------------------------------------
      const queueMember = await dbGet(
        `
        SELECT id, status, current_round
        FROM queue_members
        WHERE personnel_id = ?
          AND UPPER(role_type) = 'STAFF'
          AND current_round = ?;
        `,
        [
          personnelId,
          currentStaffRound
        ]
      );

      if (!queueMember) {
        console.warn(
          `⚠️ ไม่พบ STAFF personnel_id=${personnelId} ` +
          `ในรอบ ${currentStaffRound}`
        );
        continue;
      }

      if (queueMember.status !== 'WAITING') {
        console.warn(
          `⏭️ ข้าม STAFF personnel_id=${personnelId} ` +
          `เพราะสถานะเป็น ${queueMember.status}`
        );
        continue;
      }

      await dbRun(
        `
        INSERT INTO mission_assignments
        (
          mission_id,
          personnel_id,
          role_type,
          assigned_round,
          is_leader,
          assignment_status,
          ack_status
        )
        VALUES
        (
          ?, ?, 'STAFF', ?, 0,
          'JOINED',
          'PENDING_ACK'
        );
        `,
        [
          missionId,
          personnelId,
          currentStaffRound
        ]
      );

      //--------------------------------------------------------
      // เปลี่ยนเป็น COMPLETED
      // พนักงานคนนี้จะไม่ถูกสุ่มซ้ำในรอบเดิม
      //--------------------------------------------------------
      await dbRun(
        `
        UPDATE queue_members
        SET
          status = 'COMPLETED',
          hold_reason = NULL,
          hold_timestamp = NULL,
          last_assigned_at = CURRENT_TIMESTAMP
        WHERE id = ?;
        `,
        [queueMember.id]
      );
    }

    //----------------------------------------------------------
    // 6. ตรวจว่าครบรอบหลังบันทึกหรือยัง
    //
    // ถ้าครบ:
    // DIRECTOR → รอบใหม่เริ่ม DIR-01
    // STAFF    → รอบใหม่สุ่ม queue_order ใหม่ทั้งหมด
    //----------------------------------------------------------
    const directorRoundResult =
      await checkAndAdvanceRound('DIRECTOR');

    const staffRoundResult =
      await checkAndAdvanceRound('STAFF');

    if (directorRoundResult.roundAdvanced) {
      console.log(
        `🔁 DIRECTOR ขึ้นรอบใหม่ ` +
        `${directorRoundResult.newRound}`
      );
    }

    if (staffRoundResult.roundAdvanced) {
      console.log(
        `🎲 STAFF ขึ้นรอบใหม่และสุ่มใหม่ รอบ ` +
        `${staffRoundResult.newRound}`
      );
    }

    //----------------------------------------------------------
    // 7. ส่ง LINE และ Email
    //
    // ใช้เฉพาะคนที่บันทึก Assignment สำเร็จจริง
    //----------------------------------------------------------
    try {
      const insertedAssignments = await dbAll(
        `
        SELECT
          ma.personnel_id,
          ma.role_type,
          ma.is_leader
        FROM mission_assignments ma
        WHERE ma.mission_id = ?;
        `,
        [missionId]
      );

      const allAssignedIds = insertedAssignments.map(
        item => item.personnel_id
      );

      if (allAssignedIds.length > 0) {
        const placeholders = allAssignedIds
          .map(() => '?')
          .join(',');

        const assignedPersonnel = await dbAll(
          `
          SELECT p.*
          FROM personnel p
          WHERE p.id IN (${placeholders});
          `,
          allAssignedIds
        );

        const assignmentMap = new Map(
          insertedAssignments.map(item => [
            Number(item.personnel_id),
            item
          ])
        );

        const assignedList = assignedPersonnel.map(person => {
          const assignment =
            assignmentMap.get(Number(person.id));

          return {
            ...person,
            personnel_id: person.id,
            role_type:
              assignment?.role_type || 'STAFF',
            is_leader:
              assignment?.is_leader || 0
          };
        });

        const missionData = await dbGet(
          `
          SELECT *
          FROM missions
          WHERE id = ?;
          `,
          [missionId]
        );

        if (missionData) {
          sendMissionNotification(
            missionData,
            assignedList,
            false
          ).catch(error => {
            console.error(
              '❌ Notification dispatch error:',
              error
            );
          });

          console.log(
            `📢 ส่งแจ้งเตือนกิจกรรม "${mission_title}" ` +
            `ให้ ${assignedList.length} คน`
          );
        }
      }
    } catch (notificationError) {
      console.error(
        '❌ เกิดข้อผิดพลาดตอนส่งแจ้งเตือน:',
        notificationError
      );
    }

    res.json({
      success: true,
      message:
        `สร้างกิจกรรม "${mission_title}" สำเร็จ! ` +
        `ส่งแจ้งเตือนให้ผู้ที่ถูกจัดสรรแล้ว`,
      mission_id: missionId,
      mission_code: newMissionCode,
      round_status: {
        director: directorRoundResult,
        staff: staffRoundResult
      }
    });
  } catch (error) {
    console.error('Error creating mission:', error);

    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการสร้างกิจกรรม',
      details: error.message
    });
  }
});
// -------------------------------------------------------------
// 5. EMERGENCY SUBSTITUTION (การเปลี่ยนตัวกะทันหัน)
// -------------------------------------------------------------
/* router.post('/missions/substitute', async (req, res) => {
  try {
    const { mission_id, original_personnel_id, reason } = req.body;

    if (!mission_id || !original_personnel_id) {
      return res.status(400).json({ success: false, error: 'mission_id and original_personnel_id are required' });
    }

    const origPerson = await dbGet(`SELECT * FROM personnel WHERE id = ?;`, [original_personnel_id]);
    if (!origPerson) return res.status(404).json({ success: false, error: 'ไม่พบบุคลากรเดิม' });

    const roleType = origPerson.role_type;

    const substitute = await dbGet(
      `SELECT qm.*, p.name, p.emp_code 
       FROM queue_members qm
       JOIN personnel p ON qm.personnel_id = p.id
       WHERE qm.role_type = ? AND qm.status IN ('HOLD', 'WAITING') AND qm.personnel_id != ?
       ORDER BY CASE qm.status WHEN 'HOLD' THEN 1 WHEN 'WAITING' THEN 2 END, qm.queue_order ASC
       LIMIT 1;`,
      [roleType, original_personnel_id]
    );

    if (!substitute) {
      return res.status(400).json({ success: false, error: 'ไม่พบบุคลากรสำรองในคิวที่สามารถปฏิบัติงานแทนได้' });
    }

    await dbRun(
      `UPDATE mission_assignments 
       SET assignment_status = 'SUBSTITUTED', notes = ?
       WHERE mission_id = ? AND personnel_id = ?;`,
      [`เปลี่ยนตัวเนื่องจาก: ${reason || 'ลาป่วย/ลากิจ'}`, mission_id, original_personnel_id]
    );

    await dbRun(
      `UPDATE queue_members 
       SET status = 'HOLD', hold_reason = ?, hold_timestamp = CURRENT_TIMESTAMP 
       WHERE personnel_id = ?;`,
      [`เปลี่ยนตัวในกิจกรรม #${mission_id} (${reason || 'ลาป่วย/ลากิจ'})`, original_personnel_id]
    );

    const state = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = ?;`, [roleType]);
    const currentRound = state ? state.current_round : 1;

    await dbRun(
      `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes)
       VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?);`,
      [
        mission_id,
        substitute.personnel_id,
        roleType,
        currentRound,
        roleType === 'DIRECTOR' ? 1 : 0,
        original_personnel_id,
        `ปฏิบัติงานแทน ${origPerson.name} (${origPerson.emp_code})`
      ]
    );

    await dbRun(
      `UPDATE queue_members 
       SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
       WHERE personnel_id = ?;`,
      [substitute.personnel_id]
    );

    // 🚀 เพิ่มส่วนส่งแจ้งเตือน LINE / Email ไปยังพนักงานตัวแทนที่ถูกเลือกโดยอัตโนมัติ
    try {
      const missionData = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [mission_id]);
      const substitutePerson = await dbGet(`SELECT * FROM personnel WHERE id = ?;`, [substitute.personnel_id]);
      await dbRun(
      `UPDATE queue_members 
       SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
       WHERE personnel_id = ?;`,
      [substitute.personnel_id]
    );

    // ==========================================
    // 📌 นำโค้ด DEBUG แจ้งเตือนมาวางแทรกไว้ตรงนี้ครับ!
    // ==========================================
    try {
      const missionData = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [mission_id]);
      const substitutePerson = await dbGet(`SELECT * FROM personnel WHERE id = ?;`, [substitute.personnel_id]);
      
      console.log("🔍 [DEBUG] missionData:", missionData);
      console.log("🔍 [DEBUG] substitutePerson:", substitutePerson);

      if (missionData && substitutePerson) {
        console.log("🟢 [DEBUG] กำลังสั่งยิง sendMissionNotification...");
        await sendMissionNotification(missionData, [substitutePerson], true);
        console.log("✅ [DEBUG] ส่งแจ้งเตือน LINE สำเร็จเรียบร้อย!");
      } else {
        console.log("⚠️ [DEBUG] ข้อมูล missionData หรือ substitutePerson ไม่ครบถ้วน");
      }
    } catch (notifErr) {
      console.error('❌ [DEBUG] Error catching notification:', notifErr);
    }
    // ==========================================

    // จากนั้นจะเป็นคำสั่ง res.json เดิมที่มีอยู่แล้ว
    res.json({
      success: true,
      message: `เปลี่ยนตัวเรียบร้อยแล้ว: ${substitute.name} ได้รับจัดสรรปฏิบัติงานแทน ${origPerson.name}`,
      substitute: {
        id: substitute.personnel_id,
        name: substitute.name,
        emp_code: substitute.emp_code
      }
    });
      if (missionData && substitutePerson) {
        // ส่งแจ้งเตือนแบบระบุตัวแทน (isReallocation = true เพื่อขึ้นหัวข้อสีส้มเตือนด่วน)
        await sendMissionNotification(missionData, [substitutePerson], true);
      }
    } catch (notifErr) {
      console.error('Error sending substitution notification:', notifErr);
      // ป้องกันไม่ให้ข้อผิดพลาดจากการส่งแจ้งเตือนมาขัดขวางการตอบกลับหลักของ API
    }

    res.json({
      success: true,
      message: `เปลี่ยนตัวเรียบร้อยแล้ว: ${substitute.name} ได้รับจัดสรรปฏิบัติงานแทน ${origPerson.name}`,
      substitute: {
        id: substitute.personnel_id,
        name: substitute.name,
        emp_code: substitute.emp_code
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});*/

// -------------------------------------------------------------
// 6. SKIP & UNHOLD QUEUE CONTROLS
// -------------------------------------------------------------
router.post('/queue/skip', async (req, res) => {
  try {
    const { personnel_id, reason } = req.body;
    if (!personnel_id) return res.status(400).json({ success: false, error: 'personnel_id is required' });

    await dbRun(
      `UPDATE queue_members 
       SET status = 'HOLD', hold_reason = ?, hold_timestamp = CURRENT_TIMESTAMP 
       WHERE personnel_id = ?;`,
      [reason || 'ติดกิจกรรมซ้อน (Hold_In_Round)', personnel_id]
    );

    res.json({ success: true, message: 'บันทึกสถานะ Hold_In_Round เรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue/unhold', async (req, res) => {
  try {
    const { personnel_id } = req.body;
    if (!personnel_id) return res.status(400).json({ success: false, error: 'personnel_id is required' });

    await dbRun(
      `UPDATE queue_members 
       SET status = 'WAITING', hold_reason = NULL, hold_timestamp = NULL 
       WHERE personnel_id = ?;`,
      [personnel_id]
    );

    res.json({ success: true, message: 'ยกเลิกสถานะ Hold คืนสิทธิ์เข้าคิวปกติเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 7. INDIVIDUAL HISTORY VIEW (หน้าประวัติย้อนหลังรายบุคคล)
// -------------------------------------------------------------
router.get('/history/individual/:id', async (req, res) => {
  try {
    const personId = req.params.id;

    const person = await dbGet(`SELECT * FROM personnel WHERE id = ?;`, [personId]);
    if (!person) return res.status(404).json({ success: false, error: 'ไม่พบบุคลากร' });

    const queueStatus = await dbGet(`SELECT * FROM queue_members WHERE personnel_id = ?;`, [personId]);

    const history = await dbAll(
      `SELECT 
        ma.id as assignment_id,
        ma.assigned_round,
        ma.is_leader,
        ma.assignment_status,
        ma.notes,
        ma.assigned_at,
        m.id as mission_id,
        m.mission_title,
        m.description as mission_description,
        m.location,
        m.dress_code,
        m.start_date,
        m.end_date,
        m.status as mission_status
       FROM mission_assignments ma
       JOIN missions m ON ma.mission_id = m.id
       WHERE ma.personnel_id = ?
       ORDER BY ma.assigned_round ASC, m.start_date DESC;`,
      [personId]
    );

    let totalJoined = 0;
    let totalHours = 0;
    let absentOrSubstituted = 0;

    history.forEach(h => {
      let dur = 8;
      if (h.start_date && h.end_date) {
        const s = new Date(h.start_date);
        const e = new Date(h.end_date);
        const diffMs = e.getTime() - s.getTime();
        if (diffMs > 0) dur = Math.round((diffMs / 3600000) * 10) / 10;
      }
      h.duration_hours = dur;

      if (h.assignment_status === 'JOINED') {
        totalJoined++;
        totalHours += dur;
      } else if (h.assignment_status === 'SUBSTITUTED') {
        absentOrSubstituted++;
      }
    });

    for (const h of history) {
      if (person.role_type === 'STAFF') {
        const leader = await dbGet(
          `SELECT p.name, p.position 
           FROM mission_assignments ma
           JOIN personnel p ON ma.personnel_id = p.id
           WHERE ma.mission_id = ? AND ma.is_leader = 1
           LIMIT 1;`,
          [h.mission_id]
        );
        if (leader) {
          h.director_leader_name = leader.name;
          h.director_leader_position = leader.position;
        }
      }
    }

    const historyByRound = {};
    history.forEach(h => {
      const r = h.assigned_round || 1;
      if (!historyByRound[r]) historyByRound[r] = [];
      historyByRound[r].push(h);
    });

    const activeRound = queueStatus ? queueStatus.current_round : 1;

    res.json({
      success: true,
      person,
      queueStatus,
      summary: {
        totalJoined,
        totalHours: Math.round(totalHours * 10) / 10,
        absentOrSubstituted,
        attendanceNote: absentOrSubstituted === 0 ? 'ไม่เคยขาด/ลา' : `ลา/เปลี่ยนตัว ${absentOrSubstituted} ครั้ง`
      },
      activeRound,
      historyByRound,
      history
    });
  } catch (err) {
    console.error('❌ Individual history error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function checkAndUpdateMissionStatus(missionId) {
  if (!missionId) return;

  try {
    const pendingRow = await dbGet(
      `SELECT COUNT(*) AS pending_count 
       FROM mission_assignments 
       WHERE mission_id = ? 
         AND assignment_status = 'JOINED' 
         AND (ack_status IS NULL OR ack_status != 'ACKNOWLEDGED');`,
      [missionId]
    );

    const totalRow = await dbGet(
      `SELECT COUNT(*) AS total_count 
       FROM mission_assignments 
       WHERE mission_id = ? 
         AND assignment_status = 'JOINED';`,
      [missionId]
    );

    const pendingCount = pendingRow ? Number(pendingRow.pending_count) : 0;
    const totalCount = totalRow ? Number(totalRow.total_count) : 0;

    if (totalCount > 0 && pendingCount === 0) {
      await dbRun(`UPDATE missions SET status = 'SUCCESS' WHERE id = ?;`, [missionId]);
      console.log(`🎉 อัปเดตสถานะกิจกรรม #${missionId} เป็น SUCCESS (ทุกคนปฏิบัติ/ตอบรับเสร็จสิ้นแล้ว)`);
    } else {
      await dbRun(`UPDATE missions SET status = 'SCHEDULED' WHERE id = ?;`, [missionId]);
    }
  } catch (err) {
    console.error('Error checking mission status:', err);
  }
}

// -------------------------------------------------------------
// 8. ALL MISSIONS & PERSONNEL LISTS
// -------------------------------------------------------------
router.get('/missions', async (req, res) => {
  try {
    const allMissions = await dbAll(`SELECT id FROM missions;`);
    for (const m of allMissions) {
      await checkAndUpdateMissionStatus(m.id);
    }

    const missions = await dbAll(
      `SELECT 
        m.*,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.role_type = 'DIRECTOR' AND ma.assignment_status = 'JOINED') as directors_count,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.role_type = 'STAFF' AND ma.assignment_status = 'JOINED') as staff_count
       FROM missions m
       ORDER BY m.start_date DESC;`
    );

    res.json({ success: true, missions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


router.get('/missions/:id', async (req, res) => {
  try {
    const mission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [req.params.id]);
    if (!mission) return res.status(404).json({ success: false, error: 'ไม่พบกิจกรรม' });

    const assigned = await dbAll(
      `SELECT 
        ma.id as assignment_id,
        ma.assigned_round,
        ma.is_leader,
        ma.assignment_status,
        ma.ack_status,
        ma.ack_at,
        ma.decline_reason,
        ma.notes,
        ma.assigned_at,
        p.id as personnel_id,
        p.emp_code,
        p.name,
        p.role_type,
        p.department,
        p.position,
        p.phone
       FROM mission_assignments ma
       JOIN personnel p ON ma.personnel_id = p.id
       WHERE ma.mission_id = ?
       ORDER BY ma.is_leader DESC, p.name ASC;`,
      [req.params.id]
    );

    res.json({ success: true, mission, assigned });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/personnel', async (req, res) => {
  try {
    const { search = '', role = '', department = '' } = req.query;

    let query = `
      SELECT 
        p.*,
        qm.current_round,
        qm.queue_order,
        qm.status as queue_status,
        qm.hold_reason,
        qm.hold_timestamp,
        qm.last_assigned_at,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.personnel_id = p.id AND ma.assignment_status = 'JOINED') as total_missions_joined
      FROM personnel p
      LEFT JOIN queue_members qm ON p.id = qm.personnel_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.name LIKE ? OR p.emp_code LIKE ? OR p.position LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      query += ` AND p.role_type = ?`;
      params.push(role.toUpperCase());
    }

    if (department) {
      query += ` AND p.department = ?`;
      params.push(department);
    }

    query += ` ORDER BY p.role_type DESC, qm.queue_order ASC;`;

    const list = await dbAll(query, params);
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 9. EMPLOYEE ACKNOWLEDGEMENT & AUTO RE-ALLOCATION ON CONFLICT
// -------------------------------------------------------------
router.post('/missions/respond', async (req, res) => {
  try {
    const { mission_id, personnel_id, response_status, substitute_emp_code, decline_reason } = req.body;

    if (!mission_id || !personnel_id || !response_status) {
      return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบถ้วน' });
    }

    const assignment = await dbGet(
      `SELECT ma.*, p.name, p.role_type, p.emp_code 
       FROM mission_assignments ma
       JOIN personnel p ON ma.personnel_id = p.id
       WHERE ma.mission_id = ? AND ma.personnel_id = ? AND ma.assignment_status = 'JOINED';`,
      [mission_id, personnel_id]
    );

    if (!assignment) {
      return res.status(404).json({ success: false, error: 'ไม่พบรายการจัดสรรที่ใช้งานอยู่ของบุคลากรท่านนี้' });
    }

    if (response_status === 'ACKNOWLEDGED') {
      await dbRun(
        `UPDATE mission_assignments 
         SET ack_status = 'ACKNOWLEDGED', ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [assignment.id]
      );

      await checkAndUpdateMissionStatus(mission_id);

      return res.json({
        success: true,
        message: `บันทึกการรับทราบเข้าร่วมกิจกรรมของ ${assignment.name} เรียบร้อยแล้ว`
      });


    // =========================================================
    // กรณีที่ 1: ติดภารกิจ/ขอลา แบบ "ไม่มีคนแทน" (รูปแบบ B)
    // =========================================================
    } else if (response_status === 'DECLINED_NO_SUBSTITUTE') {
      const reasonText = decline_reason || 'ติดภารกิจ/ขอลา (ไม่มีคนแทน)';

      // 1. อัปเดตแถวของคนเดิม (ผู้ขอลา)
      await dbRun(
        `UPDATE mission_assignments 
         SET assignment_status = 'DECLINED_NO_SUBSTITUTE', 
             ack_status = 'DECLINED_BUSY', 
             decline_reason = ?, 
             ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [reasonText, assignment.id]
      );

      // 2. รูปแบบ B: ถือว่าใช้สิทธิ์ในรอบนี้แล้ว -> อัปเดตคิวผู้ลาเป็น COMPLETED
      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [personnel_id]
      );

      // 3. ค้นหาพนักงานคนถัดไปในคิว (Auto-Reallocate Next Candidate)
      const nextCandidate = await dbGet(
        `SELECT qm.personnel_id, p.id, p.emp_code, p.name, p.role_type, p.department, p.position, p.email, p.phone, p.line_user_id
         FROM queue_members qm
         JOIN personnel p ON p.id = qm.personnel_id
         WHERE UPPER(qm.role_type) = UPPER(?)
           AND qm.status IN ('WAITING', 'HOLD')
           AND qm.personnel_id != ?
         ORDER BY qm.current_round ASC, qm.queue_order ASC
         LIMIT 1;`,
        [assignment.role_type, personnel_id]
      );

      let replacementMessage = '';
      let replacementPersonName = null;

      if (nextCandidate) {
        // เพิ่มแถวให้พนักงานคนใหม่
        await dbRun(
          `INSERT INTO mission_assignments 
           (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes, ack_status)
           VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?, 'PENDING_ACK');`,
          [
            mission_id,
            nextCandidate.id,
            assignment.role_type,
            assignment.assigned_round,
            assignment.is_leader,
            personnel_id,
            `จัดสรรแทน [${assignment.name} ที่ขอลา (ไม่มีคนแทน)]`
          ]
        );

        // อัปเดตคิวของพนักงานคนใหม่เป็น COMPLETED
        await dbRun(
          `UPDATE queue_members 
           SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
           WHERE personnel_id = ?;`,
          [nextCandidate.id]
        );

        // ตรวจสอบการเลื่อนรอบ
        await checkAndAdvanceRound(assignment.role_type);

        // ส่งการแจ้งเตือน (ส่ง LINE/Email ตามช่องทางที่พนักงานผูกไว้)
        const mission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [mission_id]);
        if (mission) {
          sendMissionNotification(
            mission,
            [{ ...nextCandidate, personnel_id: nextCandidate.id }],
            true
          ).catch(e => console.error('Notification dispatch error:', e));
        }

        const channelNotice = (nextCandidate.line_user_id && nextCandidate.line_user_id.toLowerCase() !== 'email') 
          ? 'ทาง LINE และ อีเมล' 
          : 'ทางอีเมล';

        replacementPersonName = nextCandidate.name;
        replacementMessage = `ระบบได้จัดสรรพนักงานลำดับถัดไปคือ คุณ ${nextCandidate.name} (${nextCandidate.emp_code}) ปฏิบัติงานแทนให้อัตโนมัติแล้ว (ส่งแจ้งเตือน ${channelNotice})`;
      } else {
        await checkAndAdvanceRound(assignment.role_type);
        replacementMessage = `ขณะนี้ไม่มีพนักงานในคิวที่สามารถปฏิบัติงานแทนได้ ระบบจึงลงประวัติขอลาไว้เรียบร้อยแล้ว`;
      }

      return res.json({
        success: true,
        message: `บันทึกการขอลาของ ${assignment.name} เรียบร้อยแล้ว (ถือว่าใช้สิทธิ์ในรอบนี้แล้ว) ${replacementMessage}`,
        replacementPerson: replacementPersonName
      });

    // =========================================================
    // กรณีที่ 2: ติดภารกิจ แบบ "มีผู้ปฏิบัติงานแทน" (ระบุรหัสตัวแทน)
    // =========================================================
    } else if (response_status === 'DECLINED_BUSY') {
      if (!substitute_emp_code) {
        return res.status(400).json({ success: false, error: '📝 กรุณาพิมพ์รหัสผู้ปฏิบัติงานแทน' });
      }

      const substitutePerson = await dbGet(`SELECT * FROM personnel WHERE emp_code = ?;`, [substitute_emp_code]);
      
      if (!substitutePerson) {
        return res.status(404).json({ success: false, error: 'ไม่พบรหัสพนักงานตัวแทนนี้ในระบบ' });
      }

      await dbRun(
        `UPDATE mission_assignments 
         SET assignment_status = 'SUBSTITUTED', ack_status = 'DECLINED_BUSY', decline_reason = ?, ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [`ให้ ${substitutePerson.name} ทำแทน`, assignment.id]
      );

      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [personnel_id]
      );

      await dbRun(
        `INSERT INTO mission_assignments 
         (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes, ack_status)
         VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?, 'PENDING_ACK');`,
        [
          mission_id,
          substitutePerson.id,
          assignment.role_type,
          assignment.assigned_round,
          assignment.is_leader,
          personnel_id,
          `มาเป็นตัวแทนของ [${assignment.name}]`
        ]
      );

      await checkAndAdvanceRound(assignment.role_type);

      const mission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [mission_id]);
      if (mission) {
        sendMissionNotification(
          mission,
          [{ ...substitutePerson, personnel_id: substitutePerson.id }],
          true
        ).catch(e => console.error('Notification dispatch error:', e));
      }

      return res.json({
        success: true,
        message: `ส่งตัวแทนสำเร็จ! เพิ่มชื่อ ${substitutePerson.name} เข้าสู่กิจกรรมแล้ว และส่งแจ้งเตือนให้ตัวแทนเรียบร้อย`,
        replacementPerson: substitutePerson.name
      });
    }

    res.status(400).json({ success: false, error: 'สถานะตอบรับไม่ถูกต้อง' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// -------------------------------------------------------------
// 10. EXPORT SUMMARY REPORT DATA
// -------------------------------------------------------------
router.get('/reports/export', async (req, res) => {
  try {
    const dirState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'DIRECTOR';`);
    const staffState = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = 'STAFF';`);

    const missions = await dbAll(
      `SELECT m.*,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.role_type = 'DIRECTOR' AND ma.assignment_status = 'JOINED') as directors_count,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.role_type = 'STAFF' AND ma.assignment_status = 'JOINED') as staff_count
       FROM missions m ORDER BY m.start_date DESC;`
    );

    const personnel = await dbAll(
      `SELECT p.emp_code, p.name, p.role_type, p.department, p.position, qm.queue_order, qm.status as queue_status, qm.last_assigned_at,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.personnel_id = p.id AND ma.assignment_status = 'JOINED') as total_missions_joined,
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.personnel_id = p.id AND (ma.assignment_status = 'SUBSTITUTED' OR ma.ack_status = 'DECLINED_BUSY')) as total_substituted
       FROM personnel p
       LEFT JOIN queue_members qm ON p.id = qm.personnel_id
       ORDER BY p.role_type DESC, qm.queue_order ASC;`
    );

    // 💡 สิ่งที่เพิ่มใหม่ 1: ดึงประวัติการส่งตัวแทนและการสลับคิวทั้งหมด
    const swapHistory = await dbAll(
      `SELECT 
         m.mission_title, 
         p.emp_code, 
         p.name as original_person, 
         ma.assignment_status, 
         ma.decline_reason as substitute_note, 
         ma.notes as additional_notes,
         ma.ack_at as action_date
       FROM mission_assignments ma
       JOIN personnel p ON ma.personnel_id = p.id
       JOIN missions m ON ma.mission_id = m.id
       WHERE ma.ack_status = 'DECLINED_BUSY' 
          OR ma.assignment_status = 'SUBSTITUTED'
          OR ma.notes LIKE '%มาเป็นตัวแทน%'
       ORDER BY ma.ack_at DESC;`
    );

    const notificationLogs = await dbAll(
      `SELECT nl.channel, nl.recipient, nl.subject_title, nl.status, nl.sent_at 
       FROM notification_logs nl ORDER BY nl.sent_at DESC LIMIT 50;`
    );

    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      system: 'FMO Smart Queue (องค์การสะพานปลา - อสป.)',
      rounds: {
        directorRound: dirState ? dirState.current_round : 1,
        staffRound: staffState ? staffState.current_round : 1
      },
      missions,
      personnel,
      swapHistory, // 💡 สิ่งที่เพิ่มใหม่ 2: ส่งข้อมูลประวัติการสลับคิวออกไปพร้อมกับ JSON
      notificationLogs
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/notifications/logs', async (req, res) => {
  try {
    const logs = await dbAll(
      `SELECT nl.*, m.mission_title
       FROM notification_logs nl
       LEFT JOIN missions m ON nl.mission_id = m.id
       ORDER BY nl.sent_at DESC 
       LIMIT 50;`
    );

    const acknowledgements = await dbAll(
      `SELECT 
        ma.id as assignment_id,
        ma.mission_id,
        ma.personnel_id,
        ma.ack_status,
        ma.ack_at,
        ma.assignment_status,
        p.name as person_name,
        p.emp_code,
        p.line_user_id,
        p.email,
        m.mission_title,
        m.start_date
       FROM mission_assignments ma
       JOIN personnel p ON ma.personnel_id = p.id
       JOIN missions m ON ma.mission_id = m.id
       WHERE ma.assignment_status IN ('JOINED', 'SUBSTITUTED', 'DECLINED_NO_SUBSTITUTE')
       ORDER BY ma.ack_at DESC, ma.id DESC
       LIMIT 100;`
    );

    res.json({ success: true, logs, acknowledgements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/upcoming-notice - แจ้งเตือนเตรียมพร้อมคิวถัดไปทาง LINE / Email
router.post('/notifications/upcoming-notice', async (req, res) => {
  try {
    const { sendUpcomingQueueNotice } = require('../services/notification');
    const result = await sendUpcomingQueueNotice();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



// -------------------------------------------------------------
// 11. IMPORT REAL PERSONNEL DATA (CSV)
// -------------------------------------------------------------
router.post('/personnel/import-csv', async (req, res) => {
  try {
    const { personnelList } = req.body;
    if (!Array.isArray(personnelList) || personnelList.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลรายชื่อบุคลากรในไฟล์' });
    }

    await dbRun(`DELETE FROM mission_assignments;`);
    await dbRun(`DELETE FROM queue_members;`);
    await dbRun(`DELETE FROM personnel;`);
    await dbRun(`UPDATE queue_state SET current_round = 1;`);

    let dirOrder = 1;
    let staffOrder = 1;
    const usedEmpCodes = new Set();

    for (const p of personnelList) {
      const rawName = (p.name || '').trim();
      const rawCode = (p.emp_code || '').trim();

      if (!rawName || rawName.includes('===') || rawName.includes('ลำดับ') || rawName.includes('รหัสพนักงาน')) continue;

      const role = (p.role_type || '').toUpperCase().includes('DIR') ? 'DIRECTOR' : 'STAFF';
      let empCode = rawCode;

      if (!empCode || empCode.includes('===') || empCode.includes('ลำดับ') || empCode.includes('รหัสพนักงาน')) {
        empCode = role === 'DIRECTOR' ? `DIR-${String(dirOrder).padStart(2, '0')}` : `EMP-${String(staffOrder).padStart(3, '0')}`;
      }

      let uniqueEmpCode = empCode;
      let dupCounter = 1;
      while (usedEmpCodes.has(uniqueEmpCode)) {
        uniqueEmpCode = `${empCode}_${dupCounter++}`;
      }
      usedEmpCodes.add(uniqueEmpCode);

      const name = rawName;
      const pos = p.position || (role === 'DIRECTOR' ? 'ผู้อำนวยการฝ่าย' : 'พนักงาน');
      const dept = p.department || 'อสป.';
      const email = p.email || '';
      const phone = p.phone || '';

      const pRes = await dbRun(
        `INSERT INTO personnel (emp_code, name, position, department, role_type, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [uniqueEmpCode, name, pos, dept, role, email, phone]
      );

      const pId = pRes.lastID;
      const order = role === 'DIRECTOR' ? dirOrder++ : staffOrder++;

      await dbRun(
        `INSERT INTO queue_members (personnel_id, role_type, current_round, queue_order, status) VALUES (?, ?, 1, ?, 'WAITING');`,
        [pId, role, order]
      );
    }

    res.json({
      success: true,
      message: `นำเข้าข้อมูลรายชื่อบุคลากรจริงสำเร็จเรียบร้อยแล้ว จำนวนรวม ${usedEmpCodes.size} ท่าน! (ผอ.ฝ่าย ${dirOrder - 1} ท่าน / พนักงาน ${staffOrder - 1} ท่าน)`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 12. LINE OA WEBHOOK ENDPOINT
// -------------------------------------------------------------
router.post('/line-webhook', async (req, res) => {
  res.status(200).send('OK');

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const lineUserId = event.source.userId;
      const userText = event.message.text.trim().toUpperCase();
      const replyToken = event.replyToken;

      try {
        const person = await dbGet(`SELECT * FROM personnel WHERE UPPER(emp_code) = ?`, [userText]);

        let replyMsg = '';
        if (person) {
          await dbRun(`UPDATE personnel SET line_user_id = ? WHERE id = ?`, [lineUserId, person.id]);
          replyMsg = `✅ ผูกบัญชีสำเร็จ!\n\nสวัสดีคุณ ${person.name}\nระบบ FMO Smart Queue ได้เชื่อมต่อกับ LINE ของคุณเรียบร้อยแล้วค่ะ`;
        } else {
          replyMsg = `❌ ไม่พบรหัสพนักงาน "${userText}" ในระบบ\n\nกรุณาพิมพ์รหัสพนักงานใหม่อีกครั้ง เช่น EMP-001 หรือ DIR-01 ค่ะ`;
        }

        if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
          await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken: replyToken,
            messages: [{ type: 'text', text: replyMsg }]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
          });
        }
      } catch (err) {
        console.error('Error handling LINE Webhook:', err);
      }
    }
  }
});

module.exports = router;