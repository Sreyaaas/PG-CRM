-- migrate:up

-- BE-41: one caretaker's cash ledger (threat #1). Same scope and sums as api.cash_balances(): the owner sees any
-- caretaker of the org, a caretaker only themself, and every cash payment they received, every cash expense they
-- paid and every handover is included whichever building it was in (RLS on payments / expenses is per building, so
-- a caretaker who changed buildings would otherwise see a ledger that doesn't add up to their balance).
-- Amounts are signed: + cash in (payments), - cash out (expenses, handovers). Void entries are returned with
-- voided = true; callers leave them out of the running balance, exactly as cash_balances() does.
CREATE FUNCTION api.cash_ledger(p_caretaker uuid)
RETURNS TABLE (
  entry_at timestamptz, entry_type text, id uuid, property_name text, resident_name text,
  expense_category text, notes text, amount_paise bigint, voided boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH who AS (
    SELECT m.user_id
      FROM organization_members m
     WHERE m.org_id = app.current_org_id()
       AND m.user_id = p_caretaker
       AND m.role = 'caretaker'
       AND app.is_member()
       AND (app.is_owner() OR m.user_id = app.current_user_id())
  )
  SELECT pm.received_at, 'payment', pm.id, pr.name, r.full_name, NULL, pm.notes, pm.amount_paise,
         pm.voided_at IS NOT NULL
    FROM payments pm
    JOIN who ON who.user_id = pm.received_by
    JOIN properties pr ON pr.id = pm.property_id
    JOIN residents r ON r.id = pm.resident_id
   WHERE pm.org_id = app.current_org_id() AND pm.method = 'cash'
  UNION ALL
  SELECT e.created_at, 'expense', e.id, pr.name, NULL, e.category::text, e.notes, -e.amount_paise,
         e.voided_at IS NOT NULL
    FROM expenses e
    JOIN who ON who.user_id = e.created_by
    JOIN properties pr ON pr.id = e.property_id
   WHERE e.org_id = app.current_org_id() AND e.paid_from = 'caretaker_cash'
  UNION ALL
  SELECT h.handed_over_at, 'handover', h.id, NULL, NULL, NULL, h.notes, -h.amount_paise, false
    FROM cash_handovers h
    JOIN who ON who.user_id = h.caretaker_user_id
   WHERE h.org_id = app.current_org_id()
  ORDER BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION api.cash_ledger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.cash_ledger(uuid) TO pgcrm_app;

-- migrate:down

DROP FUNCTION IF EXISTS api.cash_ledger(uuid);
