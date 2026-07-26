const express = require('express');
const router = express.Router();
const axios = require('axios');
const { dbRun, dbGet, dbAll } = require('../db/database');
const { sendMissionNotification } = require('../services/notification');

// Helper: Auto-advance round if everyone completed
async function checkAndAdvanceRound(roleType) {
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
  // ตอบ LINE กลับไปทันทีว่าเซิร์ฟเวอร์รับข้อมูลแล้ว (ป้องกัน timeout ถ้าประมวลผลช้า)
  // ส่วนที่เหลือประมวลผลแบบ fire-and-forget ด้านล่าง
  res.status(200).send('OK');

  try {
    const events = req.body.events;

    if (events && events.length > 0) {
      for (const event of events) {
        // ครอบ try/catch รายอีเวนต์ กัน event เดียวพังแล้ว event อื่นในชุดเดียวกันไม่ถูกประมวลผลต่อ
        try {
        // เช็กว่าผู้ใช้ส่ง "ข้อความตัวอักษร" เข้ามาหรือไม่
        if (event.type === 'message' && event.message.type === 'text') {
          const userMessage = event.message.text.trim().toUpperCase();
          const lineUserId = event.source.userId;
          const replyToken = event.replyToken;
          
          let messagesPayload = []; // ตัวแปรสำหรับเก็บก้อนข้อความที่จะตอบกลับ

          // ---------------------------------------------------------
          // 1. รับรหัสพนักงาน -> เช็กซ้ำ -> ส่ง Flex Message ขอความยินยอม (PDPA)
          // ---------------------------------------------------------
          if (userMessage.startsWith('EMP-') || userMessage.startsWith('DIR-')) {
            const person = await dbGet(`SELECT * FROM personnel WHERE UPPER(emp_code) = ?`, [userMessage]);

            if (person) {
              // เช็กระบบป้องกันการผูกซ้ำ (ถ้ามี line_user_id อยู่แล้ว จะไม่ให้ผูกใหม่)
              if (person.line_user_id) {
                messagesPayload = [{
                  type: 'text',
                  text: `⚠️ รหัสรับคิว ${userMessage} ถูกผูกกับบัญชี LINE อื่นไปแล้วค่ะ\n\nหากต้องการแก้ไขหรือเปลี่ยนบัญชี กรุณาติดต่อทีม IT นะคะ 🛠️`
                }];
              } else {
                // ยังไม่เคยผูก: ส่ง Flex Message ขอความยินยอม PDPA
                messagesPayload = [{
                  type: "flex",
                  altText: "ขอความยินยอมการใช้ข้อมูลส่วนบุคคล (PDPA)",
                  contents: {
                    type: "bubble",
                    header: {
                      type: "box",
                      layout: "vertical",
                      backgroundColor: "#0056A0",
                      contents: [
                        { type: "text", text: "นโยบายความเป็นส่วนตัว (PDPA)", weight: "bold", color: "#FFFFFF", size: "sm" },
                        { type: "text", text: "FMO Smart Queue", weight: "bold", size: "xl", color: "#FFFFFF", margin: "sm" }
                      ]
                    },
                    body: {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        { type: "text", text: `สวัสดีคุณ ${person.name}`, weight: "bold", size: "md", color: "#111111", wrap: true },
                        { type: "text", text: "เพื่อความสะดวกในการรับแจ้งเตือนคิวและภารกิจ องค์การสะพานปลา (อสป.) มีความจำเป็นต้องจัดเก็บข้อมูล LINE User ID ของท่าน", wrap: true, size: "sm", color: "#666666", margin: "md" },
                        { type: "text", text: "ข้อมูลนี้จะถูกใช้เพื่อการแจ้งเตือนภายในระบบ FMO Smart Queue เท่านั้น และจะถูกเก็บรักษาตามมาตรฐานความปลอดภัย", wrap: true, size: "sm", color: "#666666", margin: "md" },
                        { type: "text", text: "ท่านยินยอมให้ระบบจัดเก็บข้อมูลหรือไม่?", wrap: true, weight: "bold", size: "sm", color: "#0056A0", margin: "lg" }
                      ]
                    },
                    footer: {
                      type: "box",
                      layout: "vertical",
                      spacing: "sm",
                      contents: [
                        {
                          type: "button",
                          style: "primary",
                          color: "#0056A0",
                          action: { type: "message", label: "✅ ยินยอม (ผูกบัญชี)", text: `CONFIRM-${userMessage}` }
                        },
                        {
                          type: "button",
                          style: "secondary",
                          action: { type: "message", label: "❌ ไม่ยินยอม (ส่งเมลแทน)", text: `CANCEL-${userMessage}` }
                        }
                      ]
                    }
                  }
                }];
              }
            } else {
              messagesPayload = [{
                type: 'text',
                text: `❌ ไม่พบรหัสรับคิว "${userMessage}" ในระบบ 🥺\n\n🔍 กรุณาตรวจสอบและพิมพ์รหัสใหม่อีกครั้งค่ะ 💡`
              }];
            }
          } 
          // ---------------------------------------------------------
          // 2. เมื่อกดปุ่ม "✅ ยินยอม (ผูกบัญชี)" -> บันทึกข้อมูลลงฐานข้อมูล
          // ---------------------------------------------------------
          else if (userMessage.startsWith('CONFIRM-')) {
            const targetEmpCode = userMessage.replace('CONFIRM-', '');
            const person = await dbGet(`SELECT * FROM personnel WHERE UPPER(emp_code) = ?`, [targetEmpCode]);

            if (person) {
              // ใช้ atomic UPDATE พร้อมเงื่อนไข line_user_id IS NULL ใน WHERE
              // กันปัญหากดยืนยันซ้อนกันพอดีแล้วผูกบัญชีทับกัน (race condition)
              const bindResult = await dbRun(
                `UPDATE personnel SET line_user_id = ? WHERE id = ? AND line_user_id IS NULL`,
                [lineUserId, person.id]
              );

              if (bindResult && bindResult.changes > 0) {
                messagesPayload = [{
                  type: 'text',
                  text: `🎉 ยืนยันการผูกบัญชีสำเร็จ! ✅\n\n👋 สวัสดีค่ะ\n👤 ${person.name}\n\n🐟 ระบบ FMO Smart Queue ได้เชื่อมต่อกับ LINE ของคุณเรียบร้อยแล้ว 📱✨\n\n🚀 พร้อมรับการแจ้งเตือนคิวและภารกิจต่างๆ ได้ทันทีค่ะ!`
                }];
              } else {
                messagesPayload = [{ type: 'text', text: `⚠️ รหัสรับคิว ${targetEmpCode} ถูกผูกบัญชีไปแล้วค่ะ` }];
              }
            } else {
              messagesPayload = [{ type: 'text', text: `❌ เกิดข้อผิดพลาด ไม่พบข้อมูลรหัสรับคิวค่ะ` }];
            }
          } 
          // ---------------------------------------------------------
          // 3. เมื่อกดปุ่ม "❌ ไม่ยินยอม (ส่งเมลแทน)" -> แจ้งเปลี่ยนช่องทาง
          // ---------------------------------------------------------
          else if (userMessage.startsWith('CANCEL-')) {
            const targetEmpCode = userMessage.replace('CANCEL-', '');
            const person = await dbGet(`SELECT * FROM personnel WHERE UPPER(emp_code) = ?`, [targetEmpCode]);

            if (person) {
              const userEmail = person.email ? person.email : 'อีเมลองค์กรของคุณ';
              messagesPayload = [{
                type: 'text',
                text: `❌ ท่านไม่ยินยอมให้จัดเก็บข้อมูล (PDPA)\n\nระบบจะไม่มีการผูกบัญชี LINE ค่ะ 🛡️\n\n📧 อย่างไรก็ตาม เพื่อไม่ให้ท่านพลาดการติดต่อ ระบบจะทำการส่งการแจ้งเตือนคิวและภารกิจต่างๆ ไปยังอีเมล:\n👉 ${userEmail}\nโดยอัตโนมัติแทนนะคะ 😊`
              }];
            } else {
              messagesPayload = [{ type: 'text', text: `❌ ยกเลิกการทำรายการเรียบร้อยแล้วค่ะ` }];
            }
          } 
          // ---------------------------------------------------------
          // 4. กรณีพิมพ์ข้อความอื่นๆ ที่ไม่เข้าระบบ
          // ---------------------------------------------------------
          else {
             messagesPayload = [{
               type: 'text',
               text: `ℹ️ หากต้องการผูกบัญชีเข้ากับระบบ FMO Smart Queue กรุณาพิมพ์รหัสพนักงานของคุณ (เช่น EMP-025) ได้เลยค่ะ`
             }];
          }

          // ---------------------------------------------------------
          // ยิง API สั่งให้ LINE ตอบกลับข้อความทั้งหมด
          // ---------------------------------------------------------
          if (messagesPayload.length > 0) {
            try {
              await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: messagesPayload
              }, {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                }
              });
            } catch (replyErr) {
              // LINE จะส่งรายละเอียด error ที่แท้จริงมาใน response.data
              // เช่น invalid reply token, invalid channel access token ฯลฯ
              console.error(
                'LINE Reply API Error:',
                replyErr.response ? replyErr.response.data : replyErr.message
              );
            }
          }
        }
        } catch (eventErr) {
          console.error('Event processing error:', eventErr);
        }
      }
    }
  } catch (err) {
    console.error('Webhook Error:', err);
  }
});

router.post('/missions/preview-candidates', async (req, res) => {
  try {
    const { required_directors = 1, required_staff = 1 } = req.body;

    const selectCandidatesForRole = async (roleType, count) => {
      if (count <= 0) return [];

      const candidates = await dbAll(
        `SELECT 
           qm.personnel_id, 
           qm.role_type, 
           qm.current_round,
           p.emp_code,
           p.name,
           p.department,
           p.position,
           p.email,
           p.phone
          FROM queue_members qm
          JOIN personnel p ON qm.personnel_id = p.id
          WHERE UPPER(qm.role_type) = UPPER(?) AND qm.status IN ('HOLD', 'WAITING')
          ORDER BY qm.current_round ASC, qm.queue_order ASC
          LIMIT ?`,
          [roleType, count]
      );

      return candidates;
    };

    const directors = await selectCandidatesForRole('DIRECTOR', required_directors);
    const staff = await selectCandidatesForRole('STAFF', required_staff);

    res.json({
      success: true,
      data: {
        directors,
        staff
      }
    });
  } catch (err) {
    console.error('Preview Candidates Error:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

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

    // 2. Insert Mission Record
    const mRes = await dbRun(
      `INSERT INTO missions (mission_title, description, location, dress_code, start_date, end_date, required_directors, required_staff, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED');`,
      [
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
        `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status)
         VALUES (?, ?, 'DIRECTOR', ?, 1, 'JOINED');`,
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
        `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status)
         VALUES (?, ?, 'STAFF', ?, 0, 'JOINED');`,
        [missionId, pId, currentStaffRound]
      );

      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [pId]
      );
    }

    // 5. Strict Round Control Progression Check
    const dirAdvance = await checkAndAdvanceRound('DIRECTOR');
    const staffAdvance = await checkAndAdvanceRound('STAFF');

    // 6. Dispatch LINE Group & Email Notifications
    const createdMission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [missionId]);
    const assignedPersonnel = await dbAll(
      `SELECT ma.*, p.emp_code, p.name, p.role_type, p.department, p.position, p.email, p.phone
       FROM mission_assignments ma
       JOIN personnel p ON ma.personnel_id = p.id
       WHERE ma.mission_id = ? AND ma.assignment_status = 'JOINED';`,
      [missionId]
    );

    sendMissionNotification(createdMission, assignedPersonnel).catch(e => console.error('Notification dispatch error:', e));

    res.json({
      success: true,
      message: 'สร้างกิจกรรม จัดสรรคิว และส่งการแจ้งเตือน Email & LINE Group เรียบร้อยแล้ว',
      missionId,
      roundAdvance: { director: dirAdvance, staff: staffAdvance }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 5. EMERGENCY SUBSTITUTION (การเปลี่ยนตัวกะทันหัน)
// -------------------------------------------------------------
router.post('/missions/substitute', async (req, res) => {
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
});

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

// -------------------------------------------------------------
// 8. ALL MISSIONS & PERSONNEL LISTS
// -------------------------------------------------------------
router.get('/missions', async (req, res) => {
  try {
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
    const { mission_id, personnel_id, response_status, decline_reason } = req.body;

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

    const mission = await dbGet(`SELECT * FROM missions WHERE id = ?;`, [mission_id]);

    if (response_status === 'ACKNOWLEDGED') {
      await dbRun(
        `UPDATE mission_assignments 
         SET ack_status = 'ACKNOWLEDGED', ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [assignment.id]
      );

      return res.json({
        success: true,
        message: `บันทึกการรับทราบเข้าร่วมกิจกรรมของ ${assignment.name} เรียบร้อยแล้ว`
      });
    } else if (response_status === 'DECLINED_BUSY') {
      const reasonText = decline_reason || 'ติดภารกิจซ้อน (ขอสลับคิวอัตโนมัติ)';

      await dbRun(
        `UPDATE mission_assignments 
         SET assignment_status = 'SUBSTITUTED', ack_status = 'DECLINED_BUSY', decline_reason = ?, ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [reasonText, assignment.id]
      );

      await dbRun(
        `UPDATE queue_members 
         SET status = 'HOLD', hold_reason = ?, hold_timestamp = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [reasonText, personnel_id]
      );

      const roleType = assignment.role_type;
      const state = await dbGet(`SELECT current_round FROM queue_state WHERE role_type = ?;`, [roleType]);
      const currentRound = state ? state.current_round : 1;

      const nextCandidate = await dbGet(
        `SELECT qm.*, p.name, p.emp_code, p.department, p.position, p.email, p.phone
         FROM queue_members qm
         JOIN personnel p ON qm.personnel_id = p.id
         WHERE qm.role_type = ? AND qm.status IN ('HOLD', 'WAITING')
           AND qm.personnel_id NOT IN (
             SELECT personnel_id FROM mission_assignments WHERE mission_id = ? AND assignment_status = 'JOINED'
           )
         ORDER BY CASE qm.status WHEN 'HOLD' THEN 1 WHEN 'WAITING' THEN 2 END, qm.queue_order ASC
         LIMIT 1;`,
        [roleType, mission_id]
      );

      let replacementName = '';
      if (nextCandidate) {
        replacementName = nextCandidate.name;
        await dbRun(
          `INSERT INTO mission_assignments (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes, ack_status)
           VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?, 'PENDING_ACK');`,
          [
            mission_id,
            nextCandidate.personnel_id,
            roleType,
            currentRound,
            assignment.is_leader,
            personnel_id,
            `จัดสรรทดแทนอัตโนมัติ เนื่องจาก [${assignment.name}] ติดภารกิจ`
          ]
        );

        await dbRun(
          `UPDATE queue_members 
           SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
           WHERE personnel_id = ?;`,
          [nextCandidate.personnel_id]
        );

        await checkAndAdvanceRound(roleType);
        sendMissionNotification(mission, [nextCandidate], true).catch(e => console.error('Notification dispatch error:', e));
      }

      return res.json({
        success: true,
        message: `บันทึกการติดภารกิจของ ${assignment.name} เรียบร้อยแล้ว ➔ ระบบสลับสิทธิ์เป็น HOLD และจัดสรร ${replacementName || 'พนักงานคิวถัดไป'} เข้ามาทำแทนให้อัตโนมัติ!`,
        replacementPerson: replacementName
      });
    }

    res.status(400).json({ success: false, error: 'สถานะตอบรับไม่ถูกต้อง' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET NOTIFICATION LOGS
router.get('/notifications/logs', async (req, res) => {
  try {
    const logs = await dbAll(
      `SELECT nl.*, m.mission_title, p.name as person_name 
       FROM notification_logs nl
       LEFT JOIN missions m ON nl.mission_id = m.id
       LEFT JOIN personnel p ON nl.personnel_id = p.id
       ORDER BY nl.sent_at DESC
       LIMIT 20;`
    );
    res.json({ success: true, logs });
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
        (SELECT COUNT(*) FROM mission_assignments ma WHERE ma.personnel_id = p.id AND ma.assignment_status = 'JOINED') as total_missions_joined
       FROM personnel p
       LEFT JOIN queue_members qm ON p.id = qm.personnel_id
       ORDER BY p.role_type DESC, qm.queue_order ASC;`
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
      notificationLogs
    });
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

module.exports = router;