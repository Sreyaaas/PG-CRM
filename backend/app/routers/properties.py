from fastapi import APIRouter

from app.deps import Org
from app.schemas import Property

router = APIRouter(tags=["properties"])

_COLUMNS = """
  id, name, address, locality, qr_slug, upi_vpa, upi_payee_name,
  short_term_daily_rate_paise, exit_deduction_paise, is_active, created_at
"""


@router.get("/properties", response_model=list[Property])
def list_properties(ctx: Org) -> list[Property]:
    """Properties the caller can access. Caretakers see only assigned buildings
    (enforced by RLS, not by this query)."""
    with ctx.tx() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM properties ORDER BY name")
        return [Property(**r) for r in cur.fetchall()]
