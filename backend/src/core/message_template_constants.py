"""
Default message templates for appointment confirmations and reminders.

These constants are used to populate new appointment types and during migration.
Each appointment type stores its own message text (not system-wide), and admins
can edit them per appointment type.
"""

# Patient-triggered confirmation message (when patient books via LIFF)
DEFAULT_PATIENT_CONFIRMATION_MESSAGE = """{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！"""

# Clinic-triggered confirmation message (when clinic user creates appointment)
DEFAULT_CLINIC_CONFIRMATION_MESSAGE = """{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！"""

# Reminder message (sent before appointment)
DEFAULT_REMINDER_MESSAGE = """提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。

請準時前往診所，期待為您服務！"""

# Recurring clinic-triggered confirmation message (when clinic creates multiple appointments)
DEFAULT_RECURRING_CLINIC_CONFIRMATION_MESSAGE = """{病患姓名}，已為您建立{預約數量}個預約：

{日期範圍}

{預約列表}

【{服務項目}】{治療師姓名}

期待為您服務！"""

# Maximum number of appointments to display in recurring appointment lists
MAX_APPOINTMENTS_IN_LIST = 100

