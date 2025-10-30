# pyright: reportMissingTypeStubs=false
"""
Tool for getting weekday information for all dates in a specific month.

This tool helps agents understand which days of the week correspond to specific dates,
particularly useful for handling complex date references like "下個月第三個星期二".
"""

import logging
from datetime import date

from agents import function_tool, RunContextWrapper

from clinic_agents.context import ConversationContext

logger = logging.getLogger(__name__)


async def get_month_weekdays_impl(
    wrapper: RunContextWrapper[ConversationContext],
    year: int,
    month: int
) -> str:
    """
    Core implementation for getting weekday information for all dates in a specific month.

    Args:
        wrapper: Context wrapper (auto-injected)
        year: Year (e.g., 2024)
        month: Month (1-12)

    Returns:
        Compact string with all dates and their weekdays for the month
    """
    logger.debug(f"📅 [get_month_weekdays] Getting weekday info for {year}-{month:02d}")

    try:
        # Validate input
        if not (1 <= month <= 12):
            return "錯誤：月份必須在1-12之間"

        if year < 1900 or year > 2100:
            return "錯誤：年份必須在1900-2100之間"

        # Get all dates in the month
        import calendar

        # Get the number of days in the month
        _, days_in_month = calendar.monthrange(year, month)

        # Chinese weekday names (Monday = 0, Sunday = 6)
        weekday_names = ["一", "二", "三", "四", "五", "六", "日"]

        # Build compact date list
        date_entries: list[str] = []
        for day in range(1, days_in_month + 1):
            date_obj = date(year, month, day)
            weekday_name = weekday_names[date_obj.weekday()]
            date_entries.append(f"{year}年{month}月{day}日({weekday_name})")

        result = " | ".join(date_entries)

        logger.debug(f"✅ [get_month_weekdays] Generated weekday info for {days_in_month} days")
        return result

    except ValueError as e:
        logger.exception(f"Invalid date parameters in get_month_weekdays: {e}")
        return f"錯誤：無效的日期參數：{str(e)}"
    except Exception as e:
        logger.exception(f"Unexpected error in get_month_weekdays: {e}")
        return f"錯誤：獲取月份日期資訊時發生錯誤：{str(e)}"


@function_tool
async def get_month_weekdays(
    wrapper: RunContextWrapper[ConversationContext],
    year: int,
    month: int
) -> str:
    """
    Get weekday information for all dates in a specific month.

    This tool provides a compact list of all dates in the specified month with their
    corresponding weekdays in Chinese. This is particularly useful for handling
    complex date references like "下個月第三個星期二" (the third Tuesday of next month).

    Args:
        wrapper: Context wrapper containing database session and clinic information (auto-injected)
        year: Year as integer (e.g., 2024)
        month: Month as integer (1-12)

    Returns:
        Compact string with all dates in the month and their weekdays, formatted as:
        "2024年11月1日(一) | 2024年11月2日(二) | ... | 2024年11月30日(日)"
        Returns error message if parameters are invalid.
    """
    return await get_month_weekdays_impl(
        wrapper=wrapper,
        year=year,
        month=month
    )
