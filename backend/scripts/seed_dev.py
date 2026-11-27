"""Create demo data for local development (never run against production).

    uv run python scripts/seed_dev.py

Dev logins (local only):
    owner      9000000001 / devpass123
    caretaker  9000000002 / devpass123   (assigned to "Sunrise HSR" only)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402
from app.db import transaction  # noqa: E402
from app.security import hash_password  # noqa: E402

OWNER_PHONE, CARETAKER_PHONE, PASSWORD = "9000000001", "9000000002", "devpass123"


def main() -> None:
    if get_settings().environment == "prod":
        raise SystemExit("refusing to seed a production database")

    with transaction() as cur:
        cur.execute("SELECT 1 FROM api.auth_get_credentials(%s)", (OWNER_PHONE,))
        if cur.fetchone():
            print("seed data already present")
            return
        cur.execute(
            "SELECT * FROM api.signup_owner(%s, 'Aarav Mehta', %s, 'Nivas PGs')",
            (OWNER_PHONE, hash_password(PASSWORD)),
        )
        row = cur.fetchone()
    owner, org = row["user_id"], row["org_id"]

    with transaction(owner, org) as cur:
        props = {}
        for name, locality, rate in (("Sunrise HSR", "HSR Layout", 800_00), ("Lakeview BTM", "BTM Layout", 700_00)):
            cur.execute(
                """INSERT INTO properties (org_id, name, locality, short_term_daily_rate_paise,
                                           exit_deduction_paise, upi_vpa, upi_payee_name, house_rules)
                   VALUES (%s, %s, %s, %s, 2000_00, 'nivas@paytm', 'Nivas PGs',
                           'Gate closes 11 PM. No outside guests overnight.')
                   RETURNING id""",
                (org, name, locality, rate),
            )
            props[name] = cur.fetchone()["id"]
            for floor, (room, sharing, ac, rent) in enumerate(
                (("101", 2, False, 10_500_00), ("102", 3, False, 6_000_00), ("201", 2, True, 12_000_00)), start=1
            ):
                cur.execute(
                    """INSERT INTO rooms (org_id, property_id, label, floor, sharing, is_ac)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                    (org, props[name], room, floor, sharing, ac),
                )
                room_id = cur.fetchone()["id"]
                for i in range(sharing):
                    cur.execute(
                        """INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (org, props[name], room_id, f"{room}-{'ABC'[i]}", rent),
                    )
        cur.execute(
            "SELECT api.add_staff_member(%s, 'Ravi Kumar', %s, 'caretaker', %s)",
            (CARETAKER_PHONE, hash_password(PASSWORD), [props["Sunrise HSR"]]),
        )
    print("seeded: 1 org, 2 properties, 14 beds, owner + caretaker")


if __name__ == "__main__":
    main()
