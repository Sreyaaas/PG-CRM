"""Billing formulas (docs/PRODUCT.md -> "Billing rules"). Integer paise only, no floats.

Used at check-in (BE-22), for notice (BE-24) and by monthly billing (BE-30).
"""

import calendar
from datetime import date, timedelta


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def round_to_rupee(numerator: int, denominator: int) -> int:
    """numerator / denominator paise, rounded half up to a whole rupee (100 paise)."""
    return (numerator + denominator * 50) // (denominator * 100) * 100


def first_month_rent(monthly_rent_paise: int, check_in: date) -> int:
    """Pro-rata rent from the check-in day to the month end, both included.

    round_to_rupee(monthly_rent × days_stayed ÷ days_in_month). Check-in on the 1st = the full month.
    ₹10,500 from 18 Nov: 13 of 30 days -> ₹4,550.
    """
    days_in_month = calendar.monthrange(check_in.year, check_in.month)[1]
    if check_in.day == 1:
        return monthly_rent_paise
    days_stayed = days_in_month - check_in.day + 1
    return round_to_rupee(monthly_rent_paise * days_stayed, days_in_month)


def short_term_nights(check_in: date, check_out: date) -> int:
    """Nights between check-in and check-out, at least 1."""
    return max(1, (check_out - check_in).days)


def short_term_amount(daily_rate_paise: int, check_in: date, check_out: date) -> int:
    """Short stays: daily rate × nights, charged at check-in."""
    return daily_rate_paise * short_term_nights(check_in, check_out)


def notice_last_day(notice_date: date, deadline_day: int) -> date:
    """Monthly stays: notice on or before `deadline_day` of month M -> leave by the end of M; after it -> the end of
    M+1. Deadline 5: 5 Nov -> 30 Nov, 6 Nov -> 31 Dec. Same calculation as SQL `app.notice_last_day`."""
    if notice_date.day <= deadline_day:
        return month_end(notice_date)
    next_month = month_end(notice_date) + timedelta(days=1)
    return month_end(next_month)
