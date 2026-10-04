const { query } = require('../config/db');

/**
 * Retrieve paginated audit logs with filtering (Super Admin only)
 */
async function getAuditLogs(req, res) {
  try {
    const {
      action,
      entityType,
      userId,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (action) {
      conditions.push(`a.action = $${idx++}`);
      params.push(action);
    }

    if (entityType) {
      conditions.push(`a.entity_type = $${idx++}`);
      params.push(entityType);
    }

    if (userId) {
      conditions.push(`a.user_id = $${idx++}`);
      params.push(userId);
    }

    if (startDate) {
      conditions.push(`a.created_at >= $${idx++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`a.created_at <= $${idx++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT
        a.*,
        u.full_name as actor_name,
        u.email as actor_email,
        u.role as actor_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT COUNT(a.id) as total_count
      FROM audit_logs a
      ${whereClause}
    `;

    const [listRes, countRes] = await Promise.all([
      query(listQuery, [...params, parseInt(limit, 10), parseInt(offset, 10)]),
      query(countQuery, params)
    ]);

    return res.json({
      success: true,
      totalCount: parseInt(countRes.rows[0].total_count, 10),
      logs: listRes.rows
    });
  } catch (err) {
    console.error('[GetAuditLogs Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
}

/**
 * Retrieve audit statistics / summaries
 */
async function getAuditSummary(req, res) {
  try {
    const actionCountsRes = await query(`
      SELECT action, COUNT(id) as count
      FROM audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `);

    const entityCountsRes = await query(`
      SELECT entity_type, COUNT(id) as count
      FROM audit_logs
      GROUP BY entity_type
      ORDER BY count DESC
    `);

    return res.json({
      success: true,
      topActions: actionCountsRes.rows,
      entityTypes: entityCountsRes.rows
    });
  } catch (err) {
    console.error('[GetAuditSummary Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve audit summary.' });
  }
}

module.exports = {
  getAuditLogs,
  getAuditSummary
};
