const { dbAll, dbRun } = require('../database/db');

async function getSchedule() {
    return dbAll(
        `SELECT id, day_of_week, day_name, is_open, open_time, close_time, note, sync_status
         FROM live_store_schedule
         ORDER BY day_of_week ASC`,
        []
    );
}

async function updateDay(dayOfWeek, { is_open, open_time, close_time, note }) {
    await dbRun(
        `UPDATE live_store_schedule
         SET is_open=?, open_time=?, close_time=?, note=?, sync_status=0, updated_at=CURRENT_TIMESTAMP
         WHERE day_of_week=?`,
        [is_open ? 1 : 0, open_time || '08:00', close_time || '20:00', note || null, dayOfWeek]
    );
}

async function saveSchedule(days) {
    for (const day of days) {
        await updateDay(day.day_of_week, day);
    }
}

async function getUnsyncedSchedule() {
    return dbAll(
        `SELECT day_of_week, day_name, is_open, open_time, close_time, note
         FROM live_store_schedule
         WHERE sync_status = 0
         ORDER BY day_of_week ASC`,
        []
    );
}

async function markScheduleSynced(dayOfWeeks) {
    if (!dayOfWeeks.length) return;
    const placeholders = dayOfWeeks.map(() => '?').join(',');
    await dbRun(
        `UPDATE live_store_schedule SET sync_status=1, updated_at=CURRENT_TIMESTAMP
         WHERE day_of_week IN (${placeholders})`,
        dayOfWeeks
    );
}

module.exports = { getSchedule, updateDay, saveSchedule, getUnsyncedSchedule, markScheduleSynced };
