// server/src/services/multiTenantScheduler.js
import { getPool } from '../db/pool.js';
import { assignQueuedTicketAtomically } from './routingService.js';

let isSchedulingInProgress = false;
let hasQueuedRerun = false;

// In-process debounced scheduler trigger (Concurrency-safe and Render Free compliant)
export function dispatchSchedulingOpportunity(brandId = null) {
  if (isSchedulingInProgress) {
    hasQueuedRerun = true;
    return;
  }

  isSchedulingInProgress = true;
  setImmediate(async () => {
    try {
      await processDueQueuedTicketsMultiTenant();
    } catch (err) {
      console.warn('[SCHEDULER OPPORTUNITY NOTICE] Scheduling cycle completed with notice:', err.message);
    } finally {
      isSchedulingInProgress = false;
      if (hasQueuedRerun) {
        hasQueuedRerun = false;
        dispatchSchedulingOpportunity();
      }
    }
  });
}

export async function processDueQueuedTicketsMultiTenant() {
  const pool = getPool();

  // Strict round-robin fairness across brands using brand_routing_state
  const brandsRes = await pool.query(`
    SELECT
      b.id AS brand_id,
      COUNT(q.id) AS pending_count,
      COALESCE(rs.last_scheduled_at, '1970-01-01'::TIMESTAMPTZ) AS last_served
    FROM brands b
    JOIN ticket_routing_queue q
      ON b.id = q.brand_id AND q.status = 'queued' AND q.next_routing_attempt_at <= NOW()
    LEFT JOIN brand_routing_state rs
      ON b.id = rs.brand_id
    GROUP BY b.id, rs.last_scheduled_at
    ORDER BY last_served ASC, MIN(q.queued_at) ASC
    LIMIT 15
  `);

  let totalAttempts = 0;
  let totalAssigned = 0;
  let processedBrandsCount = 0;
  const maxAttemptsPerCycle = 30; // Bounded assignment attempts
  const maxAssignedPerCycle = 15;  // Bounded successful assignments

  for (const row of brandsRes.rows) {
    if (totalAttempts >= maxAttemptsPerCycle || totalAssigned >= maxAssignedPerCycle) break;
    const brandId = row.brand_id;
    let brandAttempts = 0;
    let brandAssigned = 0;

    // Per-brand batch limit: up to 5 tickets per brand per cycle
    for (let i = 0; i < 5; i++) {
      if (totalAttempts >= maxAttemptsPerCycle || totalAssigned >= maxAssignedPerCycle) break;

      totalAttempts++;
      brandAttempts++;
      const res = await assignQueuedTicketAtomically(brandId);

      if (res.reason === 'NO_DUE_QUEUED_TICKETS' || res.reason === 'NO_ELIGIBLE_AGENT_AVAILABLE') break;
      if (res.assigned) {
        totalAssigned++;
        brandAssigned++;
      }
    }

    if (brandAttempts > 0) {
      processedBrandsCount++;
      // Update persistent round-robin timestamp for this brand
      await pool.query(`
        INSERT INTO brand_routing_state (brand_id, last_scheduled_at, total_tickets_dispatched, updated_at)
        VALUES ($1, NOW(), $2, NOW())
        ON CONFLICT (brand_id) DO UPDATE SET
          last_scheduled_at = NOW(),
          total_tickets_dispatched = brand_routing_state.total_tickets_dispatched + EXCLUDED.total_tickets_dispatched,
          updated_at = NOW()
      `, [brandId, brandAssigned]);
    }
  }

  return { processedBrands: processedBrandsCount, totalAttempts, totalAssigned };
}

export default {
  dispatchSchedulingOpportunity,
  processDueQueuedTicketsMultiTenant
};
