"""Money formatting. Amounts are integer paise everywhere; this is only for text people read."""


def format_inr(paise: int | str | None) -> str:
    """₹ with Indian digit grouping: 15000000 paise -> ₹1,50,000. Paise shown only when not whole rupees."""
    if paise is None:
        return "₹?"
    paise = int(paise)
    rupees, rest = divmod(abs(paise), 100)
    digits = str(rupees)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join([head, *groups, tail]) if head else ",".join([*groups, tail])
    sign = "-" if paise < 0 else ""
    return f"{sign}₹{digits}" + (f".{rest:02d}" if rest else "")
