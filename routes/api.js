const express = require('express');
const router = express.Router();
const axios = require('axios');
const { dbRun, dbGet, dbAll } = require('../db/database');
const { sendMissionNotification } = require('../services/notification');

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
  res.status(200).send('OK');

  try {
    const events = req.body.events;

    if (events && events.length > 0) {
      for (const event of events) {
        try {

          // =============================================================
          // A. POSTBACK EVENT: รองรับปุ่มกดรับทราบ / ติดภารกิจ จาก Flex Card
          // =============================================================
          if (event.type === 'postback') {
            const postbackData = (event.postback && event.postback.data) ? event.postback.data : '';
            const lineUserId = event.source?.userId;
            const replyToken = event.replyToken;
            let replyMessages = [];

            // 📍 เพิ่ม Log เพื่อตรวจสอบค่าที่ส่งมาจากปุ่มกด
            console.log(`[DEBUG] 📩 ได้รับข้อมูล Postback จาก LINE:`, postbackData);

            // --- ACK: รับทราบ ---
            if (postbackData.startsWith('ACK|')) {
              const parts = postbackData.split('|');
              const missionId = parseInt(parts[1], 10);
              const personnelId = parseInt(parts[2], 10);

              console.log(`[DEBUG] 🔍 กำลังค้นหาคิว: Mission ID = ${missionId}, Personnel ID = ${personnelId}`);

              // 💡 นำเงื่อนไข AND ma.assignment_status = 'JOINED' ออกชั่วคราว เพื่อให้ค้นหาเจอแน่นอน
              const assignment = await dbGet(
                `SELECT ma.*, p.name FROM mission_assignments ma
                 JOIN personnel p ON ma.personnel_id = p.id
                 WHERE ma.mission_id = ? AND ma.personnel_id = ?;`,
                [missionId, personnelId]
              );

              console.log(`[DEBUG] 📦 ข้อมูลที่ค้นพบในฐานข้อมูล:`, assignment);

              if (assignment) {
                if (assignment.ack_status !== 'ACKNOWLEDGED') {
                  await dbRun(
                    `UPDATE mission_assignments
                    SET ack_status = 'ACKNOWLEDGED',
                        ack_at = CURRENT_TIMESTAMP
                    WHERE id = ?;`,
                    [assignment.id]
                  );

                  const mission = await dbGet(
                    `SELECT mission_title
                    FROM missions
                    WHERE id = ?;`,
                    [missionId]
                  );

                  console.log('========== ACK DEBUG ==========');
                  console.log('mission_id =', missionId);
                  console.log('personnel_id =', personnelId);
                  console.log('assignment_id =', assignment.id);
                  console.log('employee_name =', assignment.name);
                  console.log('mission =', mission);
                  console.log('================================');

                  replyMessages = [{
                    type: 'text',
                    text:
                      `✅ รับทราบแล้วค่ะ คุณ ${assignment.name}\n\n` +
                      `📋 กิจกรรม: ${mission?.mission_title || '-'}\n\n` +
                      `ระบบได้บันทึกการตอบรับของท่านเรียบร้อยแล้ว ขอบคุณค่ะ 🙏`
                  }];

                  console.log(
                    `✅ LINE Postback ACK Success: ${assignment.name} (mission #${missionId})`
                  );
                } else {
                  replyMessages = [{
                    type: 'text',
                    text: 'ℹ️ ท่านได้กดรับทราบกิจกรรมนี้ไปแล้วค่ะ'
                  }];

                  console.log(
                    `ℹ️ LINE Postback ACK Duplicate: ${assignment.name} (mission #${missionId})`
                  );
                }
              } else {
                replyMessages = [{
                  type: 'text',
                  text:
                    `❌ ไม่พบข้อมูลการจัดสรรในระบบ กรุณาติดต่อเจ้าหน้าที่ค่ะ\n` +
                    `(Debug: Act=${missionId}, Emp=${personnelId})`
                }];

                console.log(
                  `❌ LINE Postback ACK Failed: ไม่พบข้อมูล Mission=${missionId}, Personnel=${personnelId}`
                );
              }
            }

            // --- BUSY: ติดภารกิจ → เปลี่ยนสถานะเป็นรอพิมพ์รหัสตัวแทนในแชท ---
            else if (postbackData.startsWith('BUSY|')) {
              const parts = postbackData.split('|');
              const missionId = parseInt(parts[1], 10);
              const personnelId = parseInt(parts[2], 10);

              console.log(`[DEBUG] 🔴 แจ้งติดภารกิจ: Mission ID = ${missionId}, Personnel ID = ${personnelId}`);

              const assignment = await dbGet(
                `SELECT ma.*, p.name FROM mission_assignments ma
                 JOIN personnel p ON ma.personnel_id = p.id
                 WHERE ma.mission_id = ? AND ma.personnel_id = ?;`,
                [missionId, personnelId]
              );

              if (assignment) {
                try {
                  // เปลี่ยนสถานะเป็น BUSY_PENDING (รอรับรหัสตัวแทน)
                  // หมายเหตุ: หากคอลัมน์สถานะของคุณรณิดาชื่ออื่น เช่น 'status' หรือ 'assignment_status' ให้แก้ตรง SET ให้ตรงกันนะครับ
                  await dbRun(
                    `UPDATE mission_assignments SET assignment_status = 'BUSY_PENDING' WHERE id = ?;`,
                    [assignment.id]
                  );
                  
                  const mission = await dbGet(`SELECT mission_title FROM missions WHERE id = ?;`, [missionId]);
                  
                  replyMessages = [{
                    type: 'text',
                    text: `🔴 แจ้งติดภารกิจ (${mission?.mission_title || '-'})\n\nคุณ ${assignment.name} กรุณาพิมพ์ "รหัสพนักงาน" (เช่น EMP-025) ที่ต้องการให้ปฏิบัติงานแทนส่งมาในแชทนี้ได้เลยค่ะ 🙏`
                  }];
                  console.log(`[DEBUG] 🔴 LINE Postback BUSY: ${assignment.name} -> อัปเดตสถานะเป็น BUSY_PENDING แล้ว (รอพิมพ์รหัส)`);
                } catch (dbErr) {
                  console.error('[DB ERROR ตอนกดปุ่มติดภารกิจ]:', dbErr);
                  replyMessages = [{ type: 'text', text: `❌ เกิดข้อผิดพลาดในการบันทึกสถานะ กรุณาตรวจสอบ Log หลังบ้านค่ะ` }];
                }
              } else {
                replyMessages = [{ type: 'text', text: `❌ ไม่พบข้อมูลในระบบ (Debug: Act=${missionId}, Emp=${personnelId})` }];
              }
            }
          }
          // ==========================================
          // 📌 2. โค้ดส่วนรับข้อความพิมพ์ (Text Message)
          // ==========================================
          else if (event.type === 'message' && event.message.type === 'text') {
            const userText = event.message.text.trim();
            const lineUserId = event.source.userId;
            const replyToken = event.replyToken;
            let replyMessages = []; // สร้างตัวแปรเตรียมส่งข้อความ

            // 📍 เพิ่ม Log ให้โชว์ใน Terminal เวลามีคนพิมพ์เข้ามา
            console.log(`[DEBUG] 💬 ได้รับข้อความจากแชท: "${userText}"`);

            // --- 2.1 ดักจับเมื่อผู้ใช้พิมพ์คำว่า "แจ้งติดภารกิจ" ---
            if (userText.includes('แจ้งติดภารกิจ')) {
              try {
                const latestAssignment = await dbGet(`
                  SELECT ma.*, p.name FROM mission_assignments ma
                  JOIN personnel p ON ma.personnel_id = p.id
                  WHERE p.line_user_id = ? AND ma.assignment_status != 'ACKNOWLEDGED' AND ma.assignment_status != 'REPLACED'
                  ORDER BY ma.id DESC LIMIT 1
                `, [lineUserId]);

                if (latestAssignment) {
                  await dbRun(
                    `UPDATE mission_assignments SET assignment_status = 'BUSY_PENDING' WHERE id = ?;`,
                    [latestAssignment.id]
                  );

                  replyMessages = [{
                    type: 'text',
                    text: `🔴 รับทราบการติดภารกิจค่ะ\n\nคุณ ${latestAssignment.name} กรุณาพิมพ์ "รหัสพนักงาน" (เช่น EMP-025) ที่ต้องการให้ปฏิบัติงานแทนส่งมาได้เลยค่ะ 🙏`
                  }];
                  console.log(`[DEBUG] 🔴 อัปเดตสถานะเป็น BUSY_PENDING จากข้อความพิมพ์`);
                } else {
                  replyMessages = [{ type: 'text', text: `❌ ไม่พบรายการกิจกรรมที่ต้องปฏิบัติในขณะนี้ค่ะ` }];
                }
              } catch (dbError) {
                console.error("[DB ERROR ตอนพิมพ์แจ้งติดภารกิจ]:", dbError);
                replyMessages = [{ type: 'text', text: `❌ เกิดข้อผิดพลาดในการดึงข้อมูลค่ะ` }];
              }
            }
            
            // --- 2.2 ผู้ใช้พิมพ์รหัสตัวแทน เช่น EMP-025 ---
            else if (/^(EMP|DIR)-\d+$/i.test(userText)) {

              try {

                  // ค้นหารายการที่กำลังรอตัวแทน
                  const pendingAssignment = await dbGet(`
                    SELECT
                        ma.*,
                        p.name AS original_name,
                        p.emp_code AS original_emp_code
                    FROM mission_assignments ma
                    JOIN personnel p
                        ON ma.personnel_id = p.id
                    WHERE ma.assignment_status='BUSY_PENDING'
                    AND p.line_user_id=?
                    ORDER BY ma.id DESC
                    LIMIT 1
                `, [lineUserId]);

                  if(!pendingAssignment){

                      replyMessages=[{
                          type:'text',
                          text:'⚠️ ไม่พบรายการที่กำลังรอระบุตัวแทน กรุณากด "ติดภารกิจ" ใหม่อีกครั้งค่ะ'
                      }];

                  }else{

            // ค้นหารหัส EMP-025
            const substituteUser = await dbGet(
                `SELECT * FROM personnel WHERE emp_code=?`,
                [userText.toUpperCase()]
            );

            if(!substituteUser){

                replyMessages=[{
                    type:'text',
                    text:`❌ ไม่พบรหัส ${userText}`
                }];

            }else{

                //------------------------------------------------------
                // 1. เปลี่ยนสถานะคนเดิมเป็น "ติดภารกิจ ส่งตัวแทน"
                //------------------------------------------------------

                await dbRun(`
                    UPDATE mission_assignments
                    SET
                        assignment_status = 'SUBSTITUTED',
                        ack_status = 'DECLINED_BUSY',
                        decline_reason = ?,
                        notes = ?,
                        substituted_for_personnel_id = ?,
                        ack_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                [
                    `ติดภารกิจ ส่งตัวแทน ${substituteUser.name} (${substituteUser.emp_code})`,
                    `ส่ง ${substituteUser.name} (${substituteUser.emp_code}) ปฏิบัติงานแทน`,
                    substituteUser.id,
                    pendingAssignment.id
                ]);

                console.log(
                    `🔄 ${pendingAssignment.original_name} ติดภารกิจ และส่ง ${substituteUser.name} (${substituteUser.emp_code}) ปฏิบัติงานแทน`
                );

                //------------------------------------------------------
                // 2. เพิ่มผู้ปฏิบัติงานแทนเข้ากิจกรรม
                //------------------------------------------------------

                await dbRun(`
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
                    VALUES
                    (
                        ?, ?, ?, ?, ?,
                        'JOINED',
                        ?,
                        'PENDING_ACK',
                        ?
                    )
                `,
                [
                    pendingAssignment.mission_id,
                    substituteUser.id,
                    pendingAssignment.role_type,
                    pendingAssignment.assigned_round,
                    pendingAssignment.is_leader,

                    // อ้างอิงถึงคนเดิมที่ติดภารกิจ
                    pendingAssignment.personnel_id,

                    // แสดงในหน้ารายงาน
                    `ปฏิบัติงานแทน ${pendingAssignment.original_name} (${pendingAssignment.original_name || ''})`
                ]);

                console.log(
                    `✅ เพิ่ม ${substituteUser.name} เป็นผู้ปฏิบัติงานแทน ${pendingAssignment.original_name}`
                );


                //------------------------------------------------------
                // 3. โหลดข้อมูลกิจกรรม
                //------------------------------------------------------

                const mission = await dbGet(
                    `SELECT * FROM missions WHERE id=?`,
                    [pendingAssignment.mission_id]
                );


          //------------------------------------------------------
          // 4. ส่ง LINE สีส้มให้ผู้ปฏิบัติงานแทน
          //------------------------------------------------------
          if (mission) {
            console.log('🚀 ก่อนส่ง LINE');
            console.log('📌 Mission ID:', pendingAssignment.mission_id);
            console.log('👤 ผู้ปฏิบัติงานแทน:', substituteUser.name);
            console.log('🔄 ปฏิบัติงานแทน:', pendingAssignment.original_name);

            try {
              const notificationResult = await sendMissionNotification(
                mission,
                [
                  {
                    ...substituteUser,

                    // ID ของผู้ปฏิบัติงานแทน
                    personnel_id: substituteUser.id,

                    // ใช้บทบาทและสถานะหัวหน้าทีมตามงานของคนเดิม
                    role_type: pendingAssignment.role_type,
                    is_leader: pendingAssignment.is_leader,

                    // นำไปแสดงบนหัวการ์ดสีส้ม
                    substitute_for_name:
                      pendingAssignment.original_name || '-',

                    // นำไปแสดงในเนื้อหาการ์ด
                    // หากยังไม่ได้ดึงชื่อหัวหน้าทีม จะแสดงเป็น "-"
                    team_leader_name:
                      pendingAssignment.team_leader_name || '-'
                  }
                ],
                true // true = การ์ดจัดสรรแทนสีส้ม
              );

                if (notificationResult) {
                  console.log(
                    `✅ ส่ง LINE แจ้งผู้ปฏิบัติงานแทนสำเร็จ: ${substituteUser.name}`
                  );
                } else {
                  console.error(
                    `❌ ส่ง LINE แจ้งผู้ปฏิบัติงานแทนไม่สำเร็จ: ${substituteUser.name}`
                  );
                }
              } catch (err) {
                console.error(
                  '❌ sendMissionNotification Error:',
                  err.response?.data || err.message || err
                );
              }
            } else {
              console.error(
                '❌ ไม่พบข้อมูลกิจกรรม mission_id =',
                pendingAssignment.mission_id
              );
            }
                //------------------------------------------------------
                // 5. ตอบกลับคนที่แจ้งติดภารกิจ
                //------------------------------------------------------

                replyMessages=[{
                    type:'text',
                    text:
`✅ ระบบได้บันทึกให้

${substituteUser.name}
(${substituteUser.emp_code})

ปฏิบัติงานแทน : ${pendingAssignment.original_name}

เรียบร้อยแล้วค่ะ

📩 ระบบได้ส่ง LINE แจ้งเตือนไปยังผู้ปฏิบัติงานแทนเรียบร้อยแล้ว`
                }];

            }

        }

    }catch(err){

        console.error(err);

        replyMessages=[{
            type:'text',
            text:'❌ เกิดข้อผิดพลาดในการบันทึกตัวแทน'
        }];

    }

}
            // ==========================================
            // 🚀 คำสั่งส่งข้อความกลับหาผู้ใช้ (ต้องมีส่วนนี้ บอทถึงจะตอบ)
            // ==========================================
            if (replyMessages.length > 0 && replyToken) {
              try {
                await axios.post('https://api.line.me/v2/bot/message/reply', {
                  replyToken: replyToken,
                  messages: replyMessages
                }, {
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                });
                console.log(`[DEBUG] 📤 ส่งข้อความตอบกลับ LINE สำเร็จ!`);
              } catch (replyErr) {
                console.error('[LINE Reply Error (message)]:', replyErr.response?.data || replyErr.message);
              }
            }
          }
          
          // =============================================================
          // B. MESSAGE EVENT: รับรหัสพนักงาน / ยืนยัน PDPA
          // =============================================================
          else if (event.type === 'message' && event.message.type === 'text') {
            const userMessage = event.message.text.trim().toUpperCase();
            const lineUserId = event.source.userId;
            const replyToken = event.replyToken;
            
            let messagesPayload = [];

            // ---------------------------------------------------------
            // 1. รับรหัสพนักงาน -> เช็กซ้ำ -> ส่ง Flex Message ขอความยินยอม (PDPA)
            // ---------------------------------------------------------
            if (userMessage.startsWith('EMP-') || userMessage.startsWith('DIR-')) {
              const person = await dbGet(`SELECT * FROM personnel WHERE UPPER(emp_code) = ?`, [userMessage]);

              if (person) {
                if (person.line_user_id) {
                  messagesPayload = [{
                    type: 'text',
                    text: `⚠️ รหัสรับคิว ${userMessage} ถูกผูกกับบัญชี LINE อื่นไปแล้วค่ะ\n\nหากต้องการแก้ไขหรือเปลี่ยนบัญชี กรุณาติดต่อทีม IT นะคะ 🛠️`
                  }];
                } else {
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
                console.error('LINE Reply API Error:', replyErr.response ? replyErr.response.data : replyErr.message);
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
    // 💡 เพิ่มรับค่า substitute_emp_code จากหน้าเว็บ
    const { mission_id, personnel_id, response_status, substitute_emp_code } = req.body;

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

      return res.json({
        success: true,
        message: `บันทึกการรับทราบเข้าร่วมกิจกรรมของ ${assignment.name} เรียบร้อยแล้ว`
      });

    } else if (response_status === 'DECLINED_BUSY') {
      // 1. ตรวจสอบว่ามีการส่งรหัสตัวแทนมาหรือไม่
      if (!substitute_emp_code) {
        return res.status(400).json({ success: false, error: '📝 กรุณาพิมพ์รหัสผู้ปฏิบัติงานแทน' });
      }

      // 2. ค้นหาข้อมูลพนักงาน "ตัวแทน" จากฐานข้อมูล
      const substitutePerson = await dbGet(`SELECT * FROM personnel WHERE emp_code = ?;`, [substitute_emp_code]);
      
      if (!substitutePerson) {
        return res.status(404).json({ success: false, error: 'ไม่พบรหัสพนักงานตัวแทนนี้ในระบบ' });
      }

      // 3. อัปเดตแถวของ "คนเดิม" ให้สถานะเป็น 'SUBSTITUTED'
      await dbRun(
        `UPDATE mission_assignments 
         SET assignment_status = 'SUBSTITUTED', ack_status = 'DECLINED_BUSY', decline_reason = ?, ack_at = CURRENT_TIMESTAMP 
         WHERE id = ?;`,
        [`ให้ ${substitutePerson.name} ทำแทน`, assignment.id]
      );

      // 4. คิวของ "คนเดิม" ถือว่าใช้คิวไปแล้ว -> ตั้งเป็น COMPLETED (ไม่ใช่ WAITING)
      //    เพื่อไม่ให้ระบบเลือกคนเดิมขึ้นมาเป็น "คิวถัดไป" ซ้ำอีกในรอบเดียวกัน
      await dbRun(
        `UPDATE queue_members 
         SET status = 'COMPLETED', hold_reason = NULL, hold_timestamp = NULL, last_assigned_at = CURRENT_TIMESTAMP 
         WHERE personnel_id = ?;`,
        [personnel_id]
      );

      // 5. เพิ่มแถวใหม่! นำชื่อ "ตัวแทน" เข้าตารางกิจกรรม เพื่อให้แสดงบนหน้าเว็บ
      await dbRun(
        `INSERT INTO mission_assignments 
         (mission_id, personnel_id, role_type, assigned_round, is_leader, assignment_status, substituted_for_personnel_id, notes, ack_status)
         VALUES (?, ?, ?, ?, ?, 'JOINED', ?, ?, 'PENDING_ACK');`,
        [
          mission_id,
          substitutePerson.id,           // รหัสอ้างอิงของตัวแทน
          assignment.role_type,          // บทบาทเดิม
          assignment.assigned_round,
          assignment.is_leader,
          personnel_id,                  // เก็บประวัติว่ามาแทนใคร
          `มาเป็นตัวแทนของ [${assignment.name}]` // ขึ้นตรงช่องสถานะ/หมายเหตุ
        ]
      );

      // 💡 (ไม่แตะคิวของตัวแทนเลย สิทธิ์ในการรอคิวของตัวแทนจึงยังอยู่เหมือนเดิม)

      // 6. เช็คว่าทุกคนในรอบนี้เสร็จหมดหรือยัง (คนเดิมเพิ่ง COMPLETED ไปเมื่อกี้ อาจทำให้ครบรอบพอดี)
      await checkAndAdvanceRound(assignment.role_type);

      // 7. 💡 แจ้งเตือนตัวแทนทั้งทาง Email และ LINE (จุดที่ขาดไปเดิม ทำให้ตัวแทนไม่เคยได้รับแจ้งเตือนเลย)
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
/*router.post('/line-webhook', async (req, res) => {
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
});*/

module.exports = router;